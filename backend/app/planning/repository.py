"""Immutable public planning snapshot and explicit national identity reconciliation."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from app.planning.snapshot import ContentSnapshot

IDENTITY_BRIDGE = {
    "male": "island:1443",
    "hulhumale": "island:1442",
    "hulhule": "island:1483",
    "vilimale": "island:1382",
}


class PlanningRepository:
    @property
    def baseline(self) -> dict[str, Any]:
        return self._baseline_snapshot.value

    @baseline.setter
    def baseline(self, value: dict[str, Any]) -> None:
        self._baseline_snapshot = ContentSnapshot(value)

    def baseline_fingerprint(self) -> str:
        """Hash once per content revision, including nested in-process source edits."""
        return self._baseline_snapshot.fingerprint()

    def __init__(self, public_dir: Path) -> None:
        self.public_dir = public_dir
        self.baseline = self._read("planning-baseline.json", {})
        self.capital_population_basis = self.baseline.get("assumptions", {}).get(
            "populationSpatialDistribution"
        )
        self.national_population = self._read("national-population-origins.json", {})
        self.national_infrastructure = self._read("national-planning-infrastructure.json", {})
        self._extend_national_snapshot()
        self._extend_sea_snapshot()
        self.island_names = {
            IDENTITY_BRIDGE.get(island["id"], island["id"]): island.get("name") or island["id"]
            for island in self.baseline.get("islands", [])
        }
        self.calendars = self._read("policy-evidence/service-calendars.json", {})
        # Populated from the normalized, tag-aware terminal catalogue at startup.
        # Scenario operations reference these source identities; they cannot
        # introduce a free fictitious port through arbitrary coordinates.
        self.ferry_terminals: dict[str, dict[str, Any]] = {}
        self.receipts = []
        for name in (
            "planning-baseline.json",
            "national-population-origins.json",
            "national-planning-infrastructure.json",
            "island-context.json",
            "policy-evidence/service-calendars.json",
            "sea-services.json",
        ):
            path = public_dir / name
            if path.exists():
                self.receipts.append(
                    {
                        "path": f"data/public/{name}",
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "bytes": path.stat().st_size,
                    }
                )

    def _extend_sea_snapshot(self) -> None:
        from app.planning.sea_data import planning_patterns

        bundle = self._read("sea-services.json", {})
        terminals = {
            item["id"]: item
            for item in self._read("policy-evidence/ferry-terminals.json", {}).get("terminals", [])
        }
        stops, patterns = planning_patterns(bundle, terminals, self.planning_id)
        if not patterns:
            return
        transit = self.baseline.setdefault("transit", {})
        existing = {item["id"] for item in transit.setdefault("stops", [])}
        transit["stops"].extend(item for item in stops if item["id"] not in existing)
        existing = {item["id"] for item in transit.setdefault("patterns", [])}
        transit["patterns"].extend(item for item in patterns if item["id"] not in existing)
        existing = {item["id"] for item in self.baseline.setdefault("sources", [])}
        self.baseline["sources"].extend(
            item for item in bundle.get("sources", []) if item["id"] not in existing
        )

    def _extend_national_snapshot(self) -> None:
        """Append portable prepared evidence, preserving the calibrated capital model."""
        baseline = self.baseline
        population, infrastructure = self.national_population, self.national_infrastructure
        if not baseline or not population:
            return
        baseline.setdefault("islands", []).extend(population.get("islands", []))
        baseline.setdefault("origins", []).extend(population.get("origins", []))
        baseline.setdefault("facilities", []).extend(infrastructure.get("facilities", []))
        network = baseline.setdefault("network", {"nodes": [], "edges": []})
        for key in ("nodes", "edges"):
            network.setdefault(key, []).extend(infrastructure.get("network", {}).get(key, []))
        transit = baseline.setdefault("transit", {})
        for key in ("stops", "patterns", "routeCatalogues"):
            transit.setdefault(key, []).extend(infrastructure.get("transit", {}).get(key, []))
        source_ids = {s.get("id") for s in baseline.get("sources", [])}
        for source in population.get("sources", []) + infrastructure.get("sources", []):
            if source.get("id") not in source_ids:
                baseline.setdefault("sources", []).append(source)
                source_ids.add(source.get("id"))
        baseline["nationalCoverage"] = population.get("coverage", {})
        baseline.setdefault("assumptions", {})["populationSpatialDistribution"] = (
            "Official MBS 2026/2030 island projections allocated using the existing "
            "WorldPop alpha raster where screening passes, or explicitly approximate "
            "mapped residential footprints where it fails. Inspect each island's "
            "population basis. These are modeled distributions, not block census counts."
        )
        baseline["version"] = "+".join(
            str(value)
            for value in (
                baseline.get("version", "planning"),
                population.get("version", "national-population"),
                infrastructure.get("version", "national-infrastructure"),
            )
        )

    def population_basis(self, island_id: str | None = None, *, population_year: int = 2026) -> Any:
        scope = self.planning_id(island_id)
        if not scope and self.national_population:
            return {
                "spatial_method": "mixed_island_allocations",
                "spatial_quality": "mixed_including_coarse_assumption",
                "population_source": "Maldives Bureau of Statistics island projections 2022–2030",
                "population_year": population_year,
                "population_years": [2026, 2030],
                "qualification": self.baseline.get("assumptions", {}).get(
                    "populationSpatialDistribution"
                ),
                "warnings": [
                    "National results combine modeled raster and approximate "
                    "residential-footprint allocations. Inspect each island's evidence."
                ],
            }
        island = next((i for i in self.baseline.get("islands", []) if i["id"] == scope), {})
        basis = island.get("populationBasis")
        if basis:
            qualification = basis.get("qualification", "")
            return {
                **basis,
                "spatial_method": basis.get("method"),
                "spatial_quality": basis.get("spatialQuality"),
                "population_source": "Maldives Bureau of Statistics island projections 2022–2030",
                "population_year": population_year,
                "population_years": basis.get("years", [2026, 2030]),
                "warnings": [qualification] if qualification else [],
            }
        return self.capital_population_basis

    def evidence_coverage(self, island_id: str | None = None) -> dict[str, Any]:
        scope = self.planning_id(island_id)

        def scoped(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
            return [x for x in items if not scope or x.get("islandId") == scope]

        network = self.baseline.get("network", {})
        nodes = scoped(network.get("nodes", []))
        node_ids = {n["id"] for n in nodes}
        stops = scoped(self.baseline.get("transit", {}).get("stops", []))
        stop_ids = {s["id"] for s in stops}
        patterns = [
            p
            for p in self.baseline.get("transit", {}).get("patterns", [])
            if not scope or stop_ids.intersection(p.get("stopIds", []))
        ]
        facilities = scoped(self.baseline.get("facilities", []))
        basis = self.population_basis(island_id)
        warnings = list(basis.get("warnings", [])) if isinstance(basis, dict) else []
        if not nodes:
            warnings.append(
                "No captured walking network for this island; route access remains unknown."
            )
        if not patterns:
            warnings.append(
                "Mapped boarding points have no verified scheduled service in this snapshot."
            )
        return {
            "resident_origins": len(scoped(self.baseline.get("origins", []))),
            "walking_nodes": len(nodes),
            "walking_edges": sum(e["from"] in node_ids for e in network.get("edges", [])),
            "healthcare_destinations": sum(
                f.get("kind") in {"hospital", "clinic"}
                and f.get("careScope") == "general"
                and f.get("operatingStatus") == "open"
                for f in facilities
            ),
            "education_destinations": sum(
                f.get("kind") == "school" and f.get("operatingStatus") == "open" for f in facilities
            ),
            "transport_stops": len(stops),
            "scheduled_patterns": len(patterns),
            "timetable_status": "available" if patterns else "unavailable",
            "spatial_method": basis.get("spatial_method")
            if isinstance(basis, dict)
            else "worldpop_calibrated",
            "spatial_quality": basis.get("spatial_quality")
            if isinstance(basis, dict)
            else "modeled_distribution",
            "warnings": warnings,
        }

    def _read(self, name: str, fallback: Any) -> Any:
        path = self.public_dir / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback

    def planning_id(self, island_id: str | None) -> str | None:
        return next(
            (key for key, value in IDENTITY_BRIDGE.items() if value == island_id), island_id
        )

    def scope_world(self, world: dict[str, Any], island_id: str | None) -> dict[str, Any]:
        """Keep all connected transit islands without indexing unrelated atolls.

        The capital cluster retains its original complete network. New imported
        services can expand an island scope through their explicit stop IDs.
        Financial comparisons continue to use the complete world.
        """
        scope = self.planning_id(island_id)
        if not scope:
            return world
        scopes = set(IDENTITY_BRIDGE) if scope in IDENTITY_BRIDGE else {scope}
        stop_islands = {s["id"]: s.get("islandId") for s in world.get("stops", [])}
        changed = True
        while changed:
            before = len(scopes)
            for pattern in world.get("patterns", []):
                served = {stop_islands[s] for s in pattern.get("stopIds", []) if s in stop_islands}
                if scopes.intersection(served):
                    scopes.update(served)
            changed = len(scopes) != before
        network = world.get("network", {})
        nodes = [n for n in network.get("nodes", []) if n.get("islandId") in scopes]
        node_ids = {n["id"] for n in nodes}
        stops = [s for s in world.get("stops", []) if s.get("islandId") in scopes]
        stop_ids = {s["id"] for s in stops}
        return {
            **world,
            "network": {
                "nodes": nodes,
                "edges": [
                    e
                    for e in network.get("edges", [])
                    if e["from"] in node_ids and e["to"] in node_ids
                ],
            },
            "facilities": [f for f in world.get("facilities", []) if f.get("islandId") in scopes],
            "stops": stops,
            "patterns": [
                p for p in world.get("patterns", []) if stop_ids.intersection(p.get("stopIds", []))
            ],
        }

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
        coverage = self.evidence_coverage(island_id)
        return {
            "status": "partial" if in_scope and baseline else "outside_snapshot",
            "version": baseline.get("version"),
            "model_version": "fastapi-service-planning-1.0",
            "reference_date": baseline.get("referenceDate"),
            "source_snapshots": {
                "capital_service_date": baseline.get("referenceDate"),
                "national_infrastructure": self.national_infrastructure.get("sourceSnapshotDate"),
                "national_population_years": [2026, 2030] if self.national_population else [],
            },
            "timezone": "Indian/Maldives",
            "island_id": island_id,
            "planning_island_id": scope,
            "identity_bridge": IDENTITY_BRIDGE,
            "identity_bridge_method": (
                "Physical-island coordinates reconciled with national normalized polygons; "
                "Vilimalé corresponds to national Vilin'gili. No administrative-name-only join."
            ),
            "islands": [
                dict(x, national_island_id=IDENTITY_BRIDGE.get(x["id"], x["id"]))
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
                "nodes": coverage["walking_nodes"],
                "edges": coverage["walking_edges"],
            },
            "population_basis": self.population_basis(island_id),
            "coverage": coverage,
            "national_coverage": baseline.get("nationalCoverage", {}),
            "source_receipts": self.receipts,
            "sources": baseline.get("sources", []) + self.calendars.get("sources", []),
            "warnings": [
                "Resident weights are modeled spatial allocations normalized to official island "
                "projections. Inspect the island's allocation method; weights are "
                "not observed block residents or passenger demand.",
                *(
                    [
                        "Bus stop times are a dated remaining-departure snapshot "
                        "(10 October 2026), not a complete recurring or morning calendar."
                    ]
                    if any(pattern.get("mode") == "bus" for pattern in patterns)
                    else []
                ),
                "Ferry departure calendars are usable as timetables; routing requires explicit "
                "crossing durations and reconciled stop IDs.",
                "Hulhulé has no separate verified resident projection. Resort/industrial islands "
                "without a matched official island projection have no resident allocation.",
                "Destination capacity, admissions, staffing, current entrance and opening hours "
                "remain unverified unless supplied explicitly.",
            ]
            + coverage["warnings"],
        }
