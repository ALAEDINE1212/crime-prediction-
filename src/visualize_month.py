from __future__ import annotations

import argparse
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge

from config import CFG


def get_feature_cols(df: pd.DataFrame) -> list[str]:
    candidates = [
        "count",
        "lag_1", "lag_2", "lag_3", "lag_6", "lag_12",
        "roll3_mean", "roll6_mean",
    ]
    cols = [c for c in candidates if c in df.columns]
    if not cols:
        raise ValueError("No usable feature columns found.")
    return cols


def fit_predict_ridge(train: pd.DataFrame, test: pd.DataFrame, feature_cols: list[str]) -> np.ndarray:
    train = train.dropna(subset=feature_cols + ["target_next_count"]).copy()
    test = test.dropna(subset=feature_cols + ["target_next_count"]).copy()

    if train.empty or test.empty:
        return np.array([])

    X_train = train[feature_cols].values
    y_train = train["target_next_count"].values.astype(float)
    X_test = test[feature_cols].values

    model = Pipeline([
        ("scaler", StandardScaler(with_mean=True, with_std=True)),
        ("ridge", Ridge(alpha=1.0, random_state=42)),
    ])
    model.fit(X_train, y_train)
    return model.predict(X_test)


def make_grid_image(merged: pd.DataFrame, value_col: str) -> tuple[np.ndarray, int, int, int, int]:
    """
    Build a dense grid image from (cell_x, cell_y) with possible gaps.
    Returns (img, xmin, xmax, ymin, ymax)
    """
    xs = merged["cell_x"].values.astype(int)
    ys = merged["cell_y"].values.astype(int)
    vals = merged[value_col].values.astype(float)

    xmin, xmax = xs.min(), xs.max()
    ymin, ymax = ys.min(), ys.max()

    w = xmax - xmin + 1
    h = ymax - ymin + 1

    img = np.full((h, w), np.nan, dtype=float)
    img[ys - ymin, xs - xmin] = vals
    return img, xmin, xmax, ymin, ymax


def save_map(img: np.ndarray, outpath: Path, title: str) -> None:
    plt.figure()
    plt.imshow(img, origin="lower", aspect="auto")
    plt.title(title)
    plt.colorbar()
    plt.tight_layout()
    plt.savefig(outpath, dpi=200)
    plt.close()


def save_scatter(y_true: np.ndarray, y_pred: np.ndarray, outpath: Path, title: str) -> None:
    plt.figure()
    plt.scatter(y_true, y_pred, s=10)
    plt.title(title)
    plt.xlabel("Actual (next-month count)")
    plt.ylabel("Predicted")
    plt.tight_layout()
    plt.savefig(outpath, dpi=200)
    plt.close()


def save_residual_hist(resid: np.ndarray, outpath: Path, title: str) -> None:
    plt.figure()
    plt.hist(resid, bins=40)
    plt.title(title)
    plt.xlabel("Residual (actual - predicted)")
    plt.ylabel("Frequency")
    plt.tight_layout()
    plt.savefig(outpath, dpi=200)
    plt.close()


def hotspot_overlap_map(df: pd.DataFrame, actual_col: str, pred_col: str, k_percent: float) -> pd.DataFrame:
    g = df.copy()
    k = max(1, int(len(g) * k_percent))

    top_act = set(g.nlargest(k, actual_col)["cell_id"])
    top_pred = set(g.nlargest(k, pred_col)["cell_id"])

    # 0=none, 1=actual only, 2=pred only, 3=overlap
    def tag(cid: int) -> int:
        a = cid in top_act
        p = cid in top_pred
        if a and p:
            return 3
        if a:
            return 1
        if p:
            return 2
        return 0

    g["hotspot_tag"] = g["cell_id"].apply(tag)
    return g


