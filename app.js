/* global cytoscape */

// =============================
// Persistence (drag positions)
// =============================
const LS_KEY_PREFIX = "cp_diagram_positions_";
function positionsKey(diagram) { return `${LS_KEY_PREFIX}${diagram}`; }
function loadPositions(diagram) {
  try {
    const raw = localStorage.getItem(positionsKey(diagram));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : null;
  } catch { return null; }
}
function savePositions(diagram, cy) {
  if (!cy) return;
  const pos = {};
  cy.nodes().forEach(n => { pos[n.id()] = n.position(); });
  localStorage.setItem(positionsKey(diagram), JSON.stringify(pos));
}
function applyPositions(cy, posObj) {
  if (!posObj || !cy) return false;
  let applied = 0;
  cy.nodes().forEach(n => {
    const p = posObj[n.id()];
    if (p && typeof p.x === "number" && typeof p.y === "number") {
      n.position(p);
      applied++;
    }
  });
  return applied > 0;
}

// =============================
// Layout meta
// =============================
const DIAGRAM_META = {
  pipeline: {
    title: "Pipeline Diagram",
    layout: { name: "dagre", rankDir: "TB", rankSep: 95, nodeSep: 45, edgeSep: 14, padding: 70 }
  },
  erd: {
    title: "ERD Diagram",
    layout: { name: "dagre", rankDir: "LR", rankSep: 120, nodeSep: 60, edgeSep: 14, padding: 80 }
  },
  web: {
    title: "Website Architecture Diagram",
    layout: { name: "dagre", rankDir: "LR", rankSep: 125, nodeSep: 55, edgeSep: 18, padding: 85 }
  }
};

// =============================
// Cytoscape style (READABLE, NO WHITE LABEL BOX)
// =============================
// Key change: remove text-background entirely.
// Use strong font + subtle outline only.
const CY_STYLE = [
  {
    selector: "node",
    style: {
      "shape": "round-rectangle",
      "label": "data(label)",
      "text-valign": "center",
      "text-halign": "center",
      "text-wrap": "wrap",
      "text-max-width": "data(textMaxW)",
      "width": "data(w)",
      "height": "data(h)",

      "font-family": "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      "font-size": "data(fs)",
      "font-weight": 900,

      // readable text without white square
      "color": "#0b1220",
      "text-outline-width": 1.25,
      "text-outline-color": "rgba(255,255,255,0.35)",

      "border-width": 1.8,
      "border-color": "rgba(148,163,184,0.35)",
      "overlay-opacity": 0
    }
  },

  // Pipeline palette (same “feel” as before)
  { selector: "node.dataset", style: { "background-color": "#8fb7ff", "border-color": "rgba(143,183,255,0.95)" } },
  { selector: "node.step", style: { "background-color": "#f6c85f", "border-color": "rgba(246,200,95,0.95)" } },
  { selector: "node.model", style: { "background-color": "#cfd6e6", "border-color": "rgba(207,214,230,0.95)" } },
  { selector: "node.eval", style: { "background-color": "#42d9a7", "border-color": "rgba(66,217,167,0.95)" } },
  { selector: "node.output", style: { "background-color": "#b487ff", "border-color": "rgba(180,135,255,0.95)" } },

  // Planned / Optional styling
  { selector: "node.planned", style: { "border-style": "dashed", "border-width": 2.2, "opacity": 0.92 } },
  { selector: "node.optional", style: { "border-style": "dashed", "border-width": 2.2, "opacity": 0.92 } },

  // ERD tables
  { selector: "node.table", style: { "background-color": "#ffffff", "border-color": "rgba(148,163,184,0.9)" } },

  // Website architecture palette (kept simple but readable)
  { selector: "node.web-white", style: { "background-color": "#ffffff", "border-color": "rgba(148,163,184,0.9)" } },
  { selector: "node.web-blue", style: { "background-color": "#7aa2ff", "border-color": "rgba(122,162,255,0.95)" } },
  { selector: "node.web-teal", style: { "background-color": "#2ee6c2", "border-color": "rgba(46,230,194,0.95)" } },
  { selector: "node.web-dark", style: { "background-color": "#0b1630", "border-color": "rgba(232,238,252,0.35)", "color": "#e8eefc", "text-outline-color": "rgba(0,0,0,0.55)" } },

  // Edges
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      "width": 2,
      "line-color": "rgba(148,163,184,0.48)",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "rgba(148,163,184,0.58)",
      "arrow-scale": 0.9,

      "label": "data(label)",
      "font-family": "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      "font-size": 12,
      "font-weight": 900,
      "color": "#e8eefc",
      "text-outline-width": 3,
      "text-outline-color": "rgba(0,0,0,0.70)",
      "text-rotation": "autorotate"
    }
  },

  // Selected highlight
  {
    selector: ".selected",
    style: {
      "border-width": 3,
      "border-color": "rgba(122,162,255,0.98)",
      "line-color": "rgba(122,162,255,0.70)",
      "target-arrow-color": "rgba(122,162,255,0.80)"
    }
  }
];

