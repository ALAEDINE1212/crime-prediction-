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

/* -----------------------
   Node detail content
   Structure supports:
   - overview (string)
   - oneRow (string)
   - keys (string)
   - why (string)
   - links (string)
   - example (string)
   - bullets (array)
------------------------ */

const PIPELINE_DETAILS = {
  crime: {
    title: "Crime Incident Data (West Yorkshire Police)",
    tags: ["Dataset", "Raw input"],
    tagStyle: ["good", "good"],
    overview: "This is the raw incident-level dataset: each record is a reported crime with a location and timestamp.",
    keys: "Not a clean relational table. Often no stable primary key. You may build a synthetic id from (datetime + location + type).",
    why: "You start here because everything else in the project is derived from these raw records.",
    links: "Feeds into: Pre-processing & Quality Gate → then grid mapping and monthly aggregation.",
    bullets: [
      "Fields: latitude/longitude, datetime, crime type, outcome (often missing).",
      "Typical problems: invalid coords, duplicates, missing outcomes, inconsistent labels.",
      "Stored immutable: keep a copy unchanged so you can always reproduce results."
    ]
  },
  socio: {
    title: "Socio-Economic Indicators (Open Government Data)",
    tags: ["Dataset", "External features"],
    tagStyle: ["good", "purple"],
    overview: "This is external context data (deprivation, unemployment, housing, education) published by government areas like LSOA/MSOA.",
    keys: "Keyed by area_id (LSOA/MSOA code) and a time period (year or month).",
    why: "It adds explanatory signals beyond past crime counts (helps capture structural differences between areas).",
    links: "Joined via: dim_area + (optional) bridge_cell_area → then merged into cell-month features.",
    bullets: [
      "Common mismatch: socio-economic is yearly while crime is monthly (you must document how you handle it).",
      "You must map your grid cells to areas (centroid or overlap weights)."
    ]
  },
  prep: {
    title: "Data Pre-processing & Quality Gate",
    tags: ["Pipeline stage", "High risk"],
    tagStyle: ["purple", "warn"],
    overview: "This stage cleans the raw data and enforces rules so the rest of the pipeline doesn't learn garbage.",
    why: "If you skip strict cleaning, your model performance is fake and your heatmaps will be nonsense.",
    links: "Takes: raw crime + socio. Outputs: clean crime records ready for grid mapping.",
    bullets: [
      "Remove invalid coordinates (NaN, 0,0, out-of-bounds).",
      "Decide and apply a single policy for 'No Location'.",
      "Deduplicate consistently (ID or heuristic).",
      "Audit log: counts before/after each filter."
    ]
  },
  repr: {
    title: "Spatial & Temporal Representation",
    tags: ["Feature engineering", "Representation"],
    tagStyle: ["purple", "purple"],
    overview: "This stage converts point incidents into a structured spatio-temporal dataset your model can learn from.",
    why: "ML models need consistent inputs: fixed grid cells over fixed time steps (monthly).",
    links: "Outputs: cell-month (or cell-month-type) table + engineered lag/rolling features.",
    bullets: [
      "Grid discretisation: map each incident to a cell_id (e.g., 250m/500m).",
      "Monthly aggregation: counts per cell per month.",
      "Feature fusion: merge socio-economic indicators into the same rows.",
      "Optional: spatial lags from neighboring cells."
    ]
  },
  task: {
    title: "Prediction Task Definition",
    tags: ["ML task", "Must lock"],
    tagStyle: ["good", "warn"],
    overview: "You define exactly what the model predicts. If you keep changing this, your project collapses.",
    why: "Clear task definition makes evaluation meaningful and prevents ‘accuracy’ lies.",
    links: "Determines: targets/labels in fact_crime (target_next_count / hotspot_label).",
    bullets: [
      "Primary: next-month crime count per cell (regression).",
      "Secondary: hotspot identification (Top-K% cells) (ranking/classification).",
      "Define K and label rule explicitly; class imbalance is expected."
    ]
  },
  base: {
    title: "Baseline Models",
    tags: ["Baselines", "Interpretability"],
    tagStyle: ["good", "purple"],
    overview: "Baselines are simple models that create a fair comparison. They stop you from claiming progress when you have none.",
    why: "If your deep model can’t beat a good baseline, your deep model is pointless.",
    links: "Compared against the deep model using the same time split and metrics.",
    bullets: [
      "Seasonal-naive: next month ≈ last month or same month last year.",
      "Cluster + SARIMA: forecast per cluster/cell for interpretability.",
      "Use baselines to justify complexity."
    ]
  },
  deep: {
    title: "Spatio-Temporal Deep Model (CNN + GRU)",
    tags: ["Deep learning", "Spatio-temporal"],
    tagStyle: ["good", "purple"],
    overview: "This model learns spatial patterns (where) and temporal dynamics (when) from sequences of grid maps.",
    why: "Crime hotspots move and change over time; deep spatio-temporal models can capture this better than static models.",
    links: "Input: past N months of grid maps/features → Output: next-month count grid and/or hotspot probabilities.",
    bullets: [
      "CNN extracts spatial structure from grid-like maps.",
      "GRU models temporal patterns over a lookback window (6–12 months).",
      "Use only chronological splits (random split = leakage)."
    ]
  },
  eval: {
    title: "Evaluation & Validation",
    tags: ["Testing", "No cheating"],
    tagStyle: ["good", "warn"],
    overview: "Evaluation proves whether your model generalizes to future months (not just memorizes the past).",
    why: "You must use time-based splitting or your metrics are inflated and worthless.",
    links: "Reports: forecasting error + hotspot ranking quality + error analysis.",
    bullets: [
      "Chronological split: train (2018–2022), val (2023), test (2024).",
      "Forecast metrics: MAE, RMSE.",
      "Hotspot metrics: Precision@K, Hit-rate@K.",
      "Show failure cases and explain them."
    ]
  },
  gov: {
    title: "Responsible AI & Governance",
    tags: ["Ethics", "Constraints"],
    tagStyle: ["good", "warn"],
    overview: "This is where you prevent misuse and document the limits of what the system can ethically claim.",
    why: "Police data encodes reporting and policing bias; your system must be decision-support, not targeting people.",
    links: "Displayed in the prototype as limitations/model card and included in documentation.",
    bullets: [
      "Bias: police data ≠ true crime rates.",
      "Privacy: only aggregated outputs (cell/month).",
      "Decision-support only; document non-uses and limitations."
    ]
  },
  out: {
    title: "Decision-Support Outputs",
    tags: ["Prototype", "Outputs"],
    tagStyle: ["good", "good"],
    overview: "These are the outputs a user sees: maps and ranked lists to support planning.",
    why: "If you can’t show usable outputs, you don’t have a decision-support system—just a notebook.",
    links: "Uses dim_cell to map results back to geography + evaluation tables for credibility.",
    bullets: [
      "Risk heatmaps per month (predicted vs actual).",
      "Ranked hotspots list (Top-K).",
      "Evaluation tables + short model card/limitations."
    ]
  }
};

