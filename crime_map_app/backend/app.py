from __future__ import annotations
from pathlib import Path
from functools import lru_cache
from typing import Optional, Dict, Any, Tuple, List

import numpy as np
import pandas as pd
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge
from sklearn.neighbors import NearestNeighbors



# ----------------------------
# CONFIG
# ----------------------------
FEATURES_PATH = "data/processed/cell_month_features.parquet"
DIMCELL_PATH = "data/processed/dim_cell.parquet"

DEFAULT_TOP_PCT = 0.05
MODEL_ALPHA = 1.0

FEATURE_CANDIDATES = [
    "count",
    "lag_1", "lag_2", "lag_3", "lag_6", "lag_12",
    "roll3_mean", "roll6_mean",
    # optional neighbour features if present
    "nbr_lag1_mean", "nbr_lag1_sum", "nbr_lag1_max", "nbr_lag1_count",
]

app = FastAPI(title="Crime Hotspot Prediction API", version="1.1")

# ✅ Fix CORS: allow frontend on 5500
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://ourworkflow.netlify.app",
        "http://127.0.0.1:5500",
        "http://localhost:5500",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)



def _ensure_period_month(df: pd.DataFrame) -> pd.DataFrame:
    if "month" not in df.columns:
        raise ValueError("Features parquet must include 'month' column.")
    if not isinstance(df["month"].dtype, pd.PeriodDtype):
        df["month"] = pd.PeriodIndex(df["month"].astype(str), freq="M")
    return df


@lru_cache(maxsize=1)
def load_data() -> Tuple[pd.DataFrame, pd.DataFrame]:
    df = pd.read_parquet(FEATURES_PATH)
    dim = pd.read_parquet(DIMCELL_PATH)

    df = _ensure_period_month(df)

    needed = {"cell_id", "lat_center", "lon_center"}
    if not needed.issubset(set(dim.columns)):
        raise ValueError(f"dim_cell.parquet must contain columns: {needed}")

    return df, dim


def get_feature_cols(df: pd.DataFrame) -> List[str]:
    cols = [c for c in FEATURE_CANDIDATES if c in df.columns]
    if not cols:
        raise ValueError("No usable feature columns found. Check parquet columns.")
    return cols


def ridge_model() -> Pipeline:
    return Pipeline([
        ("scaler", StandardScaler()),
        ("ridge", Ridge(alpha=MODEL_ALPHA, random_state=42)),
    ])


def available_forecast_months(df: pd.DataFrame) -> List[str]:
    """
    Return only forecast months that can actually be evaluated:
    forecast_month = predict_month + 1
    requires:
      - train months < predict_month non-empty
      - test rows for predict_month non-empty
    """
    feat_cols = get_feature_cols(df)
    months = sorted(df["month"].unique())

    ok: List[str] = []
    for predict_month in months:
        train = df[df["month"] < predict_month].dropna(subset=feat_cols + ["target_next_count"])
        test = df[df["month"] == predict_month].dropna(subset=feat_cols)
        if len(train) > 0 and len(test) > 0:
            ok.append(str(predict_month + 1))
    return ok


def train_predict_for_forecast_month(
    df: pd.DataFrame,
    dim: pd.DataFrame,
    forecast_month: pd.Period
) -> pd.DataFrame:
    predict_month = forecast_month - 1
    feat_cols = get_feature_cols(df)

    train = df[df["month"] < predict_month].dropna(subset=feat_cols + ["target_next_count"]).copy()
    test = df[df["month"] == predict_month].dropna(subset=feat_cols).copy()

    if train.empty:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough history to train for forecast_month={forecast_month}. Pick a later month."
        )
    if test.empty:
        raise HTTPException(
            status_code=400,
            detail=f"No usable rows for predict_month={predict_month} (features missing)."
        )

    X_train = train[feat_cols].to_numpy()
    y_train = train["target_next_count"].to_numpy(dtype=float)
    X_test = test[feat_cols].to_numpy()

    model = ridge_model()
    model.fit(X_train, y_train)
    pred = model.predict(X_test)

    out = test[["cell_id", "month"]].copy()
    out["forecast_month"] = forecast_month
    out["predicted_count"] = pred

    if "target_next_count" in test.columns:
        out["actual_count"] = test["target_next_count"].to_numpy(dtype=float)
    else:
        out["actual_count"] = np.nan

    out = out.merge(dim[["cell_id", "lat_center", "lon_center"]], on="cell_id", how="left")
    out = out.dropna(subset=["lat_center", "lon_center"]).copy()
    return out


