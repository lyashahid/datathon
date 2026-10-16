"""Read the dated HDC land-use plan's published quantitative panels."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pdfplumber

SOURCE_ID = "hdc-landuse-plan-2025"
SOURCE_PATH = "data/public/archive/policy-evidence/hdc-landuse-plan.pdf"
EXPECTED_SHA256 = "49237f702b94aba82373a981af7da519877989652382faa9bcd17b3debdefcfc"
TRANSFORM = "hdc-landuse-plan-context-v1"


def build_hdc_plan_context(root: Path) -> dict[str, Any]:
    path = root / SOURCE_PATH
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    if checksum != EXPECTED_SHA256:
        raise ValueError("HDC plan capture changed; review its panels before conversion")
    manifest = json.loads((root / "data/public/policy-evidence/sources.json").read_text("utf-8"))
    source = next(row for row in manifest["sources"] if row["id"] == SOURCE_ID)
    rows: list[dict[str, Any]] = []

    def add(phase, metric, category, value, unit, section, bbox, is_total=False):
        rows.append(
            {
                "id": f"hdc:2025:{phase}:{metric}:{category}",
                "source_id": SOURCE_ID,
                "source_page": 1,
                "source_section": section,
                "source_bbox_points": list(bbox),
                "source_value": value,
                "plan_date": "2025-10-27",
                "plan_version": "Version 1",
                "locality": "Hulhumalé",
                "phase": phase,
                "geography_grain": "published_plan_phase",
                "metric": metric,
                "category": category,
                "value": value,
                "unit": unit,
                "is_total": is_total,
                "measure_type": "published_planning_context",
                "observed_current": False,
                "qualification": (
                    "Dated planning panel; not observed residents, completed housing "
                    "or occupied land."
                ),
            }
        )

    with pdfplumber.open(path) as document:
        if len(document.pages) != 1:
            raise ValueError("Expected one-page HDC plan")
        page = document.pages[0]
        text = page.extract_text() or ""
        if "MAP UPDATED: 27/10/2025" not in text or "MAP VERSION: Version 1" not in text:
            raise ValueError("Plan revision labels changed")
        capacity_box = (20, 365, 170, 500)
        panel = page.crop(capacity_box).extract_text() or ""
        values = re.findall(r"([\d,]+)\s+(\d+) ha", panel)
        if len(values) != 3:
            raise ValueError("Expected total and two phase capacity/area pairs")
        for phase, (capacity, area) in zip(["total", "phase_1", "phase_2"], values, strict=True):
            add(
                phase,
                "estimated_population_capacity",
                "all",
                int(capacity.replace(",", "")),
                "persons_planning_capacity",
                "Estimated population capacity",
                capacity_box,
                phase == "total",
            )
            add(
                phase,
                "plan_area",
                "all",
                int(area),
                "hectares",
                "Area",
                capacity_box,
                phase == "total",
            )
        for phase, box, expected_count in [
            ("phase_1", (128, 530, 195, 630), 14),
            ("phase_2", (128, 640, 195, 744), 15),
        ]:
            lines = (page.crop(box).extract_text(x_tolerance=1) or "").splitlines()
            if len(lines) != expected_count:
                raise ValueError(f"Unexpected {phase} legend length")
            for line in lines:
                match = re.fullmatch(r"(.+) (\d+\.\d+)%", line)
                if not match:
                    raise ValueError(f"Unrecognized land-use legend line: {line}")
                add(
                    phase,
                    "land_use_area_share",
                    match[1],
                    float(match[2]),
                    "percent",
                    "Landuse by area",
                    box,
                )
        housing_box = (15, 775, 182, 851)
        labels = sorted(
            [
                word
                for word in page.crop(housing_box).extract_words()
                if re.fullmatch(r"[\d,]+", word["text"])
            ],
            key=lambda item: item["x0"],
        )
        if len(labels) != 12:
            raise ValueError("Expected twelve housing-bar labels")
        for index, label in enumerate(labels):
            phase = ["phase_1", "phase_2", "total"][index // 4]
            category = ["Social", "Mid-Range", "Private", "High-End"][index % 4]
            add(
                phase,
                "housing_units",
                category,
                int(label["text"].replace(",", "")),
                "housing_units",
                "Housing units by type",
                housing_box,
                phase == "total",
            )
        lots_box = (20, 895, 180, 985)
        lots = (page.crop(lots_box).extract_text() or "").splitlines()[1:]
        if len(lots) != 4:
            raise ValueError("Expected four private-residential lot categories")
        for line in lots:
            match = re.fullmatch(r"(.+) (\d+)", line)
            if not match:
                raise ValueError(f"Unrecognized lot count: {line}")
            add(
                "not_separately_stated",
                "private_residential_lots",
                match[1],
                int(match[2]),
                "lots",
                "Private residential lots",
                lots_box,
            )

    def phase_values(metric: str, category: str = "all"):
        return {
            row["phase"]: row["value"]
            for row in rows
            if row["metric"] == metric and row["category"] == category
        }

    capacity = phase_values("estimated_population_capacity")
    issues = [
        {
            "kind": "published_capacity_total_conflict",
            "source_page": 1,
            "published_total": capacity["total"],
            "sum_of_published_phase_values": capacity["phase_1"] + capacity["phase_2"],
            "qualification": (
                "Both published values are preserved; no population correction is inferred."
            ),
        }
    ]
    if phase_values("plan_area")["total"] != sum(
        phase_values("plan_area")[phase] for phase in ["phase_1", "phase_2"]
    ):
        raise ValueError("Published phase areas do not reconcile")
    for category in ["Social", "Mid-Range", "Private", "High-End"]:
        values = phase_values("housing_units", category)
        if values["total"] != values["phase_1"] + values["phase_2"]:
            raise ValueError(f"Published housing totals do not reconcile: {category}")
    return {
        "schemaVersion": 1,
        "transformVersion": TRANSFORM,
        "version": TRANSFORM + ":" + checksum[:16],
        "sources": [source],
        "sourceReceipts": [{"path": SOURCE_PATH, "sha256": checksum, "bytes": path.stat().st_size}],
        "observations": rows,
        "qualityIssues": issues,
        "planRevision": {
            "updated": "2025-10-27",
            "version": "Version 1",
            "dataSource": "HDC Planning Division (October 2025)",
            "publisherPurpose": "planning and visualisation",
        },
        "coverage": {
            "published_cells": len(rows),
            "land_use_categories_by_phase": {"phase_1": 14, "phase_2": 15},
            "housing_type_cells": 12,
            "private_lot_categories": 4,
            "source_pages": 1,
        },
        "warnings": [
            "Plan capacity differs from official resident projections; it never changes "
            "resident allocation weights or totals.",
            "Totals overlap phase values. Percentages are not counts and may reflect rounding.",
            "The housing panel does not state completion, occupancy or household residence dates.",
            "Private-lot categories have no separate phase label; they are not forced to a phase.",
        ],
    }