// =============================
// Node / Edge builders
// =============================
function node(id, label, classes, details, sizing = {}) {
  const { w = 240, h = 88, fs = 14, textMaxW = 210 } = sizing;
  return { data: { id, label, details, w, h, fs, textMaxW }, classes };
}
function edge(id, source, target, label = "") {
  return { data: { id, source, target, label } };
}

// =============================
// Details schema (audience tone)
// =============================
function detailBlock({
  role = "Implemented",
  what = "",
  why = "",
  how = "",
  inputs = [],
  outputs = [],
  connections = [],
  tags = []
} = {}) {
  return { role, what, why, how, inputs, outputs, connections, tags };
}

// =============================
// PIPELINE (current + planned)
// =============================
const PIPELINE = [
  // Inputs
  node(
    "street_csvs",
    "Crime Incident Data\nWest Yorkshire Police\n(monthly street CSVs)",
    "dataset",
    detailBlock({
      role: "Implemented",
      tags: ["Data", "Primary signal"],
      what: "Monthly street-level crime records used as the main incident signal.",
      why: "Hotspot forecasting requires historical counts per location; these records supply the core time-series.",
      how: "Files are read from monthly folders, validated, cleaned, and aggregated into grid cells and months.",
      inputs: ["Police monthly street CSVs"],
      outputs: ["Monthly cell counts", "Features table (after aggregation)"],
      connections: ["Feeds: Pre-processing & Quality Gate"]
    }),
    { w: 265, h: 98, fs: 14, textMaxW: 225 }
  ),

  node(
    "outcomes_csvs",
    "Outcomes Data\n(monthly outcomes CSVs)\n(optional)",
    "dataset optional",
    detailBlock({
      role: "Optional (Not used in current model)",
      tags: ["Data", "Optional"],
      what: "Outcome records linked to crime reports (e.g., status/closure information).",
      why: "Could support additional analysis (e.g., resolution patterns) or alternative targets, but not required for hotspot counts.",
      how: "Would be joined where possible via identifiers seen in police data; coverage can be incomplete.",
      inputs: ["Police outcomes CSVs"],
      outputs: ["Optional outcome-derived features/analytics"],
      connections: ["Optional input to: Feature Engineering"]
    }),
    { w: 250, h: 98, fs: 14, textMaxW: 215 }
  ),

  node(
    "stop_search_csvs",
    "Stop & Search Data\n(monthly stop-and-search)\n(optional)",
    "dataset optional",
    detailBlock({
      role: "Optional (Not used in current model)",
      tags: ["Data", "Optional"],
      what: "Stop-and-search records that can reflect enforcement activity and context.",
      why: "May add contextual signals, but introduces bias risk and must be handled carefully.",
      how: "Could be aggregated into the same grid/month representation as incidents.",
      inputs: ["Stop-and-search CSVs"],
      outputs: ["Optional stop/search features by cell-month"],
      connections: ["Optional input to: Feature Engineering"]
    }),
    { w: 250, h: 98, fs: 14, textMaxW: 215 }
  ),

  node(
    "socio_economic",
    "Socio-Economic Indicators\n(ONS / Open Gov)\n(planned)",
    "dataset planned",
    detailBlock({
      role: "Planned (Future work)",
      tags: ["Data", "Planned"],
      what: "Area-level indicators (deprivation, income, employment, etc.) used as explanatory context.",
      why: "Pure history-based forecasts can miss structural drivers; socio-economic context can improve generalisation.",
      how: "Indicators would be joined to grid cells via geographic mapping (e.g., LSOA/MSOA → grid overlap).",
      inputs: ["ONS/Open Gov datasets", "Boundary lookups (LSOA/MSOA shapes or mappings)"],
      outputs: ["Context features by area/time", "Joined context features by cell-month"],
      connections: ["Planned input to: Feature Engineering (context join)"]
    }),
    { w: 275, h: 102, fs: 14, textMaxW: 235 }
  ),

  // Processing
  node(
    "preprocess",
    "Data Pre-processing\n& Quality Gate\nclean + validate",
    "step",
    detailBlock({
      role: "Implemented",
      tags: ["Cleaning", "Validation"],
      what: "Data cleaning and validation stage before any modelling.",
      why: "Bad coordinates, missing values, and inconsistent schema produce misleading hotspots.",
      how: "Rows with invalid geo-coordinates are filtered; month fields are standardised; schema is normalised across files.",
      inputs: ["Raw CSVs (street, optional: outcomes, stop/search)"],
      outputs: ["Clean incident records ready for spatial/temporal aggregation"],
      connections: ["Receives: Raw data → Produces: Grid + monthly representation"]
    })
  ),

  node(
    "grid_month",
    "Spatial & Temporal\nRepresentation\ngrid + monthly",
    "step",
    detailBlock({
      role: "Implemented",
      tags: ["Grid", "Aggregation"],
      what: "A consistent spatial grid plus a monthly time index.",
      why: "Models require fixed spatial units over time to support forecasting and hotspot ranking.",
      how: "Coordinates are mapped into meter-based grid indices (cell_x, cell_y); counts are aggregated per (cell, month).",
      inputs: ["Clean incident records"],
      outputs: ["dim_cell.parquet", "Monthly counts per cell"],
      connections: ["Feeds: Feature Engineering"]
    })
  ),

  node(
    "features",
    "Feature Engineering\nlags + rolling\nneighbours (optional)",
    "step",
    detailBlock({
      role: "Implemented (+ optional extensions)",
      tags: ["Time-series features", "Neighbour features"],
      what: "Predictor variables computed per cell-month (history and trend).",
      why: "Forecasting benefits from lag signals and smoothed trend statistics; neighbour context can capture spillover.",
      how: "Lag features and rolling-window statistics are computed; neighbour aggregates can be computed via adjacency.",
      inputs: ["Monthly counts per cell", "Optional adjacency (neighbour graph)", "Optional socio-economic join"],
      outputs: ["cell_month_features.parquet"],
      connections: ["Feeds: Model training & forecasting"]
    })
  ),

  node(
    "task",
    "Prediction Task\nforecast + hotspots",
    "step",
    detailBlock({
      role: "Implemented",
      tags: ["Forecasting", "Ranking"],
      what: "One-step-ahead monthly forecasting per cell and hotspot selection by ranking.",
      why: "Decision-support requires identifying likely hotspot cells for a future month.",
      how: "Predicted counts are generated per cell; hotspots are defined as the top K% within the selected area (bbox).",
      inputs: ["Feature table", "Forecast month selection", "Top% threshold", "Optional bbox"],
      outputs: ["Hotspot list", "Point-level nearest cell prediction"],
      connections: ["Consumes: Model predictions → Feeds: Evaluation and Web outputs"]
    })
  ),

  // Models (current + planned)
  node(
    "baselines",
    "Baseline Models\nnaive lag-1\nseasonal lag-12",
    "model",
    detailBlock({
      role: "Implemented",
      tags: ["Benchmark"],
      what: "Simple reference models used as minimum performance standards.",
      why: "Benchmarks prevent over-claiming; any advanced model must beat the baseline reliably.",
      how: "Lag-1 predicts next month as last month; seasonal uses the same month from the previous year where available.",
      inputs: ["Historical counts per cell"],
      outputs: ["Baseline predictions", "Baseline metrics"],
      connections: ["Compared against: Ridge, DL models"]
    }),
    { w: 260, h: 88, fs: 14, textMaxW: 220 }
  ),

  node(
    "ridge",
    "ML Model\nRidge Regression\n(lags + rolling)",
    "model",
    detailBlock({
      role: "Implemented (Best working model)",
      tags: ["Linear model", "Regularised regression"],
      what: "Regularised regression model trained on engineered features to forecast counts.",
      why: "Provides a strong, explainable improvement over naive baselines while staying lightweight and stable.",
      how: "Ridge is trained using walk-forward splits; forecasts are computed for each month and used for hotspot ranking.",
      inputs: ["cell_month_features.parquet", "Walk-forward splits"],
      outputs: ["Predicted counts per cell", "Hotspot rankings"],
      connections: ["Feeds: Walk-forward evaluation", "Feeds: API /predict and /predict_point"]
    }),
    { w: 260, h: 88, fs: 14, textMaxW: 220 }
  ),

  node(
    "dl_cnn_gru",
    "Deep Learning\nCNN + GRU\n(spatio-temporal)\n(planned)",
    "model planned",
    detailBlock({
      role: "Planned (Future work)",
      tags: ["Deep learning", "Spatio-temporal"],
      what: "A spatio-temporal model that learns patterns across space (CNN) and time (GRU).",
      why: "May capture complex spatial dynamics and temporal dependencies beyond handcrafted features.",
      how: "Grid data is reshaped into spatial tensors per month; CNN extracts spatial features and GRU models temporal evolution.",
      inputs: ["Grid tensor sequences", "Optional socio-economic channels"],
      outputs: ["Forecasts per cell", "Hotspot rankings"],
      connections: ["Planned alternative to: Ridge", "Evaluated via: Walk-forward + hotspot metrics"]
    }),
    { w: 280, h: 110, fs: 14, textMaxW: 240 }
  ),

  node(
    "gnn",
    "Graph Model\nGNN / ST-GNN\n(optional planned)",
    "model planned optional",
    detailBlock({
      role: "Optional (Planned extension)",
      tags: ["Graph", "Neighbours"],
      what: "Graph neural model using an adjacency graph between cells.",
      why: "Neighbour spillover can be modelled explicitly rather than through simple aggregates.",
      how: "Cells become nodes; edges connect neighbour cells; temporal modelling is added with recurrent/temporal layers.",
      inputs: ["Adjacency edges", "Cell time series features"],
      outputs: ["Forecasts per cell", "Spatially-consistent hotspot rankings"],
      connections: ["Depends on: adjacency_edges table (ERD)", "Alternative to: CNN+GRU"]
    }),
    { w: 270, h: 100, fs: 14, textMaxW: 230 }
  ),

  // Evaluation and outputs
  node(
    "evaluation",
    "Evaluation & Validation\nwalk-forward\nMAE / RMSE / Precision@K",
    "eval",
    detailBlock({
      role: "Implemented",
      tags: ["Evaluation", "Leakage control"],
      what: "Time-aware evaluation that simulates real forecasting (train on past, test on next month).",
      why: "Random splits cause leakage for time series; walk-forward reflects real deployment conditions.",
      how: "For each step, the model is trained on historical months and evaluated on the next month; hotspot precision@K is computed.",
      inputs: ["Predictions per cell", "True counts per cell-month"],
      outputs: ["wf_*.csv results", "figures/ plots for metrics and hotspot maps"],
      connections: ["Reports performance for: baseline, ridge, future DL/GNN models"]
    }),
    { w: 285, h: 105, fs: 14, textMaxW: 245 }
  ),

  node(
    "governance",
    "Responsible AI\n& Governance\nbias + limitations",
    "eval",
    detailBlock({
      role: "Ongoing (Required)",
      tags: ["Ethics", "Risk"],
      what: "Risk-aware framing for use as decision-support rather than automated enforcement.",
      why: "Policing data contains reporting and enforcement biases; misuse leads to harmful feedback loops.",
      how: "Document limitations, avoid sensitive inference, present uncertainty, and restrict intended use to planning support.",
      inputs: ["Data characteristics", "Model behaviour", "Stakeholder constraints"],
      outputs: ["Transparency notes", "Risk mitigations", "Ethics-by-design evidence"],
      connections: ["Applies to: all downstream outputs and deployment decisions"]
    }),
    { w: 270, h: 95, fs: 14, textMaxW: 230 }
  ),

  node(
    "web_output",
    "Decision-Support Output\nInteractive Hotspot Map\n+ point query",
    "output",
    detailBlock({
      role: "Implemented",
      tags: ["Web UI", "Leaflet", "API"],
      what: "Interactive map interface to request predictions and visualise hotspots.",
      why: "Stakeholders need interpretable output: where hotspots are, and what a location’s nearest cell predicts.",
      how: "Frontend calls API for available months and hotspot lists; clicking a point calls nearest-cell prediction.",
      inputs: ["Forecast month", "Top% threshold", "Optional bbox", "Map click lat/lon"],
      outputs: ["Hotspot markers", "Nearest cell prediction panel"],
      connections: ["Uses: /months, /predict, /predict_point endpoints"]
    }),
    { w: 300, h: 105, fs: 14, textMaxW: 260 }
  ),

  // Pipeline edges
  edge("p1", "street_csvs", "preprocess", ""),
  edge("p2", "outcomes_csvs", "preprocess", "optional"),
  edge("p3", "stop_search_csvs", "preprocess", "optional"),
  edge("p4", "socio_economic", "features", "planned join"),

  edge("p5", "preprocess", "grid_month", ""),
  edge("p6", "grid_month", "features", ""),
  edge("p7", "features", "task", ""),

  edge("p8", "task", "baselines", offersLabel("benchmark")),
  edge("p9", "task", "ridge", offersLabel("current best")),
  edge("p10", "task", "dl_cnn_gru", offersLabel("planned")),
  edge("p11", "task", "gnn", offersLabel("optional planned")),

  edge("p12", "baselines", "evaluation", ""),
  edge("p13", "ridge", "evaluation", ""),
  edge("p14", "dl_cnn_gru", "evaluation", "planned"),
  edge("p15", "gnn", "evaluation", "planned"),

  edge("p16", "evaluation", "governance", ""),
  edge("p17", "governance", "web_output", "")
];

