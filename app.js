/* global vis */

let network = null;
let currentGraphKey = "pipeline";

const graphTitleEl = document.getElementById("graphTitle");
const detailsBodyEl = document.getElementById("detailsBody");
const tabPipeline = document.getElementById("tab-pipeline");
const tabErd = document.getElementById("tab-erd");
const resetDetailsBtn = document.getElementById("resetDetails");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

// --------------------
// Data: Node details
// --------------------

const PIPELINE_DETAILS = {
  crime: {
    title: "Crime Incident Data (West Yorkshire Police)",
    tags: ["Dataset", "Raw input"],
    tagStyle: ["good", "good"],
    bullets: [
      "Incident-level records: latitude/longitude, datetime, crime type, outcome.",
      "Time range: 2018 → Jan 2024.",
      "Main issues: invalid/missing coords, duplicates, missing outcomes, inconsistent categories.",
      "Stored raw and immutable: data/raw/"
    ]
  },
  socio: {
    title: "Socio-Economic Indicators (Open Government Data)",
    tags: ["Dataset", "External features"],
    tagStyle: ["good", "purple"],
    bullets: [
      "Indicators: deprivation, unemployment, housing, education.",
      "Usually keyed by LSOA/MSOA area code and year/period.",
      "Needs spatial join: grid cell → area (direct or overlap-weighted).",
      "Potential mismatch: socio-economic updates yearly while crime is monthly."
    ]
  },
  prep: {
    title: "Data Pre-processing & Quality Gate",
    tags: ["Pipeline stage", "High risk"],
    tagStyle: ["purple", "warn"],
    bullets: [
      "Remove invalid coordinates (NaN, 0,0, out-of-bounds).",
      "Define strict missing policy for 'No Location'.",
      "Deduplicate (incident_id or time+location+type heuristic).",
      "Audit logging: before/after row counts for every filter step."
    ]
  },
  repr: {
    title: "Spatial & Temporal Representation",
    tags: ["Feature engineering", "Representation"],
    tagStyle: ["purple", "purple"],
    bullets: [
      "Grid discretisation: map incidents to cell_id (e.g., 250m / 500m).",
      "Monthly aggregation: counts per cell per month (optionally per crime type).",
      "Feature fusion: attach socio-economic indicators via area mapping.",
      "Optional: spatial lag features from neighboring cells."
    ]
  },
  task: {
    title: "Prediction Task Definition",
    tags: ["ML task", "Must lock"],
    tagStyle: ["good", "warn"],
    bullets: [
      "Primary: forecast next-month crime counts per cell (regression).",
      "Secondary: hotspot identification (Top-K% cells) (ranking/classification).",
      "Define K and label rule explicitly; don’t pretend class imbalance doesn’t exist."
    ]
  },
  base: {
    title: "Baseline Models",
    tags: ["Baselines", "Interpretability"],
    tagStyle: ["good", "purple"],
    bullets: [
      "Seasonal-naive: next month ≈ last month or same month last year.",
      "Cluster + SARIMA: group similar cells then forecast per cluster/cell.",
      "Purpose: prove DL adds value vs a strong baseline (not a toy baseline)."
    ]
  },
  deep: {
    title: "Spatio-Temporal Deep Model (CNN + GRU)",
    tags: ["Deep learning", "Spatio-temporal"],
    tagStyle: ["good", "purple"],
    bullets: [
      "CNN extracts spatial patterns from grid-like maps.",
      "GRU models temporal dynamics over lookback window (6–12 months).",
      "Outputs: next-month count grid and/or hotspot probabilities.",
      "Time-based split only; random split = leakage."
    ]
  },
  eval: {
    title: "Evaluation & Validation",
    tags: ["Testing", "No cheating"],
    tagStyle: ["good", "warn"],
    bullets: [
      "Chronological split: train (2018–2022), val (2023), test (2024).",
      "Regression metrics: MAE, RMSE.",
      "Hotspot metrics: Precision@K, Hit-rate@K (Top-K%).",
      "Error analysis: show failure months/areas and likely causes."
    ]
  },
  gov: {
    title: "Responsible AI & Governance",
    tags: ["Ethics", "Constraints"],
    tagStyle: ["good", "warn"],
    bullets: [
      "Bias: police data reflects reporting/policing patterns, not 'true crime'.",
      "Privacy: publish only aggregated cell/month outputs.",
      "Decision-support only; document limitations and intended use."
    ]
  },
  out: {
    title: "Decision-Support Outputs",
    tags: ["Prototype", "Outputs"],
    tagStyle: ["good", "good"],
    bullets: [
      "Risk heatmaps per month (predicted vs actual).",
      "Ranked hotspot list (Top-K).",
      "Evaluation tables + short model card/limitations."
    ]
  }
};

