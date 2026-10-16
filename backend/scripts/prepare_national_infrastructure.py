"""Rebuild the portable national planning network from acquired project sources."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.planning.national_infrastructure import prepare  # noqa: E402

if __name__ == "__main__":
    artifact = prepare(ROOT)
    destination = ROOT / "data/public/national-planning-infrastructure.json"
    destination.write_text(
        json.dumps(artifact, ensure_ascii=False, allow_nan=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(json.dumps(artifact["coverage"], indent=2))
