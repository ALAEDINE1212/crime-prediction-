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
   Audience-ready language:
   no "you/your" addressing.
------------------------ */

const PIPELINE_DETAILS = {
  crime: {
    title: "Crime Incident Data (West Yorkshire Police)",
    tags: ["Dataset", "Raw input"],
    tagStyle: ["good", "good"],
    overview: "This is the raw incident-level dataset. Each record represents a reported crime event with location and time information.",
    keys: "A stable primary key is not always provided. A synthetic identifier can be formed from (datetime + location + crime type) if required.",
    why: "All downstream tables and model inputs are derived from these raw records.",
    links: "This dataset feeds into: Pre-processing & Quality Gate → then grid mapping and monthly aggregation.",
    bullets: [
      "Common fields: latitude/longitude, datetime, crime type, outcome (often missing).",
      "Common issues: invalid coordinates, duplicates, missing outcomes, inconsistent category labels.",
      "A raw immutable copy supports reproducibility and auditing."
    ]
  },
  socio: {
    title: "Socio-Economic Indicators (Open Government Data)",
    tags: ["Dataset", "External features"],
    tagStyle: ["good", "purple"],
    overview: "This dataset provides external context such as deprivation, unemployment, housing, and education indicators, typically published by official areas (LSOA/MSOA).",
    keys: "Keyed by area_id (LSOA/MSOA code) and a time period (year or month depending on the source).",
    why: "These indicators add structural information that is not captured by historical crime counts alone.",
    links: "Merged via: dim_area + (optional) bridge_cell_area → then attached to cell-month features.",
    bullets: [
      "A common mismatch occurs when socio-economic data is yearly while crime aggregation is monthly; the alignment method must be documented.",
      "A mapping is required between grid cells and LSOA/MSOA areas (centroid or overlap weights)."
    ]
  },
  prep: {
    title: "Data Pre-processing & Quality Gate",
    tags: ["Pipeline stage", "High risk"],
    tagStyle: ["purple", "warn"],
    overview: "This stage cleans the raw data and enforces consistency rules before feature engineering and modelling.",
    why: "Without strict cleaning, the pipeline trains on noise and produces misleading evaluation scores and heatmaps.",
    links: "Inputs: raw crime data + socio-economic data. Output: cleaned crime records ready for spatial-temporal processing.",
    bullets: [
      "Remove invalid coordinates (NaN, 0,0, out-of-bounds).",
      "Apply a single consistent policy for 'No Location'.",
      "Deduplicate using incident IDs or a well-defined heuristic.",
      "Maintain an audit log of row counts before/after each cleaning step."
    ]
  },
  repr: {
    title: "Spatial & Temporal Representation",
    tags: ["Feature engineering", "Representation"],
    tagStyle: ["purple", "purple"],
    overview: "This stage converts point incidents into a structured spatio-temporal dataset suitable for modelling.",
    why: "Models require consistent inputs: fixed spatial units (grid cells) over fixed temporal steps (months).",
    links: "Output: an aggregated cell-month (or cell-month-type) table with lag/rolling features and optional spatial lags.",
    bullets: [
      "Grid discretisation maps incidents to cell_id using a fixed resolution (e.g., 250m/500m).",
      "Monthly aggregation produces counts per cell per month.",
      "Socio-economic indicators are fused into the same rows via area mapping.",
      "Optional: neighbour-based spatial lag features can capture local spillover effects."
    ]
  },
  task: {
    title: "Prediction Task Definition",
    tags: ["ML task", "Must lock"],
    tagStyle: ["good", "warn"],
    overview: "This defines the prediction target and label logic used for training and evaluation.",
    why: "A fixed task definition makes metrics meaningful and prevents inconsistent performance claims.",
    links: "Determines which target fields appear in the fact table (e.g., target_next_count or hotspot_label).",
    bullets: [
      "Primary task: next-month crime count forecasting per cell (regression).",
      "Secondary task: hotspot identification (Top-K% cells) (ranking/classification).",
      "K and label thresholds must be stated explicitly because hotspot classes are typically imbalanced."
    ]
  },
  base: {
    title: "Baseline Models",
    tags: ["Baselines", "Interpretability"],
    tagStyle: ["good", "purple"],
    overview: "Baselines provide a realistic reference level of performance using simple, interpretable techniques.",
    why: "If a complex model cannot outperform strong baselines, added complexity is not justified.",
    links: "Compared against the deep model using the same time split and evaluation metrics.",
    bullets: [
      "Seasonal-naive: next month approximated by last month or the same month last year.",
      "Cluster + SARIMA: group similar cells then forecast per cluster/cell for interpretability.",
      "Baselines provide credibility for any reported improvement."
    ]
  },
  deep: {
    title: "Spatio-Temporal Deep Model (CNN + GRU)",
    tags: ["Deep learning", "Spatio-temporal"],
    tagStyle: ["good", "purple"],
    overview: "This model captures spatial patterns (where) and temporal dynamics (when) using sequences of grid-based inputs.",
    why: "Hotspots are spatially structured and evolve over time; deep spatio-temporal models can learn these patterns jointly.",
    links: "Input: past N months of grid maps/features → Output: next-month crime count grid and/or hotspot probabilities.",
    bullets: [
      "CNN extracts spatial structure from grid-like inputs.",
      "GRU models temporal evolution over a lookback window (e.g., 6–12 months).",
      "Chronological splitting is required to avoid time leakage."
    ]
  },
  eval: {
    title: "Evaluation & Validation",
    tags: ["Testing", "No leakage"],
    tagStyle: ["good", "warn"],
    overview: "Evaluation measures future generalization by testing on later time periods not used for training.",
    why: "Time-based validation prevents overly optimistic scores caused by leakage and non-causal correlations.",
    links: "Reports forecasting error metrics, hotspot ranking metrics, and qualitative map comparisons.",
    bullets: [
      "Chronological split: train (2018–2022), validation (2023), test (2024).",
      "Forecasting metrics: MAE and RMSE.",
      "Hotspot metrics: Precision@K and Hit-rate@K.",
      "Error analysis highlights months/areas where the model fails and why."
    ]
  },
  gov: {
    title: "Responsible AI & Governance",
    tags: ["Ethics", "Limitations"],
    tagStyle: ["good", "warn"],
    overview: "Governance documents intended use, limitations, and safeguards to reduce the risk of harm or misuse.",
    why: "Reported crime data reflects reporting and enforcement patterns and can embed bias; outputs must remain decision-support rather than individual targeting.",
    links: "Shown in the prototype as a model card and stated in documentation as constraints and non-uses.",
    bullets: [
      "Bias note: recorded crime ≠ true crime prevalence.",
      "Privacy: only aggregated cell/month outputs are produced.",
      "Intended use: resource planning and situational awareness, not profiling individuals."
    ]
  },
  out: {
    title: "Decision-Support Outputs",
    tags: ["Prototype", "Outputs"],
    tagStyle: ["good", "good"],
    overview: "Outputs are presented as maps and ranked hotspot lists designed to support planning decisions.",
    why: "A decision-support system is only credible when outputs are interpretable and accompanied by evaluation evidence.",
    links: "Uses dim_cell for mapping, plus evaluation tables and limitations for transparency.",
    bullets: [
      "Risk heatmaps per month (predicted vs actual comparison).",
      "Ranked hotspot list (Top-K cells).",
      "Evaluation tables and a short model card describing assumptions and limits."
    ]
  }
};

