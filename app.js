/* global cytoscape */

const API_BASE_DEFAULT = "https://crime-prediction-apii.onrender.com"; // your Render API
const LS_KEY_PREFIX = "cp_positions_v2_";

const DIAGRAM_META = {
  pipeline: { title: "Pipeline Diagram" },
  erd:      { title: "ERD Diagram" },
  web:      { title: "Website Architecture Diagram" },
};

/**
 * READABILITY FIXES:
 * - Inter font everywhere
 * - Bigger font, bold
 * - Wrap text
 * - Nodes auto-size to label with padding
 * - Text outline + background so labels are readable on any node color
 * - Per-class overrides for light nodes (black text) and dark nodes (white text)
 */
const CY_STYLE = [
  {
    selector: "node",
    style: {
      "shape": "round-rectangle",
      "label": "data(label)",
      "text-valign": "center",
      "text-halign": "center",

      // Font + readability
      "font-family": "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      "font-size": 14,
      "font-weight": 800,

      // Make nodes fit labels so text never sits outside
      "width": "label",
      "height": "label",
      "padding": "12px",

      // Wrap long labels
      "text-wrap": "wrap",
      "text-max-width": 150,

      // Default text for darker nodes
      "color": "#f8fafc",

      // Outline makes text readable regardless of fill
      "text-outline-width": 3,
      "text-outline-color": "rgba(0,0,0,0.72)",

      // Optional subtle label background (helps on busy tiles)
      "text-background-opacity": 0.85,
      "text-background-color": "rgba(2,6,23,0.65)",
      "text-background-padding": "3px",
      "text-background-shape": "round-rectangle",

      // Node visuals
      "background-color": "rgba(148,163,184,0.14)",
      "border-width": 1.5,
      "border-color": "rgba(148,163,184,0.28)",
      "overlay-padding": 8,
      "overlay-opacity": 0,
    }
  },

  // Light nodes: black text + white outline (so it stays readable on light fills)
  {
    selector: "node.light",
    style: {
      "color": "#0b1220",
      "text-outline-color": "rgba(255,255,255,0.92)",
      "text-background-color": "rgba(255,255,255,0.78)",
      "text-background-opacity": 0.95
    }
  },

  // Pipeline group colors
  {
    selector: "node.dataset",
    style: {
      "background-color": "rgba(122,162,255,0.22)",
      "border-color": "rgba(122,162,255,0.55)",
      "text-background-color": "rgba(2,6,23,0.60)"
    }
  },
  {
    selector: "node.process",
    style: {
      "background-color": "rgba(255,201,77,0.20)",
      "border-color": "rgba(255,201,77,0.55)",

      // Yellow is light -> force readable black text
      "color": "#0b1220",
      "text-outline-color": "rgba(255,255,255,0.92)",
      "text-background-color": "rgba(255,255,255,0.78)",
      "text-background-opacity": 0.95
    }
  },
  {
    selector: "node.model",
    style: {
      "background-color": "rgba(148,163,184,0.18)",
      "border-color": "rgba(148,163,184,0.45)"
    }
  },
  {
    selector: "node.eval",
    style: {
      "background-color": "rgba(60,234,180,0.18)",
      "border-color": "rgba(60,234,180,0.50)",
      "color": "#0b1220",
      "text-outline-color": "rgba(255,255,255,0.92)",
      "text-background-color": "rgba(255,255,255,0.78)",
      "text-background-opacity": 0.95
    }
  },
  {
    selector: "node.gov",
    style: {
      "background-color": "rgba(60,234,180,0.16)",
      "border-color": "rgba(60,234,180,0.40)",
      "color": "#0b1220",
      "text-outline-color": "rgba(255,255,255,0.92)",
      "text-background-color": "rgba(255,255,255,0.78)",
      "text-background-opacity": 0.95
    }
  },
  {
    selector: "node.output",
    style: {
      "background-color": "rgba(170,120,255,0.20)",
      "border-color": "rgba(170,120,255,0.50)"
    }
  },

  // ERD styling
  {
    selector: "node.erdTable",
    style: {
      "background-color": "rgba(226,232,240,0.92)",
      "border-color": "rgba(148,163,184,0.60)",
      "color": "#0b1220",
      "text-outline-color": "rgba(255,255,255,0.95)",
      "text-background-color": "rgba(255,255,255,0.85)",
      "text-background-opacity": 0.95,
      "text-max-width": 190
    }
  },

  // Web diagram styling
  {
    selector: "node.webNode",
    style: {
      "text-max-width": 170
    }
  },

  // Edges
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      "width": 2,
      "line-color": "rgba(148,163,184,0.40)",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "rgba(148,163,184,0.50)",
      "arrow-scale": 0.9,

      // Edge labels readable too
      "label": "data(label)",
      "font-family": "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      "font-size": 12,
      "font-weight": 800,
      "color": "#f8fafc",
      "text-outline-width": 3,
      "text-outline-color": "rgba(0,0,0,0.75)",
      "text-background-opacity": 0.85,
      "text-background-color": "rgba(2,6,23,0.70)",
      "text-background-padding": "3px",
      "text-background-shape": "round-rectangle",
      "text-rotation": "autorotate"
    }
  },

  // Highlight
  {
    selector: ".highlight",
    style: {
      "border-width": 3,
      "border-color": "rgba(122,162,255,0.95)",
      "background-color": "rgba(122,162,255,0.28)"
    }
  }
];

