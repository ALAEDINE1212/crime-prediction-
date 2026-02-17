/* global d3 */

const GRAPH_HOST = document.getElementById("graphHost");
const DETAILS = document.getElementById("details");

const tabPipeline = document.getElementById("tabPipeline");
const tabERD = document.getElementById("tabERD");
const graphTitle = document.getElementById("graphTitle");

const searchInput = document.getElementById("searchInput");
const btnFind = document.getElementById("btnFind");
const btnReset = document.getElementById("btnReset");

const ORIGIN_NETLIFY = "https://ourworkflow.netlify.app";
const ORIGIN_RENDER = "https://crime-prediction-apii.onrender.com";

let currentMode = "pipeline";
let svg, gZoom, sim;
let nodeSel = null;
let selectedId = null;

const palette = {
  data: "#8fb6ff",
  process: "#f7c84b",
  model: "#cbd2d9",
  eval: "#39d98a",
  gov: "#22cbb5",
  output: "#b98aff",
  deploy: "#ff8a65",
  table: "#9bd7ff"
};

function buildData() {
  // ---------- PIPELINE (with deployment) ----------
  const pipeline = {
    nodes: [
      // Inputs
      { id: "crime_data", label: "Crime Incident Data", sub: "West Yorkshire Police\n(monthly CSVs)", kind: "data", x: 360, y: 110 },
      { id: "socio_data", label: "Socio-Economic Indicators", sub: "Open Gov / ONS\n(planned)", kind: "data", x: 540, y: 110 },

      // Core pipeline
      { id: "preprocess", label: "Data Pre-processing\n& Quality Gate", sub: "clean + validate", kind: "process", x: 450, y: 220 },
      { id: "representation", label: "Spatial & Temporal\nRepresentation", sub: "grid + monthly", kind: "process", x: 450, y: 320 },
      { id: "feature_eng", label: "Feature Engineering", sub: "lags + rolling\n+ neighbours", kind: "process", x: 450, y: 420 },
      { id: "task", label: "Prediction Task\nDefinition", sub: "forecast + hotspots", kind: "process", x: 450, y: 520 },

      // Models
      { id: "baseline", label: "Baseline Models", sub: "lag-1 / seasonal", kind: "model", x: 330, y: 620 },
      { id: "ridge", label: "Ridge Regression", sub: "lags + rolling\n(+ neighbours)", kind: "model", x: 450, y: 620 },
      { id: "cnn_gru", label: "Spatio-Temporal Model", sub: "CNN + GRU\n(planned)", kind: "model", x: 570, y: 620 },

      // Eval + governance + outputs
      { id: "evaluation", label: "Evaluation &\nValidation", sub: "walk-forward +\nMAE/RMSE/P@K", kind: "eval", x: 450, y: 720 },
      { id: "governance", label: "Responsible AI\n& Governance", sub: "bias awareness +\ntransparency", kind: "gov", x: 450, y: 820 },
      { id: "outputs", label: "Decision-Support\nOutputs", sub: "hotspot map +\ntables", kind: "output", x: 450, y: 920 },

      // Deployment layer (what was actually done)
      { id: "deployment", label: "Deployment\n& Delivery", sub: "usable system", kind: "deploy", x: 450, y: 1030 },
      { id: "artifacts", label: "Processed Data\nArtifacts", sub: "Parquet files\n(features + grid)", kind: "deploy", x: 260, y: 1120 },
      { id: "api_render", label: "Backend API", sub: "FastAPI on Render", kind: "deploy", x: 450, y: 1120 },
      { id: "ui_netlify", label: "Frontend Web Map", sub: "Leaflet on Netlify", kind: "deploy", x: 640, y: 1120 },
      { id: "cors_config", label: "CORS + Config", sub: "Origins + API base\n(local vs cloud)", kind: "deploy", x: 830, y: 1120 }
    ],
    links: [
      { source: "crime_data", target: "preprocess" },
      { source: "socio_data", target: "preprocess", dim: true },

      { source: "preprocess", target: "representation" },
      { source: "representation", target: "feature_eng" },
      { source: "feature_eng", target: "task" },

      { source: "task", target: "baseline" },
      { source: "task", target: "ridge" },
      { source: "task", target: "cnn_gru", dim: true },

      { source: "baseline", target: "evaluation" },
      { source: "ridge", target: "evaluation" },
      { source: "cnn_gru", target: "evaluation", dim: true },

      { source: "evaluation", target: "governance" },
      { source: "governance", target: "outputs" },

      { source: "outputs", target: "deployment" },
      { source: "deployment", target: "api_render" },
      { source: "deployment", target: "ui_netlify" },
      { source: "deployment", target: "cors_config" },

      { source: "artifacts", target: "api_render" },
      { source: "api_render", target: "ui_netlify" },
      { source: "cors_config", target: "api_render", dim: true },
      { source: "cors_config", target: "ui_netlify", dim: true }
    ]
  };

  // ---------- ERD ----------
  const erd = {
    nodes: [
      { id: "raw_street", label: "raw_street", sub: "Monthly street crime CSVs", kind: "table", x: 300, y: 200 },
      { id: "raw_outcomes", label: "raw_outcomes", sub: "Outcomes CSVs", kind: "table", x: 600, y: 200 },
      { id: "raw_stop", label: "raw_stop_search", sub: "Stop & search CSVs", kind: "table", x: 900, y: 200 },

      { id: "dim_cell", label: "dim_cell", sub: "Grid cell dimension", kind: "table", x: 300, y: 420 },
      { id: "fact_cell_month", label: "cell_month_features", sub: "Cell × month features", kind: "table", x: 600, y: 420 },
      { id: "hotspots", label: "hotspots", sub: "Top-K predicted cells", kind: "table", x: 900, y: 420 },

      { id: "wf_results", label: "walk_forward_results", sub: "Per-month evaluation", kind: "table", x: 600, y: 620 }
    ],
    links: [
      { source: "raw_street", target: "raw_outcomes", dim: true },
      { source: "raw_street", target: "dim_cell" },
      { source: "dim_cell", target: "fact_cell_month" },
      { source: "fact_cell_month", target: "hotspots" },
      { source: "fact_cell_month", target: "wf_results" }
    ]
  };

  return { pipeline, erd };
}

