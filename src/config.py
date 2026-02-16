from dataclasses import dataclass
from pathlib import Path

@dataclass
class Config:
    # Paths
    project_root: Path = Path(__file__).resolve().parents[1]
    raw_dir: Path = project_root / "data" / "raw"
    processed_dir: Path = project_root / "data" / "processed"

    # CRS / Grid
    epsg_in: int = 4326         # WGS84 lat/lon
    epsg_proj: int = 27700      # British National Grid (UK)
    cell_size_m: int = 500      # try 250 / 500 / 1000

    # Task
    k_hotspot_percent: float = 0.05   # Top 5%
    min_months_required: int = 14

    # Preferred chronological cutoffs (fallback auto if missing)
    train_end: str = "2022-12"
    val_end: str = "2023-12"

    # Column mapping for UK Police street-level CSVs
    col_map = {
        "Latitude": ["Latitude", "lat", "LAT"],
        "Longitude": ["Longitude", "lon", "LON", "Long"],
        "Month": ["Month", "month", "DATE", "Date"],
        "Crime type": ["Crime type", "Crime Type", "crime_type", "Crime"],
    }

CFG = Config()
CFG.processed_dir.mkdir(parents=True, exist_ok=True)