function offersLabel(x) { return x; }

// =============================
// ERD (include optionals)
// =============================
const ERD = [
  node(
    "erd_raw_street",
    "raw_street\n(monthly CSVs)\ncrime_type, lat, lon, location...",
    "table optional",
    detailBlock({
      role: "Optional (Raw source)",
      tags: ["Raw"],
      what: "Unprocessed monthly street-level incident records.",
      why: "Shows provenance and supports traceability and audits.",
      how: "Read from disk, cleaned, and aggregated; not required at runtime after processing.",
      inputs: ["Monthly CSV files"],
      outputs: ["Clean records → aggregation"],
      connections: ["Feeds processing → cell_month_features"]
    }),
    { w: 330, h: 120, fs: 14, textMaxW: 290 }
  ),

  node(
    "erd_raw_outcomes",
    "raw_outcomes\n(monthly CSVs)\noptional linkage",
    "table optional",
    detailBlock({
      role: "Optional (Raw source)",
      tags: ["Raw", "Optional"],
      what: "Outcome records associated with incidents.",
      why: "Can support extended analysis or alternative targets.",
      how: "Joinable where identifiers exist; coverage may be incomplete.",
      inputs: ["Monthly CSV files"],
      outputs: ["Outcome analytics or optional features"],
      connections: ["Optional join to features"]
    }),
    { w: 300, h: 105, fs: 14, textMaxW: 260 }
  ),

  node(
    "erd_raw_stop",
    "raw_stop_and_search\n(monthly CSVs)\noptional context",
    "table optional",
    detailBlock({
      role: "Optional (Raw source)",
      tags: ["Raw", "Optional"],
      what: "Stop-and-search records.",
      why: "Potential contextual signal; also a bias risk factor.",
      how: "Aggregate to cell-month if used.",
      inputs: ["Monthly CSV files"],
      outputs: ["Optional stop/search features"],
      connections: ["Optional join to features"]
    }),
    { w: 300, h: 105, fs: 14, textMaxW: 260 }
  ),

  node(
    "erd_dim_cell",
    "dim_cell.parquet\ncell_id (PK)\ncell_x, cell_y\nlat_center, lon_center",
    "table",
    detailBlock({
      role: "Implemented",
      tags: ["Spatial dimension"],
      what: "Grid cell dimension table defining each cell and its centre coordinate.",
      why: "Provides stable spatial keys for joins and for map visualisation / nearest-cell queries.",
      how: "Created during grid construction; one row per unique cell.",
      inputs: ["Grid parameters", "Projected coordinates"],
      outputs: ["cell_id mapping + lat/lon centres"],
      connections: ["Joined with: cell_month_features via cell_id"]
    }),
    { w: 320, h: 120, fs: 14, textMaxW: 280 }
  ),

  node(
    "erd_features",
    "cell_month_features.parquet\n(cell_id, month) (PK)\ncount, lags, rolling\nnbr_* (optional)",
    "table",
    detailBlock({
      role: "Implemented",
      tags: ["Main modelling table"],
      what: "Feature table used by forecasting models.",
      why: "Central dataset for training, validation, and API inference.",
      how: "Aggregated counts are expanded with lag and rolling statistics; optional neighbour/context features can be added.",
      inputs: ["Monthly counts", "Optional adjacency", "Optional socio-economic join"],
      outputs: ["Model-ready features by cell-month"],
      connections: ["Used by: Ridge, Baselines, planned DL/GNN pipelines"]
    }),
    { w: 340, h: 140, fs: 14, textMaxW: 300 }
  ),

  node(
    "erd_socio",
    "socio_economic (planned)\narea_code, indicators...\n(optional join)",
    "table planned",
    detailBlock({
      role: "Planned",
      tags: ["Optional context"],
      what: "Area-level socio-economic context table.",
      why: "Adds explanatory structure beyond historical counts.",
      how: "Joined into features via geographic mapping (e.g., LSOA/MSOA ↔ cells).",
      inputs: ["ONS/Open Gov indicators", "Boundary mappings"],
      outputs: ["Context features"],
      connections: ["Optional join into: cell_month_features"]
    }),
    { w: 310, h: 120, fs: 14, textMaxW: 270 }
  ),

  node(
    "erd_adj",
    "adjacency_edges (optional)\nsrc_cell_id, dst_cell_id\nweight/type",
    "table optional planned",
    detailBlock({
      role: "Optional (Planned extension)",
      tags: ["Graph structure"],
      what: "Neighbour graph describing which cells are adjacent.",
      why: "Supports neighbour feature aggregation and graph neural models.",
      how: "Edges created by grid adjacency rules (4-neighbour or 8-neighbour).",
      inputs: ["dim_cell geometry/grid indices"],
      outputs: ["Edge list for neighbour features / GNN"],
      connections: ["Used by: neighbour features and GNN models"]
    }),
    { w: 310, h: 120, fs: 14, textMaxW: 270 }
  ),

  node(
    "erd_wf",
    "wf_*.csv\nmodel, predict_month\nMAE, RMSE, Precision@K",
    "table",
    detailBlock({
      role: "Implemented",
      tags: ["Evaluation results"],
      what: "Walk-forward evaluation outputs for each model.",
      why: "Provides comparable month-by-month performance for reporting.",
      how: "Saved after evaluation runs; used to build the results table and plots.",
      inputs: ["Predictions vs truth"],
      outputs: ["Metrics per month", "Summary table"],
      connections: ["Feeds: reporting, figures, comparisons"]
    }),
    { w: 320, h: 120, fs: 14, textMaxW: 280 }
  ),

  node(
    "erd_runtime_pred",
    "runtime_predictions (API)\nforecast_month\ncell_id\npredicted_count\nrank/is_hotspot",
    "table",
    detailBlock({
      role: "Runtime (Computed)",
      tags: ["API output"],
      what: "Predictions computed on demand by the API.",
      why: "The UI requests predictions for a month and a visible map area.",
      how: "API loads features, forecasts counts, ranks cells, filters by bbox, returns top K%.",
      inputs: ["Features + forecast_month + top_pct + bbox"],
      outputs: ["Hotspot list", "Point prediction payloads"],
      connections: ["Served by: /predict and /predict_point"]
    }),
    { w: 340, h: 130, fs: 14, textMaxW: 300 }
  ),

  // ERD edges
  edge("e1", "erd_dim_cell", "erd_features", "cell_id"),
  edge("e2", "erd_adj", "erd_features", "optional neighbour agg"),
  edge("e3", "erd_socio", "erd_features", "planned join"),
  edge("e4", "erd_features", "erd_runtime_pred", "(forecast_month, cell_id)"),
  edge("e5", "erd_features", "erd_wf", "evaluation source"),

  edge("e6", "erd_raw_street", "erd_features", "aggregation"),
  edge("e7", "erd_raw_outcomes", "erd_features", "optional"),
  edge("e8", "erd_raw_stop", "erd_features", "optional")
];

