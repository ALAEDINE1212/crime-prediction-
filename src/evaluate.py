import pandas as pd
from config import CFG
from baseline import chrono_split
from utils import precision_at_k, hitrate_at_k

def hotspot_metrics(df: pd.DataFrame, pred_col: str, k_percent: float) -> pd.DataFrame:
    rows = []
    for m, g in df.groupby("month"):
        g = g.dropna(subset=[pred_col, "target_next_count"])
        if g.empty:
            continue

        actual = g.set_index("cell_id")["target_next_count"]
        pred = g.set_index("cell_id")[pred_col]

        k = max(1, int(len(g) * k_percent))

        rows.append({
            "month": str(m),
            "cells": len(g),
            "k": k,
            "precision_at_k": precision_at_k(actual, pred, k),
            "hitrate_at_k": hitrate_at_k(actual, pred, k),
        })

    return pd.DataFrame(rows)

def main():
    df = pd.read_parquet(CFG.processed_dir / "cell_month_features.parquet")
    _, _, test = chrono_split(df)

    for pred_col in ["lag_1", "lag_12"]:
        out = hotspot_metrics(test, pred_col, CFG.k_hotspot_percent)
        print("\n=== Hotspot metrics on TEST for", pred_col, "===")
        if out.empty:
            print("No rows.")
            continue
        print(out.tail(12).to_string(index=False))
        print("Mean Precision@K:", round(out["precision_at_k"].mean(), 4))

if __name__ == "__main__":
    main()
