"""Refresh, rebuild, validate, and report backend readiness."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.cli.accessibility import build_accessibility_artifact
from app.cli.discovery import WORKSPACE_ROOT, run_discovery, write_report
from app.config.settings import Settings
from app.data.normalize.normalizer import NationalNormalizer
from app.data.validation import CacheValidator

SOURCE_NAMES = ["onemap", "mbs", "health", "education", "caa", "lga", "osm"]


def run_prewarm(
    settings: Settings,
    *,
    refresh_sources: bool = True,
    docs_dir: Path | None = None,
) -> dict[str, Any]:
    """Run the complete deterministic build while retaining phase diagnostics."""

    report: dict[str, Any] = {
        "version": "prewarm-v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "data_directory": str(settings.data_dir),
        "phases": {},
    }
    if refresh_sources:
        try:
            discovery = run_discovery(settings, SOURCE_NAMES)
            report["phases"]["source_refresh"] = {
                "status": "ok"
                if all(item["status"] == "ok" for item in discovery["sources"].values())
                else "warning",
                "sources": discovery["sources"],
            }
            write_report(discovery, docs_dir or WORKSPACE_ROOT / "docs")
        except Exception as error:
            report["phases"]["source_refresh"] = {
                "status": "error",
                "error_type": type(error).__name__,
                "error": str(error),
            }
    else:
        report["phases"]["source_refresh"] = {
            "status": "skipped",
            "message": "Using the last-known-good raw cache.",
        }

    try:
        report["phases"]["normalization"] = {
            "status": "ok",
            "result": NationalNormalizer(settings.data_dir).run(),
        }
    except Exception as error:
        report["phases"]["normalization"] = {
            "status": "error",
            "error_type": type(error).__name__,
            "error": str(error),
        }

    try:
        artifact = build_accessibility_artifact(settings.data_dir)
        report["phases"]["accessibility"] = {
            "status": "ok",
            "summary": artifact["summary"],
        }
    except Exception as error:
        report["phases"]["accessibility"] = {
            "status": "error",
            "error_type": type(error).__name__,
            "error": str(error),
        }

    validation = CacheValidator(settings.data_dir).validate()
    report["phases"]["cache_validation"] = validation
    phase_errors = [
        name
        for name, phase in report["phases"].items()
        if phase.get("status") == "error"
    ]
    if validation["status"] == "error":
        phase_errors.append("cache_validation")
    source_warning = report["phases"]["source_refresh"].get("status") == "warning"
    report["readiness"] = {
        "status": (
            "error"
            if phase_errors
            else "ready_with_source_warnings"
            if source_warning
            else "ready"
        ),
        "errors": sorted(set(phase_errors)),
        "source_refresh_warning": source_warning,
    }
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build and validate all backend artifacts")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Refresh all configured public sources before rebuilding artifacts.",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Skip source refresh and use the last-known-good raw cache.",
    )
    parser.add_argument("--data-dir", type=Path, default=None)
    parser.add_argument("--docs-dir", type=Path, default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = Settings(data_dir=args.data_dir) if args.data_dir else Settings()
    settings.ensure_data_directories()
    report = run_prewarm(
        settings,
        refresh_sources=args.all and not args.offline,
        docs_dir=args.docs_dir,
    )
    report_path = settings.data_dir / "metadata" / "prewarm-report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["readiness"]["status"] != "error" else 1


if __name__ == "__main__":
    raise SystemExit(main())
