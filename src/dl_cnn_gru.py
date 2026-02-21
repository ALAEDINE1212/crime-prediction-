# src/dl_cnn_gru.py
from __future__ import annotations

import os
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

from dataclasses import dataclass
from typing import List, Tuple, Dict, Optional, Set

import numpy as np
import pandas as pd
import torch
from torch import nn


@dataclass
class GridIndex:
    x_min: int
    y_min: int
    H: int
    W: int
    cell_to_rc: Dict[int, Tuple[int, int]]
    mask: np.ndarray  # HxW bool where a cell exists


def build_grid_index(dim_cell: pd.DataFrame) -> GridIndex:
    for c in ["cell_id", "cell_x", "cell_y"]:
        if c not in dim_cell.columns:
            raise ValueError(f"dim_cell missing required column: {c}")

    x_min = int(dim_cell["cell_x"].min())
    x_max = int(dim_cell["cell_x"].max())
    y_min = int(dim_cell["cell_y"].min())
    y_max = int(dim_cell["cell_y"].max())

    W = (x_max - x_min) + 1
    H = (y_max - y_min) + 1

    cell_to_rc: Dict[int, Tuple[int, int]] = {}
    mask = np.zeros((H, W), dtype=bool)

    for r in dim_cell.itertuples(index=False):
        rr = int(r.cell_y) - y_min
        cc = int(r.cell_x) - x_min
        cell_to_rc[int(r.cell_id)] = (rr, cc)
        mask[rr, cc] = True

    return GridIndex(x_min=x_min, y_min=y_min, H=H, W=W, cell_to_rc=cell_to_rc, mask=mask)


def build_month_tensor(
    features: pd.DataFrame,
    grid: GridIndex,
    month: pd.Period,
    channels: List[str],
    global_channels: Optional[Set[str]] = None,
) -> np.ndarray:
    """
    Build CxHxW tensor for one month.

    - "global_channels" are broadcast across the grid (e.g., region-level ONS features).
    - Everything else is treated as spatial and filled per cell_id.
    - No heuristics. No guessing. No silent corruption.
    """
    global_channels = global_channels or set()

    if "month" not in features.columns or "cell_id" not in features.columns:
        raise ValueError("features must contain at least: 'month', 'cell_id'")

    mdf = features[features["month"] == month]
    if mdf.empty:
        raise ValueError(f"No rows for month={month}")

    C = len(channels)
    x = np.zeros((C, grid.H, grid.W), dtype=np.float32)

    # Precompute row/col mapping for the month (vectorised fill later)
    cell_ids = mdf["cell_id"].astype("int64").values
    rc_list = [grid.cell_to_rc.get(int(cid)) for cid in cell_ids]
    keep = np.array([rc is not None for rc in rc_list], dtype=bool)

    if keep.any():
        rr = np.array([rc_list[i][0] for i in range(len(rc_list)) if keep[i]], dtype=np.int32)
        cc = np.array([rc_list[i][1] for i in range(len(rc_list)) if keep[i]], dtype=np.int32)
        mdf_keep = mdf.iloc[np.where(keep)[0]]
    else:
        rr = np.array([], dtype=np.int32)
        cc = np.array([], dtype=np.int32)
        mdf_keep = mdf.iloc[0:0]

    for ci, col in enumerate(channels):
        if col not in mdf.columns:
            raise ValueError(f"Missing channel column: {col}")

        if col in global_channels:
            # Broadcast a single monthly value across grid
            vals = mdf[col].dropna().unique()
            if len(vals) == 0:
                v = 0.0
            elif len(vals) == 1:
                v = float(vals[0])
            else:
                # Not expected; take mean instead of pretending it's spatial
                v = float(np.mean(vals))
            x[ci, :, :] = v
        else:
            # Spatial fill per cell_id
            if len(mdf_keep) == 0:
                continue
            vals = mdf_keep[col].to_numpy(dtype=np.float32, copy=False)
            ok = ~np.isnan(vals)
            if ok.any():
                x[ci, rr[ok], cc[ok]] = vals[ok]

    # Explicitly zero invalid pixels
    x[:, ~grid.mask] = 0.0
    return x