function elNode(id, label, classes, details) {
  return {
    data: { id, label, details },
    classes
  };
}

function elEdge(id, source, target, label = "") {
  return {
    data: { id, source, target, label }
  };
}

/* -------------------- DIAGRAM DATA -------------------- */

const PIPELINE_ELEMENTS = [
  // Nodes
  elNode(
    "crime_data",
    "Crime Incident Data\nWest Yorkshire Police\n(monthly CSVs)",
    "dataset",
    {
      subtitle: "Raw incident records used as the primary signal.",
      bullets: [
        "Inputs: location coordinates, month, crime type, outcomes (when available).",
        "Main quality issues: missing/invalid coordinates and duplicates.",
        "Used to build monthly grid-cell crime counts."
      ]
    }
  ),

  elNode(
    "socio_data",
    "Socio-Economic Indicators\nOpen Gov / ONS\n(planned)",
    "dataset",
    {
      subtitle: "Contextual features that may explain spatial differences.",
      bullets: [
        "Examples: deprivation, unemployment, housing, education.",
        "Joined by area (LSOA/MSOA) then mapped to grid cells.",
        "Added as static or slowly-varying features per cell."
      ]
    }
  ),

  elNode(
    "prep",
    "Data Pre-processing & Quality Gate\nclean + validate",
    "process",
    {
      subtitle: "Cleaning steps applied before any modelling.",
      bullets: [
        "Drop rows with invalid coordinates or “No Location”.",
        "Standardise date/month fields and remove duplicates.",
        "Basic sanity checks so downstream results aren’t garbage."
      ]
    }
  ),

  elNode(
    "repr",
    "Spatial & Temporal Representation\ngrid + monthly",
    "process",
    {
      subtitle: "Transforms raw points into a consistent spatio-temporal table.",
      bullets: [
        "Project lat/lon → meters, then assign each record to a grid cell.",
        "Aggregate to monthly counts per cell.",
        "Creates stable IDs (cell_x, cell_y, cell_id)."
      ]
    }
  ),

  elNode(
    "fe",
    "Feature Engineering\nlags + rolling\n+ neighbours",
    "process",
    {
      subtitle: "Adds history and neighbourhood context for forecasting.",
      bullets: [
        "Lag features (e.g., t-1, t-2 …), rolling mean/sum.",
        "Neighbour features (adjacent cells) to capture spillover.",
        "Produces model-ready features per cell per month."
      ]
    }
  ),

  elNode(
    "task",
    "Prediction Task Definition\nforecast + hotspots",
    "process",
    {
      subtitle: "Defines what the model predicts and how hotspots are selected.",
      bullets: [
        "One-step-ahead forecast of crime count for each cell.",
        "Hotspots = top K% predicted cells per month.",
        "Supports point query via nearest cell."
      ]
    }
  ),

  elNode(
    "baseline",
    "Baseline Models\nnaive + seasonal",
    "model",
    {
      subtitle: "Simple baselines to beat.",
      bullets: [
        "Naive lag-1: y_hat(t) = y(t-1).",
        "Seasonal lag-12: y_hat(t) = y(t-12).",
        "Provides an interpretable benchmark."
      ]
    }
  ),

  elNode(
    "ridge",
    "ML Model\nRidge Regression\n(lags+rolling)",
    "model",
    {
      subtitle: "Stronger baseline: linear model with regularisation.",
      bullets: [
        "Trains on engineered lag/rolling features.",
        "Ridge helps prevent overfitting and stabilises coefficients.",
        "Evaluated with walk-forward splits."
      ]
    }
  ),

  elNode(
    "eval",
    "Evaluation & Validation\nwalk-forward",
    "eval",
    {
      subtitle: "Time-respecting testing (no leakage).",
      bullets: [
        "Chronological walk-forward: train → predict next month → roll.",
        "Regression metrics: MAE / RMSE.",
        "Hotspot metrics: Precision@K / HitRate@K."
      ]
    }
  ),

  elNode(
    "rai",
    "Responsible AI & Governance",
    "gov",
    {
      subtitle: "Decision-support only; limitations clearly stated.",
      bullets: [
        "Bias awareness: policing data reflects reporting and enforcement.",
        "Transparency: document assumptions, errors, and uncertainty.",
        "Avoid using outputs for punitive decisions."
      ]
    }
  ),

  elNode(
    "outputs",
    "Decision-Support Outputs\nmaps + ranked cells",
    "output",
    {
      subtitle: "Outputs designed for interpretation, not blind automation.",
      bullets: [
        "Hotspot map: top predicted cells for a chosen month.",
        "Point query: nearest cell forecast at clicked location.",
        "Tables: month-by-month error + hotspot precision."
      ]
    }
  ),

  // Edges
  elEdge("p1","crime_data","prep"),
  elEdge("p2","socio_data","prep"),
  elEdge("p3","prep","repr"),
  elEdge("p4","repr","fe"),
  elEdge("p5","fe","task"),
  elEdge("p6","task","baseline"),
  elEdge("p7","task","ridge"),
  elEdge("p8","baseline","eval"),
  elEdge("p9","ridge","eval"),
  elEdge("p10","eval","rai"),
  elEdge("p11","rai","outputs"),
];

