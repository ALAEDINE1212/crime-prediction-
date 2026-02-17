/* ==========
   Crime Prediction Diagrams
   - 3 modes: pipeline, erd, website
   - Click node -> right-side explanation
   - Drag nodes -> saved to localStorage so they stay where placed
   - Reset button -> clears saved positions for current mode
   ========== */

let cy = null;
let currentMode = "pipeline";

const PANEL_TITLES = {
  pipeline: "Pipeline Diagram",
  erd: "ERD Diagram",
  website: "Website Architecture Diagram"
};

const STORAGE_KEY = (mode) => `cp_diagram_positions_${mode}_v1`;

/* ---------- Graph Data ---------- */
/* Keep labels SHORT. Details belong in the right panel. */
const GRAPHS = {
  pipeline: {
    nodes: [
      { data:{ id:"crime_data", label:"Crime Incident Data\n(WY Police CSVs)" }, classes:"source" },
      { data:{ id:"socio_data", label:"Socio-Economic Data\n(ONS / Open Gov)" }, classes:"source planned" },

      { data:{ id:"prep", label:"Pre-processing\n& Quality Gate" }, classes:"process" },
      { data:{ id:"repr", label:"Spatial + Temporal\nRepresentation" }, classes:"process" },
      { data:{ id:"fe", label:"Feature Engineering\n(lags + rolling)" }, classes:"process" },
      { data:{ id:"task", label:"Prediction Task\n(forecast + hotspots)" }, classes:"process" },

      { data:{ id:"baseline", label:"Baseline Models\n(naive / seasonal)" }, classes:"model" },
      { data:{ id:"ridge", label:"Ridge Model\n(tabular ML)" }, classes:"model" },
      { data:{ id:"st_dl", label:"Spatio-Temporal DL\n(CNN + GRU)\n(planned)" }, classes:"model planned" },

      { data:{ id:"eval", label:"Evaluation\n(walk-forward)" }, classes:"eval" },
      { data:{ id:"rai", label:"Responsible AI\n& Governance" }, classes:"rai" },
      { data:{ id:"outputs", label:"Decision-Support\nOutputs" }, classes:"output" },
    ],
    edges: [
      { data:{ id:"e1", source:"crime_data", target:"prep" } },
      { data:{ id:"e2", source:"socio_data", target:"prep" } },
      { data:{ id:"e3", source:"prep", target:"repr" } },
      { data:{ id:"e4", source:"repr", target:"fe" } },
      { data:{ id:"e5", source:"fe", target:"task" } },
      { data:{ id:"e6", source:"task", target:"baseline" } },
      { data:{ id:"e7", source:"task", target:"ridge" } },
      { data:{ id:"e8", source:"task", target:"st_dl" } },
      { data:{ id:"e9", source:"baseline", target:"eval" } },
      { data:{ id:"e10", source:"ridge", target:"eval" } },
      { data:{ id:"e11", source:"st_dl", target:"eval" } },
      { data:{ id:"e12", source:"eval", target:"rai" } },
      { data:{ id:"e13", source:"rai", target:"outputs" } },
    ],
    defaultLayout: { name:"dagre", rankDir:"TB", nodeSep:50, rankSep:70 }
  },

  erd: {
    nodes: [
      { data:{ id:"street_csv", label:"street.csv\n(raw incidents)" }, classes:"table" },
      { data:{ id:"stop_csv", label:"stop_and_search.csv\n(optional)" }, classes:"table muted" },
      { data:{ id:"outcomes_csv", label:"outcomes.csv\n(optional)" }, classes:"table muted" },

      { data:{ id:"dim_cell", label:"dim_cell\n(grid cell index)" }, classes:"table" },
      { data:{ id:"features", label:"cell_month_features\n(model features)" }, classes:"table" },

      { data:{ id:"wf", label:"walk_forward_results\n(metrics per month)" }, classes:"table" },
      { data:{ id:"figures", label:"figures/\n(plots PNG)" }, classes:"artifact" },
      { data:{ id:"api", label:"FastAPI\nserving layer" }, classes:"service" },
      { data:{ id:"ui", label:"Map UI\n(Leaflet)" }, classes:"service" },
    ],
    edges: [
      { data:{ id:"er1", source:"street_csv", target:"features", label:"aggregate\nmonthly counts" } },
      { data:{ id:"er2", source:"street_csv", target:"dim_cell", label:"grid assign\n(cell_x/y)" } },

      { data:{ id:"er3", source:"dim_cell", target:"features", label:"join\ncell geometry" } },

      { data:{ id:"er4", source:"features", target:"wf", label:"evaluate\nwalk-forward" } },
      { data:{ id:"er5", source:"wf", target:"figures", label:"visualize\nmetrics" } },

      { data:{ id:"er6", source:"features", target:"api", label:"load\nparquet" } },
      { data:{ id:"er7", source:"dim_cell", target:"api", label:"load\nparquet" } },
      { data:{ id:"er8", source:"api", target:"ui", label:"JSON\n(months/predict)" } },
    ],
    defaultLayout: { name:"dagre", rankDir:"LR", nodeSep:40, rankSep:70 }
  },

  website: {
    nodes: [
      { data:{ id:"user", label:"User\n(browser)" }, classes:"actor" },

      { data:{ id:"netlify", label:"Frontend Hosting\n(Netlify)" }, classes:"service" },
      { data:{ id:"ui_map", label:"Map UI\n(Leaflet JS)" }, classes:"service" },

      { data:{ id:"render", label:"Backend Hosting\n(Render)" }, classes:"service" },
      { data:{ id:"api_fastapi", label:"FastAPI API\n(uvicorn)" }, classes:"service" },

      { data:{ id:"endpoint_months", label:"GET /months\navailable dates" }, classes:"endpoint" },
      { data:{ id:"endpoint_predict", label:"GET /predict\nhotspots in bbox" }, classes:"endpoint" },
      { data:{ id:"endpoint_point", label:"GET /predict_point\nnearest cell" }, classes:"endpoint" },

      { data:{ id:"parquet", label:"Processed Data\n(parquet)" }, classes:"data" },
      { data:{ id:"model", label:"Forecast Logic\n(ridge / baseline)" }, classes:"model" },

      { data:{ id:"cors", label:"CORS Policy\n(allow origin)" }, classes:"policy" },
    ],
    edges: [
      { data:{ id:"w1", source:"user", target:"netlify" } },
      { data:{ id:"w2", source:"netlify", target:"ui_map", label:"serves\nHTML/CSS/JS" } },

      { data:{ id:"w3", source:"ui_map", target:"api_fastapi", label:"fetch()\nAPI calls" } },
      { data:{ id:"w4", source:"render", target:"api_fastapi", label:"runs" } },

      { data:{ id:"w5", source:"api_fastapi", target:"endpoint_months" } },
      { data:{ id:"w6", source:"api_fastapi", target:"endpoint_predict" } },
      { data:{ id:"w7", source:"api_fastapi", target:"endpoint_point" } },

      { data:{ id:"w8", source:"endpoint_months", target:"parquet", label:"read" } },
      { data:{ id:"w9", source:"endpoint_predict", target:"model", label:"compute" } },
      { data:{ id:"w10", source:"endpoint_point", target:"model", label:"compute" } },
      { data:{ id:"w11", source:"model", target:"parquet", label:"uses\nfeatures+cells" } },

      { data:{ id:"w12", source:"cors", target:"api_fastapi", label:"middleware" } },
      { data:{ id:"w13", source:"ui_map", target:"cors", label:"needs\nallowed origin" } },
    ],
    defaultLayout: { name:"dagre", rankDir:"LR", nodeSep:40, rankSep:75 }
  }
};

