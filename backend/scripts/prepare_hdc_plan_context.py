"""Convert the captured official HDC plan panels; no downloads."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data.hdc_plan_context import build_hdc_plan_context  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


if __name__ == "__main__":
    result = build_hdc_plan_context(ROOT)
    target = ROOT / "data/public/hdc-plan-context.json"
    target.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n", "utf-8")
    print(json.dumps(result["coverage"], indent=2))
