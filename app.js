/* global cytoscape */

const LS_KEY_PREFIX = "cp_diagram_positions_";
const DIAGRAM_META = {
  pipeline: { title: "Pipeline Diagram", layout: { name: "dagre", rankDir: "TB", rankSep: 90, nodeSep: 40, edgeSep: 12, padding: 60 } },
  erd:      { title: "ERD Diagram",      layout: { name: "dagre", rankDir: "LR", rankSep: 110, nodeSep: 55, edgeSep: 12, padding: 70 } },
  web:      { title: "Website Architecture Diagram", layout: { name: "dagre", rankDir: "LR", rankSep: 120, nodeSep: 50, edgeSep: 18, padding: 70 } },
};

const cyContainer = document.getElementById("cy");
const panelTitle  = document.getElementById("panelTitle");
const detailsEl   = document.getElementById("details");
const fitBtn      = document.getElementById("fitBtn");
const resetLayoutBtn = document.getElementById("resetLayoutBtn");
const resetPosBtn = document.getElementById("resetPosBtn");
const tabs = Array.from(document.querySelectorAll(".tab"));
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

let cy = null;
let currentDiagram = "pipeline";

/* -------------------- STYLE (ONLY READABILITY + “TEXT INSIDE BOX”) -------------------- */
/*
  You said: don’t mess with colors/layout/meaning.
  So this style:
  - keeps node colors by class
  - only fixes label contrast + size + wrapping
  - ensures text doesn’t float outside: fixed width/height + wrap
*/
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

      // Default readable label treatment on dark UI
      "color": "#0b1220",                       // black text by default (you asked that earlier for pipeline)
      "text-outline-width": 2.5,
      "text-outline-color": "rgba(255,255,255,0.92)",
      "text-background-opacity": 0.92,
      "text-background-color": "rgba(255,255,255,0.78)",
      "text-background-padding": "3px",
      "text-background-shape": "round-rectangle",

      "border-width": 1.6,
      "border-color": "rgba(148,163,184,0.35)",
      "overlay-opacity": 0,
    }
  },

  /* Pipeline colors (same idea as your screenshot: blue datasets, yellow steps, grey models, green eval, purple outputs) */
  { selector: "node.dataset", style: { "background-color": "#8fb7ff", "border-color": "rgba(143,183,255,0.95)" } },
  { selector: "node.step",    style: { "background-color": "#f6c85f", "border-color": "rgba(246,200,95,0.95)" } },
  { selector: "node.model",   style: { "background-color": "#cfd6e6", "border-color": "rgba(207,214,230,0.95)" } },
  { selector: "node.eval",    style: { "background-color": "#42d9a7", "border-color": "rgba(66,217,167,0.95)" } },
  { selector: "node.output",  style: { "background-color": "#b487ff", "border-color": "rgba(180,135,255,0.95)" } },

  /* ERD table look (light card) */
  { selector: "node.table",   style: { "background-color": "#ffffff", "border-color": "rgba(148,163,184,0.85)" } },

  /* Website diagram nodes (keep simple modern palette similar to what you showed: white/blue/teal) */
  { selector: "node.web-white", style: { "background-color": "#ffffff", "border-color": "rgba(148,163,184,0.85)" } },
  { selector: "node.web-blue",  style: { "background-color": "#7aa2ff", "border-color": "rgba(122,162,255,0.95)" } },
  { selector: "node.web-teal",  style: { "background-color": "#2ee6c2", "border-color": "rgba(46,230,194,0.95)" } },

  /* Edges */
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      "width": 2,
      "line-color": "rgba(148,163,184,0.45)",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "rgba(148,163,184,0.55)",
      "arrow-scale": 0.9,

      "label": "data(label)",
      "font-family": "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      "font-size": 12,
      "font-weight": 900,

      // readable edge labels
      "color": "#e8eefc",
      "text-outline-width": 3,
      "text-outline-color": "rgba(0,0,0,0.70)",
      "text-background-opacity": 0.88,
      "text-background-color": "rgba(2,6,23,0.70)",
      "text-background-padding": "3px",
      "text-background-shape": "round-rectangle",
      "text-rotation": "autorotate"
    }
  },

  /* click highlight */
  {
    selector: ".selected",
    style: {
      "border-width": 3,
      "border-color": "rgba(122,162,255,0.95)",
      "line-color": "rgba(122,162,255,0.65)",
      "target-arrow-color": "rgba(122,162,255,0.75)"
    }
  }
];