const ERD_DETAILS = {
  dim_cell: {
    title: "dim_cell (Grid Cells)",
    tags: ["Dimension", "Geospatial"],
    tagStyle: ["purple", "good"],
    overview: "A dimension table that describes each grid cell on the map.",
    keys: "PK: cell_id",
    why: "You don’t repeat lat/lon in every row. You store it once and link to it from the fact table.",
    links: "fact_crime.cell_id → dim_cell.cell_id",
    example: "If the model predicts cell_id=102 is high risk, dim_cell tells you its location so you can draw it on the heatmap.",
    bullets: [
      "Typical fields: lat_center, lon_center, optional district label.",
      "Used for mapping predictions back into heatmaps."
    ]
  },
  dim_time: {
    title: "dim_time (Monthly Time Dimension)",
    tags: ["Dimension", "Time"],
    tagStyle: ["purple", "good"],
    overview: "A dimension table that describes each month in your timeline.",
    keys: "PK: month_id",
    why: "Makes time-based splits and seasonality consistent and prevents messy date handling everywhere.",
    links: "fact_crime.month_id → dim_time.month_id; fact_socio_econ may also link to time.",
    example: "month_id=2023-07 links all July 2023 rows to the same time metadata.",
    bullets: [
      "Typical fields: year, month_num, month_str (YYYY-MM).",
      "Supports chronological train/val/test splitting."
    ]
  },
  dim_crime_type: {
    title: "dim_crime_type (Crime Categories)",
    tags: ["Dimension", "Optional"],
    tagStyle: ["purple", "warn"],
    overview: "A dimension table listing crime categories (standardized names).",
    keys: "PK: crime_type_id",
    why: "Stops you storing messy strings in the main table and enables filtering by category.",
    links: "fact_crime.crime_type_id → dim_crime_type.crime_type_id (only if you model by type).",
    example: "crime_type_id=3 might represent ‘Burglary’. The name lives in dim_crime_type, not repeated everywhere.",
    bullets: [
      "You can skip this if you only predict total crime counts per cell-month.",
      "If you include it, your fact table becomes cell-month-type."
    ]
  },
  dim_area: {
    title: "dim_area (LSOA/MSOA Areas)",
    tags: ["Dimension", "Socio key"],
    tagStyle: ["purple", "good"],
    overview: "A dimension table for official government statistical areas (LSOA/MSOA).",
    keys: "PK: area_id (LSOA/MSOA code)",
    why: "Socio-economic data is published by area, not by your custom grid cells—so you need the area dimension.",
    links: "fact_socio_econ.area_id → dim_area.area_id; bridge_cell_area also links to dim_area.",
    example: "area_id=E010xxxxx represents a specific LSOA; indicators are attached to that area.",
    bullets: [
      "Stores area metadata (codes/names).",
      "Used to join socio-economic indicators correctly."
    ]
  },
  fact_crime: {
    title: "fact_crime (Aggregated Crime Counts)",
    tags: ["Fact table", "Model input"],
    tagStyle: ["good", "good"],
    overview: "The central table: it stores the measured numbers (crime counts) after aggregation.",
    oneRow: "One row usually means: one grid cell in one month (and optionally one crime type).",
    keys: "FKs: cell_id → dim_cell, month_id → dim_time, (optional) crime_type_id → dim_crime_type",
    why: "This is what the ML model actually learns from. Everything else exists to describe these rows.",
    links: "Connects to location/time/type dimensions so you can group, filter, and map results.",
    example: "cell_id=102, month_id=2023-07, count=18 means 18 crimes in that cell during July 2023.",
    bullets: [
      "Stores count and optionally target_next_count / hotspot_label.",
      "This table is produced from the pipeline’s aggregation stage."
    ]
  },
  bridge_cell_area: {
    title: "bridge_cell_area (Cell ↔ Area Mapping)",
    tags: ["Bridge", "Correct join"],
    tagStyle: ["purple", "warn"],
    overview: "A bridge table that maps your custom grid cells to official areas (LSOA/MSOA).",
    oneRow: "One row means: a specific cell overlaps a specific area by some proportion.",
    keys: "FKs: cell_id → dim_cell, area_id → dim_area, plus weight (0–1)",
    why: "Cells don’t align with LSOA boundaries. Without this, your socio-economic join can be wrong or oversimplified.",
    links: "Used to bring fact_socio_econ(area) features into fact_crime(cell).",
    example: "If cell overlaps Area A 0.7 and Area B 0.3 then cell_deprivation = 0.7*dep(A) + 0.3*dep(B).",
    bullets: [
      "If you skip weights, you might do nearest-centroid mapping (simpler but less accurate).",
      "This is the ‘proper’ way to avoid messy boundary mismatches."
    ]
  },
  fact_socio_econ: {
    title: "fact_socio_econ (Socio-Economic Indicators)",
    tags: ["Fact table", "External features"],
    tagStyle: ["good", "purple"],
    overview: "Stores socio-economic measurements by area and time period.",
    oneRow: "One row means: one area (LSOA/MSOA) in one time period with its indicators.",
    keys: "FK: area_id → dim_area, plus time key (month_id or year depending on the dataset).",
    why: "This provides external features that can help explain differences between areas.",
    links: "Joined to cells through bridge_cell_area, then merged into cell-month features for modelling.",
    example: "area_id=E010..., year=2023, unemployment=... means that area’s indicators for 2023.",
    bullets: [
      "Time granularity may be yearly while crime is monthly—document the alignment method.",
      "Features: deprivation, unemployment, housing, education."
    ]
  }
};