const ERD_DETAILS = {
  dim_cell: {
    title: "dim_cell (Grid Cells)",
    tags: ["Dimension", "Geospatial"],
    tagStyle: ["purple", "good"],
    bullets: [
      "PK: cell_id",
      "Stores cell metadata: center lat/lon, optional district label.",
      "Used to convert model outputs into heatmaps and ranked lists."
    ]
  },
  dim_time: {
    title: "dim_time (Monthly Time Dimension)",
    tags: ["Dimension", "Time"],
    tagStyle: ["purple", "good"],
    bullets: [
      "PK: month_id",
      "Stores YYYY-MM, year, month number, etc.",
      "Used for chronological splits and seasonality features."
    ]
  },
  dim_crime_type: {
    title: "dim_crime_type (Crime Categories)",
    tags: ["Dimension", "Optional"],
    tagStyle: ["purple", "warn"],
    bullets: [
      "PK: crime_type_id",
      "Maps cleaned crime category strings to IDs.",
      "Optional if you model only total crime counts (cell-month)."
    ]
  },
  dim_area: {
    title: "dim_area (LSOA/MSOA Areas)",
    tags: ["Dimension", "Socio-economic key"],
    tagStyle: ["purple", "good"],
    bullets: [
      "PK: area_id (LSOA/MSOA code)",
      "Area metadata for joining socio-economic indicators."
    ]
  },
  fact_crime: {
    title: "fact_crime (Aggregated Crime Counts)",
    tags: ["Fact table", "Model input"],
    tagStyle: ["good", "good"],
    bullets: [
      "FKs: cell_id, month_id (and crime_type_id if used).",
      "Measures: count, target_next_count, hotspot_label (depending on task).",
      "This is the core table used for training after aggregation."
    ]
  },
  bridge_cell_area: {
    title: "bridge_cell_area (Cell ↔ Area Mapping)",
    tags: ["Bridge", "Optional but correct"],
    tagStyle: ["purple", "warn"],
    bullets: [
      "FKs: cell_id, area_id",
      "weight = overlap proportion if a cell intersects multiple areas.",
      "If you skip it, you’re probably using nearest centroid (less correct)."
    ]
  },
  fact_socio_econ: {
    title: "fact_socio_econ (Socio-Economic Indicators)",
    tags: ["Fact table", "External features"],
    tagStyle: ["good", "purple"],
    bullets: [
      "FKs: area_id and month_id/year depending on availability.",
      "Measures: deprivation, unemployment, housing, education.",
      "Joined into model features via area mapping."
    ]
  }
};

// --------------------
// Graph definitions
// --------------------