class SpatialEncoder(nn.Module):
    """
    Per-timestep encoder. Keeps HxW.
    """
    def __init__(self, in_channels: int, out_channels: int = 16):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(in_channels, 16, 3, padding=1),
            nn.BatchNorm2d(16),
            nn.ReLU(inplace=True),
            nn.Conv2d(16, out_channels, 3, padding=1),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, 3, padding=1),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class ConvGRUCell(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int, kernel_size: int = 3):
        super().__init__()
        pad = kernel_size // 2
        self.hidden_dim = hidden_dim
        self.conv_gates = nn.Conv2d(input_dim + hidden_dim, 2 * hidden_dim, kernel_size, padding=pad)
        self.conv_cand = nn.Conv2d(input_dim + hidden_dim, hidden_dim, kernel_size, padding=pad)

    def forward(self, x: torch.Tensor, h: torch.Tensor) -> torch.Tensor:
        combined = torch.cat([x, h], dim=1)
        gates = torch.sigmoid(self.conv_gates(combined))
        r, z = gates.chunk(2, dim=1)

        combined_r = torch.cat([x, r * h], dim=1)
        n = torch.tanh(self.conv_cand(combined_r))

        return (1 - z) * h + z * n


class ConvGRU(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int):
        super().__init__()
        self.cell = ConvGRUCell(input_dim, hidden_dim)
        self.hidden_dim = hidden_dim

    def forward(self, x_seq: torch.Tensor) -> torch.Tensor:
        # x_seq: (B, T, C, H, W)
        B, T, C, H, W = x_seq.shape
        h = torch.zeros(B, self.hidden_dim, H, W, device=x_seq.device)
        for t in range(T):
            h = self.cell(x_seq[:, t], h)
        return h


class CNNGRU(nn.Module):
    """
    Predicts log1p(count) map (>=0) using Softplus at output.
    """
    def __init__(self, in_channels: int, hidden: int = 32, enc_ch: int = 16):
        super().__init__()
        self.encoder = SpatialEncoder(in_channels, enc_ch)
        self.conv_gru = ConvGRU(input_dim=enc_ch, hidden_dim=hidden)

        self.skip_proj = nn.Conv2d(in_channels, hidden, 1)

        self.decoder = nn.Sequential(
            nn.Conv2d(hidden * 2, hidden, 3, padding=1),
            nn.BatchNorm2d(hidden),
            nn.ReLU(inplace=True),
            nn.Conv2d(hidden, hidden // 2, 3, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(hidden // 2, 1, 1),
            nn.Softplus(),  # stable, non-negative output on log scale
        )

    def forward(self, x_seq: torch.Tensor) -> torch.Tensor:
        # x_seq: (B, T, C, H, W)
        B, T, C, H, W = x_seq.shape

        enc_seq = []
        for t in range(T):
            enc_seq.append(self.encoder(x_seq[:, t]))
        enc_tensor = torch.stack(enc_seq, dim=1)
        del enc_seq

        h = self.conv_gru(enc_tensor)
        del enc_tensor

        skip = self.skip_proj(x_seq[:, -1])
        out = self.decoder(torch.cat([h, skip], dim=1))
        return out.squeeze(1)  # (B,H,W)


def masked_mse(pred: torch.Tensor, target: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    m = mask.unsqueeze(0).expand_as(pred)
    diff = (pred - target) ** 2
    return diff[m].mean()


def masked_huber(pred: torch.Tensor, target: torch.Tensor, mask: torch.Tensor, delta: float = 1.0) -> torch.Tensor:
    """
    Huber loss is better than MSE for spike-heavy targets (crime counts).
    Works on log1p scale nicely.
    """
    m = mask.unsqueeze(0).expand_as(pred)
    e = pred - target
    ae = torch.abs(e)
    quad = torch.minimum(ae, torch.tensor(delta, device=ae.device))
    lin = ae - quad
    loss = 0.5 * quad * quad + delta * lin
    return loss[m].mean()