/* -------------------- ELEMENT HELPERS -------------------- */
function node(id, label, classes, details, sizing = {}) {
  const {
    w = 220, h = 84, fs = 14, textMaxW = 190
  } = sizing;
  return {
    data: { id, label, details, w, h, fs, textMaxW },
    classes
  };
}

function edge(id, source, target, label = "") {
  return { data: { id, source, target, label } };
}

/* -------------------- CONTENT (BASED ON WHAT YOU BUILT TONIGHT) -------------------- */
/* Pipeline */
const PIPELINE = [
  node(
    "crime_incident_data",
    "Crime Incident Data\nWest Yorkshire Police\n(monthly CSVs)",
    "dataset",
    {
      subtitle: "Raw police records you stored in data/raw/YYYY-MM (street CSVs).",
      chips: ["Input", "CSV"],
      bullets: [
        "You loaded 36 monthly files and validated columns + coordinates.",
        "Records are aggregated into monthly counts per grid cell.",
        "This is the main signal used for forecasting hotspots."
      ]
    },
    { w: 250, h: 92, fs: 14, textMaxW: 210 }
  ),

  node(
    "socio_economic",
    "Socio-Economic Indicators\n(Open Gov / ONS)\n(planned)",
    "dataset",
    {
      subtitle: "Planned dataset you said you’ll add later (5 days). Not used yet.",
      chips: ["Planned", "Context features"],
      bullets: [
        "Would be joined via geography (LSOA/MSOA → cells).",
        "Could improve generalisation beyond pure crime history.",
        "Until you integrate it, don’t pretend it’s part of the model."
      ]
    },
    { w: 250, h: 92, fs: 14, textMaxW: 210 }
  ),

  node(
    "preprocess",
    "Data Pre-processing\n& Quality Gate\nclean + validate",
    "step",
    {
      subtitle: "Cleaning stage in make_dataset.py before grid aggregation.",
      chips: ["make_dataset.py"],
      bullets: [
        "Handled missing/invalid coordinates and dropped unusable rows.",
        "Standardised month field and kept consistent schema across files.",
        "This prevents garbage from poisoning features and evaluation."
      ]
    }
  ),

  node(
    "representation",
    "Spatial & Temporal\nRepresentation\ngrid + monthly",
    "step",
    {
      subtitle: "You assigned incidents to a meter-based grid and aggregated by month.",
      chips: ["cell_x/cell_y", "cell_id"],
      bullets: [
        "Projected coordinates → grid indices (cell_x, cell_y).",
        "Built stable cell_id and cell centers (dim_cell.parquet).",
        "Produced monthly cell table used for modelling."
      ]
    }
  ),

  node(
    "feature_engineering",
    "Feature Engineering\nlags + rolling\n(+ neighbours optional)",
    "step",
    {
      subtitle: "Created model features per cell-month (cell_month_features.parquet).",
      chips: ["lags", "rolling", "neighbours"],
      bullets: [
        "Lag features (t-1 etc.) and rolling stats for trend/smoothing.",
        "Neighbour features were added, but performance slightly worsened.",
        "So you keep them optional, not forced."
      ]
    }
  ),

  node(
    "task_definition",
    "Prediction Task\nforecast + hotspots",
    "step",
    {
      subtitle: "One-step-ahead forecasting per cell + choose top K% as hotspots.",
      chips: ["Precision@K", "BBox filtering"],
      bullets: [
        "Forecast next month count for each cell.",
        "Rank cells → hotspot set = top K% (your UI uses top_pct).",
        "Also support point query by nearest cell center."
      ]
    }
  ),

  node(
    "baselines",
    "Baseline Models\nnaive lag-1 / seasonal",
    "model",
    {
      subtitle: "Simple benchmarks you ran before ML.",
      chips: ["baseline"],
      bullets: [
        "Lag-1 baseline and lag-12 seasonal baseline were evaluated.",
        "Gives you a minimum standard to beat.",
        "If your fancy model can’t beat this, it’s not worth deploying."
      ]
    },
    { w: 240, h: 80, fs: 14, textMaxW: 200 }
  ),

  node(
    "ridge",
    "ML Model\nRidge Regression\n(lags+rolling)",
    "model",
    {
      subtitle: "Your best working model tonight (better MAE/RMSE and Precision@K).",
      chips: ["ridge", "walk-forward"],
      bullets: [
        "Trained using walk-forward evaluation to avoid leakage.",
        "Improved compared to baseline in your results.",
        "Used to drive the deployed hotspot API."
      ]
    },
    { w: 240, h: 80, fs: 14, textMaxW: 200 }
  ),

  node(
    "evaluation",
    "Evaluation & Validation\nwalk-forward + plots",
    "eval",
    {
      subtitle: "You generated figures and CSV results for model comparison.",
      chips: ["MAE", "RMSE", "Precision@K"],
      bullets: [
        "Walk-forward results saved to CSV (wf_*.csv).",
        "Visual evaluation saved under data/processed/figures.",
        "You also computed file hashes for reproducibility."
      ]
    }
  ),

  node(
    "governance",
    "Responsible AI\n& Governance",
    "eval",
    {
      subtitle: "Important: this is decision-support, not enforcement automation.",
      chips: ["Ethics", "Limitations"],
      bullets: [
        "Policing data contains reporting/enforcement bias.",
        "Outputs should be presented with uncertainty and caveats.",
        "Must not be used to justify discriminatory targeting."
      ]
    },
    { w: 230, h: 74, fs: 14, textMaxW: 190 }
  ),

  node(
    "outputs",
    "Decision-Support Outputs\nhotspot map + point query",
    "output",
    {
      subtitle: "You built a real map UI: choose month, top%, bbox, click for point prediction.",
      chips: ["Leaflet", "API"],
      bullets: [
        "Frontend renders hotspots (top K%) as markers.",
        "Click on map calls /predict_point for nearest cell forecast.",
        "This matches what your supervisor expects: interpretable outputs."
      ]
    },
    { w: 260, h: 86, fs: 14, textMaxW: 220 }
  ),

  edge("p1","crime_incident_data","preprocess"),
  edge("p2","socio_economic","preprocess"),
  edge("p3","preprocess","representation"),
  edge("p4","representation","feature_engineering"),
  edge("p5","feature_engineering","task_definition"),
  edge("p6","task_definition","baselines"),
  edge("p7","task_definition","ridge"),
  edge("p8","baselines","evaluation"),
  edge("p9","ridge","evaluation"),
  edge("p10","evaluation","governance"),
  edge("p11","governance","outputs"),
];

