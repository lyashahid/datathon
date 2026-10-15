"""Small geometry helpers used during normalization."""

from __future__ import annotations

import re
from typing import Any


def parse_coordinate(value: Any) -> float | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    try:
        return float(text)
    except ValueError:
        pass
    numbers = re.findall(r"[-+]?\d+(?:\.\d+)?", text)
    if len(numbers) < 3:
        return None
    degrees, minutes, seconds = (float(number) for number in numbers[:3])
    if not (0 <= minutes < 60 and 0 <= seconds < 60):
        return None
    result = abs(degrees) + minutes / 60 + seconds / 3600
    if any(direction in text.upper() for direction in ("S", "W")):
        result *= -1
    return result


def point_geometry(longitude: float | None, latitude: float | None) -> dict[str, Any] | None:
    if longitude is None or latitude is None:
        return None
    return {"type": "Point", "coordinates": [longitude, latitude]}