function pipelineGraph() {
  return {
    title: "Pipeline Diagram",
    details: PIPELINE_DETAILS,
    nodes: [
      { id: "crime", label: "Crime Incident Data\n(West Yorkshire Police)\n2018–Jan 2024", color: "#6aa6ff" },
      { id: "socio", label: "Socio-Economic Indicators\n(Open Gov Data)", color: "#6aa6ff" },
      { id: "prep", label: "Data Pre-processing &\nQuality Gate", color: "#ffd166" },
      { id: "repr", label: "Spatial & Temporal\nRepresentation", color: "#ffd166" },
      { id: "task", label: "Prediction Task\nDefinition", color: "#ffd166" },
      { id: "base", label: "Baseline Models", color: "#a9b1c3" },
      { id: "deep", label: "Spatio-Temporal Model\nCNN + GRU", color: "#a9b1c3" },
      { id: "eval", label: "Evaluation &\nValidation", color: "#4fd1a5" },
      { id: "gov", label: "Responsible AI &\nGovernance", color: "#4fd1a5" },
      { id: "out", label: "Decision-Support\nOutputs", color: "#b892ff" }
    ],
    edges: [
      { from: "crime", to: "prep" },
      { from: "socio", to: "prep" },
      { from: "prep", to: "repr" },
      { from: "repr", to: "task" },
      { from: "task", to: "base" },
      { from: "task", to: "deep" },
      { from: "base", to: "eval" },
      { from: "deep", to: "eval" },
      { from: "eval", to: "gov" },
      { from: "gov", to: "out" }
    ],
    options: {
      layout: {
        hierarchical: {
          enabled: true,
          direction: "UD",
          sortMethod: "directed",
          levelSeparation: 120,
          nodeSpacing: 160
        }
      },
      physics: { enabled: false },
      interaction: { hover: true },
      nodes: {
        shape: "box",
        borderWidth: 2,
        font: { color: "#0b0e14", size: 16, face: "Arial" }
      },
      edges: {
        arrows: { to: { enabled: true } },
        smooth: { type: "cubicBezier", forceDirection: "vertical", roundness: 0.4 }
      }
    }
  };
}

function erdGraph() {
  return {
    title: "Relational ERD",
    details: ERD_DETAILS,
    nodes: [
      { id: "dim_cell", label: "dim_cell\nPK: cell_id", color: "#6aa6ff" },
      { id: "dim_time", label: "dim_time\nPK: month_id", color: "#6aa6ff" },
      { id: "dim_crime_type", label: "dim_crime_type\nPK: crime_type_id", color: "#6aa6ff" },
      { id: "dim_area", label: "dim_area\nPK: area_id", color: "#6aa6ff" },
      { id: "fact_crime", label: "fact_crime\nFK: cell_id, month_id,\ncrime_type_id\ncount/targets", color: "#ffd166" },
      { id: "bridge_cell_area", label: "bridge_cell_area\nFK: cell_id, area_id\nweight", color: "#4fd1a5" },
      { id: "fact_socio_econ", label: "fact_socio_econ\nFK: area_id, month_id/year\nindicators…", color: "#b892ff" }
    ],
    edges: [
      { from: "fact_crime", to: "dim_cell", label: "cell_id" },
      { from: "fact_crime", to: "dim_time", label: "month_id" },
      { from: "fact_crime", to: "dim_crime_type", label: "crime_type_id" },

      { from: "bridge_cell_area", to: "dim_cell", label: "cell_id" },
      { from: "bridge_cell_area", to: "dim_area", label: "area_id" },

      { from: "fact_socio_econ", to: "dim_area", label: "area_id" },
      { from: "fact_socio_econ", to: "dim_time", label: "month_id/year" }
    ],
    options: {
      physics: {
        enabled: true,
        barnesHut: {
          gravitationalConstant: -25000,
          centralGravity: 0.25,
          springLength: 170,
          springConstant: 0.05,
          damping: 0.25
        },
        minVelocity: 0.75
      },
      interaction: { hover: true },
      nodes: {
        shape: "box",
        borderWidth: 2,
        font: { color: "#0b0e14", size: 15, face: "Arial" }
      },
      edges: {
        arrows: { to: { enabled: true } },
        smooth: { type: "dynamic" },
        font: { align: "middle" }
      }
    }
  };
}

const GRAPHS = {
  pipeline: pipelineGraph,
  erd: erdGraph
};