/* ERD */
const ERD = [
  node(
    "t_dim_cell",
    "dim_cell\n(cell_id PK)\ncell_x, cell_y\nlat_center, lon_center",
    "table",
    {
      subtitle: "Created in make_dataset.py and saved as dim_cell.parquet.",
      chips: ["parquet", "spatial"],
      bullets: [
        "Defines each grid cell and its center coordinate.",
        "Used by map rendering and nearest-cell lookup.",
        "Joins to features via cell_id."
      ]
    },
    { w: 280, h: 110, fs: 14, textMaxW: 240 }
  ),

  node(
    "t_features",
    "cell_month_features\n(cell_id, month PK)\ncount\nlags, rolling\nnbr_* (optional)",
    "table",
    {
      subtitle: "Main modelling table saved as cell_month_features.parquet.",
      chips: ["features", "time-series"],
      bullets: [
        "One row per cell per month.",
        "Target = monthly crime count; features = lags/rolling (+ neighbours).",
        "This is what Ridge uses in walk-forward."
      ]
    },
    { w: 300, h: 130, fs: 14, textMaxW: 260 }
  ),

  node(
    "t_wf_results",
    "walk_forward_results\n(model, predict_month)\nMAE, RMSE\nprecision_at_k",
    "table",
    {
      subtitle: "Evaluation outputs you saved to CSV for baselines and ridge.",
      chips: ["metrics", "CSV"],
      bullets: [
        "Used for comparing models fairly across months.",
        "Feeds your results table (make_results_table.py).",
        "Supports reproducibility via file hashes."
      ]
    },
    { w: 300, h: 120, fs: 14, textMaxW: 260 }
  ),

  node(
    "t_predictions",
    "predictions (runtime)\nforecast_month\ncell_id\npredicted_count\nrank/is_hotspot",
    "table",
    {
      subtitle: "Not a stored DB table here—computed in API for the selected month/bbox.",
      chips: ["API output", "ranking"],
      bullets: [
        "API ranks cells for chosen forecast_month.",
        "Returns top K% hotspots for current bbox (optional).",
        "Point query returns nearest cell + predicted/actual count."
      ]
    },
    { w: 300, h: 130, fs: 14, textMaxW: 260 }
  ),

  edge("e1","t_dim_cell","t_features","cell_id"),
  edge("e2","t_features","t_predictions","cell_id + forecast_month"),
  edge("e3","t_features","t_wf_results","evaluation"),
];