// =============================
// WEBSITE ARCHITECTURE (more relationships)
// =============================
const WEB = [
  node(
    "web_user",
    "User\n(Browser)",
    "web-white",
    detailBlock({
      role: "Runtime actor",
      tags: ["User"],
      what: "The user interacts with the map interface.",
      why: "The interface exists to request forecasts and visualise hotspots as decision-support.",
      how: "Controls forecast month, top% threshold, and map viewport; clicks a point for nearest-cell details.",
      inputs: ["User selections + map interactions"],
      outputs: ["Prediction requests to API", "Visual interpretation of hotspots"],
      connections: ["Uses: Netlify-hosted frontend"]
    }),
    { w: 220, h: 85, fs: 14, textMaxW: 185 }
  ),

  node(
    "web_netlify",
    "Frontend Hosting\n(Netlify)\nStatic files",
    "web-blue",
    detailBlock({
      role: "Deployed",
      tags: ["Hosting"],
      what: "Serves the static website (HTML/CSS/JS).",
      why: "Separates frontend delivery from backend compute; easy public access with a shareable link.",
      how: "Hosts the compiled/static assets and delivers them via HTTPS to browsers.",
      inputs: ["index.html, styles.css, app.js"],
      outputs: ["Web UI delivered to browser"],
      connections: ["Serves: Leaflet UI + app logic"]
    }),
    { w: 250, h: 95, fs: 14, textMaxW: 210 }
  ),

  node(
    "web_frontend",
    "Map Frontend\nLeaflet + app.js\n(fetch → API)",
    "web-teal",
    detailBlock({
      role: "Deployed",
      tags: ["Leaflet", "UI logic"],
      what: "Client-side map application.",
      why: "Transforms API outputs into an interpretable geographic view.",
      how: "Fetches available months; requests hotspots for a month/top%; requests point predictions on click.",
      inputs: ["API responses", "User selections", "Map bbox and click coordinates"],
      outputs: ["Markers + side panel prediction details"],
      connections: ["Calls: /months, /predict, /predict_point"]
    }),
    { w: 280, h: 110, fs: 14, textMaxW: 240 }
  ),

  node(
    "web_osm",
    "Map Tiles\n(OpenStreetMap)\nTile servers",
    "web-white optional",
    detailBlock({
      role: "External dependency",
      tags: ["External"],
      what: "Base map tiles displayed under the markers.",
      why: "Provides geographic context for the hotspot overlays.",
      how: "Leaflet requests tiles for the current zoom and viewport.",
      inputs: ["Tile requests from browser"],
      outputs: ["Rendered base map tiles"],
      connections: ["Used by: Leaflet map layer"]
    }),
    { w: 240, h: 95, fs: 14, textMaxW: 205 }
  ),

  node(
    "web_render",
    "Backend Hosting\nRender\n(Uvicorn + FastAPI)",
    "web-blue",
    detailBlock({
      role: "Deployed",
      tags: ["Hosting", "Compute"],
      what: "Runs the API service and handles prediction requests.",
      why: "Centralises model logic and data access; keeps keys/paths off the client.",
      how: "Uvicorn serves FastAPI on Render-provided PORT; reads local parquet files for features and cell geometry.",
      inputs: ["HTTP requests from frontend"],
      outputs: ["JSON responses"],
      connections: ["Runs: FastAPI app", "Reads: parquet data"]
    }),
    { w: 280, h: 110, fs: 14, textMaxW: 240 }
  ),

  node(
    "web_api",
    "FastAPI API\n/months\n/predict\n/predict_point",
    "web-teal",
    detailBlock({
      role: "Deployed",
      tags: ["API"],
      what: "Prediction and metadata endpoints consumed by the web UI.",
      why: "Provides a stable contract between UI and model logic.",
      how: "Loads data, determines valid months, forecasts/ranks hotspots, supports bbox filtering and nearest-cell lookup.",
      inputs: ["forecast_month, top_pct, bbox", "lat/lon for point query"],
      outputs: ["forecast_months list", "hotspots list", "nearest cell payload"],
      connections: ["Called by: frontend fetch()", "Depends on: parquet storage + model logic"]
    }),
    { w: 320, h: 120, fs: 14, textMaxW: 280 }
  ),

  node(
    "web_cors",
    "CORS Policy\nAllow Netlify origin\n(Security control)",
    "web-dark",
    detailBlock({
      role: "Deployed",
      tags: ["Security", "Browser policy"],
      what: "Cross-Origin Resource Sharing configuration.",
      why: "Browsers block frontend → backend calls unless the API explicitly allows the origin.",
      how: "CORSMiddleware adds Access-Control-Allow-Origin for the Netlify site (or configured allowlist).",
      inputs: ["Origin header from browser requests"],
      outputs: ["CORS headers on responses"],
      connections: ["Protects: API endpoints for browser clients"]
    }),
    { w: 280, h: 110, fs: 14, textMaxW: 240 }
  ),

  node(
    "web_storage",
    "Processed Data\n(dim_cell.parquet)\n(cell_month_features.parquet)",
    "web-white",
    detailBlock({
      role: "Deployed",
      tags: ["Storage", "Parquet"],
      what: "Processed datasets shipped with the backend deployment.",
      why: "API must load these to compute months and predictions; missing files cause 500 errors.",
      how: "Files exist in the service filesystem (e.g., crime_map_app/data/processed). Paths must match backend code.",
      inputs: ["Parquet reads from backend"],
      outputs: ["DataFrames used for inference and lookup"],
      connections: ["Read by: FastAPI backend"]
    }),
    { w: 320, h: 120, fs: 14, textMaxW: 280 }
  ),

  node(
    "web_model_logic",
    "Model Logic\nRidge + ranking\n(optional DL/GNN later)",
    "web-white",
    detailBlock({
      role: "Implemented + planned extensions",
      tags: ["Model", "Ranking"],
      what: "Forecasting logic and hotspot ranking policy.",
      why: "Transforms features into predicted counts, then into ranked hotspot sets.",
      how: "Ridge produces predicted counts; cells are ranked; top K% is returned; future DL/GNN can swap in behind the same API.",
      inputs: ["Features", "forecast_month", "top_pct"],
      outputs: ["predicted_count, rank, hotspot selection"],
      connections: ["Used by: /predict and /predict_point"]
    }),
    { w: 320, h: 120, fs: 14, textMaxW: 280 }
  ),

  // Web edges (explicit relationships)
  edge("w1", "web_user", "web_netlify", "HTTPS request"),
  edge("w2", "web_netlify", "web_frontend", "serves HTML/CSS/JS"),
  edge("w3", "web_frontend", "web_osm", "tile requests"),
  edge("w4", "web_frontend", "web_api", "fetch() requests"),
  edge("w5", "web_api", "web_cors", "CORS headers"),
  edge("w6", "web_api", "web_render", "runs on"),
  edge("w7", "web_render", "web_storage", "reads parquet"),
  edge("w8", "web_api", "web_model_logic", "forecast + rank"),
  edge("w9", "web_frontend", "web_api", "GET /months"),
  edge("w10", "web_frontend", "web_api", "GET /predict"),
  edge("w11", "web_frontend", "web_api", "GET /predict_point")
];