/* ---------- Node Details (audience voice, not “you”) ---------- */
const DETAILS = {
  /* PIPELINE */
  crime_data: {
    title: "Crime Incident Data (West Yorkshire Police CSVs)",
    tag: "pipeline • data source",
    body: [
      "Monthly police records provide the raw incident-level observations used to build the dataset.",
      "Each record is mapped to a grid cell and aggregated by month to produce supervised learning targets."
    ],
    bullets: [
      "Inputs: latitude/longitude, crime type, month",
      "Used to compute monthly counts per cell",
      "Primary driver of the prediction task"
    ]
  },
  socio_data: {
    title: "Socio-Economic Data (ONS / Open Government) — planned",
    tag: "pipeline • data source",
    body: [
      "Area-level indicators (e.g., deprivation, unemployment, housing) add context beyond crime history.",
      "These features are merged at the correct geographic resolution (LSOA/MSOA/ward) and aligned by time."
    ],
    bullets: [
      "Examples: IMD, unemployment, education, housing quality",
      "Join key: geography code → mapped into grid",
      "Risk: mismatch in geography and time resolution"
    ]
  },
  prep: {
    title: "Pre-processing & Quality Gate",
    tag: "pipeline • cleaning",
    body: [
      "Cleaning enforces consistent coordinates and removes records that cannot be reliably located.",
      "This step prevents spatial noise from poisoning every downstream feature and evaluation."
    ],
    bullets: [
      "Remove invalid/missing coordinates",
      "Apply ‘No Location’ handling policy",
      "Deduplicate records and standardize columns"
    ]
  },
  repr: {
    title: "Spatial + Temporal Representation",
    tag: "pipeline • representation",
    body: [
      "Incidents are discretised into a fixed spatial grid, then aggregated monthly.",
      "The output becomes a cell-month table: one row per (cell, month)."
    ],
    bullets: [
      "Grid size controls spatial granularity",
      "Monthly aggregation supports walk-forward validation",
      "Provides the base index for features and targets"
    ]
  },
  fe: {
    title: "Feature Engineering (lags + rolling + neighbours)",
    tag: "pipeline • features",
    body: [
      "Lag features convert past counts into predictive signals (lag-1, lag-2, etc.).",
      "Rolling windows smooth volatility; neighbour features capture spillover across adjacent cells."
    ],
    bullets: [
      "Lag features: previous months’ counts",
      "Rolling mean/max: local trend and volatility",
      "Neighbour summaries: mean/max of adjacent cells"
    ]
  },
  task: {
    title: "Prediction Task (forecast + hotspots)",
    tag: "pipeline • task",
    body: [
      "The primary goal is one-step-ahead monthly forecasting of crime counts per grid cell.",
      "Hotspot prediction ranks cells by predicted intensity and reports top-K (or top-percent)."
    ],
    bullets: [
      "Forecast target: count_next_month",
      "Hotspots: top-K predicted cells in an area",
      "Operational output: ranked cells + map overlay"
    ]
  },
  baseline: {
    title: "Baseline Models (naive / seasonal)",
    tag: "pipeline • model",
    body: [
      "Baselines provide reference performance and sanity checks.",
      "If advanced models fail to beat baselines, the ‘improvement’ is fake."
    ],
    bullets: [
      "Naive lag-1: next ≈ last month",
      "Seasonal lag-12: next ≈ same month last year",
      "Used in walk-forward comparison"
    ]
  },
  ridge: {
    title: "Ridge Model (tabular ML)",
    tag: "pipeline • model",
    body: [
      "Ridge regression learns a weighted combination of engineered features.",
      "It is strong for structured data and fast to retrain in walk-forward evaluation."
    ],
    bullets: [
      "Inputs: lags + rolling + neighbour features",
      "Output: predicted next-month count",
      "Strength: stable, interpretable coefficients"
    ]
  },
  st_dl: {
    title: "Spatio-Temporal Deep Learning (CNN + GRU) — planned",
    tag: "pipeline • model",
    body: [
      "CNNs capture local spatial patterns across the grid; GRUs capture temporal dynamics across months.",
      "This requires converting the grid into image-like tensors and building a consistent training window."
    ],
    bullets: [
      "CNN: spatial context (neighbourhood structure)",
      "GRU: sequential temporal memory",
      "Cost: heavier compute + more careful data design"
    ]
  },
  eval: {
    title: "Evaluation (walk-forward validation)",
    tag: "pipeline • evaluation",
    body: [
      "Walk-forward evaluation tests month-by-month forecasting without leaking future information.",
      "It measures both numeric accuracy (MAE/RMSE) and ranking quality (Precision@K)."
    ],
    bullets: [
      "Chronological splits (no random shuffling)",
      "MAE/RMSE for regression error",
      "Precision@K / Hit-rate@K for hotspot ranking"
    ]
  },
  rai: {
    title: "Responsible AI & Governance",
    tag: "pipeline • governance",
    body: [
      "Outputs are decision-support, not automated enforcement.",
      "Documentation includes limitations, bias risks, and appropriate use constraints."
    ],
    bullets: [
      "Decision-support framing",
      "Bias and fairness awareness",
      "Transparency: what the model uses and cannot do"
    ]
  },
  outputs: {
    title: "Decision-Support Outputs",
    tag: "pipeline • outputs",
    body: [
      "The model produces maps and ranked hotspot lists for a chosen month and area.",
      "Outputs are designed for interpretation and operational planning, not policing decisions."
    ],
    bullets: [
      "Heatmap / points overlay on map",
      "Top-K ranked cells",
      "Evaluation tables and plots"
    ]
  },

  /* ERD */
  street_csv: {
    title: "street.csv (raw incidents)",
    tag: "erd • raw",
    body: [
      "Raw monthly police incidents are stored as CSV files.",
      "These are the primary input to build the cell-month dataset."
    ],
    bullets: [
      "Contains coordinates and dates",
      "Mapped into grid cells",
      "Aggregated to monthly counts"
    ]
  },
  stop_csv: {
    title: "stop_and_search.csv (optional)",
    tag: "erd • raw",
    body: [
      "Stop-and-search records can be used as an auxiliary signal if included.",
      "It remains optional depending on data quality and project scope."
    ],
    bullets: [
      "Optional feature source",
      "May require separate cleaning rules",
      "Can be aggregated similarly by grid/month"
    ]
  },
  outcomes_csv: {
    title: "outcomes.csv (optional)",
    tag: "erd • raw",
    body: [
      "Outcome records describe post-incident outcomes for some crimes.",
      "This is often incomplete and may be excluded from the main target."
    ],
    bullets: [
      "High missingness is common",
      "May introduce bias if used incorrectly",
      "Can be used for descriptive analysis"
    ]
  },
  dim_cell: {
    title: "dim_cell (grid cell index)",
    tag: "erd • processed",
    body: [
      "A dimension table describing each grid cell and its geometry/centroid.",
      "Used to translate model results into geographic coordinates for mapping."
    ],
    bullets: [
      "cell_id, cell_x, cell_y",
      "lat/lon center per cell",
      "Used by API and visualisations"
    ]
  },
  features: {
    title: "cell_month_features (model feature table)",
    tag: "erd • processed",
    body: [
      "The main training table: one row per (cell, month).",
      "Contains targets and engineered features used by models."
    ],
    bullets: [
      "Index: cell_id + month",
      "Columns: lags/rolling/neighbour features",
      "Target: next-month count"
    ]
  },
  wf: {
    title: "walk_forward_results (metrics per month)",
    tag: "erd • evaluation",
    body: [
      "Stores month-by-month evaluation results from walk-forward validation.",
      "Used to generate summary statistics and plots."
    ],
    bullets: [
      "MAE/RMSE per forecast month",
      "Precision@K per forecast month",
      "Supports comparison across models"
    ]
  },
  figures: {
    title: "figures/ (saved plots)",
    tag: "erd • artifacts",
    body: [
      "Generated images for reports and documentation.",
      "Includes time series plots and summary bar charts."
    ],
    bullets: [
      "wf_mae_over_time.png, wf_rmse_over_time.png",
      "Precision@K plots",
      "Month hotspot overlays"
    ]
  },
  api: {
    title: "FastAPI serving layer",
    tag: "erd • service",
    body: [
      "Loads processed parquet tables and serves predictions as JSON.",
      "This is what the frontend calls."
    ],
    bullets: [
      "Endpoints: /months, /predict, /predict_point",
      "Loads dim_cell + features",
      "Returns hotspot points for mapping"
    ]
  },
  ui: {
    title: "Map UI (Leaflet)",
    tag: "erd • service",
    body: [
      "Frontend map interface that requests months and predictions.",
      "Displays hotspots as overlays and supports point queries."
    ],
    bullets: [
      "Choose forecast month + top percent",
      "Load hotspots for current map bounds",
      "Click map for nearest cell prediction"
    ]
  },

  /* WEBSITE */
  user: {
    title: "User (browser)",
    tag: "website • actor",
    body: [
      "The browser runs the UI and triggers prediction requests.",
      "All interaction is client-side: selecting a month, panning map, clicking points."
    ],
    bullets: [
      "Inputs: forecast month, top-percent, map area",
      "Actions: load hotspots, click point",
      "Receives: JSON and renders overlays"
    ]
  },
  netlify: {
    title: "Frontend Hosting (Netlify)",
    tag: "website • hosting",
    body: [
      "Netlify serves the static frontend files: index.html, styles.css, app.js.",
      "This produces a public link and handles CDN-level delivery."
    ],
    bullets: [
      "Static hosting (no server code)",
      "Deploys from GitHub branch",
      "Outputs: public site URL"
    ]
  },
  ui_map: {
    title: "Map UI (Leaflet JS)",
    tag: "website • frontend",
    body: [
      "Leaflet renders the real map and overlays predictions.",
      "It calls the backend using fetch(), passing selected month and bounds."
    ],
    bullets: [
      "Loads months on startup",
      "Calls /predict with bbox",
      "Calls /predict_point on map click"
    ]
  },
  render: {
    title: "Backend Hosting (Render)",
    tag: "website • hosting",
    body: [
      "Render runs the FastAPI service on a public HTTPS URL.",
      "It builds from the GitHub repo and starts uvicorn."
    ],
    bullets: [
      "Python web service",
      "Reads parquet packaged in repo",
      "Provides stable API base URL"
    ]
  },
  api_fastapi: {
    title: "FastAPI API (uvicorn)",
    tag: "website • backend",
    body: [
      "FastAPI serves endpoints used by the map UI.",
      "It loads parquet files and computes predictions per request."
    ],
    bullets: [
      "Startup: loads paths and validates files",
      "Runtime: handle requests and return JSON",
      "CORS middleware controls allowed origins"
    ]
  },
  endpoint_months: {
    title: "GET /months",
    tag: "website • endpoint",
    body: [
      "Returns forecast months that can be requested safely (enough history).",
      "The frontend uses this to populate the dropdown."
    ],
    bullets: [
      "Returns: list of month strings",
      "Derived from feature table coverage",
      "Prevents invalid month requests"
    ]
  },
  endpoint_predict: {
    title: "GET /predict (hotspots in bbox)",
    tag: "website • endpoint",
    body: [
      "Computes and returns hotspot cells inside the current map view (bounding box).",
      "The frontend plots them as points."
    ],
    bullets: [
      "Inputs: forecast_month, bbox, top_pct",
      "Output: array of hotspot points + predicted counts",
      "Supports “Only current map view” filtering"
    ]
  },
  endpoint_point: {
    title: "GET /predict_point (nearest cell)",
    tag: "website • endpoint",
    body: [
      "Finds the nearest grid cell to a clicked map coordinate and returns its predicted count.",
      "This supports point-level queries without cluttering the map."
    ],
    bullets: [
      "Inputs: forecast_month, lat, lon",
      "Output: nearest cell + predicted/actual count (if available)",
      "Useful for explaining specific locations"
    ]
  },
  parquet: {
    title: "Processed Data (parquet)",
    tag: "website • data",
    body: [
      "The API reads the precomputed feature table and cell geometry from parquet files.",
      "This avoids rebuilding the dataset on the server."
    ],
    bullets: [
      "cell_month_features.parquet",
      "dim_cell.parquet",
      "Must exist at runtime on Render"
    ]
  },
  model: {
    title: "Forecast Logic (ridge / baseline)",
    tag: "website • model",
    body: [
      "Prediction logic runs server-side using trained parameters or deterministic baselines.",
      "Outputs are converted to map points using dim_cell geometry."
    ],
    bullets: [
      "Ridge-based prediction from engineered features",
      "Top-K selection from predicted intensity",
      "Returns JSON suitable for mapping"
    ]
  },
  cors: {
    title: "CORS Policy (allow origin)",
    tag: "website • security",
    body: [
      "CORS controls which websites are allowed to call the API from a browser.",
      "Without correct CORS headers, the frontend is blocked even if the API works."
    ],
    bullets: [
      "allow_origins should include the Netlify domain",
      "Browsers enforce it; curl does not",
      "Misconfig shows as blocked fetch in console"
    ]
  }
};

