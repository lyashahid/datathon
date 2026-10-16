"""Build official nationwide island context from the captured original workbooks.

Run from backend with ``python -m app.cli.island_context``. Raw evidence is read
only. The generated JSON is sufficient for application use without XLSX inputs.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.data.island_context import build_island_context


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    bundle = build_island_context(args.root)
    destination = args.output or args.root / "data" / "public" / "island-context.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(bundle, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(destination), **bundle["coverage"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
