"""Source fitness and reproducible diagnostics across every app data collection."""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.analytics.service import DatasetService
from app.forecasting.engine import forecast_series, index_month, month_index

METHOD_REFERENCES = [
    {
        "title": "Forecasting: Principles and Practice — time series cross-validation",
        "url": "https://otexts.com/fpp3/toolbox.html#time-series-cross-validation",
    },
    {
        "title": "Forecasting: Principles and Practice — regression predictors",
        "url": "https://otexts.com/fpp3/regression.html#some-useful-predictors",
    },
    {
        "title": "Forecasting: Principles and Practice — exponential smoothing",
        "url": "https://otexts.com/fpp3/exponential-smoothing.html",
    },
]

GRAINS = {
    "passenger-monthly": "Published category × calendar month; endpoint movements",
    "resident-origins": "Spatial origin × island, with population projection-year weights",
    "planning-facilities": "Audited institution coordinate; capacity is unknown",
    "national-population": "Island × census year × demographic category; categories may overlap",
    "national-readiness": "Island snapshot with separate census/projection measures",
    "policy-observations": "Source-defined geography × metric × period × unit",
    "airport-observations": "Airport × metric × source-defined month/year",
    "vessel-observations": "Port × metric × source-defined period",
    "transit-patterns": "Route direction × bounded departure capture",
    "service-calendars": "Route direction × validity window × day type",
    "weather-alerts": "Captured CAP alert identifier × sent/onset/expiry",
}