// =============================
// DIAGRAM REGISTRY
// =============================
const DIAGRAMS = { pipeline: PIPELINE, erd: ERD, web: WEB };

// =============================
// UI hooks (existing page)
// =============================
const cyContainer = document.getElementById("cy");
const panelTitle = document.getElementById("panelTitle");
const detailsEl = document.getElementById("details");
const fitBtn = document.getElementById("fitBtn");
const resetLayoutBtn = document.getElementById("resetLayoutBtn");
const resetPosBtn = document.getElementById("resetPosBtn");
const tabs = Array.from(document.querySelectorAll(".tab"));
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

let cy = null;
let currentDiagram = "pipeline";

// =============================
// Details rendering (What/Why/How + I/O + Connections)
// =============================
function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setDetailsEmpty() {
  detailsEl.className = "detailsEmpty";
  detailsEl.innerHTML = `
    <div class="emptyIcon">▣</div>
    <div class="emptyTitle">Click a node on the left.</div>
    <div class="emptySub">This panel explains what it is, why it exists, and how it connects.</div>
  `;
}

function section(title, bodyHtml) {
  if (!bodyHtml) return "";
  return `
    <div style="margin-top:14px;">
      <div style="font-weight:900; opacity:0.9; margin-bottom:6px;">${escapeHtml(title)}</div>
      <div style="color:rgba(232,238,252,0.80); line-height:1.5;">${bodyHtml}</div>
    </div>
  `;
}

