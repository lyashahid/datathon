"""Prepare bounded historical MACL aggregates from the pinned Datathon release.

Pass --archive explicitly. Raw movement records and anonymous route/carrier codes
are not copied into the public bundle. No airport-to-bus demand inference is made.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SOURCE_ID = "datathon-2026-macl-v1"
REPOSITORY = "https://github.com/mbs-datathon/maldives-datathon-2026-datasets"
RELEASE_URL = REPOSITORY + "/releases/tag/v1.0"
ASSET_URL = REPOSITORY + "/releases/download/v1.0/MACL.zip"
ARCHIVE_SHA256 = "72428c8b5f57301987ceeb832070fc81f27423e5e213534b9c5610f70716e5b3"
CSV_MEMBER = "MACL/Airport traffic_Dataset_27092026.csv"
CSV_SHA256 = "4fa7875ac279a39076d5afa1991494a1cd1dfd03d2d8f6b125495dfc607d7c08"
METADATA_MEMBER = "MACL/Metadata.csv"
METADATA_SHA256 = "77697f928004dd3ee54689a931a1877a8ce9141065a5aef163929fb012bee0d6"
FIRST_DATE = date(2012, 1, 1)
LAST_DATE = date(2026, 7, 31)
FIELDS = (
    "record_id",
    "flight_type",
    "dep_date",
    "arrival_date",
    "carrier_code",
    "route_code",
    "region",
    "aircraft_type_code",
    "aircraft_category",
    "arr_adults",
    "arr_children",
    "arr_infants",
    "transit_adults",
    "transit_children",
    "transit_infants",
    "dep_adults",
    "dep_children",
    "dep_infants",
    "ata",
    "atd",
)
NUMERIC_FIELDS = tuple(
    f"{prefix}_{cohort}"
    for prefix in ("arr", "dep", "transit")
    for cohort in ("adults", "children", "infants")
)
REGIONS = {
    "South Asia",
    "Middle East",
    "Europe",
    "Southeast Asia",
    "East Asia",
    "Central Asia & CIS",
    "Other",
    "Africa",
}
TIME_PATTERN = re.compile(r"^(\d{1,2}):(\d{2})$")
DATE_PATTERN = re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$")


def _date(value: str, issues: Counter[str], event: str) -> date | None:
    if not value:
        issues[f"{event}_missing_date"] += 1
        return None
    if not DATE_PATTERN.fullmatch(value):
        issues[f"{event}_invalid_date"] += 1
        return None
    try:
        result = datetime.strptime(value, "%m/%d/%Y").date()
    except ValueError:
        issues[f"{event}_invalid_date"] += 1
        return None
    if not FIRST_DATE <= result <= LAST_DATE:
        issues[f"{event}_outside_reference_period"] += 1
        if result.year == 1970:
            issues[f"{event}_epoch_sentinel"] += 1
        return None
    return result


def _hour(value: str, issues: Counter[str], event: str) -> int | None:
    if not value:
        issues[f"{event}_missing_time"] += 1
        return None
    match = TIME_PATTERN.fullmatch(value)
    if match is None or int(match[1]) >= 24 or int(match[2]) >= 60:
        issues[f"{event}_invalid_time"] += 1
        return None
    return int(match[1])


def _add(target: Counter[str], adults: int, children: int, infants: int) -> None:
    target.update(
        {
            "movement_records": 1,
            "passengers": adults + children + infants,
            "adults": adults,
            "children": children,
            "infants": infants,
        }
    )


def prepare(archive_path: Path) -> dict[str, Any]:
    """Read this source vintage, validate it, then aggregate independent events."""
    archive_bytes = archive_path.read_bytes()
    if hashlib.sha256(archive_bytes).hexdigest() != ARCHIVE_SHA256:
        raise ValueError("Archive differs from the reviewed Datathon MACL v1.0 asset")
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        csv_bytes = archive.read(CSV_MEMBER)
        metadata_bytes = archive.read(METADATA_MEMBER)
    if hashlib.sha256(csv_bytes).hexdigest() != CSV_SHA256:
        raise ValueError("Airport movement CSV differs from the reviewed source")
    if hashlib.sha256(metadata_bytes).hexdigest() != METADATA_SHA256:
        raise ValueError("MACL metadata differs from the reviewed source")
    metadata = list(csv.DictReader(io.StringIO(metadata_bytes.decode("utf-8-sig"))))
    if tuple(row["Column"] for row in metadata if row.get("Column")) != FIELDS:
        raise ValueError("Unexpected MACL metadata column definitions")
    reader = csv.DictReader(io.StringIO(csv_bytes.decode("utf-8-sig")))
    if tuple(reader.fieldnames or ()) != FIELDS:
        raise ValueError("Unexpected MACL movement CSV columns")

    hourly: dict[tuple[int, int, str, str], Counter[str]] = defaultdict(Counter)
    monthly: dict[tuple[str, str, str], Counter[str]] = defaultdict(Counter)
    quality: Counter[str] = Counter()
    monthly_dates: dict[tuple[str, str, str], set[date]] = defaultdict(set)
    hourly_dates: dict[tuple[int, int, str, str], set[date]] = defaultdict(set)
    identities: set[str] = set()
    content_hashes: set[bytes] = set()
    retained: dict[str, Counter[str]] = defaultdict(Counter)
    raw: dict[str, Counter[str]] = defaultdict(Counter)
    flight_types: Counter[str] = Counter()
    aircraft_categories: Counter[str] = Counter()
    region_counts: Counter[str] = Counter()
    for row in reader:
        quality["source_records"] += 1
        record_id = row["record_id"]
        if not record_id.isdigit() or record_id in identities:
            raise ValueError("Missing, malformed or repeated MACL record identity")
        identities.add(record_id)
        if None in row or any(value is None for value in row.values()):
            raise ValueError("Malformed MACL CSV record width")
        for name in NUMERIC_FIELDS:
            if not row[name].isdigit():
                raise ValueError(f"Passenger counts must be nonnegative integers: {name}")
        if row["region"] not in REGIONS:
            raise ValueError("Unexpected MACL region")
        if row["flight_type"] not in {"SCHEDULED", "CHARTER"}:
            raise ValueError("Unexpected MACL flight type")
        if row["aircraft_category"] not in {"Widebody", "Narrowbody", "Turboprop"}:
            raise ValueError("Unexpected MACL aircraft category")
        fingerprint = hashlib.sha256(
            json.dumps(
                [row[name] for name in FIELDS if name != "record_id"],
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode()
        ).digest()
        if fingerprint in content_hashes:
            quality["repeated_content_excluding_uid_retained"] += 1
        content_hashes.add(fingerprint)
        flight_types[row["flight_type"]] += 1
        aircraft_categories[row["aircraft_category"]] += 1
        region_counts[row["region"]] += 1
        if not row["carrier_code"]:
            quality["missing_carrier_code"] += 1
        for event, prefix, date_field, time_field in (
            ("arrival", "arr", "arrival_date", "ata"),
            ("departure", "dep", "dep_date", "atd"),
        ):
            adults, children, infants = (
                int(row[f"{prefix}_{cohort}"]) for cohort in ("adults", "children", "infants")
            )
            _add(raw[event], adults, children, infants)
            day = _date(row[date_field], quality, event)
            hour = _hour(row[time_field], quality, event)
            if day is None:
                quality[f"{event}_excluded_date_passengers"] += adults + children + infants
                continue
            month_key = (day.strftime("%Y-%m"), event, row["region"])
            _add(monthly[month_key], adults, children, infants)
            monthly_dates[month_key].add(day)
            _add(retained[f"{event}_monthly"], adults, children, infants)
            if hour is None:
                quality[f"{event}_excluded_hour_passengers"] += adults + children + infants
                continue
            hour_key = (day.year, hour, event, row["region"])
            _add(hourly[hour_key], adults, children, infants)
            hourly_dates[hour_key].add(day)
            _add(retained[f"{event}_hourly"], adults, children, infants)

    monthly_rows = [
        {
            "period": period,
            "year": int(period[:4]),
            "month": int(period[5:]),
            "event": event,
            "region": region,
            **dict(values),
            "observed_dates": len(monthly_dates[(period, event, region)]),
            "source_id": SOURCE_ID,
        }
        for (period, event, region), values in sorted(monthly.items())
    ]
    hourly_rows = [
        {
            "year": year,
            "hour": hour,
            "event": event,
            "region": region,
            **dict(values),
            "observed_dates": len(hourly_dates[(year, hour, event, region)]),
            "source_id": SOURCE_ID,
        }
        for (year, hour, event, region), values in sorted(hourly.items())
    ]
    for event in ("arrival", "departure"):
        for rows, grain in ((monthly_rows, "monthly"), (hourly_rows, "hourly")):
            for measure in ("movement_records", "passengers", "adults", "children", "infants"):
                assert (
                    sum(row[measure] for row in rows if row["event"] == event)
                    == (retained[f"{event}_{grain}"][measure])
                )
        assert raw[event]["passengers"] == (
            retained[f"{event}_monthly"]["passengers"]
            + quality[f"{event}_excluded_date_passengers"]
        )
        assert retained[f"{event}_monthly"]["passengers"] == (
            retained[f"{event}_hourly"]["passengers"] + quality[f"{event}_excluded_hour_passengers"]
        )
    return {
        "schemaVersion": 1,
        "version": "datathon-airport-v1:" + CSV_SHA256[:16],
        "transformationVersion": "independent-event-calendar-hour-v1",
        "sourceSnapshotDate": "2026-10-21",
        "sources": [
            {
                "id": SOURCE_ID,
                "title": "MACL airport traffic, official Maldives Datathon 2026 release v1.0",
                "publisher": "MACL; distributed by Maldives Bureau of Statistics",
                "url": ASSET_URL,
                "repository": REPOSITORY,
                "releaseUrl": RELEASE_URL,
                "referencePeriod": "2012-01-01 through 2026-07-31; 2026 is partial",
                "timezone": "Not stated in supplied metadata; source clock values retained",
                "licenseStatus": "Datathon participant dataset; archive has no explicit licence",
            }
        ],
        "sourceReceipts": [
            {"url": ASSET_URL, "sha256": ARCHIVE_SHA256, "bytes": len(archive_bytes)},
            {"archiveMember": CSV_MEMBER, "sha256": CSV_SHA256, "bytes": len(csv_bytes)},
            {
                "archiveMember": METADATA_MEMBER,
                "sha256": METADATA_SHA256,
                "bytes": len(metadata_bytes),
            },
        ],
        "hourly": hourly_rows,
        "monthly": monthly_rows,
        "coverage": {
            "records": quality["source_records"],
            "monthly_rows": len(monthly_rows),
            "hourly_rows": len(hourly_rows),
            "firstPeriod": "2012-01",
            "lastPeriod": "2026-07",
            "regions": sorted(region_counts),
            "flight_types": dict(flight_types),
            "aircraft_categories": dict(aircraft_categories),
            "eventTotals": {key: dict(value) for key, value in sorted(retained.items())},
        },
        "quality": {
            "counts": dict(sorted(quality.items())),
            "unique_record_ids": len(identities),
            "date_format": "M/D/YYYY; supplied metadata incorrectly specifies YYYY-MM-DD",
            "rawEventTotals": {key: dict(value) for key, value in sorted(raw.items())},
            "reconciled": True,
            "cancellation_status": "Not supplied; movement records are not a cancellation series",
        },
        "limitations": [
            "Historical airport activity is not current flight status, a timetable, unique "
            "travellers, bus mode share or local ground-transport demand.",
            "The source does not identify the clock timezone or provide a named airport/route "
            "code lookup. No island route, domestic sector or UTC conversion is inferred.",
            "Hourly rows use each arrival/departure event's own date and actual time. Missing, "
            "malformed and outside-period event dates are excluded; missing/malformed times "
            "are excluded from hourly rows but retained in monthly rows when the date is valid.",
            "1970 arrival dates are treated as invalid sentinels. The one 2011 arrival is outside "
            "the reviewed 2012–July 2026 reference period. No dates are borrowed across events.",
            "No turnaround or flight duration is inferred from the paired event dates. "
            "Negative and multi-day date differences have not been repaired.",
            "Five repeated records excluding their unique ID remain included because the "
            "archive does not establish whether these represent distinct events.",
            "Passengers sum adults, children and infants for the selected event. Transit "
            "counts are not added to arrival/departure passengers. Counts are movements.",
            "Observed dates count only dates with source records in that group; absent groups "
            "are not manufactured as zero service. 2026 covers January–July only.",
            "Keep this source separate from existing CAA/MBS totals: coverage has not been "
            "reconciled, and annual, monthly, hourly and cohort totals overlap.",
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "data/public/datathon/airport.json")
    args = parser.parse_args()
    artifact = prepare(args.archive)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(
        json.dumps(artifact, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary.replace(args.output)
    print(json.dumps({"coverage": artifact["coverage"], "quality": artifact["quality"]}, indent=2))