class EvidenceAnalysis:
    def __init__(self, public_dir: Path, runtime_dir: Path):
        self.datasets = DatasetService(public_dir, runtime_dir)
        self._fingerprint = ""
        self._profiles: list[dict[str, Any]] = []

    def profiles(self) -> list[dict[str, Any]]:
        catalogue = self.datasets.catalogue()
        fingerprint = json.dumps(
            [
                (item["id"], item.get("provenance", {}).get("receipt", {}))
                for item in catalogue["items"]
            ]
        )
        if self._fingerprint == fingerprint:
            return self._profiles
        profiles = []
        for metadata in catalogue["items"]:
            if metadata["status"] != "available":
                profiles.append({**metadata, "forecastFitness": "unavailable"})
                continue
            _, rows, _ = self.datasets._load(metadata["id"])
            compact_metadata = {
                key: metadata[key]
                for key in ("id", "title", "category", "status", "row_count", "qualification")
            }
            compact_metadata["columns"] = [
                {key: value for key, value in column.items() if key != "examples"}
                for column in metadata["columns"]
            ]
            provenance = metadata["provenance"]
            compact_metadata["provenance"] = {
                "receipt": provenance["receipt"],
                "timestamps": provenance["timestamps"],
                "sources": [
                    {key: item[key] for key in ("id", "title", "url") if key in item}
                    for item in provenance.get("sources", [])
                    if isinstance(item, dict)
                ],
            }
            canonical_rows = [json.dumps(row, sort_keys=True, ensure_ascii=False) for row in rows]
            repeated = len(rows) - len(set(canonical_rows))
            nulls = sum(column["missing_count"] for column in metadata["columns"])
            cells = len(rows) * len(metadata["columns"])
            mixed = [column["name"] for column in metadata["columns"] if column["type"] == "mixed"]
            dates = {}
            for column in metadata["columns"]:
                name = column["name"]
                if re.search(r"(month|year|period|date|time|asof|sent|onset|expiry)$", name, re.I):
                    values = [str(row[name]) for row in rows if row.get(name) is not None]
                    if values:
                        dates[name] = {
                            "minimum": min(values),
                            "maximum": max(values),
                            "distinct": len(set(values)),
                        }
            identity_checks = []
            for key in ("id", "seriesId", "island_id", "islandId", "sourceId"):
                if any(key in row for row in rows):
                    counts = Counter(str(row[key]) for row in rows if row.get(key) is not None)
                    identity_checks.append(
                        {
                            "column": key,
                            "distinct": len(counts),
                            "repeatedValues": sum(count - 1 for count in counts.values()),
                            "qualification": "Repeated dimensions do not imply duplicate grain.",
                        }
                    )
            geography_coverage = None
            if metadata["id"] == "national-population":
                attached = [row for row in rows if row.get("island_id")]
                geography_coverage = {
                    "mappedRecords": len(attached),
                    "mappedIslands": len({row["island_id"] for row in attached}),
                    "unmappedRecords": len(rows) - len(attached),
                    "matchStatuses": dict(
                        Counter(row.get("match_status", "unknown") for row in rows)
                    ),
                    "qualification": "P6 aggregate geographies stay unattached to islands; "
                    "census categories overlap and must not be summed as independent people.",
                }
            profiles.append(
                {
                    **compact_metadata,
                    "grain": GRAINS.get(
                        metadata["id"],
                        "Source-defined record snapshot; inspect schema before joining",
                    ),
                    "exactDuplicateRows": repeated,
                    "nullCells": nulls,
                    "nullCellRate": nulls / cells if cells else None,
                    "mixedTypeColumns": mixed,
                    "temporalFields": dates,
                    "identityChecks": identity_checks,
                    "geographyCoverage": geography_coverage,
                    "forecastFitness": "aggregate-target"
                    if metadata["id"] == "passenger-monthly"
                    else "context-only",
                    "forecastQualification": (
                        "Continuous monthly target history; revised values and source lag retained."
                        if metadata["id"] == "passenger-monthly"
                        else "No historical feature join with matching target and availability."
                    ),
                }
            )
        self._fingerprint, self._profiles = fingerprint, profiles
        return profiles

    def report(self, source: dict[str, Any]) -> dict[str, Any]:
        profiles = self.profiles()
        passenger = []
        horizons = []
        for series in source["series"]:
            points = series["points"]
            months = [point["month"] for point in points]
            values = [point["value"] for point in points]
            passenger.append(
                {
                    "seriesId": series["id"],
                    "name": series["name"],
                    "observations": len(points),
                    "firstMonth": months[0],
                    "lastMonth": months[-1],
                    "duplicateMonths": len(months) - len(set(months)),
                    "missingMonths": month_index(months[-1])
                    - month_index(months[0])
                    + 1
                    - len(set(months)),
                    "invalidCounts": sum(
                        not isinstance(value, (int, float))
                        or isinstance(value, bool)
                        or not math.isfinite(value)
                        or value < 0
                        for value in values
                    ),
                    "minimum": min(values),
                    "maximum": max(values),
                    "sourceUrl": series["sourceUrl"],
                }
            )
            for horizon in range(1, 13):
                forecast = forecast_series(
                    series, index_month(month_index(series["lastActualMonth"]) + horizon)
                )
                horizons.append(
                    {
                        "seriesId": series["id"],
                        "name": series["name"],
                        "horizonMonths": horizon,
                        "model": forecast["model"],
                        "status": forecast["status"],
                        "evaluation": forecast["evaluation"],
                        "selection": forecast.get("selection"),
                        "empiricalRange": forecast["empiricalRange"],
                        "diagnostics": forecast.get("diagnostics"),
                    }
                )
        available = [item for item in profiles if item["status"] == "available"]
        source_hashes = sorted({item["provenance"]["receipt"]["sha256"] for item in available})
        return {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "scope": (
                "Every structured collection exposed by the bundled app; raw files are traced "
                "through source receipts, not counted again as independent observations."
            ),
            "summary": {
                "collections": len(profiles),
                "availableCollections": len(available),
                "uniqueSourceArtifacts": len(source_hashes),
                "forecastableSeries": len(passenger),
                "passengerObservations": sum(item["observations"] for item in passenger),
                "emptyCollections": [item["id"] for item in available if not item["row_count"]],
                "collectionsWithExactDuplicates": [
                    item["id"] for item in available if item["exactDuplicateRows"]
                ],
            },
            "collectionProfiles": profiles,
            "passengerProfiles": passenger,
            "horizonDiagnostics": horizons,
            "passengerSourceReceipt": source["receipt"],
            "analysisFingerprint": hashlib.sha256(
                (self._fingerprint + source["receipt"]["sha256"]).encode()
            ).hexdigest(),
            "insights": [
                {
                    "title": "Predict movements at the published aggregate scale",
                    "detail": (
                        f"{sum(item['observations'] for item in passenger)} monthly observations "
                        f"across {len(passenger)} categories support rolling historical forecasts. "
                        "Ferry endpoints stay separate; counts are not unique riders."
                    ),
                },
                {
                    "title": "Use the model selected for the decision horizon",
                    "detail": (
                        "Each 1–12 month horizon has a separately locked selection policy. Nine "
                        "baselines/statistical candidates and an ensemble compete on earlier MAE; "
                        "complexity needs a 5% improvement."
                    ),
                },
                {
                    "title": "Treat later errors as a planning constraint",
                    "detail": (
                        "Later forecasts do not influence model choice or range calibration. "
                        "Low coverage, negative skill and bias stay visible; ranges need "
                        "independent calibration history."
                    ),
                },
                {
                    "title": "Use population and facilities for access, not invented demand",
                    "detail": (
                        "Census/projection weights, facilities and schedules support resident "
                        "accessibility and resource scenarios. Capacity, occupancy and measured "
                        "origin–destination trips are absent."
                    ),
                },
                {
                    "title": "Collect aligned history before adding live covariates",
                    "detail": (
                        "Live weather, traffic and position captures do not provide a historic, "
                        "timestamped monthly feature panel. Fitting them to old monthly outcomes "
                        "would create unsupported joins and leakage."
                    ),
                },
            ],
            "methods": METHOD_REFERENCES,
            "limitations": [
                "The historical snapshot has already been explored; chronological holdout design "
                "is not a pristine prospective test.",
                "Original publication-time vintages and availability are not reconstructed; "
                "errors use revised values.",
                "Exact duplicate rows and null cell rates are descriptive; composite grains "
                "and legitimate sparsity need source-specific interpretation.",
                "No causal policy effect, stop demand, vehicle ETA, unique riders or national "
                "resident travel times are inferred from incompatible data.",
            ],
        }
