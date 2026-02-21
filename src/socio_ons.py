# src/socio_ons.py
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import List

import pandas as pd

ONS_AREA_CODE_DEFAULT = "E12000003"  # Yorkshire and The Humber (region)


def _read_ons_csv(path: Path) -> pd.DataFrame:
    """
    ONS 'Explore Local Statistics' CSVs include metadata lines before the header.
    Find the row starting with 'Area code,' and read from there.
    """
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    hdr = None
    for i, line in enumerate(lines):
        if re.match(r"\s*Area code,", line):
            hdr = i
            break
    if hdr is None:
        raise ValueError(f"Could not locate ONS header row in {path}")
    return pd.read_csv(path, skiprows=hdr, encoding="utf-8")


def _period_to_months(time_period) -> List[pd.Period]:
    s = str(time_period).strip()

    # YYYY
    if re.fullmatch(r"\d{4}", s):
        y = int(s)
        return [pd.Period(f"{y}-{m:02d}", freq="M") for m in range(1, 13)]

    # YYYY-YY (financial year assumed Apr..Mar)
    m = re.fullmatch(r"(\d{4})-(\d{2})", s)
    if m:
        y0 = int(m.group(1))
        months = []
        for mo in range(4, 13):
            months.append(pd.Period(f"{y0}-{mo:02d}", freq="M"))
        for mo in range(1, 4):
            months.append(pd.Period(f"{y0+1}-{mo:02d}", freq="M"))
        return months

    # YYYY-MM
    if re.fullmatch(r"\d{4}-\d{2}", s):
        return [pd.Period(s, freq="M")]

    raise ValueError(f"Unsupported time period format: {time_period!r}")


@dataclass(frozen=True)
class IndicatorSpec:
    name: str
    filename: str
    value_col: str


def build_monthly_ons_features(
    folder: str | Path,
    months: pd.PeriodIndex,
    area_code: str = ONS_AREA_CODE_DEFAULT,
) -> pd.DataFrame:
    """
    Loads multiple ONS indicators and returns a monthly table:
      month (Period[M]) + indicator columns.
    Values are forward-filled.
    """
    folder = Path(folder)

    specs = [
        IndicatorSpec("wellbeing_satisfaction", "wellbeing-satisfaction-line-chart-data.csv", "Value (score out of 10)"),
        IndicatorSpec("wellbeing_anxiety", "wellbeing-anxiety-line-chart-data.csv", "Value (score out of 10)"),
        IndicatorSpec("no_qualifications_pct", "aged-16-to-64-years-with-no-qualifications-great-britain-line-chart-data.csv", "Value (%)"),
        IndicatorSpec("fe_participation_per_100k", "further-education-and-skills-participation-line-chart-data.csv", "Value (per 100,000 population)"),
        IndicatorSpec("children_relative_poverty_pct", "children-in-relative-poverty-line-chart-data.csv", "Value (%)"),
        IndicatorSpec("modelled_unemployment_pct", "modelled-unemployment-line-chart-data.csv", "Value (%)"),
        IndicatorSpec("economic_inactivity_pct", "economic-inactivity-rate-line-chart-data.csv", "Value (%)"),
        IndicatorSpec("median_age_years", "median-age-line-chart-data (2).csv", "Value (years)"),
    ]

    out = pd.DataFrame({"month": months})

    for spec in specs:
        path = folder / spec.filename
        if not path.exists():
            raise FileNotFoundError(f"Missing indicator file: {path}")

        df = _read_ons_csv(path)
        df = df[df["Area code"] == area_code].copy()
        if df.empty:
            raise ValueError(f"No rows for area code {area_code} in {spec.filename}")
        if spec.value_col not in df.columns:
            raise ValueError(f"Column {spec.value_col!r} not found in {spec.filename}")

        rows = []
        for _, r in df.iterrows():
            for m in _period_to_months(r["Time period"]):
                rows.append((m, float(r[spec.value_col])))

        tmp = pd.DataFrame(rows, columns=["month", spec.name])
        tmp = tmp.groupby("month", as_index=False)[spec.name].mean()
        out = out.merge(tmp, on="month", how="left")

    out = out.sort_values("month").reset_index(drop=True).ffill()
    return out