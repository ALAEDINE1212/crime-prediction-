from __future__ import annotations

import argparse
import pandas as pd
import numpy as np

from config import CFG
from utils import mae, rmse, precision_at_k, hitrate_at_k

# Optional ML (only used if model == "ridge")
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge


def get_feature_cols(df: pd.DataFrame) -> list[str]:
    candidates = [
        "count",
        "lag_1", "lag_2", "lag_3", "lag_6", "lag_12",
        "roll3_mean", "roll6_mean",
        "nbr_lag1_mean", "nbr_lag1_sum", "nbr_lag1_max", "nbr_lag1_count",
    ]
    cols = [c for c in candidates if c in df.columns]
    if not cols:
        raise ValueError("No usable feature columns found in dataset.")
    return cols




def fit_predict_ridge(train: pd.DataFrame, test: pd.DataFrame, feature_cols: list[str]) -> np.ndarray:
    """Train Ridge on train rows and predict for test rows."""
    train = train.dropna(subset=feature_cols + ["target_next_count"]).copy()
    test = test.dropna(subset=feature_cols).copy()

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


def baseline_predict(test: pd.DataFrame, pred_col: str) -> np.ndarray:
    """Baseline prediction from an existing column (lag_1 or lag_12)."""
    t = test.dropna(subset=[pred_col]).copy()
    if t.empty:
        return np.array([])
    return t[pred_col].values.astype(float)


def compute_month_metrics(test_rows: pd.DataFrame, y_pred: np.ndarray, k_percent: float) -> dict:
    """Compute regression + hotspot ranking metrics for one prediction month."""
    if len(y_pred) == 0:
        return {
            "rows": 0,
            "cells": 0,
            "MAE": np.nan,
            "RMSE": np.nan,
            "k": 0,
            "precision_at_k": np.nan,
            "hitrate_at_k": np.nan,
        }

    # Align predictions with the rows actually used
    # (some rows might be dropped due to NaNs)
    used = test_rows.copy()
    used = used.iloc[:len(y_pred)].copy()  # safe fallback if alignment differs

    used = used.dropna(subset=["target_next_count"]).copy()
    if used.empty:
        return {
            "rows": 0,
            "cells": 0,
            "MAE": np.nan,
            "RMSE": np.nan,
            "k": 0,
            "precision_at_k": np.nan,
            "hitrate_at_k": np.nan,
        }

    y_true = used["target_next_count"].values.astype(float)
    y_pred = np.asarray(y_pred[:len(y_true)], dtype=float)

    # Regression
    out = {
        "rows": int(len(y_true)),
        "cells": int(used["cell_id"].nunique()),
        "MAE": mae(y_true, y_pred),
        "RMSE": rmse(y_true, y_pred),
    }

    # Hotspot ranking (Top-K overlap)
    idx = used["cell_id"].values
    actual = pd.Series(y_true, index=idx)
    pred = pd.Series(y_pred, index=idx)

    k = max(1, int(len(actual) * k_percent))
    out["k"] = int(k)
    out["precision_at_k"] = precision_at_k(actual, pred, k)
    out["hitrate_at_k"] = hitrate_at_k(actual, pred, k)

    return out


def walk_forward(df: pd.DataFrame, model_name: str, k_percent: float, min_train_months: int) -> pd.DataFrame:
    """
    Walk-forward evaluation:

    Each step:
    - Train on months < m (strictly earlier months)
    - Predict on month m (predicting target_next_count for m -> m+1)
    - Evaluate against target_next_count in month m
    """
    df = df.copy()
    df = df.sort_values(["month", "cell_id"])

    months = sorted(df["month"].unique())
    if len(months) < (min_train_months + 2):
        raise ValueError(
            f"Not enough months for walk-forward. Found {len(months)} months, "
            f"need at least {min_train_months + 2}."
        )

    feature_cols = get_feature_cols(df) if model_name == "ridge" else []

    results = []
    # Start after min_train_months, so training has enough history
    start_idx = min_train_months

    for i in range(start_idx, len(months)):
        m = months[i]
        train = df[df["month"] < m].copy()
        test = df[df["month"] == m].copy()

        # Forecast month is "m + 1" (since target_next_count is next month)
        forecast_month = (m + 1)

        # Predict
        if model_name == "baseline_lag1":
            test_used = test.dropna(subset=["lag_1", "target_next_count"]).copy()
            y_pred = baseline_predict(test_used, "lag_1")
        elif model_name == "baseline_lag12":
            test_used = test.dropna(subset=["lag_12", "target_next_count"]).copy()
            y_pred = baseline_predict(test_used, "lag_12")
        elif model_name == "ridge":
            # Keep same rows for eval alignment
            test_used = test.dropna(subset=feature_cols + ["target_next_count"]).copy()
            y_pred = fit_predict_ridge(train, test_used, feature_cols)
        else:
            raise ValueError(f"Unknown model: {model_name}")

        metrics = compute_month_metrics(test_used, y_pred, k_percent)

        results.append({
            "train_end_month": str((m - 1)),
            "predict_month": str(m),
            "forecast_month": str(forecast_month),
            "model": model_name,
            **metrics
        })

    return pd.DataFrame(results)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="baseline_lag1", choices=["baseline_lag1", "baseline_lag12", "ridge"])
    ap.add_argument("--k", type=float, default=CFG.k_hotspot_percent, help="Top-k percent for hotspot metrics (e.g., 0.05)")
    ap.add_argument("--min_train_months", type=int, default=12, help="Minimum months before starting evaluation")
    ap.add_argument("--infile", default=str(CFG.processed_dir / "cell_month_features.parquet"))
    ap.add_argument("--outfile", default=str(CFG.processed_dir / "walk_forward_results.csv"))
    args = ap.parse_args()

    df = pd.read_parquet(args.infile)

    # Ensure month is Period[M]
    if not isinstance(df["month"].dtype, pd.PeriodDtype):
        df["month"] = pd.PeriodIndex(df["month"].astype(str), freq="M")

    res = walk_forward(df, args.model, args.k, args.min_train_months)

    res.to_csv(args.outfile, index=False)
    print("[OK] Saved:", args.outfile)

    # Summary
    valid = res.dropna(subset=["MAE", "RMSE", "precision_at_k"])
    if valid.empty:
        print("[WARN] No valid rows to summarise.")
        return

    print("\n=== Walk-forward summary (mean over months) ===")
    print("Model:", args.model)
    print("Months evaluated:", len(valid))
    print("MAE mean:", round(valid["MAE"].mean(), 4), " | std:", round(valid["MAE"].std(), 4))
    print("RMSE mean:", round(valid["RMSE"].mean(), 4), " | std:", round(valid["RMSE"].std(), 4))
    print("Precision@K mean:", round(valid["precision_at_k"].mean(), 4), " | std:", round(valid["precision_at_k"].std(), 4))

    print("\nLast 8 months:")
    print(valid.tail(8)[["predict_month", "forecast_month", "rows", "cells", "MAE", "RMSE", "precision_at_k"]].to_string(index=False))


if __name__ == "__main__":
    main()
