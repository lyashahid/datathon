"""Aggregate the Datathon taxi release; retain no journey coordinates or identifiers.

Run with --archive /path/to/Avas_Ride.zip. Runtime uses the compact output only.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
from zipfile import ZipFile

import numpy as np
import pandas as pd
from shapely import contains_xy
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[2]
SOURCE_ID = "datathon-avas-ride-v1"
ARCHIVE_SHA256 = "959e575f01d4b08f75517fe5a196de127dc0e498a6648f1f179238405aff2f1b"
SOURCE_URL = (
    "https://github.com/mbs-datathon/maldives-datathon-2026-datasets/"
    "releases/download/v1.0/Avas_Ride.zip"
)
COMPLETED_STATUSES = {"payment_completed", "ride_completed"}
KNOWN_STATUSES = COMPLETED_STATUSES | {"ride_expired"}
ZONE_NAMES = {"male": "Malé", "hulhumale": "Hulhumalé", "hulhule": "Hulhulé / airport island"}
MIN_GROUP = 30


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def classify(frame: pd.DataFrame, prefix: str, features: list[dict]) -> pd.Series:
    """Assign only points strictly inside an existing physical-island polygon."""
    result = pd.Series("unmatched", index=frame.index)
    for feature in features:
        zone = feature.get("id", feature["properties"]["id"])
        if zone not in ZONE_NAMES:
            continue
        inside = contains_xy(
            shape(feature["geometry"]), frame[f"{prefix}_lng"], frame[f"{prefix}_lat"]
        )
        result.loc[inside] = zone
    return result


def profiles(frame: pd.DataFrame, keys: list[str]) -> list[dict]:
    result = []
    for values, group in frame.groupby(keys, sort=True):
        if len(group) < MIN_GROUP:
            continue
        values = values if isinstance(values, tuple) else (values,)
        native_values = (v.item() if isinstance(v, np.generic) else v for v in values)
        entry = dict(zip(keys, native_values, strict=True))
        entry.update(
            ride_count=len(group),
            median_minutes=round(float(group.time_sec.median()) / 60, 2),
            p90_minutes=round(float(group.time_sec.quantile(0.9)) / 60, 2),
            median_km=round(float(group.distance_km.median()), 3),
            recorded_speed_kph=round(
                float(group.distance_km.sum() / group.time_sec.sum()) * 3600, 2
            ),
            source_id=SOURCE_ID,
        )
        result.append(entry)
    return result


def build(archive: Path, boundaries: Path) -> dict:
    archive_bytes = archive.read_bytes()
    if digest(archive_bytes) != ARCHIVE_SHA256:
        raise ValueError("Avas Ride archive differs from the reviewed v1.0 release")
    with ZipFile(io.BytesIO(archive_bytes)) as source:
        members = {name: source.read(name) for name in source.namelist() if not name.endswith("/")}
    if set(members) != {"avas_rides_aug_sep_2026.csv", "car_fare_matrix.csv"}:
        raise ValueError("Avas Ride member schema changed; review the release before importing")
    raw = pd.read_csv(io.BytesIO(members["avas_rides_aug_sep_2026.csv"]))
    expected = {
        "date_started",
        "pickup_lat",
        "pickup_lng",
        "dropoff_lat",
        "dropoff_lng",
        "distance_km",
        "time_sec",
        "status",
    }
    if set(raw.columns) != expected:
        raise ValueError("Avas Ride journey columns changed")
    status_counts = {str(k): int(v) for k, v in raw.status.value_counts().items()}
    duplicates = int(raw.duplicated().sum())
    frame = raw.drop_duplicates().copy()
    frame["started"] = pd.to_datetime(frame.date_started, errors="coerce")
    numeric = ["pickup_lat", "pickup_lng", "dropoff_lat", "dropoff_lng", "distance_km", "time_sec"]
    for field in numeric:
        frame[field] = pd.to_numeric(frame[field], errors="coerce")
    valid = (
        frame.started.notna()
        & np.isfinite(frame[numeric]).all(axis=1)
        & frame.pickup_lat.between(-90, 90)
        & frame.dropoff_lat.between(-90, 90)
        & frame.pickup_lng.between(-180, 180)
        & frame.dropoff_lng.between(-180, 180)
        & (frame.distance_km > 0)
        & (frame.time_sec > 0)
    )
    # A distance shorter than endpoint separation cannot support a trip-speed proxy.
    lat1, lat2 = np.radians(frame.pickup_lat), np.radians(frame.dropoff_lat)
    dlat, dlon = lat2 - lat1, np.radians(frame.dropoff_lng - frame.pickup_lng)
    geodesic = 12742 * np.arcsin(
        np.minimum(
            1, np.sqrt(np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2)
        )
    )
    plausible = (frame.distance_km + 0.05 >= geodesic) & (
        frame.distance_km / frame.time_sec * 3600 <= 100
    )
    usable = frame.loc[valid & plausible & frame.status.isin(COMPLETED_STATUSES)].copy()
    usable["hour"] = usable.started.dt.hour.astype(int)
    usable["date"] = usable.started.dt.strftime("%Y-%m-%d")
    boundary_bytes = boundaries.read_bytes()
    features = json.loads(boundary_bytes)["features"]
    usable["pickup_zone"] = classify(usable, "pickup", features)
    usable["dropoff_zone"] = classify(usable, "dropoff", features)
    matched = usable.loc[(usable.pickup_zone != "unmatched") & (usable.dropoff_zone != "unmatched")]
    fares_raw = pd.read_csv(io.BytesIO(members["car_fare_matrix.csv"]))
    zone_column = "from_zone \\ to_zone"
    fares = []
    for _, row in fares_raw.iterrows():
        for destination in fares_raw.columns[2:]:
            value = float(row[destination])
            if not np.isfinite(value) or value < 0:
                raise ValueError("Invalid fare matrix value")
            fares.append(
                {
                    "from_zone": row[zone_column],
                    "to_zone": destination,
                    "fare_mvr": value,
                    "source_id": SOURCE_ID,
                }
            )
    if len(fares) != 36 or len({(r["from_zone"], r["to_zone"]) for r in fares}) != 36:
        raise ValueError("Fare matrix dimensions changed")
    date_min, date_max = usable.date.min(), usable.date.max()
    dates = pd.date_range(date_min, date_max)
    hourly = profiles(usable, ["hour"])
    daily = profiles(usable, ["date"])
    if sum(r["ride_count"] for r in hourly) != len(usable):
        raise ValueError("Hourly counts do not reconcile with usable completed records")
    if sum(r["ride_count"] for r in daily) != len(usable):
        raise ValueError("Daily counts do not reconcile with usable completed records")
    summary = profiles(usable.assign(scope="all"), ["scope"])[0]
    summary.pop("scope")
    summary["expired_records"] = status_counts.get("ride_expired", 0)
    summary["expired_share_pct"] = round(summary["expired_records"] / len(raw) * 100, 2)
    return {
        "schemaVersion": 1,
        "version": f"avas-ride-v1-{ARCHIVE_SHA256[:12]}",
        "sources": [
            {
                "id": SOURCE_ID,
                "title": "Avas Ride journey and car fare datasets, Datathon 2026 release v1.0",
                "url": SOURCE_URL,
                "publisher": "Avas Ride, distributed by Maldives Bureau of Statistics",
                "archive_sha256": ARCHIVE_SHA256,
                "member_sha256": {name: digest(value) for name, value in members.items()},
                "reference_period": "2026-08-01 to 2026-09-30",
                "grain": (
                    "One supplied ride record; unique journeys and people cannot be "
                    "verified without IDs"
                ),
                "clock": "Source date_started clock; timezone not documented",
                "license_status": (
                    "Public Datathon participant dataset; no separate reuse licence in archive"
                ),
            }
        ],
        "coverage": {
            "source_rows": len(raw),
            "completed_records": len(usable),
            "date_from": date_min,
            "date_to": date_max,
            "observed_days": len(daily),
            "calendar_days": len(dates),
            "status_counts": status_counts,
            "zones": [{"id": k, "name": v} for k, v in ZONE_NAMES.items()],
            "spatial_basis": (
                "Strict containment in existing OSM-derived physical-island polygons; no snapping"
            ),
            "boundaries_sha256": digest(boundary_bytes),
            "both_endpoints_matched": len(matched),
            "pickup_unmatched": int((usable.pickup_zone == "unmatched").sum()),
            "dropoff_unmatched": int((usable.dropoff_zone == "unmatched").sum()),
        },
        "quality": {
            "exact_duplicate_rows": duplicates,
            "missing_cells": int(raw.isna().sum().sum()),
            "invalid_field_rows": int((~valid).sum()),
            "implausible_metric_rows": int((valid & ~plausible).sum()),
            "unknown_status_rows": int((~frame.status.isin(KNOWN_STATUSES)).sum()),
            "minimum_profile_records": MIN_GROUP,
            "completed_status_assumption": sorted(COMPLETED_STATUSES),
            "expired_excluded_from_trip_metrics": True,
            "aggregate_counts_reconciled": True,
        },
        "summary": summary,
        "hourly": hourly,
        "daily": daily,
        "zones": profiles(usable.loc[usable.pickup_zone != "unmatched"], ["pickup_zone"]),
        "zoneHourly": profiles(
            usable.loc[usable.pickup_zone != "unmatched"], ["pickup_zone", "hour"]
        ),
        "corridors": profiles(matched, ["pickup_zone", "dropoff_zone"]),
        "corridorHourly": profiles(matched, ["pickup_zone", "dropoff_zone", "hour"]),
        "fares": fares,
        "limitations": [
            "These are historical supplied ride records, not live traffic or all taxi journeys.",
            "Completed records combine payment_completed and ride_completed as an explicit "
            "status-name assumption; no status dictionary is supplied.",
            "Expired records also contain positive distance/time fields and are excluded "
            "from trip-duration and speed profiles; expiration does not establish an unserved "
            "passenger.",
            "No journey, passenger or vehicle ID is supplied. Counts describe records, "
            "not unique people, fleet size or occupancy.",
            "The source clock timezone and the exact definition of time_sec are undocumented; "
            "trip minutes are not pickup waiting time or a calibrated road congestion measure.",
            "Recorded speed is summed distance divided by summed time. Trip mix and stopping "
            "can change it; it is not a measured road-segment speed or causal congestion index.",
            "Coarse zones reuse existing island geometry. Hulhumalé and Hulhulé use the app's "
            "derived causeway partition, not official neighbourhood or terminal boundaries; "
            "unmatched points are not snapped onto land.",
            "Only aggregate groups of at least 30 records are published; no raw coordinates "
            "or individual timestamps are retained.",
            "Car fare cells are interpreted as nominal MVR for the supplied Malé city zone "
            "matrix; the CSV has no explicit currency, effective date, surcharge or fare-rule "
            "documentation. They are context, not quoted current fares.",
        ],
        "reproduce": (
            "backend/.venv/Scripts/python.exe backend/scripts/prepare_datathon_taxis.py "
            "--archive /path/to/Avas_Ride.zip"
        ),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument(
        "--boundaries", type=Path, default=ROOT / "data/public/greater-male-boundaries.geojson"
    )
    parser.add_argument("--output", type=Path, default=ROOT / "data/public/datathon/taxis.json")
    args = parser.parse_args()
    result = build(args.archive, args.boundaries)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n", "utf-8")
    print(json.dumps({"coverage": result["coverage"], "quality": result["quality"]}, indent=2))
