"""Convert the retained official school PDF into portable, typed analysis records."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.data.school_context import build_school_context  # noqa: E402

if __name__ == "__main__":
    artifact = build_school_context(ROOT)
    destination = ROOT / "data/public/school-context.json"
    destination.write_text(
        json.dumps(artifact, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(json.dumps(artifact["coverage"], indent=2))
