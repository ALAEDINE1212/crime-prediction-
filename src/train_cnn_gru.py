# src/train_cnn_gru.py
from __future__ import annotations

import os
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

import argparse
from pathlib import Path
from typing import List, Set, Tuple, Optional, Dict

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset, DataLoader

from dl_cnn_gru import build_grid_index, build_month_tensor, CNNGRU, masked_huber


# Columns that are NOT model features
ID_COLS = {
    "month", "cell_id", "cell_x", "cell_y",
    "lat", "lon", "latitude", "longitude",
    "lsoa", "lsoa_code", "crime_type", "outcome",
    "index"
}

# Explicit indicators of label leakage (future info)
LEAK_SUBSTR = ("target", "label", "next", "y_")

# ONS-type globals (broadcast) — treated explicitly, never guessed
SOCIO_PREFIXES = (
    "wellbeing_",
    "no_qualifications",
    "fe_participation",
    "children_",
    "modelled_",
    "economic_",
    "median_",
)

# Feature patterns that are safe predictors (NO "count" here!)
SAFE_FEATURE_PATTERNS = (
    "lag", "roll", "rolling", "ewm", "ema", "nbr_",
    "mean", "std", "sum", "max", "min"
)


def pick_channels(df: pd.DataFrame, use_socio: bool, max_channels: int) -> Tuple[List[str], Set[str]]:
    """
    Pick spatial channels (count + lag/rolling/neighbour/etc) and optional global socio channels.

    Critically: EXCLUDES any columns that look like targets/future labels.
    """
    # Numeric-only candidates
    num_cols = list(df.select_dtypes(include=[np.number]).columns)
    num_cols = [c for c in num_cols if c not in ID_COLS]

    # Explicit global channels (ONS etc.)
    global_channels: Set[str] = set()
    if use_socio:
        for c in num_cols:
            if c.startswith(SOCIO_PREFIXES):
                global_channels.add(c)

    # Spatial candidates (numeric, non-ID, non-global, non-leaky)
    spatial_candidates: List[str] = []
    for c in num_cols:
        cl = c.lower()
        if c in global_channels:
            continue
        # drop anything that smells like a label / future target
        if any(s in cl for s in LEAK_SUBSTR):
            continue
        spatial_candidates.append(c)

    # Must include current-month count
    if "count" not in df.columns:
        raise ValueError("features parquet must include 'count' column")
    if "count" not in spatial_candidates:
        spatial_candidates.insert(0, "count")

    # Build picked list: count first, then safe temporal/spatial predictors
    picked: List[str] = ["count"]
    for c in spatial_candidates:
        if c == "count":
            continue
        cl = c.lower()
        if any(p in cl for p in SAFE_FEATURE_PATTERNS):
            picked.append(c)

    # Cap channels for VRAM sanity
    if max_channels is not None and len(picked) > max_channels:
        picked = picked[:max_channels]

    channels = picked + (sorted(global_channels) if use_socio else [])
    return channels, global_channels


def precision_at_k(y_true: np.ndarray, y_pred: np.ndarray, mask: np.ndarray, top_pct: float) -> float:
    yt = y_true[mask].ravel()
    yp = y_pred[mask].ravel()
    n = len(yt)
    k = max(1, int(np.ceil(n * top_pct)))
    top_true = np.argpartition(-yt, k - 1)[:k]
    top_pred = np.argpartition(-yp, k - 1)[:k]
    return len(set(top_true).intersection(set(top_pred))) / k


def compute_channel_stats(X: np.ndarray, mask: np.ndarray, train_end: int) -> Tuple[np.ndarray, np.ndarray]:
    """
    X: (T,C,H,W)
    Compute mean/std per channel using months [0..train_end) on valid cells only.
    """
    T, C, H, W = X.shape
    m = mask.astype(bool)
    means = np.zeros((C,), dtype=np.float32)
    stds = np.ones((C,), dtype=np.float32)

    for c in range(C):
        vals = X[:train_end, c][:, m].reshape(-1)
        if vals.size == 0:
            means[c] = 0.0
            stds[c] = 1.0
            continue
        mu = float(np.mean(vals))
        sd = float(np.std(vals))
        means[c] = mu
        stds[c] = sd if sd > 1e-6 else 1.0

    return means, stds


