"""Shared eligibility rules for scored facility evidence and displayed counts."""

from __future__ import annotations

from collections.abc import Collection
from typing import Any


def scored_facilities(
    facilities: list[dict[str, Any]], categories: Collection[str]
) -> list[dict[str, Any]]:
    return [
        facility
        for facility in facilities
        if facility.get("category") in categories
        and bool((facility.get("geometry") or {}).get("coordinates"))
        and facility.get("geometry_quality") != "island_context_only"
        and facility.get("match_status")
        not in {"osm_provisional_review_required", "island_context_only"}
    ]
