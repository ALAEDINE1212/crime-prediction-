# Crime Hotspot Prediction + Interactive Map (West Yorkshire)

This repo contains:
1) a spatio-temporal crime hotspot pipeline (grid aggregation + forecasting),
2) a deployed FastAPI API (Render),
3) a deployed Leaflet web map UI (Netlify).

It works end-to-end: the UI loads forecast months from the API and displays predicted hotspots on a real map.

---

## Live links

- **Frontend (Netlify):** https://ourworkflow.netlify.app/crime-map/
- **Backend (Render API):** https://crime-prediction-apii.onrender.com
- **API docs (Swagger):** https://crime-prediction-apii.onrender.com/docs

Quick API check:
- https://crime-prediction-apii.onrender.com/months

---

## What the system does (short + accurate)

### Data → Features
- Uses UK Police street-level crime CSVs (monthly files).
- Maps incidents into a fixed spatial grid (cell_id).
- Aggregates into **cell × month** counts.
- Builds features: **lags**, **rolling windows**, and **neighbour features**.

### Model → Hotspots
- Predicts next-month crime counts per cell (baseline + Ridge regression).
- Converts predictions into “hotspots” by selecting top ranked cells (top %).

### Web map
- User selects a forecast month.
- UI requests hotspots for the visible map area (bbox).
- UI draws predicted hotspot points and supports click-based prediction.

---

## Repo layout (the parts that matter)

crime-map/ # Netlify static frontend (Leaflet map)
index.html
styles.css
app.js

crime_map_app/ # Render backend (FastAPI)
backend/app.py
requirements.txt
runtime.txt
data/processed/ # required by the API on Render
cell_month_features.parquet
dim_cell.parquet

src/ # pipeline + evaluation scripts
make_dataset.py
walk_forward.py
visualize_month.py
make_results_table.py



---

## Run locally

### 1) Create venv + install backend requirements
From repo root:

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate

pip install -r crime_map_app/requirements.txt


2) Run backend (FastAPI)

From repo root:

python -m uvicorn crime_map_app.backend.app:app --reload --port 8000


Test:

http://127.0.0.1:8000/

http://127.0.0.1:8000/docs

http://127.0.0.1:8000/months

3) Run frontend (Leaflet)

Serve the crime-map/ folder:

cd crime-map
python -m http.server 5500


Open:

http://127.0.0.1:5500/

Important: crime-map/app.js must point to the correct API:

local: http://127.0.0.1:8000

deployed: https://crime-prediction-apii.onrender.com

Core API endpoints

GET /
Health/status.

GET /months
Returns available forecast months (only months with enough history).

GET /predict?forecast_month=YYYY-MM&top_pct=0.05&bbox=lat1,lon1,lat2,lon2
Returns hotspots in the current viewport.

GET /predict_point?forecast_month=YYYY-MM&lat=...&lon=...
Returns a prediction at a clicked location.

(Exact behaviour is implemented in crime_map_app/backend/app.py.)

Pipeline scripts (dataset + evaluation)
Build processed features

Requires local raw CSVs under data/raw/ (not included in repo).

python src/make_dataset.py


Outputs:

data/processed/cell_month_features.parquet

data/processed/dim_cell.parquet

Walk-forward validation

Examples:

python src/walk_forward.py --model baseline_lag1 --outfile data/processed/wf_baseline_lag1.csv
python src/walk_forward.py --model ridge --outfile data/processed/wf_ridge.csv

Visualise a month
python src/visualize_month.py --month 2025-10 --k 200 --outdir outputs/

Deployment notes (what was actually needed)
Backend (Render)

Root directory set to: crime_map_app

Start command:

uvicorn backend.app:app --host 0.0.0.0 --port $PORT


The backend requires these files deployed on Render:

crime_map_app/data/processed/cell_month_features.parquet

crime_map_app/data/processed/dim_cell.parquet

Frontend (Netlify)

Static site hosting.

UI lives under /crime-map/.

API_BASE in crime-map/app.js points to Render.

CORS (must exist or browser blocks it)

Backend must allow:

https://ourworkflow.netlify.app

Known limitations (don’t pretend it’s perfect)

Open crime data includes reporting bias and missingness.

Hotspot prediction is a risk signal, not certainty.

Grid size and hotspot threshold strongly affect results and visuals.

This is a forecasting + ranking system, not “crime prediction of individuals”.