/* ---------- Cytoscape Styles ---------- */
const CY_STYLE = [
  {
    selector: "node",
    style: {
      "shape": "round-rectangle",
      "background-color": "rgba(122,162,255,0.18)",
      "border-width": 1,
      "border-color": "rgba(122,162,255,0.35)",
      "label": "data(label)",
      "color": "#e8eefc",
      "font-size": 12,
      "text-valign": "center",
      "text-halign": "center",
      "text-wrap": "wrap",
      "text-max-width": 160,
      "width": 190,
      "height": 62
    }
  },
  {
    selector: "node.planned",
    style: {
      "opacity": 0.65,
      "border-style": "dashed"
    }
  },
  {
    selector: "node.process",
    style: {
      "background-color": "rgba(255, 201, 77, 0.18)",
      "border-color": "rgba(255, 201, 77, 0.45)"
    }
  },
  {
    selector: "node.model",
    style: {
      "background-color": "rgba(170, 180, 210, 0.16)",
      "border-color": "rgba(170, 180, 210, 0.40)"
    }
  },
  {
    selector: "node.eval",
    style: {
      "background-color": "rgba(88, 213, 201, 0.14)",
      "border-color": "rgba(88, 213, 201, 0.40)"
    }
  },
  {
    selector: "node.rai",
    style: {
      "background-color": "rgba(88, 213, 201, 0.12)",
      "border-color": "rgba(88, 213, 201, 0.36)"
    }
  },
  {
    selector: "node.output",
    style: {
      "background-color": "rgba(160, 120, 255, 0.16)",
      "border-color": "rgba(160, 120, 255, 0.40)"
    }
  },
  {
    selector: "node.table",
    style: {
      "background-color": "rgba(122,162,255,0.12)",
      "border-color": "rgba(122,162,255,0.32)",
      "width": 200,
      "height": 64
    }
  },
  {
    selector: "node.muted",
    style: {
      "opacity": 0.55
    }
  },
  {
    selector: "node.artifact",
    style: {
      "background-color": "rgba(160,120,255,0.12)",
      "border-color": "rgba(160,120,255,0.35)"
    }
  },
  {
    selector: "node.service",
    style: {
      "background-color": "rgba(88, 213, 201, 0.12)",
      "border-color": "rgba(88, 213, 201, 0.35)"
    }
  },
  {
    selector: "node.endpoint",
    style: {
      "background-color": "rgba(255, 201, 77, 0.12)",
      "border-color": "rgba(255, 201, 77, 0.35)",
      "width": 205,
      "height": 62
    }
  },
  {
    selector: "node.data",
    style: {
      "background-color": "rgba(122,162,255,0.12)",
      "border-color": "rgba(122,162,255,0.32)"
    }
  },
  {
    selector: "node.policy",
    style: {
      "background-color": "rgba(255, 120, 120, 0.10)",
      "border-color": "rgba(255, 120, 120, 0.35)"
    }
  },
  {
    selector: "node.actor",
    style: {
      "background-color": "rgba(255,255,255,0.08)",
      "border-color": "rgba(255,255,255,0.22)"
    }
  },
  {
    selector: "edge",
    style: {
      "width": 1.2,
      "curve-style": "bezier",
      "line-color": "rgba(167,179,204,0.35)",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "rgba(167,179,204,0.35)",
      "arrow-scale": 0.9,
      "label": "data(label)",
      "font-size": 10,
      "color": "rgba(167,179,204,0.75)",
      "text-rotation": "autorotate",
      "text-wrap": "wrap",
      "text-max-width": 110
    }
  },
  {
    selector: "node:selected",
    style: {
      "border-width": 2,
      "border-color": "rgba(122,162,255,0.9)",
      "background-color": "rgba(122,162,255,0.28)"
    }
  },
  {
    selector: ".highlighted",
    style: {
      "border-width": 3,
      "border-color": "rgba(88,213,201,0.9)"
    }
  }
];