const DATA = buildData();

const DETAILS_TEXT = {
  // Pipeline details
  crime_data: {
    title: "Crime Incident Data (West Yorkshire)",
    tags: ["Input data", "UK Police API CSVs"],
    what: [
      "Monthly street-level records (location, date, crime type, outcome reference).",
      "Primary signal used to build cell × month crime counts."
    ],
    connects: [
      "Feeds into preprocessing for cleaning and coordinate validation.",
      "Later aggregated into spatial grid cells and monthly time series."
    ],
    implementation: [
      "Stored under data/raw/YYYY-MM/ as street CSV files.",
      "Key fields: latitude, longitude, month/date, crime_type."
    ]
  },

  socio_data: {
    title: "Socio-Economic Indicators (planned)",
    tags: ["External features", "Open Government / ONS"],
    what: [
      "Area-level indicators such as deprivation, unemployment, housing, education.",
      "Used to enrich the model with context beyond past crime counts."
    ],
    connects: [
      "Joined after preprocessing via spatial linkage (e.g., LSOA/MSOA/ward → grid).",
      "Merged into the cell × month feature table as static or slowly-changing covariates."
    ],
    implementation: [
      "Requires a reliable join strategy: areal polygons ↔ grid cells (centroid or intersection).",
      "Feature fusion should be versioned and documented to avoid silent leakage."
    ]
  },

  preprocess: {
    title: "Data Pre-processing & Quality Gate",
    tags: ["Cleaning", "Validation", "Consistency"],
    what: [
      "Removes unusable rows and standardises the dataset before feature building.",
      "Prevents downstream steps from training on broken coordinates or duplicate records."
    ],
    connects: [
      "Outputs clean incident rows for grid mapping and monthly aggregation.",
      "Defines the data quality policy (missing location handling, deduplication)."
    ],
    implementation: [
      "Typical operations: drop invalid coordinates, handle missing values, remove duplicates.",
      "Quality checks should be logged: rows removed, reasons, date coverage."
    ]
  },

  representation: {
    title: "Spatial & Temporal Representation",
    tags: ["Grid discretisation", "Monthly aggregation"],
    what: [
      "Maps latitude/longitude into a consistent grid (cell_id).",
      "Aggregates incident counts per cell per month to form time-series targets."
    ],
    connects: [
      "Produces dim_cell (geometry / center) and the base cell × month count table.",
      "Enables neighbour calculations and time-series feature engineering."
    ],
    implementation: [
      "Coordinate transform (meters) → cell_x, cell_y → cell_id.",
      "Monthly aggregation: groupby(cell_id, month) → crime_count."
    ]
  },

  feature_eng: {
    title: "Feature Engineering (lags + rolling + neighbours)",
    tags: ["Time-series features", "Spatial context"],
    what: [
      "Creates predictors from past values (lags) and recent history (rolling stats).",
      "Adds neighbourhood signals (e.g., mean/max of adjacent cells) to capture spillover."
    ],
    connects: [
      "Outputs the ML-ready table: cell_month_features.parquet.",
      "Provides inputs to baseline and ridge models; also becomes input tensor for deep models."
    ],
    implementation: [
      "Examples: lag_1, lag_12, rolling_3_mean, rolling_6_mean, nbr_lag1_mean, nbr_lag1_max.",
      "Neighbour features must align row-by-row with the base table (stable row index)."
    ]
  },

  task: {
    title: "Prediction Task Definition",
    tags: ["Forecasting", "Hotspot ranking"],
    what: [
      "Primary: one-step-ahead forecasting of next-month crime counts per grid cell.",
      "Secondary: hotspot identification by ranking cells and selecting the top percentage (top-K)."
    ],
    connects: [
      "All models predict the same target to allow fair evaluation.",
      "Hotspot metrics (Precision@K, Hit-rate@K) are computed from ranked predictions."
    ],
    implementation: [
      "Target: next_month_count per cell.",
      "Hotspots: top_pct × number_of_cells within a month (or within a viewport)."
    ]
  },

  baseline: {
    title: "Baseline Models",
    tags: ["Sanity check", "Interpretability-first"],
    what: [
      "Simple benchmarks (e.g., predict next month = last month).",
      "Establishes a minimum performance target and catches broken pipelines."
    ],
    connects: [
      "Compared against ridge and later deep learning models using the same walk-forward protocol."
    ],
    implementation: [
      "Examples: lag-1 baseline, seasonal lag-12 baseline."
    ]
  },

  ridge: {
    title: "Ridge Regression (current best practical model)",
    tags: ["Linear model", "Strong baseline", "Fast"],
    what: [
      "Linear model with L2 regularisation that handles correlated lag/rolling features.",
      "Often performs well for sparse time-series with engineered features."
    ],
    connects: [
      "Trained and evaluated with walk-forward validation.",
      "Supports hotspot ranking and map-based delivery."
    ],
    implementation: [
      "Inputs: lags + rolling (+ neighbour features).",
      "Outputs: predicted next-month counts used for ranking."
    ]
  },

  cnn_gru: {
    title: "Spatio-Temporal Model (CNN + GRU) (planned)",
    tags: ["Deep learning", "Spatio-temporal"],
    what: [
      "CNN captures spatial patterns (local structure across grid).",
      "GRU captures temporal dynamics across the lookback window."
    ],
    connects: [
      "Uses the same targets and evaluation protocol to avoid unfair comparisons.",
      "Requires careful handling of missing cells and stable grid indexing."
    ],
    implementation: [
      "Needs tensor construction: (time, height, width, channels) or graph variant.",
      "Not implemented in the current deployed system."
    ]
  },

  evaluation: {
    title: "Evaluation & Validation",
    tags: ["Walk-forward", "MAE/RMSE", "Precision@K"],
    what: [
      "Walk-forward validation: train on past months, predict the next, repeat over time.",
      "Reports error metrics and hotspot ranking metrics to measure usefulness."
    ],
    connects: [
      "Feeds evidence into governance (limitations, reliability, failure modes).",
      "Supports visual outputs (monthly hotspot plots, trend graphs)."
    ],
    implementation: [
      "Metrics: MAE, RMSE, Precision@K (and optionally Hit-rate@K).",
      "Artifacts saved as CSV (per-month results) and PNG figures."
    ]
  },

  governance: {
    title: "Responsible AI & Governance",
    tags: ["Bias awareness", "Decision-support only"],
    what: [
      "Documents data limitations, reporting bias, and appropriate use boundaries.",
      "Keeps the system as decision-support rather than an automated enforcement tool."
    ],
    connects: [
      "Shapes what is displayed on the map and how outputs are explained.",
      "Defines limitations and safe interpretation."
    ],
    implementation: [
      "Report disclaimers, model cards, transparent evaluation reporting."
    ]
  },

  outputs: {
    title: "Decision-Support Outputs",
    tags: ["Hotspot map", "Ranked cells", "Evaluation tables"],
    what: [
      "Ranked hotspot areas for a forecast month.",
      "Tables/figures for evaluation and comparison across models."
    ],
    connects: [
      "Delivered to users via the deployed API + web map.",
      "Also used in the report as visual evidence."
    ],
    implementation: [
      "Outputs include top predicted cells, summary metrics, and map visualisations."
    ]
  },

  // Deployment nodes
  deployment: {
    title: "Deployment & Delivery (what turned it into a usable system)",
    tags: ["Production wiring", "Frontend + Backend"],
    what: [
      "Moves from offline scripts to a system that can answer prediction queries.",
      "Separates concerns: backend generates predictions, frontend displays them."
    ],
    connects: [
      "Consumes processed artifacts (Parquet) and model logic.",
      "Provides endpoints that the web map calls in real time."
    ],
    implementation: [
      "Backend deployed on Render; frontend deployed on Netlify.",
      "API base URL must switch between localhost and cloud deployment."
    ]
  },

  artifacts: {
    title: "Processed Data Artifacts (Parquet)",
    tags: ["Deployment dependency", "Fast load"],
    what: [
      "Precomputed ML-ready tables used by the backend for prediction.",
      "Avoids re-parsing raw CSVs on every server start."
    ],
    connects: [
      "Loaded by the backend API at runtime.",
      "Must exist in the deployed backend directory."
    ],
    implementation: [
      "Required files:",
      "crime_map_app/data/processed/cell_month_features.parquet",
      "crime_map_app/data/processed/dim_cell.parquet"
    ]
  },

  api_render: {
    title: "Backend API (FastAPI on Render)",
    tags: ["Render deployment", "REST endpoints"],
    what: [
      "Serves forecast months and prediction endpoints to the frontend.",
      "Loads processed parquet artifacts and generates hotspot outputs."
    ],
    connects: [
      "Front-end calls /months, /predict, /predict_point.",
      "CORS must allow the Netlify origin to avoid browser blocking."
    ],
    implementation: [
      `Render URL: ${ORIGIN_RENDER}`,
      "Typical start command: uvicorn backend.app:app --host 0.0.0.0 --port $PORT",
      "Must not reference localhost inside the deployed backend."
    ]
  },

  ui_netlify: {
    title: "Frontend Web Map (Leaflet on Netlify)",
    tags: ["Netlify deployment", "Interactive map"],
    what: [
      "Displays predicted hotspot cells on a real map.",
      "Allows choosing forecast month and selecting top percentage."
    ],
    connects: [
      "Fetches forecast months from the backend, then queries hotspots for the visible viewport.",
      "Clicking the map triggers a nearest-cell prediction request."
    ],
    implementation: [
      `Netlify site: ${ORIGIN_NETLIFY}`,
      "app.js must set API_BASE to the Render URL when deployed.",
      "Leaflet renders points for predicted hotspots."
    ]
  },

  cors_config: {
    title: "CORS + Configuration (the reason the deployed version works)",
    tags: ["Browser security", "Environment correctness"],
    what: [
      "CORS controls which website origins can call the API in a browser.",
      "Configuration controls local vs cloud API base URLs."
    ],
    connects: [
      "Without CORS headers, the browser blocks fetch() even if the API is healthy.",
      "The frontend must call Render URL in production, not 127.0.0.1."
    ],
    implementation: [
      `Allow origin: ${ORIGIN_NETLIFY}`,
      "FastAPI: CORSMiddleware allow_origins=[Netlify URL].",
      "Frontend: API_BASE set to Render URL in production."
    ]
  },

  // ERD details
  raw_street: {
    title: "ERD: raw_street",
    tags: ["Raw", "CSV"],
    what: [
      "Street-level crime incidents per month.",
      "Contains location + time + type fields used for aggregation."
    ],
    connects: [
      "Optionally linked to outcomes via crime_id.",
      "Mapped into grid cells for dim_cell and fact features."
    ],
    implementation: [
      "Stored as monthly CSV files, typically named: YYYY-MM-*-street.csv"
    ]
  },

  raw_outcomes: {
    title: "ERD: raw_outcomes",
    tags: ["Raw", "CSV"],
    what: [
      "Outcome records linked to crimes (when available).",
      "Not required for the current forecasting target, but useful for analysis."
    ],
    connects: [
      "Linked to raw_street using crime_id (when present)."
    ],
    implementation: [
      "Stored as monthly CSV files, typically named: YYYY-MM-*-outcomes.csv"
    ]
  },

  raw_stop: {
    title: "ERD: raw_stop_search",
    tags: ["Raw", "CSV"],
    what: [
      "Stop and search records (separate dataset).",
      "Can be used as an additional signal or for exploratory analysis."
    ],
    connects: [
      "Not required for the current model; potential future fusion feature source."
    ],
    implementation: [
      "Stored as monthly CSV files, typically named: YYYY-MM-*-stop-and-search.csv"
    ]
  },

  dim_cell: {
    title: "ERD: dim_cell",
    tags: ["Dimension table", "Grid geometry"],
    what: [
      "Defines the spatial grid: each row represents one grid cell.",
      "Stores cell indices and geographic center coordinates."
    ],
    connects: [
      "Referenced by cell_month_features and hotspot outputs via cell_id."
    ],
    implementation: [
      "Saved as dim_cell.parquet."
    ]
  },

  fact_cell_month: {
    title: "ERD: cell_month_features",
    tags: ["Fact table", "ML features"],
    what: [
      "The main ML table: one row per cell per month.",
      "Includes crime_count, lag features, rolling features, neighbour features, and target."
    ],
    connects: [
      "Used to train and evaluate models.",
      "Used by the backend to generate hotspot predictions."
    ],
    implementation: [
      "Saved as cell_month_features.parquet."
    ]
  },

  hotspots: {
    title: "ERD: hotspots",
    tags: ["Derived", "Ranking output"],
    what: [
      "Top-ranked predicted cells for a given forecast month.",
      "Used for map visualisation and decision-support reporting."
    ],
    connects: [
      "Derived from model predictions computed from cell_month_features."
    ],
    implementation: [
      "Returned by /predict with optional bbox filtering."
    ]
  },

  wf_results: {
    title: "ERD: walk_forward_results",
    tags: ["Evaluation", "Time-based testing"],
    what: [
      "Per-month walk-forward metrics for each model.",
      "Supports comparison using MAE, RMSE, and Precision@K."
    ],
    connects: [
      "Generated by walk_forward.py and summarised for reporting."
    ],
    implementation: [
      "Saved as CSV files (e.g., wf_ridge.csv)."
    ]
  }
};

