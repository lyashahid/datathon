"""Prepare anonymous historical island-presence context from the datathon GPS archive.

Run with the backend environment and --archive <downloaded FollowMe.zip>. The
archive is streamed without extraction; device identities never leave memory.
This evidence supplements island context and never changes routing or demand.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from zipfile import ZipFile

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]
SOURCE_ID = "datathon-followme-aug2025"
SOURCE_URL = (
    "https://github.com/mbs-datathon/maldives-datathon-2026-datasets/"
    "releases/download/v1.0/FollowMe.zip"
)
EXPECTED_SHA256 = "1e3dd0cb95cd55962e746a2cea31209244975e12bc999b3e1e3450653fa8ac01"
METRES_PER_DEGREE = 111320
LONGITUDE_SCALE = METRES_PER_DEGREE * np.cos(np.deg2rad(4.5))
NEARSHORE_METRES = 500


def _digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _project(coordinates: np.ndarray) -> np.ndarray:
    return coordinates * np.array([LONGITUDE_SCALE, METRES_PER_DEGREE])


def prepare(archive: Path, islands_path: Path) -> dict[str, Any]:
    digest = _digest(archive)
    if digest != EXPECTED_SHA256:
        raise ValueError("FollowMe archive differs from the reviewed datathon release")
    source_islands = json.loads(islands_path.read_text("utf-8"))["features"]
    polygons, island_metadata, excluded_islands = [], [], []
    for feature in source_islands:
        geometry = shape(feature["geometry"])
        if geometry.is_empty or not geometry.is_valid:
            excluded_islands.append(feature["id"])
            continue
        polygons.append(shapely.transform(geometry, _project))
        island_metadata.append(feature["properties"])
    tree = STRtree(polygons)
    # Integer codes are local-only bookkeeping. No device identifiers, exact GPS
    # positions, network identifiers or per-device tracks enter the output.
    devices: dict[str, int] = {}
    island_devices: dict[int, set[int]] = defaultdict(set)
    island_days: dict[tuple[int, int], set[int]] = defaultdict(set)
    island_samples: Counter[int] = Counter()
    island_day_samples: Counter[tuple[int, int]] = Counter()
    daily_devices: dict[int, set[int]] = defaultdict(set)
    daily_samples: Counter[int] = Counter()
    quality: Counter[str] = Counter()
    poll_ids: list[np.ndarray] = []
    files = []
    with ZipFile(archive) as source:
        csv_files = sorted(
            (info for info in source.infolist() if info.filename.endswith(".csv")),
            key=lambda info: int(Path(info.filename).stem),
        )
        if [int(Path(info.filename).stem) for info in csv_files] != list(range(1, 32)):
            raise ValueError("Expected all 31 daily source files")
        for entry in csv_files:
            file_counts: Counter[str] = Counter()
            with source.open(entry) as stream:
                chunks = pd.read_csv(
                    stream,
                    chunksize=200000,
                    dtype={"imei": "string", "poll_id": "int64"},
                    usecols=[
                        "poll_id",
                        "imei",
                        "timestamp",
                        "device_date",
                        "latitude",
                        "longitude",
                    ],
                )
                for chunk in chunks:
                    file_counts["rows"] += len(chunk)
                    poll_ids.append(chunk.poll_id.to_numpy(copy=True))
                    device_time = pd.to_datetime(chunk.device_date, errors="coerce")
                    database_time = pd.to_datetime(chunk.timestamp, errors="coerce")
                    valid_time = device_time.between("2025-08-01", "2025-09-01", inclusive="left")
                    latitude = pd.to_numeric(chunk.latitude, errors="coerce")
                    longitude = pd.to_numeric(chunk.longitude, errors="coerce")
                    valid_position = latitude.between(-1, 8.5) & longitude.between(72, 75)
                    valid_identity = chunk.imei.notna() & chunk.imei.str.strip().ne("")
                    valid = valid_time & valid_position & valid_identity
                    file_counts["invalid_or_out_of_period_device_time"] += int((~valid_time).sum())
                    file_counts["invalid_or_outside_maldives_position"] += int(
                        (~valid_position).sum()
                    )
                    file_counts["missing_device_identity"] += int((~valid_identity).sum())
                    lag = (database_time - device_time).dt.total_seconds()
                    file_counts["database_time_before_device_time"] += int((lag < 0).sum())
                    file_counts["database_delay_over_hour"] += int((lag > 3600).sum())
                    file_counts["retained_records"] += int(valid.sum())
                    selected = chunk.loc[valid].copy()
                    selected["day"] = device_time.loc[valid].dt.day
                    codes = []
                    for identity in selected.imei:
                        if identity not in devices:
                            devices[identity] = len(devices)
                        codes.append(devices[identity])
                    selected["device"] = codes
                    for day, subset in selected.groupby("day"):
                        daily_samples[int(day)] += len(subset)
                        daily_devices[int(day)].update(subset.device.unique().tolist())
                    points = shapely.points(
                        longitude.loc[valid].to_numpy() * LONGITUDE_SCALE,
                        latitude.loc[valid].to_numpy() * METRES_PER_DEGREE,
                    )
                    candidates = tree.query(points, predicate="dwithin", distance=NEARSHORE_METRES)
                    matches = np.bincount(candidates[0], minlength=len(selected))
                    unique = matches[candidates[0]] == 1
                    point_rows, island_rows = candidates[:, unique]
                    file_counts["ambiguous_nearshore_records"] += int((matches > 1).sum())
                    file_counts["outside_nearshore_records"] += int((matches == 0).sum())
                    file_counts["matched_nearshore_records"] += len(point_rows)
                    matched = selected.iloc[point_rows].copy()
                    matched["island"] = island_rows
                    for island, subset in matched.groupby("island"):
                        index = int(island)
                        island_samples[index] += len(subset)
                        island_devices[index].update(subset.device.unique().tolist())
                    for (island, day), subset in matched.groupby(["island", "day"]):
                        key = (int(island), int(day))
                        island_day_samples[key] += len(subset)
                        island_days[key].update(subset.device.unique().tolist())
            quality.update(file_counts)
            files.append(
                {"member": entry.filename, "uncompressed_bytes": entry.file_size, **file_counts}
            )
            print(
                f"Prepared day {Path(entry.filename).stem}: {file_counts['rows']:,} records",
                flush=True,
            )
    ordered_ids = np.concatenate(poll_ids)
    ordered_ids.sort()
    quality["duplicate_poll_ids"] = int((np.diff(ordered_ids) == 0).sum())
    if quality["duplicate_poll_ids"]:
        raise ValueError("Repeated database identities require review before preparation")
    if quality["retained_records"] != sum(daily_samples.values()):
        raise ValueError("Daily record totals do not reconcile")
    if quality["matched_nearshore_records"] != sum(island_samples.values()):
        raise ValueError("Island record totals do not reconcile")
    if quality["retained_records"] != sum(
        quality[key]
        for key in (
            "matched_nearshore_records",
            "ambiguous_nearshore_records",
            "outside_nearshore_records",
        )
    ):
        raise ValueError("Spatial partition does not reconcile")
    records = []
    for island in sorted(island_samples, key=lambda i: island_metadata[i]["id"]):
        metadata = island_metadata[island]
        records.append(
            {
                "island_id": metadata["id"],
                "name": metadata["name"],
                "atoll": metadata["atoll"],
                "source_id": SOURCE_ID,
                "tracked_devices": len(island_devices[island]),
                "gps_records": island_samples[island],
                "days_observed": sum(bool(island_days[island, day]) for day in range(1, 32)),
                "daily": [
                    {
                        "date": f"2025-08-{day:02}",
                        "tracked_devices": len(island_days[island, day]),
                        "gps_records": island_day_samples[island, day],
                    }
                    for day in range(1, 32)
                    if island_day_samples[island, day]
                ],
            }
        )
    return {
        "schemaVersion": 1,
        "version": "datathon-vessel-presence-v1:" + digest[:16],
        "source_id": SOURCE_ID,
        "period": {"from": "2025-08-01", "through": "2025-08-31"},
        "sources": [
            {
                "id": SOURCE_ID,
                "title": "FollowMe August 2025 GPS — Maldives Datathon 2026 release v1.0",
                "publisher": "FollowMe / Maldives Bureau of Statistics datathon repository",
                "url": SOURCE_URL,
                "sha256": digest,
                "bytes": archive.stat().st_size,
                "reference_period": "2025-08-01 through 2025-08-31",
                "licence": "Participant download; explicit redistribution licence unstated",
            }
        ],
        "method": {
            "grain": "Island/day tracked-device presence; one device can visit multiple islands",
            "time_field": "device_date (measurement clock), not timestamp (database receipt)",
            "timezone": "Undocumented; source clock retained without UTC conversion",
            "spatial_match": "Inside or approximately 500 m from exactly one valid island polygon",
            "projection": "Equirectangular metres at latitude 4.5 degrees; approximate radius",
            "nearshore_metres": NEARSHORE_METRES,
            "island_receipt": {
                "path": "backend/data/cache/normalized/islands.geojson",
                "sha256": _digest(islands_path),
                "invalid_geometries_excluded": excluded_islands,
            },
            "privacy": "Aggregate counts only; identities, tracks and mobile fields omitted",
            "daily_coverage": "Island daily arrays omit dates with no matched records",
        },
        "coverage": {
            "files": len(files),
            "tracked_devices": len(devices),
            "islands_with_records": len(records),
            "days": len(daily_samples),
            **quality,
        },
        "daily": [
            {
                "date": f"2025-08-{day:02}",
                "tracked_devices": len(daily_devices[day]),
                "gps_records": daily_samples[day],
            }
            for day in range(1, 32)
        ],
        "islands": records,
        "file_receipts": files,
        "limitations": [
            "Historical recorded presence; not live positions, sailings, demand or crowding.",
            "Stationary reports included. Counts can reflect reporting frequency, not activity.",
            "Limited device coverage. Missing records do not establish an absence of boats.",
            "Devices can visit multiple islands; island device totals are not additive.",
            "Overlapping matches excluded. A 500 m association is not a proven port call.",
            "Clock timezone and speed units undocumented. Speeds and journey calibration not used.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument(
        "--islands", type=Path, default=ROOT / "backend/data/cache/normalized/islands.geojson"
    )
    parser.add_argument("--output", type=Path, default=ROOT / "data/public/datathon/vessels.json")
    args = parser.parse_args()
    prepared = prepare(args.archive, args.islands)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(prepared, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(json.dumps(prepared["coverage"], indent=2))
    print(f"Wrote {args.output} ({args.output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
