"""Dated government health-license records, kept separate from current service access."""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from pypdf import PdfReader

VERSION = "government-health-license-context-v1"
AS_OF = "2024-12-31"
SOURCE_ID = "health-government2024"
MONTHS = {
    name: number
    for number, name in enumerate(
        (
            "january",
            "february",
            "march",
            "april",
            "may",
            "june",
            "july",
            "august",
            "september",
            "october",
            "november",
            "december",
        ),
        1,
    )
}


def _issued_date(published: str) -> str:
    match = re.fullmatch(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s*(\d{4})", published)
    if match is None or match[2].lower() not in MONTHS:
        raise ValueError(f"Unrecognized published license issue date: {published}")
    value = date(int(match[3]), MONTHS[match[2].lower()], int(match[1]))
    if value > date.fromisoformat(AS_OF):
        raise ValueError("License issue date is after the dated source registry")
    return value.isoformat()


def extract_government_licenses(path: Path) -> list[dict[str, Any]]:
    reader = PdfReader(path)
    if len(reader.pages) != 8:
        raise ValueError("Dated government license PDF pagination changed")
    rows = []
    for page_number, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ""
        if (
            "Quality Assurance and Regulation Division" not in text
            or "Ministry of Health" not in text
            or text.count("Last updated on 31.12.2024") != 1
        ):
            raise ValueError("Government license publisher or source date changed")
        body = text.split("Last updated on 31.12.2024", 1)[1].split("Page ")[0]
        body = body.replace(
            "No. Name of facility GOV level Registration Number Operating license no Issued date",
            "",
        ).replace("Operating Government Health Facilities", "")
        parts = re.split(r"(?m)^\s*(\d{1,3})(?:\s+|$)", body)
        if parts[0].strip() or len(parts) % 2 != 1:
            raise ValueError(f"Government license table row structure changed: page {page_number}")
        for number, content in zip(parts[1::2], parts[2::2], strict=True):
            published = " ".join(content.split())
            match = re.fullmatch(
                r"(.+?)\s+GOV\s+(.+?)\s+(HF[-/][\w/-]+)\s+(GOV-[\w-]+)\s+(.+)", published
            )
            if match is None:
                raise ValueError(f"Government license columns changed: row {number}")
            name, level, registration, license_number, issued = match.groups()
            rows.append(
                {
                    "id": f"health-government2024:{number}",
                    "name": name,
                    "ownership": "GOV",
                    "published_level": level,
                    "level_code": re.sub(r"\s+", "", level),
                    "registration_number": registration,
                    "operating_license_number": license_number,
                    "published_issued_date": issued,
                    "issued_date": _issued_date(issued),
                    "registry_as_of": AS_OF,
                    "record_type": "historical_government_operating_license",
                    "geography_grain": "named_facility_without_boundary_match",
                    "current_operation_verified": False,
                    "capacity_observed": False,
                    "facility_match_status": "not_attempted",
                    "source_id": SOURCE_ID,
                    "source_page": page_number,
                    "source_row": int(number),
                    "published_row_text": published,
                    "data_issues": [],
                    "qualification": "Government facility listed in the Ministry of Health "
                    "operating license register as at 31 December 2024. Published level, "
                    "registration, license and issue date are historical source fields. "
                    "No 2026 operation, opening hours, beds, staffing, appointments, "
                    "coordinates or travel demand are established.",
                }
            )
    if [row["source_row"] for row in rows] != list(range(1, 194)):
        raise ValueError("Expected complete consecutive government license source rows 1–193")
    registrations = Counter(row["registration_number"] for row in rows)
    licenses = Counter(row["operating_license_number"] for row in rows)
    for row in rows:
        if registrations[row["registration_number"]] > 1:
            row["data_issues"].append("duplicate_registration_number_in_published_source")
        if licenses[row["operating_license_number"]] > 1:
            row["data_issues"].append("duplicate_operating_license_number_in_published_source")
    return rows


def build_health_license_context(root: Path) -> dict[str, Any]:
    root = root.resolve()
    manifest = json.loads((root / "data/raw/source-manifest.json").read_text(encoding="utf-8"))
    source = next(item for item in manifest["sources"] if item["id"] == SOURCE_ID)
    path = root / "data/raw" / source["file"]
    content = path.read_bytes()
    receipt = {
        "path": path.relative_to(root).as_posix(),
        "sha256": hashlib.sha256(content).hexdigest(),
        "bytes": len(content),
    }
    if receipt["sha256"] != source["sha256"]:
        raise ValueError("Government license PDF checksum differs from captured manifest")
    rows = extract_government_licenses(path)
    fingerprint = hashlib.sha256(
        json.dumps(receipt, sort_keys=True).encode() + Path(__file__).read_bytes()
    ).hexdigest()[:16]
    return {
        "schemaVersion": 1,
        "transformVersion": VERSION,
        "version": f"{VERSION}:{fingerprint}",
        "generatedAt": datetime.now(UTC).isoformat(),
        "sources": [{**source, "receipt": receipt}],
        "sourceReceipts": [receipt],
        "licenses": rows,
        "coverage": {
            "registry_as_of": AS_OF,
            "source_pages": 8,
            "license_records": len(rows),
            "unique_registration_numbers": len({row["registration_number"] for row in rows}),
            "unique_operating_license_numbers": len(
                {row["operating_license_number"] for row in rows}
            ),
            "rows_with_published_duplicates": sum(bool(row["data_issues"]) for row in rows),
            "current_operation_verified_records": 0,
            "capacity_observed_records": 0,
            "facility_matches_attempted": 0,
        },
        "warnings": [
            "The source is a historical operating-government-facility license register dated "
            "31 December 2024, not a live service availability or capacity feed.",
            "Source spelling, level codes, registration and operating-license identifiers "
            "remain as published. Whitespace-only level normalization is explicit; ambiguous "
            "codes and source duplicate registrations have not been silently corrected.",
            "All 193 source rows are retained. A record count is not a current count of "
            "open facilities. No facility or island boundary join has been asserted.",
        ],
    }
