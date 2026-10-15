"""Resolve shared public planning artifacts without writing to source directories."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

from app.config.settings import BACKEND_ROOT, backend_path


def public_data_directory(settings: Any = None) -> Path:
    configured = getattr(settings, "public_data_dir", None) if settings else None
    configured = configured or os.environ.get("MOBILITY_PUBLIC_DATA_DIR")
    return backend_path(configured) if configured else BACKEND_ROOT.parent / "data" / "public"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def file_receipt(path: Path, public_dir: Path) -> dict[str, Any]:
    content = path.read_bytes()
    return {
        "artifact": path.relative_to(public_dir).as_posix(),
        "sha256": hashlib.sha256(content).hexdigest(),
        "bytes": len(content),
        "data_status": "checked_snapshot",
    }
