from __future__ import annotations
import pandas as pd
import numpy as np
from pathlib import Path

def find_col(df: pd.DataFrame, candidates: list[str]) -> str:
    for c in candidates:
        if c in df.columns:
            return c
    raise KeyError(
        f"None of these columns found: {candidates}. "
        f"Available columns (first 30): {list(df.columns)[:30]}"
    )

def month_to_period(s: pd.Series) -> pd.PeriodIndex:
    # UK Police "Month" is usually "YYYY-MM"
    return pd.to_datetime(s, errors="coerce").dt.to_period("M")

def safe_read_csv(path: Path) -> pd.DataFrame:
    try:
        return pd.read_csv(path)
    except UnicodeDecodeError:
        return pd.read_csv(path, encoding="latin1")

def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))

def mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    return float(np.mean(np.abs(y_true - y_pred)))

def precision_at_k(actual_counts: pd.Series, pred_counts: pd.Series, k: int) -> float:
    if k <= 0:
        return 0.0
    top_pred = set(pred_counts.nlargest(k).index)
    top_act = set(actual_counts.nlargest(k).index)
    return len(top_pred & top_act) / k

def hitrate_at_k(actual_counts: pd.Series, pred_counts: pd.Series, k: int) -> float:
    # Same overlap@k definition; kept separate for reporting clarity.
    return precision_at_k(actual_counts, pred_counts, k)