function list(items) {
  if (!items || !items.length) return "";
  return `<ul style="margin:8px 0 0; padding-left:18px;">
    ${items.map(x => `<li style="margin:7px 0; line-height:1.45;">${escapeHtml(x)}</li>`).join("")}
  </ul>`;
}

function chips(role, tags) {
  const arr = [role, ...(tags || [])].filter(Boolean);
  if (!arr.length) return "";
  return `<div class="chips">${arr.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join("")}</div>`;
}

function setDetails(nodeEl) {
  const d = nodeEl.data("details") || {};
  const title = nodeEl.data("label") || nodeEl.id();

  const what = d.what ? `<div>${escapeHtml(d.what)}</div>` : "";
  const why = d.why ? `<div>${escapeHtml(d.why)}</div>` : "";
  const how = d.how ? `<div>${escapeHtml(d.how)}</div>` : "";

  const inputs = list(d.inputs || []);
  const outputs = list(d.outputs || []);
  const conns = list(d.connections || []);

  detailsEl.className = "detailsCard";
  detailsEl.innerHTML = `
    <h2>${escapeHtml(title).replace(/\n/g, "<br/>")}</h2>
    ${chips(d.role || "", d.tags || [])}

    ${section("What it is", what)}
    ${section("Why it is there", why)}
    ${section("How it works", how)}
    ${section("Inputs", inputs)}
    ${section("Outputs", outputs)}
    ${section("Connections", conns)}
  `;
}

