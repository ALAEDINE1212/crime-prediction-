A) Experimental setup

Grid size: 500m

Target: next-month crime count per cell

Hotspots: top 5% cells

Validation: walk-forward across 11 months

B) Baselines

lag-1 baseline results (table + plot)

C) Improved model

Ridge results (table + plot)

D) Ablation study (NEIGHBORS)

“Adding neighbor aggregates reduced MAE and Precision@K slightly”

That’s not failure — it’s evidence and critical thinking.

Use your summary table:

Baseline: MAE ~3.746, P@K ~0.663

Ridge: MAE ~2.944, P@K ~0.734

Ridge+neighbors: slightly worse