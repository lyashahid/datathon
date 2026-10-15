"""Run Phase 2 normalization against the local raw cache."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.config.settings import Settings
from app.data.normalize.normalizer import NationalNormalizer


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Normalize the cached national data")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=None,
        help="Override the backend data directory.",
    )
    args = parser.parse_args(argv)
    settings = Settings(data_dir=args.data_dir) if args.data_dir else Settings()
    settings.ensure_data_directories()
    result = NationalNormalizer(settings.data_dir).run()
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