/* ---------- Helpers ---------- */
function getSavedPositions(mode){
  try{
    const raw = localStorage.getItem(STORAGE_KEY(mode));
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){
    return null;
  }
}

function savePositions(mode){
  if(!cy) return;
  const pos = {};
  cy.nodes().forEach(n => {
    pos[n.id()] = n.position();
  });
  localStorage.setItem(STORAGE_KEY(mode), JSON.stringify(pos));
}

function clearPositions(mode){
  localStorage.removeItem(STORAGE_KEY(mode));
}

function renderDetails(nodeId){
  const box = document.getElementById("details");
  const d = DETAILS[nodeId];
  if(!d){
    box.innerHTML = `
      <div class="card">
        <h2>Unknown node</h2>
        <div class="tag">${nodeId}</div>
        <p>No description found for this node id.</p>
      </div>
    `;
    return;
  }

  const bodyHtml = (d.body || []).map(p => `<p>${p}</p>`).join("");
  const bulletsHtml = (d.bullets || []).length
    ? `<ul>${d.bullets.map(li => `<li>${li}</li>`).join("")}</ul>`
    : "";

  box.innerHTML = `
    <div class="card">
      <h2>${d.title}</h2>
      <div class="tag">${d.tag}</div>
      ${bodyHtml}
      ${bulletsHtml}
    </div>
  `;
}

