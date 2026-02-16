import pandas as pd
from config import CFG
from utils import mae, rmse

def chrono_split(df: pd.DataFrame):
    months = sorted(df["month"].unique())
    if len(months) < CFG.min_months_required:
        raise ValueError(f"Not enough months after preprocessing. Found {len(months)} months.")

    train_end = pd.Period(CFG.train_end, "M")
    val_end = pd.Period(CFG.val_end, "M")

    if train_end in months and val_end in months:
        train = df[df["month"] <= train_end].copy()
        val = df[(df["month"] > train_end) & (df["month"] <= val_end)].copy()
        test = df[df["month"] > val_end].copy()
    else:
        n = len(months)
        a = int(n * 0.70)
        b = int(n * 0.85)
        m_train_end = months[a - 1]
        m_val_end = months[b - 1]
        train = df[df["month"] <= m_train_end].copy()
        val = df[(df["month"] > m_train_end) & (df["month"] <= m_val_end)].copy()
        test = df[df["month"] > m_val_end].copy()

    return train, val, test

def eval_regression(df: pd.DataFrame, pred_col: str) -> dict:
    df = df.dropna(subset=[pred_col, "target_next_count"])
    y = df["target_next_count"].values
    p = df[pred_col].values
    return {"MAE": mae(y, p), "RMSE": rmse(y, p)}

def main():
    df = pd.read_parquet(CFG.processed_dir / "cell_month_features.parquet")

    train, val, test = chrono_split(df)

    baselines = [
        ("naive_lag1", "lag_1"),
        ("seasonal_lag12", "lag_12"),
    ]

    for name, pred_col in baselines:
        for split_name, split_df in [("train", train), ("val", val), ("test", test)]:
            m = eval_regression(split_df, pred_col)
            print(f"{name:15s} | {split_name:5s} | MAE={m['MAE']:.3f} RMSE={m['RMSE']:.3f}")

if __name__ == "__main__":
    main()
