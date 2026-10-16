"""Convert the pinned official monthly workbook; --download reacquires its original bytes."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.data.transport_context import URL, prepare  # noqa: E402

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    if args.download:
        import httpx

        response = httpx.get(URL, follow_redirects=True, timeout=60)
        response.raise_for_status()
        (ROOT / "data/raw/mbs-monthly-june2026.xlsx").write_bytes(response.content)
    artifact = prepare(ROOT)
    (ROOT / "data/public/transport-context.json").write_text(
        json.dumps(artifact, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(artifact["coverage"], indent=2))
