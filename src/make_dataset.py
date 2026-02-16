from __future__ import annotations

import pandas as pd
import numpy as np
from pathlib import Path
from tqdm import tqdm
from pyproj import Transformer

from config import CFG
from utils import find_col, month_to_period, safe_read_csv


def load_raw_csvs(raw_dir: Path) -> pd.DataFrame:
    # Load ONLY street-level files
    files = sorted([p for p in raw_dir.rglob("*-street.csv")])
    if not files:
        raise FileNotFoundError(f"No '*-street.csv' files found under {raw_dir}")

    print(f"[INFO] Found {len(files)} street CSV files.")
    print(f"[INFO] Example file: {files[0]}")

    frames = []
    for p in tqdm(files, desc="Reading street CSVs"):
        df = safe_read_csv(p)
        df["_source_file"] = p.name
        frames.append(df)

    return pd.concat(frames, ignore_index=True)


def standardize_columns(df: pd.DataFrame) -> pd.DataFrame:
    lat_c = find_col(df, CFG.col_map["Latitude"])
    lon_c = find_col(df, CFG.col_map["Longitude"])
    mon_c = find_col(df, CFG.col_map["Month"])
    typ_c = find_col(df, CFG.col_map["Crime type"])

    out = df.rename(columns={
        lat_c: "lat",
        lon_c: "lon",
        mon_c: "month",
        typ_c: "crime_type",
    }).copy()

    return out[["lat", "lon", "month", "crime_type"]].copy()


def clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    df["month"] = month_to_period(df["month"])
    df["lat"] = pd.to_numeric(df["lat"], errors="coerce")
    df["lon"] = pd.to_numeric(df["lon"], errors="coerce")

    df = df.dropna(subset=["lat", "lon", "month"])

    # UK-ish sanity bounds
    df = df[df["lat"].between(49.0, 61.5) & df["lon"].between(-8.5, 2.5)]

    df["crime_type"] = df["crime_type"].astype(str).str.strip().str.lower()
    return df


