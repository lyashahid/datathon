"""Deep recommendation module: generate, simulate, and rank planning candidates."""

from __future__ import annotations

import itertools
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

from app.accessibility.service import AccessibilityService
from app.data.cache import FileCache
from app.recommendation.models import RecommendationConfig, RecommendationType
from app.simulation.engine import ScenarioEngine
from app.simulation.models import Scenario, ScenarioOperation


class RecommendationService:
    """Produce deterministic planning-screening recommendations from static data."""

    def __init__(
        self,
        data_dir: Path,
        simulation: ScenarioEngine,
        accessibility: AccessibilityService,
    ) -> None:
        self.cache = FileCache(data_dir / "cache")
        self.simulation = simulation
        self.accessibility = accessibility
        self.islands: dict[str, dict[str, Any]] = {}
        self.facilities: list[dict[str, Any]] = []
        self.transport: list[dict[str, Any]] = []
        self.baseline_scores: dict[str, dict[str, Any]] = {}

    def reload(self) -> None:
        island_data = self._read_json("normalized/islands.geojson", {"features": []})
        self.islands = {
            feature["properties"]["id"]: feature
            for feature in island_data.get("features", [])
            if feature.get("properties", {}).get("id")
        }
        self.facilities = self._read_json("normalized/facilities.json", [])
        transport_data = self._read_json("normalized/transport.json", {"features": []})
        self.transport = transport_data.get("features", [])
        artifact = self.accessibility.default_artifact()
        self.baseline_scores = {
            item["island_id"]: item
            for item in artifact.get("scores", [])
            if item.get("island_id")
        }

    def recommend(
        self,
        recommendation_type: RecommendationType,
        *,
        island_id: str | None = None,
        limit: int = 10,
        config: RecommendationConfig | None = None,
    ) -> dict[str, Any]:
        policy = config or RecommendationConfig()
        island_ids = self._selected_islands(island_id)
        candidates = self._generate(recommendation_type, island_ids, policy)
        ranked = [self._simulate_and_rank(candidate, policy) for candidate in candidates]
        ranked.sort(
            key=lambda item: (-item["score"], item["id"]),
        )
        results = ranked[:limit]
        return {
            "version": "recommendations-v1",
            "recommendation_type": recommendation_type,
            "config": policy.model_dump(mode="json"),
            "recommendations": results,
            "summary": {
                "candidate_count": len(candidates),
                "returned_count": len(results),
                "island_scope": island_id,
                "planning_screening_only": True,
            },
        }

    def _selected_islands(self, island_id: str | None) -> list[str]:
        if island_id:
            return [island_id] if island_id in self.islands else []
        return sorted(self.islands)

    def _generate(
        self,
        recommendation_type: RecommendationType,
        island_ids: list[str],
        policy: RecommendationConfig,
    ) -> list[dict[str, Any]]:
        generators = {
            "underserved_island": self._underserved_islands,
            "bus_stop": self._bus_stops,
            "ferry_terminal": self._ferry_terminals,
            "ferry_route": self._ferry_routes,
            "parking": self._parking,
            "mobility_hub": self._mobility_hubs,
            "pedestrian": self._pedestrian_connections,
            "airport_access": self._airport_access,
        }
        return generators[recommendation_type](island_ids, policy.max_candidates)

    def _underserved_islands(
        self, island_ids: list[str], max_candidates: int
    ) -> list[dict[str, Any]]:
        candidates = []
        for island_id in island_ids:
            baseline = self._baseline(island_id)
            need = round(max(0.0, 100.0 - baseline["score"]), 2)
            candidates.append(
                self._candidate(
                    recommendation_id=f"underserved:{island_id}",
                    recommendation_type="underserved_island",
                    island_id=island_id,
                    coordinates=self._centroid(island_id),
                    scenario=Scenario(
                        id=f"recommendation:underserved:{island_id}",
                        name=f"Prioritize underserved island {island_id}",
                    ),
                    expected_benefit=need,
                    confidence=baseline["confidence"],
                    reason=(
                        f"The baseline accessibility score is {baseline['score']:.2f}/100; "
                        "this island has the largest unmet access opportunity."
                    ),
                    trade_offs=["Does not identify a preferred intervention by itself."],
                    assumptions=[
                        "Baseline accessibility data is representative of current static coverage."
                    ],
                    disclaimer="Planning-screening priority; not a funded project recommendation.",
                )
            )
        return sorted(candidates, key=lambda item: (-item["expected_benefit"], item["id"]))[
            :max_candidates
        ]

    def _bus_stops(self, island_ids: list[str], max_candidates: int) -> list[dict[str, Any]]:
        candidates = []
        for island_id in island_ids:
            if self._has_transport(island_id, {"bus_stop", "bus_station"}):
                continue
            coordinates = self._centroid(island_id)
            if not coordinates:
                continue
            operation = ScenarioOperation(
                type="add_bus_stop", island_id=island_id, coordinates=tuple(coordinates)
            )
            candidates.append(
                self._candidate(
                    recommendation_id=f"bus-stop:{island_id}",
                    recommendation_type="bus_stop",
                    island_id=island_id,
                    coordinates=coordinates,
                    scenario=self._scenario("bus-stop", island_id, operation),
                    expected_benefit=self._transport_gap(island_id, "bus"),
                    confidence=self._island_confidence(island_id, geometry=True),
                    reason="No mapped bus stop or bus station is present on this island.",
                    trade_offs=[
                        "Requires route design, operating resources, and demand validation."
                    ],
                    assumptions=[
                        "The island centroid is a screening location, not a final stop site."
                    ],
                    disclaimer=(
                        "Planning-screening location; engineering and service planning "
                        "are required."
                    ),
                )
            )
        return candidates[:max_candidates]

    def _ferry_terminals(
        self, island_ids: list[str], max_candidates: int
    ) -> list[dict[str, Any]]:
        candidates = []
        for island_id in island_ids:
            if self._marine_nodes(island_id):
                continue
            coordinates = self._centroid(island_id)
            if not coordinates:
                continue
            operation = ScenarioOperation(
                type="add_ferry_terminal",
                island_id=island_id,
                coordinates=tuple(coordinates),
            )
            candidates.append(
                self._candidate(
                    recommendation_id=f"ferry-terminal:{island_id}",
                    recommendation_type="ferry_terminal",
                    island_id=island_id,
                    coordinates=coordinates,
                    scenario=self._scenario("ferry-terminal", island_id, operation),
                    expected_benefit=round(self._transport_gap(island_id, "ferry") * 0.5, 2),
                    confidence=round(self._island_confidence(island_id, geometry=True) * 0.35, 3),
                    reason="No mapped ferry terminal or pier is present on this island.",
                    trade_offs=["A terminal alone does not establish a passenger service."],
                    assumptions=["A marine connection and verified operator would be required."],
                    disclaimer=(
                        "Planning-screening candidate; OSM geometry does not verify "
                        "passenger service."
                    ),
                )
            )
        return candidates[:max_candidates]

    def _ferry_routes(
        self, island_ids: list[str], max_candidates: int
    ) -> list[dict[str, Any]]:
        nodes_by_island: dict[str, list[dict[str, Any]]] = defaultdict(list)
        selected = set(island_ids)
        for node in self.simulation.routing.marine.get("nodes", []):
            if node.get("category") not in {"ferry_terminal", "pier"}:
                continue
            if node.get("island_id") in selected:
                nodes_by_island[node["island_id"]].append(node)
        pairs = []
        for first_id, second_id in itertools.combinations(sorted(nodes_by_island), 2):
            first = nodes_by_island[first_id][0]
            second = nodes_by_island[second_id][0]
            if _has_direct_edge(
                self.simulation.routing.marine.get("edges", []),
                first["id"],
                second["id"],
            ):
                continue
            distance = _distance_m(first["coordinates"], second["coordinates"])
            pairs.append((distance, first_id, second_id, first, second))
        pairs.sort(key=lambda item: (item[0], item[1], item[2]))
        candidates = []
        for distance, first_id, second_id, first, second in pairs[:max_candidates]:
            operation = ScenarioOperation(
                type="add_ferry_route",
                from_node_id=first["id"],
                to_node_id=second["id"],
                distance_m=distance,
                passenger_eligible=True,
            )
            need = (self._island_need(first_id) + self._island_need(second_id)) / 2
            candidates.append(
                self._candidate(
                    recommendation_id=f"ferry-route:{first_id}:{second_id}",
                    recommendation_type="ferry_route",
                    island_id=first_id,
                    coordinates=_midpoint(first["coordinates"], second["coordinates"]),
                    scenario=self._scenario(
                        "ferry-route", f"{first_id}-{second_id}", operation
                    ),
                    expected_benefit=round(min(100.0, need * 0.65 + _distance_bonus(distance)), 2),
                    confidence=0.3,
                    reason=f"Connects mapped marine access on {first_id} and {second_id}.",
                     trade_offs=[
                         "Requires vessel, schedule, safety, and passenger-demand validation."
                     ],
                    assumptions=["The proposed endpoints can support a safe passenger landing."],
                    disclaimer="Planning-screening route; passenger service is not verified.",
                )
            )
        return candidates

    def _parking(self, island_ids: list[str], max_candidates: int) -> list[dict[str, Any]]:
        candidates = []
        for island_id in island_ids:
            if self._has_transport(island_id, {"parking"}):
                continue
            if island_id not in self.simulation.routing.land.get("islands", {}):
                continue
            coordinates = self._centroid(island_id)
            if not coordinates:
                continue
            operation = ScenarioOperation(
                type="add_parking", island_id=island_id, coordinates=tuple(coordinates)
            )
            has_gateway = bool(self._facilities(island_id, {"airport"})) or bool(
                self._has_transport(island_id, {"bus_stop", "bus_station"})
            )
            candidates.append(
                self._candidate(
                    recommendation_id=f"parking:{island_id}",
                    recommendation_type="parking",
                    island_id=island_id,
                    coordinates=coordinates,
                    scenario=self._scenario("parking", island_id, operation),
                    expected_benefit=45.0 if has_gateway else 25.0,
                    confidence=self._island_confidence(island_id, geometry=True),
                    reason="No mapped parking feature is available near the island access network.",
                    trade_offs=["Land use, cost, and induced vehicle demand require assessment."],
                    assumptions=["The centroid is only a search-area proxy."],
                     disclaimer=(
                         "Planning-screening search area; no parcel suitability was assessed."
                     ),
                )
            )
        return candidates[:max_candidates]

    def _mobility_hubs(
        self, island_ids: list[str], max_candidates: int
    ) -> list[dict[str, Any]]:
        candidates = []
        for island_id in island_ids:
            if self._has_transport(island_id, {"mobility_hub"}):
                continue
            gateway_count = sum(
                (
                    bool(self._facilities(island_id, {"airport"})),
                    bool(self._has_transport(island_id, {"bus_stop", "bus_station"})),
                    bool(self._marine_nodes(island_id)),
                )
            )
            if gateway_count < 2:
                continue
            coordinates = self._centroid(island_id)
            if not coordinates:
                continue
            operation = ScenarioOperation(
                type="add_mobility_hub", island_id=island_id, coordinates=tuple(coordinates)
            )
            candidates.append(
                self._candidate(
                    recommendation_id=f"mobility-hub:{island_id}",
                    recommendation_type="mobility_hub",
                    island_id=island_id,
                    coordinates=coordinates,
                    scenario=self._scenario("mobility-hub", island_id, operation),
                    expected_benefit=60.0,
                    confidence=self._island_confidence(island_id, geometry=True),
                    reason=(
                        f"The island already has {gateway_count} mapped gateway types "
                        "to coordinate."
                    ),
                    trade_offs=[
                        "Hub design, land availability, and operating integration are unresolved."
                    ],
                    assumptions=["Existing gateway features are spatially compatible."],
                    disclaimer=(
                        "Planning-screening candidate; no site or operating design was assessed."
                    ),
                )
            )
        return candidates[:max_candidates]

    def _pedestrian_connections(
        self, island_ids: list[str], max_candidates: int
    ) -> list[dict[str, Any]]:
        candidates = []
        for island_id in island_ids:
            graph = self.simulation.routing.land.get("islands", {}).get(island_id)
            if not graph or len(graph.get("nodes", [])) < 2:
                continue
            nodes = sorted(graph["nodes"], key=lambda item: item["id"])
            first, second = nodes[0], nodes[-1]
            if _has_direct_edge(graph.get("edges", []), first["id"], second["id"]):
                continue
            operation = ScenarioOperation(
                type="pedestrian_connection",
                island_id=island_id,
                from_node_id=first["id"],
                to_node_id=second["id"],
            )
            candidates.append(
                self._candidate(
                    recommendation_id=f"pedestrian:{island_id}:{first['id']}:{second['id']}",
                    recommendation_type="pedestrian",
                    island_id=island_id,
                    coordinates=_midpoint(first["coordinates"], second["coordinates"]),
                    scenario=self._scenario("pedestrian", island_id, operation),
                    expected_benefit=40.0,
                    confidence=0.5,
                    reason=(
                        "The land graph has separated pedestrian endpoints without "
                        "a direct connection."
                    ),
                    trade_offs=[
                        "The proposed straight connection requires feasibility and safety review."
                    ],
                    assumptions=[
                        "Both graph endpoints are accessible and suitable for a pedestrian link."
                    ],
                    disclaimer=(
                        "Planning-screening connection; no right-of-way or engineering "
                        "review was performed."
                    ),
                )
            )
        return candidates[:max_candidates]

    def _airport_access(
        self, island_ids: list[str], max_candidates: int
    ) -> list[dict[str, Any]]:
        selected = set(island_ids)
        nodes = self.simulation.routing.air.get("nodes", [])
        edges = self.simulation.routing.air.get("edges", [])
        candidates = []
        for airport in sorted(
            (
                node
                for node in nodes
                if node.get("kind") == "airport"
                and node.get("island_id") in selected
            ),
            key=lambda item: item["id"],
        ):
            gateway = next(
                (
                    node
                    for node in nodes
                    if node.get("kind") == "island_gateway"
                    and node.get("island_id") == airport.get("island_id")
                ),
                None,
            )
            if gateway is None or _has_direct_edge(edges, airport["id"], gateway["id"]):
                continue
            operation = ScenarioOperation(
                type="airport_access_improvement",
                from_node_id=airport["id"],
                to_node_id=gateway["id"],
            )
            island_id = airport["island_id"]
            candidates.append(
                self._candidate(
                    recommendation_id=f"airport-access:{airport['id']}",
                    recommendation_type="airport_access",
                    island_id=island_id,
                    coordinates=_midpoint(airport["coordinates"], gateway["coordinates"]),
                    scenario=self._scenario("airport-access", airport["id"], operation),
                    expected_benefit=50.0,
                    confidence=self._island_confidence(island_id, geometry=True),
                    reason="The airport lacks a direct access gateway edge in the static graph.",
                    trade_offs=[
                        "Airport operations and actual flight service are outside this estimate."
                    ],
                    assumptions=["The airport and island gateway are valid access endpoints."],
                    disclaimer="Planning-screening access link; flight schedules are not inferred.",
                )
            )
        return candidates[:max_candidates]

    def _simulate_and_rank(
        self, candidate: dict[str, Any], policy: RecommendationConfig
    ) -> dict[str, Any]:
        simulation = self.simulation.run(
            Scenario.model_validate(candidate["scenario"]), candidate.get("island_id")
        )
        score = (
            policy.benefit_weight * candidate["expected_benefit"]
            + policy.confidence_weight * candidate["confidence"] * 100
        )
        candidate["score"] = round(score, 2)
        candidate["simulation"] = {
            "operations_applied": simulation["operations_applied"],
            "warnings": simulation["warnings"],
            "delta": simulation["delta"],
        }
        return candidate

    def _candidate(
        self,
        *,
        recommendation_id: str,
        recommendation_type: str,
        island_id: str,
        coordinates: list[float] | None,
        scenario: Scenario,
        expected_benefit: float,
        confidence: float,
        reason: str,
        trade_offs: list[str],
        assumptions: list[str],
        disclaimer: str,
    ) -> dict[str, Any]:
        island = self.islands.get(island_id, {})
        properties = island.get("properties", {})
        return {
            "id": recommendation_id,
            "type": recommendation_type,
            "island_id": island_id,
            "island_name": properties.get("name"),
            "location": {"type": "Point", "coordinates": coordinates},
            "expected_benefit": round(max(0.0, min(100.0, expected_benefit)), 2),
            "confidence": round(max(0.0, min(1.0, confidence)), 3),
            "reason": reason,
            "trade_offs": trade_offs,
            "assumptions": assumptions,
            "planning_screening_disclaimer": disclaimer,
            "scenario": scenario.model_dump(mode="json"),
        }

    def _scenario(
        self, kind: str, target: str, operation: ScenarioOperation
    ) -> Scenario:
        return Scenario(
            id=f"recommendation:{kind}:{target}",
            name=f"Screen {kind.replace('-', ' ')} at {target}",
            operations=[operation],
            metadata={"source": "recommendation-engine", "planning_screening": True},
        )

    def _baseline(self, island_id: str) -> dict[str, Any]:
        cached = self.baseline_scores.get(island_id)
        if cached is not None:
            return cached
        scored = self.accessibility.score_island(island_id)
        return scored or {
            "score": 0.0,
            "confidence": 0.0,
            "missing_data": ["island_not_found"],
        }

    def _island_need(self, island_id: str) -> float:
        return max(0.0, 100.0 - float(self._baseline(island_id).get("score", 0.0)))

    def _island_confidence(self, island_id: str, geometry: bool = False) -> float:
        confidence = float(self._baseline(island_id).get("confidence", 0.0))
        if geometry and island_id not in self.simulation.routing.land.get("islands", {}):
            confidence *= 0.5
        return confidence

    def _transport_gap(self, island_id: str, component: str) -> float:
        baseline = self._baseline(island_id)
        transport = baseline.get("domains", {}).get("transport", {})
        components = transport.get("components", {})
        if component == "bus":
            return 100.0 if components.get("bus", 0.0) == 0.0 else 0.0
        if component == "ferry":
            return 100.0 if components.get("ferry", 0.0) == 0.0 else 0.0
        return 100.0

    def _facilities(self, island_id: str, categories: set[str]) -> list[dict[str, Any]]:
        return [
            item
            for item in self.facilities
            if item.get("island_id") == island_id and item.get("category") in categories
        ]

    def _has_transport(self, island_id: str, categories: set[str]) -> bool:
        return any(
            item.get("island_id") == island_id and item.get("category") in categories
            for item in self.transport
        )

    def _marine_nodes(self, island_id: str) -> list[dict[str, Any]]:
        return [
            item
            for item in self.simulation.routing.marine.get("nodes", [])
            if item.get("island_id") == island_id
            and item.get("category") in {"ferry_terminal", "pier"}
        ]

    def _centroid(self, island_id: str) -> list[float] | None:
        centroid = self.islands.get(island_id, {}).get("properties", {}).get("centroid")
        return list(centroid) if centroid else None

    def _read_json(self, relative_path: str, default: Any) -> Any:
        try:
            return self.cache.read_json(relative_path)
        except FileNotFoundError:
            return default


def _has_direct_edge(edges: list[dict[str, Any]], first_id: str, second_id: str) -> bool:
    return any(
        edge.get("from_id") == first_id and edge.get("to_id") == second_id
        or edge.get("from_id") == second_id
        and edge.get("to_id") == first_id
        for edge in edges
    )


def _midpoint(first: list[float], second: list[float]) -> list[float]:
    return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2]


def _distance_m(first: list[float], second: list[float]) -> float:
    radius = 6_371_000
    lat_1 = math.radians(first[1])
    lat_2 = math.radians(second[1])
    delta_lat = math.radians(second[1] - first[1])
    delta_lon = math.radians(second[0] - first[0])
    value = math.sin(delta_lat / 2) ** 2 + math.cos(lat_1) * math.cos(lat_2) * math.sin(
        delta_lon / 2
    ) ** 2
    return 2 * radius * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def _distance_bonus(distance_m: float) -> float:
    return max(0.0, 35.0 - distance_m / 10_000)
