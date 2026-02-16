from __future__ import annotations

import argparse
from pathlib import Path
import pandas as pd
import matplotlib.pyplot as plt

from config import CFG


def load_results(path: str, label: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["model_label"] = label
    # predict_month is like "2025-03"
    df["predict_month"] = pd.PeriodIndex(df["predict_month"].astype(str), freq="M").astype(str)
    return df


def ensure_outdir(outdir: Path) -> None:
    outdir.mkdir(parents=True, exist_ok=True)


def line_plot(df: pd.DataFrame, metric: str, outpath: Path, title: str) -> None:
    plt.figure()
    for name, g in df.groupby("model_label"):
        g = g.sort_values("predict_month")
        plt.plot(g["predict_month"], g[metric], marker="o", label=name)

    plt.title(title)
    plt.xlabel("Predict month (t)")
    plt.ylabel(metric)
    plt.xticks(rotation=45)
    plt.legend()
    plt.tight_layout()
    plt.savefig(outpath, dpi=200)
    plt.close()


def bar_summary(df: pd.DataFrame, metric: str, outpath: Path, title: str) -> None:
    summary = (
        df.dropna(subset=[metric])
          .groupby("model_label")[metric]
          .agg(["mean", "std"])
          .reset_index()
          .sort_values("mean", ascending=True)
    )

    plt.figure()
    plt.bar(summary["model_label"], summary["mean"], yerr=summary["std"])
    plt.title(title)
    plt.xlabel("Model")
    plt.ylabel(f"{metric} (mean ± std)")
    plt.xticks(rotation=15)
    plt.tight_layout()
    plt.savefig(outpath, dpi=200)
    plt.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline_csv", default=str(CFG.processed_dir / "walk_forward_results.csv"))
    ap.add_argument("--ridge_csv", default=str(CFG.processed_dir / "walk_forward_results_ridge.csv"))
    ap.add_argument("--outdir", default=str(CFG.processed_dir / "figures"))
    args = ap.parse_args()

    outdir = Path(args.outdir)
    ensure_outdir(outdir)

    # Load
    frames = []
    if Path(args.baseline_csv).exists():
        frames.append(load_results(args.baseline_csv, "baseline_lag1"))
    if Path(args.ridge_csv).exists():
        frames.append(load_results(args.ridge_csv, "ridge"))

    if not frames:
        raise FileNotFoundError("No walk-forward CSVs found. Provide paths via --baseline_csv/--ridge_csv.")

    df = pd.concat(frames, ignore_index=True)

    # Keep consistent order
    df = df.sort_values(["model_label", "predict_month"])

    # Plots over time
    line_plot(df, "MAE", outdir / "wf_mae_over_time.png", "Walk-forward MAE over time")
    line_plot(df, "RMSE", outdir / "wf_rmse_over_time.png", "Walk-forward RMSE over time")
    line_plot(df, "precision_at_k", outdir / "wf_precision_at_k_over_time.png", "Walk-forward Precision@K over time")

    # Summary bars
    bar_summary(df, "MAE", outdir / "wf_mae_summary.png", "Walk-forward MAE (mean ± std)")
    bar_summary(df, "RMSE", outdir / "wf_rmse_summary.png", "Walk-forward RMSE (mean ± std)")
    bar_summary(df, "precision_at_k", outdir / "wf_precision_at_k_summary.png", "Walk-forward Precision@K (mean ± std)")

    print("[OK] Saved figures to:", outdir)


if __name__ == "__main__":
    main()