const ERD_ELEMENTS = [
  // Tables (light readable blocks)
  elNode("t_incidents","incidents\n(pk: incident_id)\nmonth, lat, lon, crime_type\ncell_id", "erdTable light", {
    subtitle:"Main incident fact table (after cleaning).",
    bullets:[
      "One row ≈ one police record (or aggregated if decided).",
      "Foreign key to grid cell for spatial aggregation.",
      "Drives monthly counts per cell."
    ]
  }),

  elNode("t_cells","dim_cell\n(pk: cell_id)\ncell_x, cell_y\nlat_center, lon_center", "erdTable light", {
    subtitle:"Spatial dimension table describing each grid cell.",
    bullets:[
      "cell_id built from (cell_x, cell_y).",
      "Center coordinates used for mapping.",
      "Joins to every monthly feature row."
    ]
  }),

  elNode("t_features","cell_month_features\n(pk: cell_id+month)\ncount\nlags, rolling\nnbr_*", "erdTable light", {
    subtitle:"Model feature table (one row per cell per month).",
    bullets:[
      "Target: monthly crime count per cell.",
      "Features: lag/rolling and neighbour features.",
      "Used by baseline + ridge models."
    ]
  }),

  elNode("t_predictions","predictions\n(cell_id+forecast_month)\npredicted_count\nrank, is_hotspot", "erdTable light", {
    subtitle:"Stores outputs for the map and analysis.",
    bullets:[
      "Predicted count per cell for forecast month.",
      "Hotspot flag based on top K%.",
      "Supports map rendering and point queries."
    ]
  }),

  elNode("t_socio","socio_features\n(area_id+month)\ndeprivation, unemployment\neducation, housing", "erdTable light", {
    subtitle:"Optional contextual features (planned).",
    bullets:[
      "Joined by area (LSOA/MSOA) then mapped to cells.",
      "May be static or time-varying by month.",
      "Enriches cell_month_features after integration."
    ]
  }),

  // Relationships
  elEdge("e1","t_cells","t_incidents","cell_id"),
  elEdge("e2","t_cells","t_features","cell_id"),
  elEdge("e3","t_features","t_predictions","cell_id + month"),
  elEdge("e4","t_socio","t_features","join via area → cell"),
];

const WEB_ELEMENTS = [
  elNode("w_user","User\n(Browser)","webNode light",{
    subtitle:"Entry point for the map interface.",
    bullets:[
      "Select forecast month and Top K%.",
      "Pan/zoom map and click to query a point.",
      "Receives hotspot layer + point prediction."
    ]
  }),

  elNode("w_netlify","Frontend Hosting\n(Netlify)","webNode dataset",{
    subtitle:"Static site deployment.",
    bullets:[
      "Serves index.html / styles.css / app.js.",
      "Runs Leaflet map UI in the browser.",
      "Calls the API over HTTPS."
    ]
  }),

  elNode("w_leaflet","Map UI\n(Leaflet JS)","webNode process",{
    subtitle:"Client-side map + interactions.",
    bullets:[
      "Displays base tiles and hotspot markers.",
      "Uses current bounding box when requested.",
      "Sends requests to API: /months, /predict, /predict_point."
    ]
  }),

  elNode("w_render","API Hosting\n(Render)","webNode model",{
    subtitle:"FastAPI backend deployed as a web service.",
    bullets:[
      "Exposes endpoints for months and predictions.",
      "Applies CORS to allow Netlify origin.",
      "Loads parquet data + model logic server-side."
    ]
  }),

  elNode("w_api","FastAPI Service\n(months + predict)","webNode model",{
    subtitle:"Backend endpoints used by the frontend.",
    bullets:[
      "GET /months → list available forecast months.",
      "GET /predict → hotspots in bbox for forecast month.",
      "GET /predict_point → nearest cell forecast for clicked point."
    ]
  }),

  elNode("w_data","Processed Data\n(parquet)","webNode light",{
    subtitle:"Model-ready dataset shipped with the backend.",
    bullets:[
      "cell_month_features.parquet",
      "dim_cell.parquet",
      "Used to compute predictions and render coordinates."
    ]
  }),

  elEdge("we1","w_user","w_netlify","HTTPS"),
  elEdge("we2","w_netlify","w_leaflet","HTML/CSS/JS"),
  elEdge("we3","w_leaflet","w_api","fetch()"),
  elEdge("we4","w_api","w_render","runs on"),
  elEdge("we5","w_render","w_data","reads"),
];