/* -----------------------
   Graph definitions
------------------------ */

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

/* -----------------------
   Rendering
------------------------ */

function renderGraph(key) {
  currentGraphKey = key;
  const cfg = GRAPHS[key]();

  graphTitleEl.textContent = cfg.title;

  tabPipeline.classList.toggle("active", key === "pipeline");
  tabErd.classList.toggle("active", key === "erd");

  renderEmptyDetails();

  const container = document.getElementById("network");
  const data = {
    nodes: new vis.DataSet(cfg.nodes),
    edges: new vis.DataSet(cfg.edges)
  };

  if (network) network.destroy();
  network = new vis.Network(container, data, cfg.options);

  network.on("click", function (params) {
    if (!params.nodes || params.nodes.length === 0) return;
    const nodeId = params.nodes[0];
    renderDetails(nodeId, cfg.details);
    network.selectNodes([nodeId]);
  });

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
        This panel explains what it is and how it connects.
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

  const bullets = (d.bullets && d.bullets.length)
    ? `<div class="section"><div class="sectionTitle">Key points</div><ul>${d.bullets.map(b => `<li>${escapeHtml(b)}</li>`).join("")}</ul></div>`
    : "";

  const sections = [];

  if (d.overview) sections.push(section("What it is", d.overview));
  if (d.oneRow) sections.push(section("What one row means", d.oneRow));
  if (d.keys) sections.push(section("Keys / identifiers", d.keys));
  if (d.why) sections.push(section("Why it exists", d.why));
  if (d.links) sections.push(section("How it links", d.links));
  if (d.example) sections.push(section("Simple example", d.example));

  detailsBodyEl.innerHTML = `
    <div class="card">
      <h2>${escapeHtml(d.title)}</h2>
      <div class="meta"><b>Node ID:</b> <span class="codeInline">${escapeHtml(nodeId)}</span></div>
      <div class="badgeRow">${badges}</div>
      ${sections.join("")}
      ${bullets}
    </div>
  `;
}