// =============================
// Cytoscape build
// =============================
function runLayout(diagram) {
  const layout = DIAGRAM_META[diagram].layout;
  cy.layout(layout).run();
}

function buildCy(diagram) {
  currentDiagram = diagram;
  panelTitle.textContent = DIAGRAM_META[diagram].title;
  setDetailsEmpty();

  if (cy) cy.destroy();

  cy = cytoscape({
    container: cyContainer,
    elements: DIAGRAMS[diagram],
    style: CY_STYLE,
    wheelSensitivity: 0.20
  });

  // restore saved positions, otherwise dagre layout
  const saved = loadPositions(diagram);
  const applied = saved && applyPositions(cy, saved);
  if (!applied) runLayout(diagram);

  cy.on("tap", "node", (evt) => {
    cy.elements().removeClass("selected");
    const n = evt.target;
    n.addClass("selected");
    setDetails(n);
  });

  cy.on("dragfree", "node", () => savePositions(currentDiagram, cy));
}

function setActiveTab(diagram) {
  tabs.forEach(t => {
    const active = t.dataset.diagram === diagram;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", active ? "true" : "false");
  });
}

tabs.forEach(btn => {
  btn.addEventListener("click", () => {
    const d = btn.dataset.diagram;
    setActiveTab(d);
    buildCy(d);
  });
});

fitBtn.addEventListener("click", () => {
  if (!cy) return;
  cy.fit(cy.elements(), 80);
});

resetLayoutBtn.addEventListener("click", () => {
  if (!cy) return;
  runLayout(currentDiagram);
});

resetPosBtn.addEventListener("click", () => {
  localStorage.removeItem(positionsKey(currentDiagram));
  buildCy(currentDiagram);
});

// =============================
// Search
// =============================
function findNode(query) {
  if (!cy) return;
  const q = (query || "").trim().toLowerCase();
  if (!q) return;

  let match = null;
  cy.nodes().forEach(n => {
    const id = (n.id() || "").toLowerCase();
    const label = (n.data("label") || "").toLowerCase();
    if (id.includes(q) || label.includes(q)) match = match || n;
  });

  if (match) {
    cy.elements().removeClass("selected");
    match.addClass("selected");
    cy.animate({ center: { eles: match }, zoom: Math.max(cy.zoom(), 1.05) }, { duration: 250 });
    setDetails(match);
  }
}

searchBtn.addEventListener("click", () => findNode(searchInput.value));
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") findNode(searchInput.value);
});

// boot
setActiveTab("pipeline");
buildCy("pipeline");