def ensure_outdir(outdir: Path) -> None:
    outdir.mkdir(parents=True, exist_ok=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", required=True, help="Predict month t in format YYYY-MM (e.g., 2025-10)")
    ap.add_argument("--k", type=float, default=CFG.k_hotspot_percent, help="Top-k percent for hotspots (e.g., 0.05)")
    ap.add_argument("--outdir", default=str(CFG.processed_dir / "figures"))
    ap.add_argument("--features", default=str(CFG.processed_dir / "cell_month_features.parquet"))
    ap.add_argument("--dim_cell", default=str(CFG.processed_dir / "dim_cell.parquet"))
    args = ap.parse_args()

    outdir = Path(args.outdir) / f"month_{args.month}"
    ensure_outdir(outdir)

    df = pd.read_parquet(args.features)
    dim = pd.read_parquet(args.dim_cell)

    # Ensure Period type
    if not isinstance(df["month"].dtype, pd.PeriodDtype):
        df["month"] = pd.PeriodIndex(df["month"].astype(str), freq="M")

    m = pd.Period(args.month, freq="M")

    # Test rows for month m (predicting month m+1)
    test = df[df["month"] == m].copy()
    train = df[df["month"] < m].copy()

    # Keep only rows with targets available
    test = test.dropna(subset=["target_next_count"]).copy()

    if test.empty:
        raise ValueError(f"No rows found for month={m}. Check month range in dataset.")

    # Predictions
    test["pred_lag1"] = test["lag_1"].astype(float)

    feature_cols = get_feature_cols(df)
    ridge_pred = fit_predict_ridge(train, test, feature_cols)
    if len(ridge_pred) == 0:
        raise ValueError("Ridge produced no predictions (likely due to NaNs after filtering).")

    test = test.dropna(subset=feature_cols + ["target_next_count"]).copy()
    test["pred_ridge"] = ridge_pred[:len(test)]

    # Merge cell coords
    merged = test.merge(dim[["cell_id", "cell_x", "cell_y"]], on="cell_id", how="left")
    merged = merged.dropna(subset=["cell_x", "cell_y"]).copy()
    merged["cell_x"] = merged["cell_x"].astype(int)
    merged["cell_y"] = merged["cell_y"].astype(int)

    # Maps: actual, pred, errors
    merged["abs_err_lag1"] = (merged["target_next_count"] - merged["pred_lag1"]).abs()
    merged["abs_err_ridge"] = (merged["target_next_count"] - merged["pred_ridge"]).abs()

    for col, name in [
        ("target_next_count", "actual_next_month"),
        ("pred_lag1", "pred_baseline_lag1"),
        ("pred_ridge", "pred_ridge"),
        ("abs_err_lag1", "abs_error_lag1"),
        ("abs_err_ridge", "abs_error_ridge"),
    ]:
        img, *_ = make_grid_image(merged, col)
        save_map(img, outdir / f"{name}.png", f"{name.replace('_',' ').title()} (predict_month={args.month})")

    # Hotspot overlap maps (actual vs each model)
    h1 = hotspot_overlap_map(merged, "target_next_count", "pred_lag1", args.k)
    h2 = hotspot_overlap_map(merged, "target_next_count", "pred_ridge", args.k)

    for hdf, name in [(h1, "hotspot_overlap_lag1"), (h2, "hotspot_overlap_ridge")]:
        img, *_ = make_grid_image(hdf, "hotspot_tag")
        save_map(img, outdir / f"{name}.png", f"{name.replace('_',' ').title()} (0 none,1 actual,2 pred,3 both)")

    # Scatter + residuals
    y_true = merged["target_next_count"].values.astype(float)

    for pred_col, tag in [("pred_lag1", "lag1"), ("pred_ridge", "ridge")]:
        y_pred = merged[pred_col].values.astype(float)
        save_scatter(y_true, y_pred, outdir / f"scatter_{tag}.png", f"Pred vs Actual ({tag}) — month={args.month}")
        resid = y_true - y_pred
        save_residual_hist(resid, outdir / f"residuals_{tag}.png", f"Residuals (actual - pred) ({tag}) — month={args.month}")

    # Save merged table for evidence
    merged_out = outdir / "month_predictions.csv"
    merged.to_csv(merged_out, index=False)

    print("[OK] Saved month visuals to:", outdir)
    print("[OK] Saved per-cell predictions:", merged_out)


if __name__ == "__main__":
    main()