// --------------------
// Render
// --------------------

function renderGraph(key) {
  currentGraphKey = key;
  const cfg = GRAPHS[key]();

  graphTitleEl.textContent = cfg.title;

  // Tabs
  tabPipeline.classList.toggle("active", key === "pipeline");
  tabErd.classList.toggle("active", key === "erd");

  // Reset details panel
  renderEmptyDetails();

  // Create network
  const container = document.getElementById("network");
  const data = {
    nodes: new vis.DataSet(cfg.nodes),
    edges: new vis.DataSet(cfg.edges)
  };

  if (network) network.destroy();
  network = new vis.Network(container, data, cfg.options);

  // Click node → details
  network.on("click", function (params) {
    if (!params.nodes || params.nodes.length === 0) return;
    const nodeId = params.nodes[0];
    renderDetails(nodeId, cfg.details);
    // Highlight selection
    network.selectNodes([nodeId]);
  });

  // Double click node → details + focus
  network.on("doubleClick", function (params) {
    if (!params.nodes || params.nodes.length === 0) return;
    const nodeId = params.nodes[0];
    renderDetails(nodeId, cfg.details);
    network.focus(nodeId, { scale: 1.2, animation: { duration: 350 } });
  });
}

function renderEmptyDetails() {
  detailsBodyEl.innerHTML = `
    <div class="empty">
      <div class="emptyIcon">⧉</div>
      <div class="emptyText">
        Click a node on the left.<br />
        This panel will show what’s inside it.
      </div>
    </div>
  `;
}

function renderDetails(nodeId, detailsMap) {
  const d = detailsMap[nodeId];
  if (!d) {
    detailsBodyEl.innerHTML = `
      <div class="card">
        <h2>${escapeHtml(nodeId)}</h2>
        <div class="meta">No details found for this node.</div>
      </div>
    `;
    return;
  }

  const badges = (d.tags || []).map((t, i) => {
    const cls = (d.tagStyle && d.tagStyle[i]) ? d.tagStyle[i] : "";
    return `<span class="badge ${cls}">${escapeHtml(t)}</span>`;
  }).join("");

  const bullets = (d.bullets || []).map(b => `<li>${escapeHtml(b)}</li>`).join("");

  detailsBodyEl.innerHTML = `
    <div class="card">
      <h2>${escapeHtml(d.title)}</h2>
      <div class="meta"><b>Node ID:</b> ${escapeHtml(nodeId)} • Click/drag/zoom the diagram as needed</div>
      <div class="badgeRow">${badges}</div>
      <ul>${bullets}</ul>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[s]));
}

// --------------------
// Search
// --------------------

function findNode() {
  const q = (searchInput.value || "").trim().toLowerCase();
  if (!q || !network) return;

  const cfg = GRAPHS[currentGraphKey]();
  const nodes = cfg.nodes;

  // match by id or label
  const hit = nodes.find(n =>
    String(n.id).toLowerCase() === q ||
    String(n.id).toLowerCase().includes(q) ||
    String(n.label).toLowerCase().includes(q)
  );

  if (!hit) {
    detailsBodyEl.innerHTML = `
      <div class="card">
        <h2>Not found</h2>
        <div class="meta">No node matched: <b>${escapeHtml(q)}</b></div>
      </div>
    `;
    return;
  }

  // Focus + show details
  network.selectNodes([hit.id]);
  network.focus(hit.id, { scale: 1.25, animation: { duration: 350 } });
  renderDetails(hit.id, cfg.details);
}

// --------------------
// Wire UI
// --------------------

tabPipeline.addEventListener("click", () => renderGraph("pipeline"));
tabErd.addEventListener("click", () => renderGraph("erd"));
resetDetailsBtn.addEventListener("click", () => renderEmptyDetails());
searchBtn.addEventListener("click", () => findNode());
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") findNode();
});

// Boot
window.addEventListener("DOMContentLoaded", () => {
  renderGraph("pipeline");
});