function section(title, text) {
  return `
    <div class="section">
      <div class="sectionTitle">${escapeHtml(title)}</div>
      <div class="sectionText">${escapeHtml(text)}</div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[s]));
}

/* -----------------------
   Search
------------------------ */

function findNode() {
  const q = (searchInput.value || "").trim().toLowerCase();
  if (!q || !network) return;

  const cfg = GRAPHS[currentGraphKey]();
  const nodes = cfg.nodes;

  const hit = nodes.find(n =>
    String(n.id).toLowerCase() === q ||
    String(n.id).toLowerCase().includes(q) ||
    String(n.label).toLowerCase().includes(q)
  );

  if (!hit) {
    detailsBodyEl.innerHTML = `
      <div class="card">
        <h2>Not found</h2>
        <div class="meta">No node matched: <span class="codeInline">${escapeHtml(q)}</span></div>
      </div>
    `;
    return;
  }

  network.selectNodes([hit.id]);
  network.focus(hit.id, { scale: 1.25, animation: { duration: 350 } });
  renderDetails(hit.id, cfg.details);
}

/* -----------------------
   UI wiring
------------------------ */

tabPipeline.addEventListener("click", () => renderGraph("pipeline"));
tabErd.addEventListener("click", () => renderGraph("erd"));
resetDetailsBtn.addEventListener("click", () => renderEmptyDetails());
searchBtn.addEventListener("click", () => findNode());
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") findNode();
});

window.addEventListener("DOMContentLoaded", () => {
  renderGraph("pipeline");
});
