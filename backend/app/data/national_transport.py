"""Adapt prepared national boarding points to the national evidence view in memory."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

CAPITAL_ISLAND_IDS = {"island:1443", "island:1442", "island:1483", "island:1382"}
NATIONAL_TRANSPORT_ARTIFACT = "national-planning-infrastructure.json"


def merge_national_boarding_points(
    existing: list[dict[str, Any]], national: dict[str, Any]
) -> list[dict[str, Any]]:
    """Preserve captured records; add only valid, identified, noncapital bus/ferry points."""
    result = list(existing)
    identifiers = {row.get("id") for row in existing}
    operator_keys = {
        (row.get("island_id"), str(row.get("operator_code") or row.get("operatorCode")))
        for row in existing
        if row.get("operator_code") or row.get("operatorCode")
    }
    for stop in national.get("transit", {}).get("stops", []):
        island_id = stop.get("islandId")
        stop_id = stop.get("id")
        mode = stop.get("mode")
        coordinate = stop.get("coordinate")
        operator_code = stop.get("operatorCode")
        operator_key = (island_id, str(operator_code))
        if (
            not stop_id
            or stop_id in identifiers
            or not island_id
            or island_id in CAPITAL_ISLAND_IDS
            or mode not in {"bus", "ferry"}
            or not isinstance(coordinate, list)
            or len(coordinate) != 2
            or any(
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not math.isfinite(value)
                for value in coordinate
            )
            or not -180 <= coordinate[0] <= 180
            or not -90 <= coordinate[1] <= 90
            or operator_code is not None
            and operator_key in operator_keys
        ):
            continue
        result.append(
            {
                "id": stop_id,
                "island_id": island_id,
                "name": stop.get("name"),
                "category": "bus_stop" if mode == "bus" else "ferry_terminal",
                "geometry": {"type": "Point", "coordinates": coordinate},
                "source_ids": stop.get("sourceIds", []),
                "source": (
                    "RTL official boarding-point catalogue"
                    if stop.get("verification") == "operator-published"
                    else "OpenStreetMap"
                ),
                "source_id": operator_code or stop_id,
                "source_artifact": f"data/public/{NATIONAL_TRANSPORT_ARTIFACT}",
                "operator_code": operator_code,
                "verification": stop.get("verification"),
                "timetable_status": stop.get("timetableStatus", "unavailable"),
                "physical_operating_status": stop.get("physicalOperatingStatus", "unverified"),
                "qualification": stop.get("qualification")
                or "Published boarding point; current operation and timetable remain unverified.",
                "tags": {"bus": "yes"} if mode == "bus" else {"ferry": "yes"},
            }
        )
        identifiers.add(stop_id)
        if operator_code is not None:
            operator_keys.add(operator_key)
    return result


def national_transport_path(public_dir: Path) -> Path:
    return public_dir / NATIONAL_TRANSPORT_ARTIFACT
