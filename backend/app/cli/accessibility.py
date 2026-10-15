"""Precompute the default configurable accessibility scores."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.accessibility.service import AccessibilityService
from app.config.settings import Settings
from app.data.cache import FileCache
from app.routing.engine import RoutingRepository


def build_accessibility_artifact(data_dir: Path) -> dict[str, object]:
    routing = RoutingRepository(data_dir)
    routing.reload()
    service = AccessibilityService(data_dir, routing)
    service.reload()
    result = service.score_national()
    FileCache(data_dir / "cache").write_json(
        "derived/accessibility-default.json",
        result,
        source="Mobility Sandbox default accessibility scores",
        endpoint="local derived output",
        parser_version="accessibility-v1",
    )
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Precompute accessibility scores")
    parser.add_argument("--data-dir", type=Path, default=None)
    args = parser.parse_args(argv)
    settings = Settings(data_dir=args.data_dir) if args.data_dir else Settings()
    settings.ensure_data_directories()
    result = build_accessibility_artifact(settings.data_dir)
    print(json.dumps(result["summary"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