class SeqDataset(Dataset):
    def __init__(
        self,
        X: np.ndarray,          # (T,C,H,W) raw
        y_log: np.ndarray,      # (T,H,W) log1p(count)
        idxs: List[int],        # forecast month indices t used for training
        lookback: int,
        mean: np.ndarray,       # (C,)
        std: np.ndarray,        # (C,)
    ):
        self.X = X
        self.y = y_log
        self.idxs = idxs
        self.lookback = lookback
        self.mean = mean.astype(np.float32)
        self.std = std.astype(np.float32)

    def __len__(self):
        return len(self.idxs)

    def __getitem__(self, i: int):
        t = self.idxs[i]
        x_seq = self.X[t - self.lookback:t].copy()  # (L,C,H,W)
        x_seq = (x_seq - self.mean[None, :, None, None]) / self.std[None, :, None, None]
        y = self.y[t]
        return torch.from_numpy(x_seq), torch.from_numpy(y)


def train_for_one_forecast(
    X: np.ndarray,
    y_log: np.ndarray,
    mask_t: torch.Tensor,
    lookback: int,
    train_end: int,
    val_months: int,
    device: torch.device,
    in_channels: int,
    hidden: int,
    epochs: int,
    batch_size: int,
    lr: float,
    weight_decay: float,
    warm_state: Optional[Dict[str, torch.Tensor]] = None,
) -> Tuple[CNNGRU, np.ndarray, np.ndarray, Dict[str, torch.Tensor]]:
    """
    Train using months < train_end, validate on last val_months before train_end.
    Returns trained model + mean/std used + state dict for warm start.
    """
    mean, std = compute_channel_stats(X, mask_t.cpu().numpy(), train_end)

    all_t = list(range(lookback, train_end))
    if len(all_t) < 5:
        raise ValueError("Not enough samples to train (increase history or reduce lookback).")

    val_start = max(lookback, train_end - val_months)
    train_t = [t for t in all_t if t < val_start]
    val_t = [t for t in all_t if t >= val_start]

    if len(train_t) < 3 or len(val_t) < 1:
        val_t = all_t[-1:]
        train_t = all_t[:-1]

    train_ds = SeqDataset(X, y_log, train_t, lookback, mean, std)
    val_ds = SeqDataset(X, y_log, val_t, lookback, mean, std)

    train_loader = DataLoader(
        train_ds, batch_size=batch_size, shuffle=True, num_workers=0,
        pin_memory=(device.type == "cuda")
    )
    val_loader = DataLoader(
        val_ds, batch_size=batch_size, shuffle=False, num_workers=0,
        pin_memory=(device.type == "cuda")
    )

    model = CNNGRU(in_channels=in_channels, hidden=hidden).to(device)
    if warm_state is not None:
        model.load_state_dict(warm_state, strict=True)

    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, mode="min", factor=0.5, patience=3)

    best_val = float("inf")
    best_state = None
    patience = 7
    bad = 0

    for ep in range(1, epochs + 1):
        model.train()
        tr_losses = []
        for xb, yb in train_loader:
            xb = xb.to(device, non_blocking=True).float()
            yb = yb.to(device, non_blocking=True).float()

            opt.zero_grad(set_to_none=True)
            pred = model(xb)
            loss = masked_huber(pred, yb, mask_t.to(device), delta=1.0)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()

            tr_losses.append(loss.item())

        model.eval()
        va_losses = []
        with torch.no_grad():
            for xb, yb in val_loader:
                xb = xb.to(device, non_blocking=True).float()
                yb = yb.to(device, non_blocking=True).float()
                pred = model(xb)
                loss = masked_huber(pred, yb, mask_t.to(device), delta=1.0)
                va_losses.append(loss.item())

        va = float(np.mean(va_losses)) if va_losses else float("nan")
        scheduler.step(va)

        if va < best_val:
            best_val = va
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            bad = 0
        else:
            bad += 1
            if bad >= patience:
                break

        if device.type == "cuda":
            torch.cuda.empty_cache()

    if best_state is not None:
        model.load_state_dict(best_state)

    warm = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    return model, mean, std, warm


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--features", type=str, default="data/processed/cell_month_features.parquet")
    ap.add_argument("--dimcell", type=str, default="data/processed/dim_cell.parquet")
    ap.add_argument("--outcsv", type=str, default="data/processed/wf_cnn_gru_summary.csv")

    ap.add_argument("--use_socio", action="store_true")
    ap.add_argument("--max_channels", type=int, default=32)

    ap.add_argument("--lookback", type=int, default=6)
    ap.add_argument("--hidden", type=int, default=32)
    ap.add_argument("--epochs", type=int, default=25)
    ap.add_argument("--batch_size", type=int, default=2)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--weight_decay", type=float, default=1e-4)

    ap.add_argument("--val_months", type=int, default=3)
    ap.add_argument("--eval_months", type=int, default=4)
    ap.add_argument("--top_pct", type=float, default=0.05)

    ap.add_argument("--no_warm_start", action="store_true")
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[INFO] device={device}")

    df = pd.read_parquet(Path(args.features)).copy()
    dim = pd.read_parquet(Path(args.dimcell)).copy()

    # Drop the known leaky column if it exists
    if "target_next_count" in df.columns:
        df = df.drop(columns=["target_next_count"])

    df["month"] = pd.PeriodIndex(df["month"].astype(str), freq="M")
    months = sorted(df["month"].unique())
    T = len(months)

    grid = build_grid_index(dim)
    mask_np = grid.mask
    mask_t = torch.from_numpy(mask_np)

    channels, global_channels = pick_channels(df, use_socio=args.use_socio, max_channels=args.max_channels)
    print(f"[INFO] months={T} | grid=({grid.H},{grid.W}) | channels={len(channels)} (global={len(global_channels)})")
    print("[INFO] channel list:", channels)

    # Sanity check: ensure no leakage columns slipped in
    bad = [c for c in channels if any(s in c.lower() for s in LEAK_SUBSTR)]
    if bad:
        raise RuntimeError(f"Leakage columns still in channels: {bad}")

    if T < args.lookback + args.val_months + 2:
        raise ValueError("Not enough months for requested lookback/val setup.")

    # Build month tensors (raw)
    X_list = []
    for m in months:
        Xm = build_month_tensor(df, grid, m, channels, global_channels=global_channels)
        X_list.append(Xm)
    X = np.stack(X_list, axis=0)  # (T,C,H,W)
    del X_list

    # Target is log1p(count) of forecast month
    if channels[0] != "count":
        raise RuntimeError("channels[0] must be 'count'")
    y_count = X[:, 0].copy()                         # (T,H,W)
    y_log = np.log1p(y_count).astype(np.float32)     # (T,H,W)

    eval_start = max(args.lookback + 1, T - args.eval_months)
    eval_idxs = list(range(eval_start, T))
    print(f"[INFO] Evaluating months: {months[eval_start]} .. {months[T-1]} ({len(eval_idxs)} months)")

    warm_state = None
    warm_start = not args.no_warm_start

    rows = []
    for t in eval_idxs:
        forecast_month = months[t]
        train_end = t  # train on months < t
        print(f"\n[WF] forecast={forecast_month} | train_months=0..{months[train_end-1]}")

        model, mean, std, warm_state_new = train_for_one_forecast(
            X=X,
            y_log=y_log,
            mask_t=mask_t,
            lookback=args.lookback,
            train_end=train_end,
            val_months=args.val_months,
            device=device,
            in_channels=X.shape[1],
            hidden=args.hidden,
            epochs=args.epochs,
            batch_size=args.batch_size,
            lr=args.lr,
            weight_decay=args.weight_decay,
            warm_state=(warm_state if warm_start else None),
        )
        warm_state = warm_state_new

        # input sequence for forecast month t
        x_seq = X[t - args.lookback:t].copy()  # (L,C,H,W)
        x_seq = (x_seq - mean[None, :, None, None]) / std[None, :, None, None]
        xb = torch.from_numpy(x_seq[None, ...]).to(device).float()

        model.eval()
        with torch.no_grad():
            pred_log = model(xb).cpu().numpy()[0]  # (H,W)

        pred_count = np.expm1(pred_log).astype(np.float32)
        true_count = y_count[t].astype(np.float32)

        m = mask_np
        err = pred_count[m] - true_count[m]
        mae = float(np.mean(np.abs(err)))
        rmse = float(np.sqrt(np.mean(err ** 2)))
        pak = precision_at_k(true_count, pred_count, m, args.top_pct)

        print(f"[WF-TEST] {forecast_month} | MAE={mae:.3f} RMSE={rmse:.3f} P@K={pak:.3f}")

        rows.append({
            "forecast_month": str(forecast_month),
            "MAE": mae,
            "RMSE": rmse,
            "precision_at_k": pak,
            "channels": len(channels),
            "use_socio": bool(args.use_socio),
            "lookback": args.lookback,
        })

        if device.type == "cuda":
            torch.cuda.empty_cache()

    out = pd.DataFrame(rows)
    out_path = Path(args.outcsv)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(out_path, index=False)

    print(f"\n[OK] Saved: {out_path}")
    print(out)
    print("\n[SUMMARY]")
    print(out[["MAE", "RMSE", "precision_at_k"]].mean(numeric_only=True))


if __name__ == "__main__":
    main()