function setEmptyDetails(){
  const box = document.getElementById("details");
  box.innerHTML = `
    <div class="details-empty">
      <div>
        <div class="icon">⧉</div>
        <div class="empty-title">Select a node</div>
        <div class="empty-text">This panel explains what it is and how it connects.</div>
      </div>
    </div>
  `;
}

/* ---------- Graph init ---------- */
function init(mode){
  currentMode = mode;

  // title update
  document.getElementById("panelTitle").textContent = PANEL_TITLES[mode] || "Diagram";

  // kill old instance
  if(cy){
    cy.destroy();
    cy = null;
  }

  setEmptyDetails();

  const graph = GRAPHS[mode];
  const elements = [...graph.nodes, ...graph.edges];

  cy = cytoscape({
    container: document.getElementById("cy"),
    elements,
    style: CY_STYLE,
    wheelSensitivity: 0.2
  });

  // If positions exist: use preset layout
  const saved = getSavedPositions(mode);
  if(saved){
    cy.nodes().forEach(n => {
      const p = saved[n.id()];
      if(p) n.position(p);
    });
    cy.layout({ name:"preset" }).run();
  }else{
    cy.layout(graph.defaultLayout).run();
  }

  // Save positions after dragging
  cy.on("dragfree", "node", () => savePositions(mode));

  // Node click: show details
  cy.on("tap", "node", (evt) => {
    const id = evt.target.id();
    renderDetails(id);
  });

  // Background click: clear
  cy.on("tap", (evt) => {
    if(evt.target === cy){
      cy.nodes().removeClass("highlighted");
      setEmptyDetails();
    }
  });
}

/* ---------- Search ---------- */
function searchNode(){
  if(!cy) return;
  const q = (document.getElementById("searchInput").value || "").trim().toLowerCase();
  if(!q) return;

  cy.nodes().removeClass("highlighted");

  // match by id or label substring
  let hit = cy.nodes().filter(n => n.id().toLowerCase() === q);
  if(hit.length === 0){
    hit = cy.nodes().filter(n => (n.data("label") || "").toLowerCase().includes(q));
  }

  if(hit.length === 0) return;

  const n = hit[0];
  n.addClass("highlighted");
  cy.animate({ fit: { eles: n, padding: 90 }, duration: 350 });
  n.select();
  renderDetails(n.id());
}

/* ---------- Wire UI ---------- */
function wireUI(){
  // tabs
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      init(btn.dataset.mode);
    });
  });

  // search
  document.getElementById("searchBtn").addEventListener("click", searchNode);
  document.getElementById("searchInput").addEventListener("keydown", (e) => {
    if(e.key === "Enter") searchNode();
  });

  // reset
  document.getElementById("resetBtn").addEventListener("click", () => {
    clearPositions(currentMode);
    init(currentMode);
  });
}

/* ---------- Start ---------- */
wireUI();
init("pipeline");
