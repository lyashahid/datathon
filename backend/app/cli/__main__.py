"""Run backend CLI commands with ``python -m app.cli``."""

from __future__ import annotations

import sys

from app.cli.batch_review import main as batch_review_main
from app.cli.discovery import main
from app.cli.prewarm import main as prewarm_main

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "batch-review":
        raise SystemExit(batch_review_main(sys.argv[2:]))
    if len(sys.argv) > 1 and sys.argv[1] == "prewarm":
        raise SystemExit(prewarm_main(sys.argv[2:]))
    raise SystemExit(main(sys.argv[1:]))