/* Website Architecture */
const WEB = [
  node(
    "w_user",
    "User\n(Browser)",
    "web-white",
    {
      subtitle: "Controls the map UI: month dropdown, top%, bbox toggle, click-to-query.",
      chips: ["UI"],
      bullets: [
        "Chooses forecast month and hotspot percentage.",
        "Loads hotspots and inspects point predictions.",
        "Sees interpretable map output (decision-support)."
      ]
    },
    { w: 220, h: 84, fs: 14, textMaxW: 180 }
  ),

  node(
    "w_netlify",
    "Frontend Hosting\n(Netlify)",
    "web-blue",
    {
      subtitle: "Static hosting for index.html / styles.css / app.js.",
      chips: ["static"],
      bullets: [
        "Serves your Leaflet map UI.",
        "Must call the API using the Render URL (not 127.0.0.1).",
        "Origin is whitelisted by CORS on the backend."
      ]
    },
    { w: 240, h: 86, fs: 14, textMaxW: 200 }
  ),

  node(
    "w_leaflet",
    "Map UI\n(Leaflet JS)",
    "web-teal",
    {
      subtitle: "Client-side logic: fetch months, fetch hotspots, point prediction on click.",
      chips: ["fetch()", "bbox"],
      bullets: [
        "GET /months to populate dropdown.",
        "GET /predict?forecast_month=...&top_pct=...&bbox=...",
        "GET /predict_point?forecast_month=...&lat=...&lon=..."
      ]
    },
    { w: 260, h: 100, fs: 14, textMaxW: 220 }
  ),

  node(
    "w_render",
    "Backend Hosting\n(Render)",
    "web-blue",
    {
      subtitle: "Runs FastAPI with uvicorn. Uses PORT binding (Render uses 10000 internally).",
      chips: ["FastAPI", "uvicorn"],
      bullets: [
        "Primary URL: your onrender.com domain.",
        "CORS middleware allows Netlify origin.",
        "Loads parquet files shipped in repo."
      ]
    },
    { w: 250, h: 96, fs: 14, textMaxW: 210 }
  ),

  node(
    "w_api",
    "FastAPI Service\n/months /predict /predict_point",
    "web-teal",
    {
      subtitle: "The API that your frontend talks to (the part that actually predicts).",
      chips: ["endpoints"],
      bullets: [
        "/months returns available forecast months based on history.",
        "/predict returns hotspot cells for a month (+ optional bbox filter).",
        "/predict_point returns nearest cell stats for a clicked location."
      ]
    },
    { w: 290, h: 110, fs: 14, textMaxW: 250 }
  ),

  node(
    "w_parquet",
    "Processed Data\n(parquet files)\ncell_month_features.parquet\ndim_cell.parquet",
    "web-white",
    {
      subtitle: "These files must exist in the deployed service filesystem (you fixed this).",
      chips: ["data/processed"],
      bullets: [
        "Moved/pointed correctly so Render can read them at runtime.",
        "FileNotFoundError on Render happened because path was wrong.",
        "Once fixed, /months returned real months instead of crashing."
      ]
    },
    { w: 310, h: 120, fs: 14, textMaxW: 260 }
  ),

  edge("w1","w_user","w_netlify","HTTPS"),
  edge("w2","w_netlify","w_leaflet","serves JS"),
  edge("w3","w_leaflet","w_api","fetch()"),
  edge("w4","w_api","w_render","runs on"),
  edge("w5","w_render","w_parquet","reads"),
];

