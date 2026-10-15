"""Acquire and summarize Phase 1 national data sources."""

from __future__ import annotations

import argparse
import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

from app.config.settings import Settings
from app.data.cache import FileCache
from app.data.http import PublicSourceClient
from app.data.providers.caa import CaaProvider
from app.data.providers.education import EducationProvider
from app.data.providers.hems import HemsProvider
from app.data.providers.lga import LgaProvider
from app.data.providers.mbs import MbsProvider
from app.data.providers.onemap import OneMapProvider
from app.data.providers.osm import OsmProvider

logger = logging.getLogger(__name__)
WORKSPACE_ROOT = Path(__file__).resolve().parents[3]

ACCESS_REVIEW = {
    "onemap": "Machine-readable ArcGIS REST JSON and paginated GeoJSON.",
    "mbs": "Direct XLSX download; parsed with openpyxl/pandas.",
    "health": (
        "Public server-rendered HTML with pagination; professionals JSON endpoint "
        "is optional enrichment."
    ),
    "education": "HTML directory plus public HTML school detail pages.",
    "caa": "HTML certification table plus direct PDF download.",
    "lga": "HTML council page plus XLSX export; current export is councilor-member data.",
    "osm": "Direct national PBF download; parsed locally with osmium.",
}

RECONCILIATION_REVIEW = {
    "osm_geometry_candidates": [
        "Health facilities without official coordinates",
        "Education schools without official coordinates",
        "Council facilities without usable official coordinates",
        "CAA aerodromes where official coordinates or geometry require matching",
        "OSM transport features requiring OneMap island assignment",
    ],
    "deferred_matching": [
        "MBS P3 uses atoll codes and locality names; reconciliation to OneMap is "
        "deferred to Phase 2.",
        "HEMS HTML records do not expose a structured island field in the discovery parser.",
        "Education detail fields require source-specific extraction and island "
        "reconciliation in Phase 2.",
        "LGA council facility identity requires a council registry source separate "
        "from the councilor export.",
        "CAA airport coordinates and OneMap island matching require normalization and review.",
    ],
    "automation_limits": [
        "No source required authentication or bypassing access controls during discovery.",
        "No low-confidence fuzzy match was automatically accepted.",
        "No live aircraft or vessel providers were queried in Phase 1.",
    ],
}


def run_discovery(settings: Settings, selected: list[str]) -> dict[str, Any]:
    cache = FileCache(settings.data_dir / "cache")
    client = PublicSourceClient()
    providers: dict[str, Callable[[], dict[str, Any]]] = {
        "onemap": lambda: OneMapProvider(cache, client).discover(),
        "mbs": lambda: MbsProvider(cache, client).discover(),
        "health": lambda: HemsProvider(cache, client).discover(),
        "education": lambda: EducationProvider(cache, client).discover(),
        "caa": lambda: CaaProvider(cache, client).discover(),
        "lga": lambda: LgaProvider(cache, client).discover(),
        "osm": lambda: OsmProvider(cache, client).discover(),
    }
    report: dict[str, Any] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "population_scope": "P3 only",
        "cache_directory": str(settings.data_dir / "cache"),
        "access_review": ACCESS_REVIEW,
        "reconciliation_review": RECONCILIATION_REVIEW,
        "sources": {},
    }
    try:
        for name in selected:
            logger.info("Discovering source: %s", name)
            try:
                report["sources"][name] = {"status": "ok", "result": providers[name]()}
            except Exception as exc:  # continue to produce a complete discovery report
                logger.exception("Discovery failed for %s", name)
                report["sources"][name] = {
                    "status": "error",
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                }
    finally:
        client.close()
    return report


def write_report(report: dict[str, Any], output_dir: Path) -> None:
    report.setdefault("access_review", ACCESS_REVIEW)
    report.setdefault("reconciliation_review", RECONCILIATION_REVIEW)
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "data-discovery.json"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    lines = [
        "# Mobility Sandbox MV — Phase 1 Data Discovery",
        "",
        f"Generated: `{report['generated_at']}`",
        "",
        "Population scope: **MBS Census 2022 P3 only**.",
        "",
        "| Source | Status | Result |",
        "|---|---|---|",
    ]
    for name, entry in report["sources"].items():
        if entry["status"] == "ok":
            result = _result_summary(entry["result"])
        else:
            result = entry["error"].replace("|", "\\|")
        lines.append(f"| {name} | {entry['status']} | {result} |")
    lines.extend(
        [
            "",
            "## Interpretation rules",
            "",
            "- This phase acquires raw sources and reports what is available.",
            "- It does not normalize names or merge official records with OSM yet.",
            "- Official identity and statistics remain authoritative.",
            "- Unmatched and ambiguous records are not silently discarded.",
            "- OSM is acquired from the national PBF; it is not a runtime bulk-query dependency.",
            "",
            "## Source access review",
            "",
        ]
    )
    for source, description in report["access_review"].items():
        lines.append(f"- **{source}:** {description}")
    lines.extend(["", "## Reconciliation and unresolved-data review", ""])
    lines.append("### Records expected to need OSM geometry or spatial assignment")
    lines.extend(f"- {item}" for item in report["reconciliation_review"]["osm_geometry_candidates"])
    lines.append("")
    lines.append("### Deferred matching")
    lines.extend(f"- {item}" for item in report["reconciliation_review"]["deferred_matching"])
    lines.append("")
    lines.append("### Automation limits")
    lines.extend(f"- {item}" for item in report["reconciliation_review"]["automation_limits"])
    (output_dir / "data-discovery.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _result_summary(result: dict[str, Any]) -> str:
    for key in (
        "feature_count",
        "record_count",
        "detail_pages_fetched",
        "html_table_record_count",
        "file_size_bytes",
    ):
        if key in result:
            return f"{key}={result[key]}"
    return "completed"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Acquire and inspect Phase 1 data sources")
    parser.add_argument(
        "--source",
        action="append",
        choices=["onemap", "mbs", "health", "education", "caa", "lga", "osm"],
        help="Run only this source; repeat for multiple sources. Defaults to all.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=WORKSPACE_ROOT / "docs",
        help="Directory for data-discovery.md and data-discovery.json.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = Settings()
    settings.ensure_data_directories()
    selected = args.source or ["onemap", "mbs", "health", "education", "caa", "lga", "osm"]
    report = run_discovery(settings, selected)
    write_report(report, args.output_dir)
    failed = [name for name, entry in report["sources"].items() if entry["status"] != "ok"]
    if failed:
        logger.error("Discovery completed with failures: %s", ", ".join(failed))
        return 1
    logger.info("Discovery report written to %s", args.output_dir)
    return 0