const ERD_DETAILS = {
  dim_cell: {
    title: "dim_cell (Grid Cells)",
    tags: ["Dimension", "Geospatial"],
    tagStyle: ["purple", "good"],
    overview: "A dimension table describing each grid cell used as the spatial unit of analysis.",
    keys: "Primary key: cell_id",
    why: "Cell metadata (e.g., centre latitude/longitude) is stored once and linked from the fact table rather than repeated in every measurement row.",
    links: "fact_crime.cell_id → dim_cell.cell_id",
    example: "When a model predicts a specific cell_id as high risk, dim_cell provides the coordinates needed to plot that cell on a heatmap.",
    bullets: [
      "Typical fields: lat_center, lon_center, optional district label.",
      "Enables mapping model outputs back into geographic visualizations."
    ]
  },
  dim_time: {
    title: "dim_time (Monthly Time Dimension)",
    tags: ["Dimension", "Time"],
    tagStyle: ["purple", "good"],
    overview: "A dimension table describing each monthly time step in the dataset.",
    keys: "Primary key: month_id",
    why: "A shared time dimension supports consistent splitting, seasonality features, and cleaner joins compared to repeated raw date strings.",
    links: "fact_crime.month_id → dim_time.month_id; fact_socio_econ also links to time where applicable.",
    example: "month_id = 2023-07 links all July 2023 measurements to the same time metadata (year, month number).",
    bullets: [
      "Typical fields: year, month_num, month_str (YYYY-MM).",
      "Supports chronological train/validation/test evaluation."
    ]
  },
  dim_crime_type: {
    title: "dim_crime_type (Crime Categories)",
    tags: ["Dimension", "Optional"],
    tagStyle: ["purple", "warn"],
    overview: "A dimension table listing standardized crime categories.",
    keys: "Primary key: crime_type_id",
    why: "Standardization avoids repeated strings in the fact table and enables filtering by category in analysis and outputs.",
    links: "fact_crime.crime_type_id → dim_crime_type.crime_type_id (only when modelling by type).",
    example: "crime_type_id = 3 may represent 'Burglary'; the name is stored once in dim_crime_type.",
    bullets: [
      "This dimension can be omitted when modelling total crime counts only (cell-month).",
      "Including it typically produces a cell-month-type fact table."
    ]
  },
  dim_area: {
    title: "dim_area (LSOA/MSOA Areas)",
    tags: ["Dimension", "Socio key"],
    tagStyle: ["purple", "good"],
    overview: "A dimension table for official government statistical areas (LSOA/MSOA) used by socio-economic datasets.",
    keys: "Primary key: area_id (LSOA/MSOA code)",
    why: "Socio-economic indicators are published at area level, so an area dimension is necessary for correct integration.",
    links: "fact_socio_econ.area_id → dim_area.area_id; bridge_cell_area.area_id → dim_area.area_id",
    example: "area_id identifies a specific LSOA/MSOA; socio-economic values attach to that area and are later transferred to grid cells.",
    bullets: [
      "Stores area metadata (codes/names).",
      "Acts as the join point for socio-economic indicators."
    ]
  },
  fact_crime: {
    title: "fact_crime (Aggregated Crime Counts)",
    tags: ["Fact table", "Model input"],
    tagStyle: ["good", "good"],
    overview: "The central fact table storing the measured quantities after aggregation.",
    oneRow: "One row typically represents one grid cell in one month (and optionally one crime type).",
    keys: "Foreign keys: cell_id → dim_cell, month_id → dim_time, optional crime_type_id → dim_crime_type",
    why: "This is the dataset used directly for modelling; other tables provide context and joinable metadata.",
    links: "Joins to dimensions to support analysis by location, time, and category and to produce interpretable outputs.",
    example: "cell_id=102, month_id=2023-07, count=18 indicates 18 crimes in that cell during July 2023.",
    bullets: [
      "May also include target_next_count (forecast target) and hotspot_label (classification target).",
      "Created from the pipeline’s aggregation and feature engineering stages."
    ]
  },
  bridge_cell_area: {
    title: "bridge_cell_area (Cell ↔ Area Mapping)",
    tags: ["Bridge", "Correct join"],
    tagStyle: ["purple", "warn"],
    overview: "A bridge table mapping custom grid cells to official LSOA/MSOA areas.",
    oneRow: "One row indicates that a grid cell overlaps a specific area by a given proportion.",
    keys: "Foreign keys: cell_id → dim_cell, area_id → dim_area, plus weight ∈ [0,1]",
    why: "Grid cells rarely align perfectly with area boundaries. The bridge enables correct transfer of socio-economic indicators to cells.",
    links: "Used to attach fact_socio_econ(area) indicators to cell-based modelling rows in fact_crime.",
    example: "If overlap is 0.7 with Area A and 0.3 with Area B, a weighted cell indicator is computed as 0.7×A + 0.3×B.",
    bullets: [
      "A simpler alternative is nearest-centroid mapping, but it is less accurate at boundaries.",
      "Weights reduce boundary mismatch errors and improve data integration quality."
    ]
  },
  fact_socio_econ: {
    title: "fact_socio_econ (Socio-Economic Indicators)",
    tags: ["Fact table", "External features"],
    tagStyle: ["good", "purple"],
    overview: "A fact-like table storing socio-economic measurements for each official area and time period.",
    oneRow: "One row represents one area in one time period with its indicator values.",
    keys: "Foreign key: area_id → dim_area, plus a time key (month_id or year depending on source).",
    why: "External indicators provide context signals used as features during modelling and analysis.",
    links: "Joined to grid cells via bridge_cell_area and then merged into cell-month modelling rows.",
    example: "area_id=E010…, year=2023, unemployment=… represents that area’s socio-economic state for that period.",
    bullets: [
      "Time granularity can be yearly while crime is monthly; the alignment method must be stated.",
      "Typical fields: deprivation, unemployment, housing, education."
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
