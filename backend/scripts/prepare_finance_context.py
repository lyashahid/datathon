"""Convert pinned local official finance captures into a portable context artifact."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data.finance_context import build_finance_context  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


if __name__ == "__main__":
    result = build_finance_context(ROOT)
    output = ROOT / "data/public/official-finance-context.json"
    output.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    print(json.dumps(result["coverage"], indent=2))
    print(f"Wrote {output}")