# cache per forecast month
_PRED_CACHE: Dict[str, pd.DataFrame] = {}
_NN_CACHE: Dict[str, NearestNeighbors] = {}


def get_predictions_cached(forecast_month_str: str) -> pd.DataFrame:
    df, dim = load_data()
    fm = pd.Period(forecast_month_str, freq="M")

    if forecast_month_str not in _PRED_CACHE:
        pred_df = train_predict_for_forecast_month(df, dim, fm)
        _PRED_CACHE[forecast_month_str] = pred_df

        coords = pred_df[["lat_center", "lon_center"]].to_numpy(dtype=float)
        nn = NearestNeighbors(n_neighbors=1, algorithm="ball_tree")
        nn.fit(coords)
        _NN_CACHE[forecast_month_str] = nn

    return _PRED_CACHE[forecast_month_str]


def df_to_geojson_points(df: pd.DataFrame) -> Dict[str, Any]:
    feats = []
    for r in df.itertuples(index=False):
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(r.lon_center), float(r.lat_center)]},
            "properties": {
                "cell_id": int(r.cell_id),
                "forecast_month": str(r.forecast_month),
                "predicted_count": float(r.predicted_count),
                "actual_count": None if pd.isna(r.actual_count) else float(r.actual_count),
            }
        })
    return {"type": "FeatureCollection", "features": feats}


@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/months")
def months():
    df, _ = load_data()
    return {
        "forecast_months": available_forecast_months(df),
        "note": "Only months with enough history are returned."
    }

@app.get("/")
def root():
    return {"status": "ok"}

@app.get("/debug/files")
def debug_files():
    return {
        "cwd": str(Path.cwd()),
        "features_exists": Path("data/processed/cell_month_features.parquet").exists(),
        "dim_exists": Path("data/processed/dim_cell.parquet").exists(),
        "tree_data_processed": [p.name for p in Path("data/processed").glob("*")],
    }

@app.get("/months")
def months():
    df, _ = load_data()
    return {"forecast_months": available_forecast_months(df)}

@app.get("/predict")
def predict(
    forecast_month: str = Query(..., description="YYYY-MM (forecast month)"),
    top_pct: float = Query(DEFAULT_TOP_PCT, ge=0.001, le=0.5),
    bbox: Optional[str] = Query(None, description="Optional bbox: latMin,lonMin,latMax,lonMax")
):
    pred_df = get_predictions_cached(forecast_month).copy()

    # bbox filter
    if bbox:
        try:
            lat_min, lon_min, lat_max, lon_max = [float(x.strip()) for x in bbox.split(",")]
            pred_df = pred_df[
                (pred_df["lat_center"] >= lat_min) & (pred_df["lat_center"] <= lat_max) &
                (pred_df["lon_center"] >= lon_min) & (pred_df["lon_center"] <= lon_max)
            ].copy()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid bbox format. Use: latMin,lonMin,latMax,lonMax")

    if pred_df.empty:
        return {
            "meta": {"forecast_month": forecast_month, "returned_points": 0, "total_points": 0, "k": 0, "top_pct": float(top_pct)},
            "geojson": {"type": "FeatureCollection", "features": []}
        }

    k = max(1, int(len(pred_df) * float(top_pct)))
    top = pred_df.nlargest(k, "predicted_count").copy()

    return {
        "meta": {
            "forecast_month": forecast_month,
            "top_pct": float(top_pct),
            "k": int(k),
            "total_points": int(len(pred_df)),
            "returned_points": int(len(top)),
        },
        "geojson": df_to_geojson_points(top)
    }


@app.get("/predict_point")
def predict_point(
    forecast_month: str = Query(..., description="YYYY-MM (forecast month)"),
    lat: float = Query(...),
    lon: float = Query(...)
):
    pred_df = get_predictions_cached(forecast_month)
    nn = _NN_CACHE.get(forecast_month)
    if nn is None:
        raise HTTPException(status_code=500, detail="Nearest-neighbour index missing (cache error).")

    dist, idx = nn.kneighbors(np.array([[lat, lon]], dtype=float), n_neighbors=1)
    i = int(idx[0][0])
    row = pred_df.iloc[i]

    return {
        "forecast_month": forecast_month,
        "nearest": {
            "cell_id": int(row["cell_id"]),
            "lat_center": float(row["lat_center"]),
            "lon_center": float(row["lon_center"]),
            "predicted_count": float(row["predicted_count"]),
            "actual_count": None if pd.isna(row["actual_count"]) else float(row["actual_count"]),
            "distance_deg": float(dist[0][0]),
        }
    }