const DIAGRAMS = {
  pipeline: PIPELINE_ELEMENTS,
  erd: ERD_ELEMENTS,
  web: WEB_ELEMENTS
};

/* -------------------- APP -------------------- */

let cy = null;
let currentDiagram = "pipeline";

const cyContainer = document.getElementById("cy");
const panelTitle = document.getElementById("panelTitle");
const detailsEl = document.getElementById("details");
const resetBtn = document.getElementById("resetBtn");
const tabs = Array.from(document.querySelectorAll(".tab"));
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

function setDetailsEmpty() {
  detailsEl.className = "detailsEmpty";
  detailsEl.innerHTML = `
    <div class="emptyIcon">▣</div>
    <div class="emptyTitle">Click a node on the left.</div>
    <div class="emptySub">This panel explains what it is and how it connects.</div>
  `;
}

function setDetails(node) {
  const d = node.data("details") || {};
  const title = node.data("label") || node.id();
  const subtitle = d.subtitle || "";
  const bullets = Array.isArray(d.bullets) ? d.bullets : [];

  detailsEl.className = "detailsCard";
  detailsEl.innerHTML = `
    <h2>${escapeHtml(title).replace(/\n/g, "<br/>")}</h2>
    ${subtitle ? `<div class="meta">${escapeHtml(subtitle)}</div>` : ""}
    ${bullets.length ? `<ul>${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join("")}</ul>` : ""}
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
  if (!posObj) return false;
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

function buildCy(diagram) {
  if (cy) cy.destroy();

  currentDiagram = diagram;
  panelTitle.textContent = DIAGRAM_META[diagram].title;

  setDetailsEmpty();

  const saved = loadPositions(diagram);

  cy = cytoscape({
    container: cyContainer,
    elements: DIAGRAMS[diagram],
    style: CY_STYLE,
    wheelSensitivity: 0.22,
  });

  const hadSaved = saved && applyPositions(saved);

  if (!hadSaved) {
    cy.layout({
      name: "dagre",
      rankDir: "TB",
      nodeSep: 40,
      rankSep: 80,
      edgeSep: 12,
      padding: 60
    }).run();
  }

  // Interactions
  cy.on("tap", "node", (evt) => {
    const n = evt.target;
    cy.nodes().removeClass("highlight");
    n.addClass("highlight");
    setDetails(n);
  });

  // Save after dragging
  cy.on("dragfree", "node", () => savePositions(currentDiagram));

  // Nice fit on load
  setTimeout(() => {
    cy.fit(cy.elements(), 60);
  }, 50);
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

resetBtn.addEventListener("click", () => {
  localStorage.removeItem(positionsKey(currentDiagram));
  buildCy(currentDiagram);
});

function findNode(query) {
  if (!cy) return;
  const q = (query || "").trim().toLowerCase();
  if (!q) return;

  const nodes = cy.nodes();
  let best = null;

  nodes.forEach(n => {
    const id = (n.id() || "").toLowerCase();
    const label = (n.data("label") || "").toLowerCase();
    if (id === q || label === q) best = n;
  });

  if (!best) {
    nodes.forEach(n => {
      const id = (n.id() || "").toLowerCase();
      const label = (n.data("label") || "").toLowerCase();
      if (id.includes(q) || label.includes(q)) best = best || n;
    });
  }

  if (best) {
    cy.nodes().removeClass("highlight");
    best.addClass("highlight");
    cy.animate({ center: { eles: best }, zoom: Math.max(cy.zoom(), 1.1) }, { duration: 250 });
    setDetails(best);
  }
}

searchBtn.addEventListener("click", () => findNode(searchInput.value));
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") findNode(searchInput.value);
});

// Boot
setActiveTab("pipeline");
buildCy("pipeline");
