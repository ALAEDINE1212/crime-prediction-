import pandas as pd
from pathlib import Path

def summarize(path: str, display_name: str):
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Missing: {p}")

    df = pd.read_csv(p).dropna(subset=["MAE","RMSE","precision_at_k"])
    if df.empty:
        raise ValueError(f"No valid rows in {p.name}")

    model_in_file = "unknown"
    if "model" in df.columns:
        uniq = sorted(df["model"].astype(str).unique())
        model_in_file = ",".join(uniq)

    return {
        "Row label": display_name,
        "Model in file": model_in_file,
        "Months": int(len(df)),
        "MAE (mean±std)": f"{df['MAE'].mean():.3f} ± {df['MAE'].std():.3f}",
        "RMSE (mean±std)": f"{df['RMSE'].mean():.3f} ± {df['RMSE'].std():.3f}",
        "Precision@K (mean±std)": f"{df['precision_at_k'].mean():.3f} ± {df['precision_at_k'].std():.3f}",
        "Source": p.name
    }

rows = [
    summarize("data/processed/wf_baseline_lag1.csv", "Baseline (lag-1)"),
    summarize("data/processed/wf_ridge.csv", "Ridge (lags+rolling)"),
]

out = pd.DataFrame(rows)
out_path = Path("data/processed/results_summary_table.csv")
out.to_csv(out_path, index=False)

print(out.to_string(index=False))
print("\n[OK] Saved:", out_path)