def add_grid(df: pd.DataFrame, cell_size_m: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Project lat/lon -> EPSG:27700, bin into grid cells.
    Returns:
      - incidents with cell_id
      - dim_cell table with cell_id, cell_x, cell_y, centers
    """
    transformer = Transformer.from_crs(
        f"EPSG:{CFG.epsg_in}", f"EPSG:{CFG.epsg_proj}", always_xy=True
    )

    x, y = transformer.transform(df["lon"].values, df["lat"].values)
    df = df.copy()
    df["x"] = x
    df["y"] = y

    x0 = float(np.floor(df["x"].min() / cell_size_m) * cell_size_m)
    y0 = float(np.floor(df["y"].min() / cell_size_m) * cell_size_m)

    df["cell_x"] = ((df["x"] - x0) // cell_size_m).astype("int64")
    df["cell_y"] = ((df["y"] - y0) // cell_size_m).astype("int64")

    # stable cell_id WITHOUT bitshift operator (works on all pandas versions)
    df["cell_id"] = df["cell_x"] * np.int64(2**32) + df["cell_y"]

    centers = (
        df.groupby("cell_id")[["cell_x", "cell_y"]]
          .first()
          .reset_index()
    )
    centers["x_center"] = x0 + (centers["cell_x"] + 0.5) * cell_size_m
    centers["y_center"] = y0 + (centers["cell_y"] + 0.5) * cell_size_m

    inv = Transformer.from_crs(
        f"EPSG:{CFG.epsg_proj}", f"EPSG:{CFG.epsg_in}", always_xy=True
    )
    lon_c, lat_c = inv.transform(centers["x_center"].values, centers["y_center"].values)
    centers["lat_center"] = lat_c
    centers["lon_center"] = lon_c

    dim_cell = centers[[
        "cell_id", "cell_x", "cell_y",
        "x_center", "y_center",
        "lat_center", "lon_center"
    ]].copy()

    return df, dim_cell


def aggregate_monthly(df: pd.DataFrame) -> pd.DataFrame:
    return (
        df.groupby(["cell_id", "month"])
          .size()
          .rename("count")
          .reset_index()
    )


def add_targets_and_lags(cell_month: pd.DataFrame) -> pd.DataFrame:
    df = cell_month.sort_values(["cell_id", "month"]).copy()

    # target: next month count
    df["target_next_count"] = df.groupby("cell_id")["count"].shift(-1)

    # lags
    for lag in [1, 2, 3, 6, 12]:
        df[f"lag_{lag}"] = df.groupby("cell_id")["count"].shift(lag)

    # rolling means using past only
    df["roll3_mean"] = (
        df.groupby("cell_id")["count"]
          .shift(1)
          .rolling(3)
          .mean()
          .reset_index(level=0, drop=True)
    )
    df["roll6_mean"] = (
        df.groupby("cell_id")["count"]
          .shift(1)
          .rolling(6)
          .mean()
          .reset_index(level=0, drop=True)
    )

    # require target and enough history (lag_12)
    df = df.dropna(subset=["target_next_count", "lag_12"]).copy()
    df["target_next_count"] = df["target_next_count"].astype(float)

    return df


def add_neighbor_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    8-neighbour (Moore) adjacency in (cell_x, cell_y) grid.
    Computes neighbour aggregates of lag_1 at the SAME month row.
    Outputs:
      - nbr_lag1_sum
      - nbr_lag1_count
      - nbr_lag1_mean
      - nbr_lag1_max
    """
    required = {"month", "cell_x", "cell_y", "lag_1"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing columns for neighbour features: {missing}")

    base = df.reset_index(drop=True).copy()
    base["row_id"] = np.arange(len(base), dtype=np.int64)

    # lookup: (month, cell_x, cell_y) -> lag_1
    lookup = base[["month", "cell_x", "cell_y", "lag_1"]].rename(columns={"lag_1": "nbr_val"}).copy()

    offsets = [
        (-1, -1), (-1, 0), (-1, 1),
        (0, -1),           (0, 1),
        (1, -1),  (1, 0),  (1, 1),
    ]

    n = len(base)
    nbr_sum = np.zeros(n, dtype=float)
    nbr_cnt = np.zeros(n, dtype=np.int32)
    nbr_max = np.full(n, -np.inf, dtype=float)

    key = base[["row_id", "month", "cell_x", "cell_y"]].copy()

    for dx, dy in offsets:
        t = key.copy()
        t["nx"] = t["cell_x"] + dx
        t["ny"] = t["cell_y"] + dy

        merged = t.merge(
            lookup,
            left_on=["month", "nx", "ny"],
            right_on=["month", "cell_x", "cell_y"],
            how="left",
            sort=False
        )[["row_id", "nbr_val"]]

        # ensure alignment with original row order
        merged = merged.sort_values("row_id", kind="mergesort")
        v = merged["nbr_val"].to_numpy(dtype=float)  # length == n
        mask = ~np.isnan(v)

        nbr_sum[mask] += v[mask]
        nbr_cnt[mask] += 1
        nbr_max[mask] = np.maximum(nbr_max[mask], v[mask])

    base["nbr_lag1_sum"] = nbr_sum
    base["nbr_lag1_count"] = nbr_cnt
    base["nbr_lag1_mean"] = np.where(nbr_cnt > 0, nbr_sum / nbr_cnt, np.nan)
    base["nbr_lag1_max"] = np.where(nbr_cnt > 0, nbr_max, np.nan)

    return base.drop(columns=["row_id"])


def main():
    raw = load_raw_csvs(CFG.raw_dir)
    std = standardize_columns(raw)
    cln = clean(std)

    inc, dim_cell = add_grid(cln, CFG.cell_size_m)

    cell_month = aggregate_monthly(inc)
    features = add_targets_and_lags(cell_month)

    # attach cell coords so neighbour lookup works
    features = features.merge(dim_cell[["cell_id", "cell_x", "cell_y"]], on="cell_id", how="left")
    features = features.dropna(subset=["cell_x", "cell_y"]).copy()
    features["cell_x"] = features["cell_x"].astype("int64")
    features["cell_y"] = features["cell_y"].astype("int64")

    # neighbour features
    features = add_neighbor_features(features)

    # Save
    out_features = CFG.processed_dir / "cell_month_features.parquet"
    out_cells = CFG.processed_dir / "dim_cell.parquet"

    features.to_parquet(out_features, index=False)
    dim_cell.to_parquet(out_cells, index=False)

    print("[OK] Saved:", out_features)
    print("[OK] Saved:", out_cells)
    print("[INFO] Feature rows:", len(features))
    print("[INFO] Unique cells:", features["cell_id"].nunique())
    print("[INFO] Months:", features["month"].nunique())
    print("[INFO] Month range:", str(features["month"].min()), "->", str(features["month"].max()))
    print("[INFO] nbr_lag1_mean non-null:", int(features["nbr_lag1_mean"].notna().sum()), "/", len(features))


if __name__ == "__main__":
    main()
