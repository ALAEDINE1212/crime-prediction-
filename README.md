# Crime Hotspot Prediction System
### West Yorkshire Police · COS-5031-E Discipline-Specific AI Project

> **Hotspot prediction is a risk signal, not certainty.**
> This is a forecasting and ranking system, not a prediction of individual behaviour.
> The system is advisory only. Human officers retain all decision-making authority.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Business Case and Problem Statement](#2-business-case-and-problem-statement)
3. [Project Charter (PID Summary)](#3-project-charter-pid-summary)
4. [Dataset](#4-dataset)
5. [Repository Structure](#5-repository-structure)
6. [Pipeline Architecture](#6-pipeline-architecture)
7. [Models and Results](#7-models-and-results)
8. [How to Run](#8-how-to-run)
9. [Dashboard and API](#9-dashboard-and-api)
10. [Ethical Framework (FAST Principles)](#10-ethical-framework-fast-principles)
11. [Project Management](#11-project-management)
12. [Team and Roles](#12-team-and-roles)
13. [Academic Context](#13-academic-context)
14. [Known Limitations](#14-known-limitations)
15. [Licence and Reuse](#15-licence-and-reuse)

---

## 1. Project Overview

This repository contains the full end-to-end pipeline for a **crime hotspot forecasting system** built for West Yorkshire Police as part of a multidisciplinary AI project at the University of Wolverhampton (COS-5031-E, Level 5, 60 credits).

The system ingests publicly available crime data from [data.police.uk](https://data.police.uk), aggregates it onto a 500m spatial grid, engineers temporal and spatial features, and trains two families of models:

- **Ridge Regression** (primary operational model - interpretable, auditable)
- **CNN-GRU** (deep learning benchmark - higher accuracy, lower interpretability)

The outputs are served via a **FastAPI backend** and a **Leaflet.js interactive map** that allows officers to query hotspot probability scores by grid cell, date range, and crime type.

---

## 2. Business Case and Problem Statement

**Domain:** Law enforcement and public safety, West Yorkshire, UK

**Problem:** Reactive policing is resource-intensive and insufficient for preventing crime in high-density urban areas. West Yorkshire Police need a data-driven decision support tool that can rank geographic cells by predicted crime likelihood one month ahead, enabling proactive patrol allocation.

**Scope:**
- Geographic area: West Yorkshire (Bradford, Leeds, Calderdale, Kirklees, Wakefield)
- Time range of training data: January 2018 to January 2024
- Forecast horizon: 1 month ahead
- Grid resolution: 500m x 500m cells

**Key constraints:**
- System must be explainable under ICO AI and Data Protection Guidance
- No automated enforcement; a human officer must remain in the loop (UK GDPR Article 22)
- No individual-level PII at any stage of the pipeline
- Must run on standard university-grade infrastructure

---

## 3. Project Charter (PID Summary)

| Field | Detail |
|---|---|
| **Project Title** | Crime Hotspot Prediction System |
| **Client** | West Yorkshire Police (DSP client project) |
| **Module** | COS-5031-E Discipline-Specific AI Project |
| **Module Leader** | Dr Kulvinder Panesar |
| **Organisation (fictional)** | Future AI for ALL (FALL) |
| **Project Manager** | Alaedine Ait bella |
| **Jira Board** | CP (Crime Prediction) |
| **Methodology** | Agile (Scrum, sprint-based) |
| **Sprints** | 5 sprints across 2 semesters |
| **Group Submission Deadline** | Friday 3rd April 2026 by 12pm |
| **Presentation Date** | Monday 6th April 2026 (D.1.03) |

**Aims and Objectives:**

1. Explore existing crime prediction methods and relevant literature
2. Source, clean, and engineer features from the West Yorkshire crime dataset (data.police.uk)
3. Build and evaluate baseline and advanced forecasting models
4. Develop an interactive crime hotspot dashboard for operational use
5. Ensure the solution meets ethical, legal, and responsible AI requirements
6. Document all decisions for auditability and reproducibility

**Outcomes:**
- Trained Ridge Regression and CNN-GRU models with walk-forward validation logs
- Interactive Leaflet map dashboard with FastAPI backend
- Full open-source pipeline on GitHub

**Stakeholders:**
- West Yorkshire Police (primary client)
- COS-5031-E module team (academic client)
- General public (indirect, affected by patrol allocation decisions)

---

## 4. Dataset

**Source:** [https://data.police.uk](https://data.police.uk) (open licence)

**Coverage:** January 2018 to January 2024, West Yorkshire

**Size:** 1,048,575 rows x 12 columns (.csv format)

**Columns:**

| Column | Type | Notes |
|---|---|---|
| `Crime ID` | string | Unique identifier (sparse) |
| `Month` | string | Format: YYYY-MM |
| `Reported by` | string | Always "West Yorkshire Police" |
| `Falls within` | string | Force area |
| `Longitude` | float64 | WGS84 |
| `Latitude` | float64 | WGS84 |
| `Location` | string | Nearest street / premises |
| `LSOA code` | string | Lower Super Output Area |
| `LSOA name` | string | District-level label |
| `Crime type` | string | 14 categories |
| `Last outcome category` | string | Investigation status |
| `Context` | string | Excluded (97% null) |

**Download instructions:**

The dataset is not included in this repository due to file size. To reproduce results:

1. Go to [https://data.police.uk/data/](https://data.police.uk/data/)
2. Select **West Yorkshire** under "Forces"
3. Select date range **January 2018 to January 2024**
4. Click **Generate File** and download the archive
5. Extract all `.csv` files into `data/raw/`

---

## 5. Repository Structure

```
crime-hotspot-prediction/
│
├── data/
│   ├── raw/                    # Downloaded CSVs from data.police.uk (not committed)
│   ├── processed/              # Cleaned dataset (crime_cleaned_v1.csv)
│   └── grid/                   # 500m grid cells GeoJSON
│
├── notebooks/
│   ├── 01_eda.ipynb            # Exploratory data analysis
│   ├── 02_feature_engineering.ipynb
│   ├── 03_baseline_models.ipynb
│   ├── 04_advanced_models.ipynb
│   └── 05_evaluation.ipynb
│
├── src/
│   ├── ingest.py               # Data loading and grid aggregation
│   ├── features.py             # Feature engineering pipeline
│   ├── models/
│   │   ├── ridge.py            # Ridge regression model
│   │   └── cnn_gru.py          # CNN-GRU deep learning model
│   ├── evaluate.py             # Walk-forward validation
│   └── visualise.py            # Heatmap and ranking plots
│
├── api/
│   ├── main.py                 # FastAPI application entry point
│   ├── routes/
│   │   ├── hotspots.py         # /hotspots endpoint
│   │   └── query.py            # /query point endpoint
│   └── schemas.py              # Pydantic data models
│
├── dashboard/
│   ├── index.html              # Leaflet.js map interface
│   ├── app.js                  # Frontend logic
│   └── style.css
│
├── validation/
│   └── wf_*.csv                # Walk-forward validation logs (retained for auditability)
│
├── docs/
│   ├── PID.md                  # Project Initiation Document
│   ├── ethical_toolkit.md      # FAST principles analysis
│   ├── group_blog/             # Sprint blog entries
│   └── risk_register.md
│
├── requirements.txt
├── environment.yml             # Conda environment
├── .gitignore
└── README.md
```

---

## 6. Pipeline Architecture

```
data.police.uk CSVs
        |
        v
  [ingest.py]
  Load + merge monthly CSVs
  Snap lat/lon to 500m grid cells
        |
        v
  [features.py]
  Date parsing (year, month fields)
  Crime type standardisation + encoding
  Lag features (1-month, 12-month)
  Rolling mean (3-month window)
  Grid-level aggregation
        |
        v
  [models/ridge.py]          [models/cnn_gru.py]
  Ridge Regression            CNN-GRU (seq2seq)
  (primary / production)      (benchmark only)
        |                           |
        v                           v
  [evaluate.py]
  Walk-forward validation (monthly expanding window)
  Regression metrics: MAE, RMSE, RMSLE, Poisson Deviance
  Ranking metrics: Precision@K, Recall@K, NDCG@K, PAI, PEI
  Logs saved to validation/wf_*.csv
        |
        v
  [api/main.py]
  FastAPI serving /hotspots and /query endpoints
        |
        v
  [dashboard/index.html]
  Leaflet.js interactive map
  Adjustable top-% threshold
  Point-query tool
  Confidence score display (not binary verdicts)
```

---

## 7. Models and Results

All results are from walk-forward validation (expanding window, monthly step).

### 7.1 Regression Metrics (lower is better)

| Model | MAE | RMSE | RMSLE | Poisson Dev. |
|---|---|---|---|---|
| Lag-1 baseline | 3.747 | 5.856 | 0.550 | 7,213 |
| Lag-12 baseline | 4.038 | 6.360 | 0.576 | 8,021 |
| **Ridge Regression** | **2.970** | **4.553** | **0.431** | **4,068** |
| CNN-GRU | 2.041 | 4.777 | 0.449 | 6,928 |

### 7.2 Hotspot Ranking Metrics (higher is better)

| Model | Precision@K | Recall@K | NDCG@K | PAI | PEI |
|---|---|---|---|---|---|
| Lag-1 baseline | 0.654 | 0.654 | 0.936 | 4.939 | 0.911 |
| Lag-12 baseline | 0.619 | 0.619 | 0.915 | 4.805 | 0.884 |
| **Ridge Regression** | **0.731** | **0.731** | **0.958** | **5.087** | **0.946** |
| CNN-GRU | 0.718 | 0.718 | 0.943 | 6.833 | 0.935 |

**Model selection rationale:**

Ridge Regression is designated as the **primary production model** because:
- Its coefficients are directly interpretable (required by ICO AI guidance for law enforcement AI)
- It achieves the best ranking precision (Precision@K = 0.731)
- Its outputs are legally defensible in a policing context

CNN-GRU achieves lower MAE (2.041 vs 2.970) but is less interpretable. It is retained in the codebase as a benchmark and for future research use only.

---

## 8. How to Run

### Prerequisites

- Python 3.10+
- Conda or pip
- 8GB RAM minimum (for full dataset)

### Environment setup

```bash
# Using conda (recommended)
conda env create -f environment.yml
conda activate crime-hotspot

# Or using pip
pip install -r requirements.txt
```

### Data preparation

```bash
# After downloading and placing CSVs in data/raw/
python src/ingest.py --input data/raw/ --output data/processed/crime_cleaned_v1.csv
```

### Feature engineering

```bash
python src/features.py --input data/processed/crime_cleaned_v1.csv --output data/processed/features.parquet
```

### Training models

```bash
# Train Ridge regression (primary)
python src/models/ridge.py --features data/processed/features.parquet --output models/ridge_model.pkl

# Train CNN-GRU (benchmark)
python src/models/cnn_gru.py --features data/processed/features.parquet --output models/cnn_gru.pt
```

### Evaluation

```bash
python src/evaluate.py --model ridge --output validation/
```

### Running the API

```bash
cd api
uvicorn main:app --reload --port 8000
```

API docs available at [http://localhost:8000/docs](http://localhost:8000/docs)

### Running the dashboard

Open `dashboard/index.html` in a browser with the API running on port 8000.

---

## 9. Dashboard and API

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/hotspots` | Returns ranked grid cells for a given month and crime type |
| GET | `/query` | Returns the hotspot score for a specific lat/lon point |
| GET | `/health` | Health check |

Example request:
```
GET /hotspots?month=2024-03&crime_type=violence&top_pct=10
```

### Dashboard Features

- Interactive Leaflet.js map of West Yorkshire
- Adjustable top-% hotspot threshold slider
- Point-query tool (click any location to get its score)
- Hotspot probability score displayed (not binary "crime will happen here")
- Crime type filter
- Month selector

---

## 10. Ethical Framework (FAST Principles)

This project was formally reviewed against the **Alan Turing Institute FAST Principles** (Fairness, Accountability, Sustainability, Transparency) during Sprint 5, supported by UK GDPR, ICO AI and Data Protection Guidance, ACM Code of Ethics, and the UK AI Safety Act 2024.

| Principle | Key Risk | Mitigation |
|---|---|---|
| **Fairness** | Over-policed areas appear as hotspots due to police presence, not higher underlying crime rates. Model could amplify existing policing bias. | System is advisory only. No automated enforcement. Officers retain all decision-making authority. |
| **Accountability** | Lack of audit trail could lead to untraceable decisions if model errors occur. | Walk-forward logs stored as `wf_*.csv`. Full pipeline open-sourced. All model choices documented. |
| **Sustainability** | Self-fulfilling prophecy: more patrols in predicted areas increase recorded crime there, feeding back into training data. | Monthly rolling model refresh planned. ONS socio-economic indicators to be added as future structural features. |
| **Transparency** | CNN-GRU is less interpretable than Ridge regression, limiting stakeholder trust and legal defensibility. | Ridge regression is the primary operational model. CNN-GRU reserved for benchmark comparison. Map displays scores, not binary verdicts. |

**Legal compliance:**
- UK GDPR Article 22: System is advisory only. A human officer must be in the loop for all deployment decisions.
- ICO AI Guidance: Ridge regression coefficients are directly interpretable. Walk-forward results logged for auditability.
- No individual-level PII stored or displayed at any stage. 500m grid cell size used to prevent re-identification.

Full ethical toolkit analysis: [docs/ethical_toolkit.md](docs/ethical_toolkit.md)

---

## 11. Project Management

This project was managed using Agile Scrum methodology with 5 sprints across two semesters.

### Epics and Status

| Epic | Key | Status |
|---|---|---|
| Data Ingestion and Grid Creation | CP-1 | Done |
| Feature Engineering | CP-14 | Done |
| Baseline Modelling | CP-27 | Done |
| Advanced Modelling | CP-40 | Done |
| Evaluation and Ablation | CP-53 | Done |
| API and Frontend Deployment | CP-66 | Done |
| Demo and Reporting | CP-76 | In Progress |
| Reflection and Wrap-Up | CP-77 | In Progress |

Full Jira backlog export: `crime_prediction_jira_backlog.xlsx`

### Key Milestones

| Milestone | Date |
|---|---|
| Project charter and PID created | Sprint 1 |
| Dataset cleaned and EDA complete | Sprint 2 |
| Baseline models trained and evaluated | Sprint 3 |
| CNN-GRU and dashboard complete | Sprint 4 |
| Ethics review and QA testing | Sprint 5 |
| Group submission | Friday 3rd April 2026 |
| Client presentation and live demo | Monday 6th April 2026 |

---

## 12. Team and Roles

| Name | Role | Key Contributions |
|---|---|---|
| Alaedine Ait bella | Project Manager / Lead Engineer | Project charter, data pipeline, baseline and advanced modelling, dashboard, presentation |
| Reyad Taha | Data Engineer | Missing data handling, ethical and privacy data screening, evaluation and ablation |
| Pana Sharif | Frontend / API Developer | API and frontend deployment |

Group blog entries documenting sprint reflections are in `docs/group_blog/`.

---

## 13. Academic Context

| Field | Detail |
|---|---|
| Module | COS-5031-E Discipline-Specific AI Project |
| Level | 5 (Year 2 undergraduate) |
| Credit Value | 60 credits |
| Module Leader | Dr Kulvinder Panesar |
| University | University of Wolverhampton |
| Assessment | Group Presentation and Live Demo (40%) + Individual Report (60%) |
| Submission | Canvas and Presentation |

This project is submitted as part of Assignment 1 (Group Work, 40%) which covers:
- Project Initiation Document (PID)
- Agile project management evidence
- Development approach, architecture, and pipeline
- Live demo of the AI prototype
- Ethical toolkit analysis using FAST Principles

---

## 14. Known Limitations

- **Reporting bias:** The dataset reflects recorded crime, not all crime. Areas with higher police presence generate more data points, which can reinforce patrol allocation decisions in a feedback loop.
- **Geographic boundary:** The model is trained and validated on West Yorkshire only. It should not be deployed in other force areas without retraining.
- **Context column excluded:** The `Context` column was excluded from all modelling due to 97% null values.
- **No socio-economic features:** ONS deprivation indicators were not included in v1.0. Their inclusion is planned as a future enhancement to provide structural context independent of historical policing patterns.
- **CNN-GRU interpretability:** The CNN-GRU model achieves lower MAE but is not suitable for operational use under current ICO guidance due to limited interpretability.
- **Model drift:** The model was last trained on data up to January 2024. A monthly rolling refresh mechanism is planned but not yet implemented.

---

## 15. Licence and Reuse

**Crime data:** Sourced from [data.police.uk](https://data.police.uk) under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

**This codebase:** Released under the MIT Licence. You are free to reuse, adapt, and redistribute with attribution.

**Reuse guidance for researchers and developers:**

If you want to apply this pipeline to a different UK police force area:

1. Download the relevant force data from [data.police.uk](https://data.police.uk)
2. Place CSVs in `data/raw/`
3. Update the bounding box in `src/ingest.py` to match the new force area
4. Rerun the full pipeline from `ingest.py` through to `evaluate.py`
5. Retrain and re-evaluate before any deployment

**Citation:**

If you use this work in academic research, please cite:

```
Crime Hotspot Prediction System, COS-5031-E Group Project,
University of Bradford, 2025-2026.
Dataset: data.police.uk, West Yorkshire Police, 2018-2024.
```

---

*COS-5031-E Crime Prediction Group | West Yorkshire Police DSP Project | University of Wolverhampton | 2025-2026*