function setMode(mode) {
  currentMode = mode;
  selectedId = null;
  render(mode);
  clearDetails();
}

function clearDetails() {
  DETAILS.innerHTML = `
    <div class="detailsEmpty">
      <div class="emptyIcon"></div>
      <div class="emptyTitle">Click a node on the left.</div>
      <div class="emptyText">This panel explains what it is and how it connects.</div>
    </div>
  `;
}

function showDetails(id) {
  const d = DETAILS_TEXT[id];
  if (!d) {
    DETAILS.innerHTML = `<div class="section"><div class="sectionTitle">No details</div><p>No description exists for this node yet.</p></div>`;
    return;
  }

  const linkify = (s) => {
    // turn Render/Netlify URLs into links if present in lines
    if (typeof s !== "string") return "";
    if (s.startsWith("http://") || s.startsWith("https://")) {
      return `<a href="${s}" target="_blank" rel="noopener noreferrer">${s}</a>`;
    }
    // handle "Label: https://..."
    const m = s.match(/^(.*?):\s*(https?:\/\/\S+)$/);
    if (m) {
      return `${m[1]}: <a href="${m[2]}" target="_blank" rel="noopener noreferrer">${m[2]}</a>`;
    }
    return escapeHtml(s);
  };

  DETAILS.innerHTML = `
    <h2>${escapeHtml(d.title)}</h2>
    <div class="tagRow">${(d.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>

    <div class="section">
      <div class="sectionTitle">What it is</div>
      <ul>${(d.what || []).map(x => `<li>${linkify(x)}</li>`).join("")}</ul>
    </div>

    <div class="section">
      <div class="sectionTitle">How it connects</div>
      <ul>${(d.connects || []).map(x => `<li>${linkify(x)}</li>`).join("")}</ul>
    </div>

    <div class="section">
      <div class="sectionTitle">Implementation notes</div>
      <ul>${(d.implementation || []).map(x => `<li>${linkify(x)}</li>`).join("")}</ul>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render(mode) {
  GRAPH_HOST.innerHTML = "";

  const width = GRAPH_HOST.clientWidth;
  const height = GRAPH_HOST.clientHeight;

  svg = d3.select(GRAPH_HOST)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // arrow marker
  svg.append("defs").append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 18)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "rgba(255,255,255,.25)");

  gZoom = svg.append("g");

  const zoom = d3.zoom()
    .scaleExtent([0.35, 2.5])
    .on("zoom", (e) => gZoom.attr("transform", e.transform));

  svg.call(zoom);

  const dataset = (mode === "pipeline") ? DATA.pipeline : DATA.erd;

  const nodes = dataset.nodes.map(n => ({ ...n }));
  const links = dataset.links.map(l => ({ ...l }));

  // force simulation anchored to (x,y) targets for stable layout
  sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(90).strength(0.7))
    .force("charge", d3.forceManyBody().strength(-240))
    .force("x", d3.forceX(d => d.x).strength(1.0))
    .force("y", d3.forceY(d => d.y).strength(1.0))
    .force("collide", d3.forceCollide(56))
    .alpha(1)
    .alphaDecay(0.08);

  // links
  const link = gZoom.append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", d => d.dim ? "link linkDim" : "link")
    .attr("marker-end", "url(#arrow)");

  // node group
  const node = gZoom.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "node")
    .call(drag(sim));

  // rectangles
  node.append("rect")
    .attr("class", "node-rect")
    .attr("rx", 10)
    .attr("ry", 10)
    .attr("width", 170)
    .attr("height", 54)
    .attr("x", -85)
    .attr("y", -27)
    .attr("fill", d => palette[d.kind] || "#cbd2d9");

  // label
  node.append("text")
    .attr("class", "node-label")
    .attr("text-anchor", "middle")
    .attr("y", -6)
    .text(d => d.label);

  // sublabel (multi-line)
  node.append("text")
    .attr("class", "node-sub")
    .attr("text-anchor", "middle")
    .attr("y", 10)
    .each(function(d){
      const lines = (d.sub || "").split("\n").slice(0, 2);
      const t = d3.select(this);
      t.selectAll("tspan").remove();
      lines.forEach((ln, i) => {
        t.append("tspan")
          .attr("x", 0)
          .attr("dy", i === 0 ? 0 : 12)
          .text(ln);
      });
    });

  node.on("click", (e, d) => {
    selectedId = d.id;
    updateSelection();
    showDetails(d.id);
  });

  sim.on("tick", () => {
    link
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });

  nodeSel = node;

  // initial fit
  setTimeout(() => zoomToFit(svg, gZoom, width, height), 30);
  updateSelection();
}

function updateSelection() {
  if (!nodeSel) return;
  nodeSel.classed("nodeSelected", d => d.id === selectedId);
  nodeSel.classed("pulse", d => d.id === selectedId);
}

function zoomToFit(svgSel, gSel, w, h) {
  const bounds = gSel.node().getBBox();
  const fullW = w;
  const fullH = h;
  const padding = 40;

  const midX = bounds.x + bounds.width / 2;
  const midY = bounds.y + bounds.height / 2;

  const scale = Math.max(0.35, Math.min(2.2, 0.92 / Math.max(bounds.width / (fullW - padding), bounds.height / (fullH - padding))));
  const translate = [fullW / 2 - scale * midX, fullH / 2 - scale * midY];

  svgSel.transition()
    .duration(300)
    .call(d3.zoom().transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
}

function drag(simulation) {
  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.15).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    // keep nodes near their intended layout, but allow some manual movement
    d.fx = null;
    d.fy = null;
  }

  return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
}

function findNode(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;

  const dataset = (currentMode === "pipeline") ? DATA.pipeline : DATA.erd;
  const byId = dataset.nodes.find(n => n.id.toLowerCase() === q);
  if (byId) return byId.id;

  const byLabel = dataset.nodes.find(n => (n.label || "").toLowerCase().includes(q));
  if (byLabel) return byLabel.id;

  const bySub = dataset.nodes.find(n => (n.sub || "").toLowerCase().includes(q));
  if (bySub) return bySub.id;

  return null;
}

function focusNode(id) {
  if (!nodeSel || !svg || !gZoom) return;

  selectedId = id;
  updateSelection();
  showDetails(id);

  // center view on selected node
  const dataset = (currentMode === "pipeline") ? DATA.pipeline : DATA.erd;
  const n = dataset.nodes.find(x => x.id === id);
  if (!n) return;

  const w = GRAPH_HOST.clientWidth;
  const h = GRAPH_HOST.clientHeight;

  const t = d3.zoomIdentity
    .translate(w / 2 - n.x, h / 2 - n.y)
    .scale(1.15);

  svg.transition().duration(280).call(d3.zoom().transform, t);
}

function resetAll() {
  selectedId = null;
  updateSelection();
  clearDetails();
  const w = GRAPH_HOST.clientWidth;
  const h = GRAPH_HOST.clientHeight;
  zoomToFit(svg, gZoom, w, h);
}

// UI bindings
tabPipeline.addEventListener("click", () => {
  tabPipeline.classList.add("active");
  tabERD.classList.remove("active");
  tabPipeline.setAttribute("aria-selected", "true");
  tabERD.setAttribute("aria-selected", "false");
  graphTitle.textContent = "Pipeline Diagram";
  setMode("pipeline");
});

tabERD.addEventListener("click", () => {
  tabERD.classList.add("active");
  tabPipeline.classList.remove("active");
  tabERD.setAttribute("aria-selected", "true");
  tabPipeline.setAttribute("aria-selected", "false");
  graphTitle.textContent = "ERD Diagram";
  setMode("erd");
});

btnFind.addEventListener("click", () => {
  const id = findNode(searchInput.value);
  if (!id) return;
  focusNode(id);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnFind.click();
});

btnReset.addEventListener("click", resetAll);

// initial render
render("pipeline");
clearDetails();