const DIAGRAMS = { pipeline: PIPELINE, erd: ERD, web: WEB };

/* -------------------- UI -------------------- */
function setDetailsEmpty() {
  detailsEl.className = "detailsEmpty";
  detailsEl.innerHTML = `
    <div class="emptyIcon">▣</div>
    <div class="emptyTitle">Click a node on the left.</div>
    <div class="emptySub">You’ll see what it does + how it links to the others.</div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function setDetails(nodeEl) {
  const d = nodeEl.data("details") || {};
  const title = nodeEl.data("label") || nodeEl.id();
  const subtitle = d.subtitle || "";
  const chips = Array.isArray(d.chips) ? d.chips : [];
  const bullets = Array.isArray(d.bullets) ? d.bullets : [];

  detailsEl.className = "detailsCard";
  detailsEl.innerHTML = `
    <h2>${escapeHtml(title).replace(/\n/g, "<br/>")}</h2>
    ${subtitle ? `<div class="meta">${escapeHtml(subtitle)}</div>` : ""}
    ${chips.length ? `<div class="chips">${chips.map(c => `<span class="chip">${escapeHtml(c)}</span>`).join("")}</div>` : ""}
    ${bullets.length ? `<ul>${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join("")}</ul>` : ""}
  `;
}

function positionsKey(diagram) {
  return `${LS_KEY_PREFIX}${diagram}`;
}

function loadPositions(diagram) {
  try {
    const raw = localStorage.getItem(positionsKey(diagram));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

function savePositions(diagram) {
  if (!cy) return;
  const pos = {};
  cy.nodes().forEach(n => { pos[n.id()] = n.position(); });
  localStorage.setItem(positionsKey(diagram), JSON.stringify(pos));
}

function applyPositions(posObj) {
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
    wheelSensitivity: 0.20,
  });

  // If you dragged nodes before, keep them where you put them.
  const saved = loadPositions(diagram);
  const applied = saved && applyPositions(saved);

  if (!applied) {
    runLayout(diagram);
  }

  // click node → details
  cy.on("tap", "node", (evt) => {
    cy.elements().removeClass("selected");
    const n = evt.target;
    n.addClass("selected");
    setDetails(n);
  });

  // save positions on drag end
  cy.on("dragfree", "node", () => savePositions(currentDiagram));
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
  cy.fit(cy.elements(), 70);
});

resetLayoutBtn.addEventListener("click", () => {
  if (!cy) return;
  runLayout(currentDiagram);
});

resetPosBtn.addEventListener("click", () => {
  localStorage.removeItem(positionsKey(currentDiagram));
  buildCy(currentDiagram);
});

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

/* boot */
setActiveTab("pipeline");
buildCy("pipeline");
