"""Immutable public planning snapshot and explicit national identity reconciliation."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

IDENTITY_BRIDGE = {
    "male": "island:1443",
    "hulhumale": "island:1442",
    "hulhule": "island:1483",
    "vilimale": "island:1382",
}


class PlanningRepository:
    def __init__(self, public_dir: Path) -> None:
        self.public_dir = public_dir
        self.baseline = self._read("planning-baseline.json", {})
        self.calendars = self._read("policy-evidence/service-calendars.json", {})
        self.receipts = []
        for name in ("planning-baseline.json", "policy-evidence/service-calendars.json"):
            path = public_dir / name
            if path.exists():
                self.receipts.append(
                    {
                        "path": f"data/public/{name}",
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "bytes": path.stat().st_size,
                    }
                )

    def _read(self, name: str, fallback: Any) -> Any:
        path = self.public_dir / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback

    def planning_id(self, island_id: str | None) -> str | None:
        return next(
            (key for key, value in IDENTITY_BRIDGE.items() if value == island_id), island_id
        )

    def summary(self, island_id: str | None = None) -> dict[str, Any]:
        from app.planning.models import PlanningAssumptions

        scope = self.planning_id(island_id)
        baseline = self.baseline
        islands = baseline.get("islands", [])
        in_scope = not scope or any(island["id"] == scope for island in islands)

        def scoped(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
            return [x for x in items if not scope or x.get("islandId") == scope]

        stops = scoped(baseline.get("transit", {}).get("stops", []))
        stop_ids = {stop["id"] for stop in stops}
        patterns = [
            p
            for p in baseline.get("transit", {}).get("patterns", [])
            if not scope or stop_ids.intersection(p["stopIds"])
        ]
        origins = scoped(baseline.get("origins", []))
        return {
            "status": "partial" if in_scope and baseline else "outside_snapshot",
            "version": baseline.get("version"),
            "model_version": "fastapi-service-planning-1.0",
            "reference_date": baseline.get("referenceDate"),
            "timezone": "Indian/Maldives",
            "island_id": island_id,
            "planning_island_id": scope,
            "identity_bridge": IDENTITY_BRIDGE,
            "identity_bridge_method": (
                "Physical-island coordinates reconciled with national normalized polygons; "
                "Vilimalé corresponds to national Vilin'gili. No administrative-name-only join."
            ),
            "islands": [
                dict(x, national_island_id=IDENTITY_BRIDGE.get(x["id"]))
                for x in islands
                if not scope or x["id"] == scope
            ],
            "origins": [
                {k: v for k, v in x.items() if k not in {"geometry", "bounds"}} for x in origins
            ],
            "facilities": scoped(baseline.get("facilities", [])),
            "stops": stops,
            "patterns": patterns,
            "service_calendars": self.calendars.get("calendars", []),
            "defaults": PlanningAssumptions().model_dump(mode="json"),
            "counts": {
                "origins": len(origins),
                "facilities": len(scoped(baseline.get("facilities", []))),
                "stops": len(stops),
                "patterns": len(patterns),
                "nodes": len(baseline.get("network", {}).get("nodes", [])),
                "edges": len(baseline.get("network", {}).get("edges", [])),
            },
            "population_basis": baseline.get("assumptions", {}).get(
                "populationSpatialDistribution"
            ),
            "source_receipts": self.receipts,
            "sources": baseline.get("sources", []) + self.calendars.get("sources", []),
            "warnings": [
                "Resident weights are WorldPop alpha allocations normalized to official island "
                "projections, not observed block residents or passenger demand.",
                "Bus stop times are a dated remaining-departure snapshot (10 October 2026), "
                "not a complete recurring or morning calendar.",
                "Ferry departure calendars are usable as timetables; routing requires explicit "
                "crossing durations and reconciled stop IDs.",
                "No population allocation is fabricated outside Greater Malé or for Hulhulé's "
                "unavailable separate projection.",
                "Destination capacity, admissions, staffing, current entrance and opening hours "
                "remain unverified unless supplied explicitly.",
            ],
        }
