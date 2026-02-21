# src/merge_socio.py
from __future__ import annotations

from pathlib import Path
import pandas as pd

from socio_ons import build_monthly_ons_features

FEATURES_IN = Path("data/processed/cell_month_features.parquet")
FEATURES_OUT = Path("data/processed/cell_month_features_with_socio.parquet")
ONS_FOLDER = Path("data/external/ons")


def main():
    df = pd.read_parquet(FEATURES_IN).copy()
    df["month"] = pd.PeriodIndex(df["month"].astype(str), freq="M")
    months = pd.PeriodIndex(sorted(df["month"].unique()), freq="M")

    socio = build_monthly_ons_features(ONS_FOLDER, months)
    df2 = df.merge(socio, on="month", how="left")

    FEATURES_OUT.parent.mkdir(parents=True, exist_ok=True)
    df2.to_parquet(FEATURES_OUT, index=False)

    print(f"[OK] Saved: {FEATURES_OUT}")
    print("Added socio columns:", [c for c in socio.columns if c != "month"])


if __name__ == "__main__":
    main()