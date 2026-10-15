"""Conservative name normalization for deterministic matching."""

from __future__ import annotations

import re
import unicodedata


def normalize_name(value: str | None) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    normalized = normalized.casefold().replace("'", "")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return " ".join(normalized.split())


def normalize_atoll_code(value: str | None) -> str:
    return "".join((value or "").casefold().split())
