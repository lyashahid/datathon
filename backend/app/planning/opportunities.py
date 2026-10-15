"""Evidence-led map screening and bounded draft packages, never planning permission.

National scores describe the captured inventory, not a survey of missing services.
Resident gains use immutable planning origins and union origin IDs across sectors.
"""

from __future__ import annotations

import heapq
import json
import math
from collections import OrderedDict, defaultdict
from copy import deepcopy
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from shapely.geometry import Point, shape

from app.accessibility.service import AccessibilityService
from app.planning.display_grid import build_display_grid
from app.planning.economics import economics
from app.planning.models import PlanningAssumptions, PlanningRequest
from app.planning.repository import IDENTITY_BRIDGE
from app.planning.routing import JourneyRouter, WalkingNetwork
from app.planning.service import PlanningService
from app.planning.world import apply_operations, baseline_world

DOMAINS = ("transport", "health", "education")
GOALS = {"health": "healthcare", "education": "education"}
INVENTORY_METHOD = (
    "Island screening from the existing accessibility model and mapped inventory. "
    "Scores are policy-weighted availability indices, not percentages of residents served. "
    "Missing mapped records stay unknown; they do not prove a service is absent."
)
REVIEW_REQUIRED = [
    "Land ownership, site suitability and planning permission",
    "Capital quotations, staffing and recurring operating funding",
    "Admissions, capacity and current operating hours",
]


class BudgetSuggestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    island_id: str | None = None
    capital_budget_mvr: float = Field(ge=0, le=1e12)
    annual_operating_budget_mvr: float | None = Field(default=None, ge=0, le=1e12)
    priorities: list[Literal["transport", "health", "education"]] = Field(
        default_factory=lambda: list(DOMAINS), min_length=1, max_length=3
    )
    max_recommendations: int = Field(default=3, ge=1, le=6)
    assumptions: PlanningAssumptions = Field(default_factory=PlanningAssumptions)


class OpportunityService:
    def __init__(
        self, planning: PlanningService, accessibility: AccessibilityService | None = None
    ) -> None:
        self.planning = planning
        self.repository = planning.repository
        self.accessibility = accessibility
        self.world = baseline_world(self.repository)
        self.walking = WalkingNetwork(self.world["network"])
        self.audited_walking = WalkingNetwork(self.world["network"], wheelchair=True)
        self.driving = WalkingNetwork(self.world["network"], drive=True)
        self._routes: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._hex_grids: dict[str, dict[str, Any]] = {}

    def _island(self, island_id: str) -> dict[str, Any] | None:
        scope = self.repository.planning_id(island_id)
        return next(
            (i for i in self.repository.baseline.get("islands", []) if i["id"] == scope), None
        )

    def _origins(self, island_id: str, assumptions: PlanningAssumptions) -> list[dict[str, Any]]:
        scope = self.repository.planning_id(island_id)
        return [
            origin
            for origin in self.repository.baseline.get("origins", [])
            if origin.get("islandId") == scope
            and origin.get(f"population{assumptions.population_year}") is not None
        ]

    def _population_basis(self) -> str:
        return self.repository.baseline.get("assumptions", {}).get(
            "populationSpatialDistribution", "Source-backed planning origin weights"
        )

    def overview(self, *, include_geometry: bool = True) -> dict[str, Any]:
        accessibility = self.accessibility
        scores = (
            {row["island_id"]: row for row in accessibility.default_artifact().get("scores", [])}
            if accessibility
            else {}
        )
        features = list(accessibility.islands.values()) if accessibility else []
        if not features:
            features = [
                {
                    "type": "Feature",
                    "geometry": island.get("geometry"),
                    "properties": dict(island, id=IDENTITY_BRIDGE.get(island["id"], island["id"])),
                }
                for island in self.repository.baseline.get("islands", [])
            ]
        facilities: dict[str, list[dict[str, Any]]] = defaultdict(list)
        transport: dict[str, list[dict[str, Any]]] = defaultdict(list)
        if accessibility:
            for facility in accessibility.facilities:
                if (
                    facility.get("geometry")
                    and facility.get("match_status") != "osm_provisional_review_required"
                ):
                    facilities[facility.get("island_id", "")].append(facility)
            for feature in accessibility.transport:
                transport[feature.get("island_id", "")].append(feature)
        islands, map_features = [], []
        for feature in features:
            properties = feature.get("properties", {})
            island_id = properties.get("id")
            if not island_id:
                continue
            score = scores.get(island_id, {})
            planning_island = self._island(island_id)
            planning_origins = self._origins(island_id, PlanningAssumptions())
            population_profile = score.get("population", {})
            population = population_profile.get("total")
            # National census and Greater Malé projections remain distinct labelled bases.
            if population is None and planning_origins:
                population = sum(float(o["population2026"]) for o in planning_origins)
                population_profile = {
                    "status": "projected_spatial_allocation",
                    "qualification": self._population_basis(),
                }
            domains = {}
            for domain in DOMAINS:
                categories = {
                    "health": {"hospital", "clinic", "health_center"},
                    "education": {"school"},
                    "transport": {"airport"},
                }[domain]
                mapped = sum(f.get("category") in categories for f in facilities.get(island_id, []))
                if domain == "transport":
                    mapped += len(transport.get(island_id, []))
                if planning_island:
                    if domain == "transport":
                        mapped = max(
                            mapped,
                            sum(
                                s.get("islandId") == planning_island["id"]
                                for s in self.world["stops"]
                            ),
                        )
                    else:
                        kinds = {"hospital", "clinic"} if domain == "health" else {"school"}
                        mapped = max(
                            mapped,
                            sum(
                                f.get("islandId") == planning_island["id"]
                                and f.get("kind") in kinds
                                for f in self.world["facilities"]
                            ),
                        )
                raw = score.get("domains", {}).get(domain, {})
                value = float(raw["score"]) if mapped and raw.get("score") is not None else None
                reasons = []
                if not mapped:
                    reasons.append(
                        f"No accepted mapped {domain} record in this snapshot; "
                        "verify local provision."
                    )
                elif value is None:
                    reasons.append(
                        f"{mapped} mapped {domain} locations; national score evidence unavailable."
                    )
                else:
                    reasons.append(
                        f"{mapped} mapped {domain} locations; availability index {value:g}/100."
                    )
                    if value < 60:
                        reasons.append(
                            "The configured availability model flags this island for review."
                        )
                if "population_density_pressure" in raw.get("missing_data", []):
                    reasons.append(
                        "The model applies a population-density pressure assumption; "
                        "capacity is unverified."
                    )
                if domain == "transport":
                    reasons.append(
                        "Mapped stops and terminals do not establish service frequency "
                        "or passenger capacity."
                    )
                domains[domain] = {
                    "score": value,
                    "status": "unknown"
                    if value is None
                    else ("review" if value < 60 else "stronger_evidence"),
                    "mapped_count": mapped,
                    "reasons": reasons,
                }
            known = [(d, row["score"]) for d, row in domains.items() if row["score"] is not None]
            priority_domain, lowest = (
                min(known, key=lambda pair: pair[1]) if known else (None, None)
            )
            coordinates = properties.get("centroid")
            geometry = feature.get("geometry")
            if coordinates is None and geometry:
                point = shape(geometry).representative_point()
                coordinates = [point.x, point.y]
            island = {
                "island_id": island_id,
                "name": properties.get("name") or island_id,
                "atoll": properties.get("atoll") or "Unassigned atoll",
                "category": properties.get("category") or "Unclassified",
                "coordinates": coordinates,
                "population": round(population, 3) if population is not None else None,
                "population_status": population_profile.get("status", "unavailable"),
                "population_basis": population_profile.get("qualification")
                or population_profile.get("source")
                or "Resident population unavailable in this source snapshot",
                "planning_supported": bool(planning_origins),
                "priority_score": round(100 - lowest, 2) if lowest is not None else None,
                "priority_domain": priority_domain,
                "domains": domains,
                "reasons": domains[priority_domain]["reasons"]
                if priority_domain
                else [
                    "Mapped service evidence is incomplete; "
                    "confirm the inventory before investment."
                ],
                "missing_data": score.get("missing_data", []),
            }
            islands.append(island)
            if include_geometry:
                map_features.append(
                    {
                        "type": "Feature",
                        "geometry": geometry,
                        "properties": {
                            "island_id": island_id,
                            "name": island["name"],
                            "overall_gap": island["priority_score"] / 100
                            if island["priority_score"] is not None
                            else None,
                            **{
                                f"{domain}_gap": round(1 - domains[domain]["score"] / 100, 4)
                                if domains[domain]["score"] is not None
                                else None
                                for domain in DOMAINS
                            },
                            "status": "review"
                            if any(d["status"] == "review" for d in domains.values())
                            else ("unknown" if not known else "stronger_evidence"),
                        },
                    }
                )
        islands.sort(
            key=lambda island: (
                -(island["priority_score"] if island["priority_score"] is not None else -1),
                -(island["population"] or 0),
                island["island_id"],
            )
        )
        return {
            "version": "planning-opportunities-1.0",
            "reference_date": self.repository.baseline.get("referenceDate"),
            "summary": {
                "island_count": len(islands),
                "known_population_islands": sum(i["population"] is not None for i in islands),
                "review_islands": sum(
                    any(d["status"] == "review" for d in i["domains"].values()) for i in islands
                ),
                "supported_planning_islands": sum(i["planning_supported"] for i in islands),
                "known_residents": round(sum(i["population"] or 0 for i in islands), 3),
            },
            "islands": islands,
            "features": {"type": "FeatureCollection", "features": map_features},
            "method": INVENTORY_METHOD,
            "warnings": [
                "Population years and bases differ across island sources; "
                "inspect each island before comparing totals.",
                "A red screening colour is not evidence of unmet individual need "
                "or a statutory priority.",
                "Resident travel modeling is supported only where "
                "source-backed spatial origins exist.",
            ],
            "source_receipts": self.repository.receipts,
            "source_fingerprint": accessibility.source_fingerprint if accessibility else {},
        }

    def _baseline_routes(
        self, island_id: str, assumptions: PlanningAssumptions, domain: str
    ) -> dict[str, Any]:
        origins = self._origins(island_id, assumptions)
        if not origins:
            return {}
        values = assumptions.model_dump(mode="json")
        values["goal"] = GOALS.get(domain, assumptions.goal)
        # Costs and display geometry cannot change travel outcomes.
        for key in (
            "cost_overrides",
            "energy_overrides",
            "calibration_records",
            "calibration_selection",
            "fleet_resources",
            "capital_budget_mvr",
            "annual_operating_budget_mvr",
            "include_origin_geometry",
            "displaced_passenger_km",
        ):
            values.pop(key, None)
        key = json.dumps([self.repository.planning_id(island_id), values], sort_keys=True)
        if key in self._routes:
            self._routes.move_to_end(key)
            return self._routes[key]
        router = JourneyRouter(
            self.world, assumptions.model_copy(update={"goal": GOALS.get(domain, assumptions.goal)})
        )
        result = {o["id"]: router.route(o) for o in origins}
        self._routes[key] = result
        while len(self._routes) > 24:
            self._routes.popitem(last=False)
        return result

    def _nearest_distances(
        self, targets: list[dict[str, Any]], max_snap_m: float, wheelchair: bool = False
    ) -> dict[str, float]:
        """Reverse multi-source Dijkstra honours asymmetric walking restrictions."""
        reverse: dict[str, list[tuple[str, float]]] = defaultdict(list)
        network = self.audited_walking if wheelchair else self.walking
        for source, edges in network.adjacency.items():
            for target, distance, _, _ in edges:
                reverse[target].append((source, distance))
        distances: dict[str, float] = {}
        queue = []
        for target in targets:
            snap = network.snap(target, max_snap_m)
            if snap and snap[1] < distances.get(snap[0], math.inf):
                distances[snap[0]] = snap[1]
                heapq.heappush(queue, (snap[1], snap[0]))
        while queue:
            distance, target = heapq.heappop(queue)
            if distance != distances[target]:
                continue
            for source, metres in reverse.get(target, []):
                value = distance + metres
                if value < distances.get(source, math.inf):
                    distances[source] = value
                    heapq.heappush(queue, (value, source))
        return distances

    def _walk_minutes(
        self, origin: dict[str, Any], distances: dict[str, float], assumptions: PlanningAssumptions
    ) -> float | None:
        network = self.audited_walking if assumptions.require_audited_wheelchair else self.walking
        snap = network.snap(origin, assumptions.max_snap_m)
        if not snap or snap[0] not in distances:
            return None
        return (snap[1] + distances[snap[0]]) / assumptions.walk_m_per_minute

    def detail(self, island_id: str) -> dict[str, Any] | None:
        overview = self.overview()
        canonical = IDENTITY_BRIDGE.get(island_id, island_id)
        entry = next((i for i in overview["islands"] if i["island_id"] == canonical), None)
        if entry is None:
            return None
        assumptions = PlanningAssumptions()
        routes = {domain: self._baseline_routes(island_id, assumptions, domain) for domain in GOALS}
        scope = self.repository.planning_id(island_id)
        stops = [
            s for s in self.world["stops"] if s.get("islandId") == scope and not s.get("disabled")
        ]
        distances = self._nearest_distances(stops, assumptions.max_snap_m)
        origins = self._origins(island_id, assumptions)
        if scope not in self._hex_grids:
            self._hex_grids[scope] = build_display_grid(origins, scope=scope, island_id=canonical)
        cells = []
        for origin in origins:
            properties = {
                "origin_id": origin["id"],
                "island_id": canonical,
                "population": round(origin[f"population{assumptions.population_year}"], 3),
                "coordinates": [origin["lon"], origin["lat"]],
            }
            known_gaps = []
            for domain in GOALS:
                route = routes[domain][origin["id"]]
                minutes = route.get("minutes")
                gap = (
                    min(1.0, minutes / assumptions.target_minutes) if minutes is not None else None
                )
                properties[f"{domain}_minutes"] = minutes
                properties[f"{domain}_gap"] = gap
                properties[f"{domain}_status"] = (
                    "unknown"
                    if minutes is None
                    else ("review" if minutes > assumptions.target_minutes else "within_target")
                )
                if gap is not None:
                    known_gaps.append(gap)
            minutes = self._walk_minutes(origin, distances, assumptions)
            properties["transport_minutes"] = round(minutes, 3) if minutes is not None else None
            properties["transport_gap"] = min(1.0, minutes / 10) if minutes is not None else None
            properties["transport_status"] = (
                "unknown" if minutes is None else ("review" if minutes > 10 else "within_target")
            )
            if minutes is not None:
                known_gaps.append(min(1.0, minutes / 10))
            properties["overall_gap"] = max(known_gaps) if known_gaps else None
            cells.append(
                {
                    "type": "Feature",
                    "geometry": origin.get("geometry")
                    or {"type": "Point", "coordinates": properties["coordinates"]},
                    "properties": properties,
                }
            )
        return {
            **entry,
            "gap_cells": {"type": "FeatureCollection", "features": cells},
            "hex_grid": deepcopy(self._hex_grids[scope]),
            "assumptions": assumptions.model_dump(mode="json"),
            "population_basis": self._population_basis() if cells else entry["population_basis"],
            "method": (
                "Health/education use scheduled journey routing to eligible facilities. "
                "Transport uses walking-network minutes to the nearest mapped stop, "
                "not verified departure frequency. Grid weights are spatial allocations, "
                "not block census counts."
            ),
            "warnings": overview["warnings"] + self.repository.summary(island_id)["warnings"],
        }

    def _site(
        self, origin: dict[str, Any], assumptions: PlanningAssumptions, drive: bool = False
    ) -> dict[str, Any] | None:
        walking = self.audited_walking if assumptions.require_audited_wheelchair else self.walking
        network = self.driving if drive else walking
        snap = network.snap(origin, assumptions.max_snap_m)
        if not snap:
            return None
        node = network.nodes[snap[0]]
        island = self._island(origin["islandId"])
        # Without a land polygon, automated siting cannot establish it is on land.
        geometry = island.get("geometry") if island else None
        if not geometry or not shape(geometry).covers(Point(node["lon"], node["lat"])):
            return None
        return node

    def _facility_candidate(
        self, island_id: str, domain: str, assumptions: PlanningAssumptions
    ) -> dict[str, Any] | None:
        origins = self._origins(island_id, assumptions)
        routes = self._baseline_routes(island_id, assumptions, domain)
        lacking = [
            origin
            for origin in origins
            if routes[origin["id"]].get("minutes") is None
            or routes[origin["id"]]["minutes"] > assumptions.target_minutes
        ]
        if not lacking:
            return None
        # Test up to 12 weighted gap locations, independent of the user's budget.
        candidates, seen = [], set()
        for origin in sorted(
            lacking, key=lambda o: (-o[f"population{assumptions.population_year}"], o["id"])
        ):
            site = self._site(origin, assumptions)
            if not site or site["id"] in seen:
                continue
            seen.add(site["id"])
            distances = self._nearest_distances(
                [site], assumptions.max_snap_m, assumptions.require_audited_wheelchair
            )
            gained = {
                o["id"]
                for o in lacking
                if (minutes := self._walk_minutes(o, distances, assumptions)) is not None
                and minutes <= assumptions.target_minutes
            }
            population = sum(
                o[f"population{assumptions.population_year}"] for o in lacking if o["id"] in gained
            )
            candidates.append((population, site["id"], site, gained))
            if len(candidates) >= 12:
                break
        if not candidates:
            return None
        population, _, site, gained = max(candidates, key=lambda c: (c[0], c[1]))
        if population <= 0:
            return None
        kind = "hospital" if domain == "health" else "school"
        scope = self.repository.planning_id(island_id)
        stable = f"auto-{scope}-{kind}"
        operation = {
            "type": f"add_{kind}",
            "island_id": island_id,
            "coordinates": [site["lon"], site["lat"]],
            "name": f"Suggested {kind} near a modeled access gap",
            "metadata": {
                "proposal_id": f"proposal:add_{kind}:{stable}",
                "siting_basis": "mapped walking node on island land; land use unverified",
            },
        }
        return {
            "id": stable,
            "title": f"{kind.capitalize()} near a modeled access gap",
            "kind": kind,
            "island_id": IDENTITY_BRIDGE.get(scope, island_id),
            "domain": domain,
            "coordinates": operation["coordinates"],
            "operations": [operation],
            "_gained_ids": gained,
            "estimated_gained_residents": round(population, 3),
            "reasons": [
                f"{population:,.0f} allocated residents currently have no modeled {domain} "
                f"journey within {assumptions.target_minutes:g} minutes; "
                "this site supplies a walking journey within that target.",
                "Capacity, demand, admissions and construction suitability need a site study.",
            ],
            "benefit_method": (
                "Conservative new walking access versus baseline scheduled journeys; "
                "not attendance or ridership."
            ),
        }

    def _bus_candidate(
        self, island_id: str, assumptions: PlanningAssumptions
    ) -> dict[str, Any] | None:
        scope = self.repository.planning_id(island_id)
        origins = self._origins(island_id, assumptions)
        bus_stops = [
            s
            for s in self.world["stops"]
            if s.get("islandId") == scope
            and s.get("mode", "bus") == "bus"
            and not s.get("disabled")
        ]
        if not bus_stops:
            return None
        baseline_distances = self._nearest_distances(
            bus_stops, assumptions.max_snap_m, assumptions.require_audited_wheelchair
        )
        lacking = [
            o
            for o in origins
            if (m := self._walk_minutes(o, baseline_distances, assumptions)) is not None and m > 10
        ]
        if not lacking:
            return None
        for origin in sorted(
            lacking, key=lambda o: (-o[f"population{assumptions.population_year}"], o["id"])
        )[:12]:
            site = self._site(origin, assumptions, drive=True)
            if not site:
                continue
            distances, _ = self.driving.tree(site["id"], 20000)
            choices = []
            for stop in bus_stops:
                snap = self.driving.snap(stop, assumptions.max_snap_m)
                if (
                    snap
                    and distances.get(snap[0], math.inf) >= 300
                    and distances.get(snap[0], math.inf) < 20000
                ):
                    back, _ = self.driving.tree(snap[0], 20000)
                    if site["id"] in back:
                        choices.append((distances[snap[0]], stop["id"], stop, back[site["id"]]))
            if not choices:
                continue
            outward_m, _, terminal, inward_m = min(choices)
            stable = f"auto-{scope}-bus"
            stop_id = f"proposal:add_stop:{stable}"
            operations: list[dict[str, Any]] = [
                {
                    "type": "add_stop",
                    "island_id": island_id,
                    "name": "Suggested neighborhood shuttle stop",
                    "coordinates": [site["lon"], site["lat"]],
                    "metadata": {"proposal_id": stop_id, "mode": "bus"},
                }
            ]
            for direction, stops, metres in (
                ("out", [stop_id, terminal["id"]], outward_m),
                ("back", [terminal["id"], stop_id], inward_m),
            ):
                minutes = max(2.0, metres / (20000 / 60))
                operations.append(
                    {
                        "type": "add_service",
                        "service": {
                            "id": f"{stable}-{direction}",
                            "routeId": stable,
                            "name": "Suggested neighborhood shuttle",
                            "mode": "bus",
                            "fleet": "diesel",
                            "stopIds": stops,
                            "distanceM": metres,
                            "calendar": {"includedDates": [assumptions.date.isoformat()]},
                            "timing": {
                                "kind": "frequency",
                                "segmentMinutes": [minutes],
                                "windows": [
                                    {"startMinutes": 360, "endMinutes": 1320, "headwayMinutes": 20}
                                ],
                            },
                            "provenance": "assumed",
                            "sourceIds": ["scenario-proposal"],
                        },
                    }
                )
            after, _ = apply_operations(
                self.repository,
                PlanningRequest(
                    island_id=island_id, assumptions=assumptions, operations=operations
                ),
            )
            after_stops = [s for s in after["stops"] if s.get("islandId") == scope]
            new_distances = self._nearest_distances(
                after_stops, assumptions.max_snap_m, assumptions.require_audited_wheelchair
            )
            gained = {
                o["id"]
                for o in lacking
                if (m := self._walk_minutes(o, new_distances, assumptions)) is not None and m <= 10
            }
            population = sum(
                o[f"population{assumptions.population_year}"] for o in origins if o["id"] in gained
            )
            if population <= 0:
                continue
            route_features = []
            for pattern in after["patterns"]:
                if pattern.get("routeId") != stable:
                    continue
                for coordinates in pattern.get("segmentGeometry", []):
                    if len(coordinates) >= 2:
                        route_features.append(
                            {
                                "type": "Feature",
                                "geometry": {"type": "LineString", "coordinates": coordinates},
                                "properties": {
                                    "candidate_id": stable,
                                    "kind": "bus",
                                    "direction": "back"
                                    if pattern["id"].endswith("back")
                                    else "out",
                                    "provenance": "osm_network_shortest_path",
                                    "qualification": "Shortest path on captured driving graph; "
                                    "assumed timetable, not an approved route",
                                },
                            }
                        )
            return {
                "id": stable,
                "title": "Neighborhood bus stop and return shuttle",
                "kind": "bus",
                "domain": "transport",
                "island_id": IDENTITY_BRIDGE.get(scope, island_id),
                "coordinates": [site["lon"], site["lat"]],
                "operations": operations,
                "map_features": {"type": "FeatureCollection", "features": route_features},
                "_gained_ids": gained,
                "estimated_gained_residents": round(population, 3),
                "reasons": [
                    f"{population:,.0f} allocated residents gain mapped stop access "
                    "within a 10-minute walk.",
                    "A road-connected shuttle is included in both directions; "
                    "20-minute headway, 20 km/h and 06:00–22:00 are editable scenario assumptions.",
                ],
                "benefit_method": (
                    "New walking access to a proposed shuttle stop; "
                    "not passengers carried or health/education journey gains."
                ),
            }
        return None

    def suggest(self, payload: BudgetSuggestionRequest) -> dict[str, Any]:
        assumptions = payload.assumptions.model_copy(
            update={
                "capital_budget_mvr": payload.capital_budget_mvr,
                "annual_operating_budget_mvr": payload.annual_operating_budget_mvr,
            }
        )
        scopes = (
            [payload.island_id]
            if payload.island_id
            else [
                IDENTITY_BRIDGE.get(i["id"], i["id"])
                for i in self.repository.baseline.get("islands", [])
            ]
        )
        scopes = list(dict.fromkeys(scopes))
        candidates, warnings = [], []
        if payload.capital_budget_mvr > 0:
            for island_id in scopes:
                if not self._origins(island_id, assumptions):
                    warnings.append(
                        f"{island_id}: no source-backed resident grid for this year; "
                        "no automatic investment site selected."
                    )
                    continue
                for domain in dict.fromkeys(payload.priorities):
                    candidate = (
                        self._bus_candidate(island_id, assumptions)
                        if domain == "transport"
                        else self._facility_candidate(island_id, domain, assumptions)
                    )
                    if candidate:
                        after, _ = apply_operations(
                            self.repository,
                            PlanningRequest(
                                island_id=island_id,
                                assumptions=assumptions,
                                operations=candidate["operations"],
                            ),
                        )
                        financial = economics(self.world, after, assumptions)
                        candidate["capital_mvr"] = financial["delta"]["capital_mvr"]
                        candidate["annual_operating_mvr"] = financial["delta"][
                            "annual_operating_mvr"
                        ]
                        candidate["confidence"] = "screening"
                        candidate["review_required"] = REVIEW_REQUIRED
                        candidate["population_basis"] = self._population_basis()
                        candidate["cost_basis"] = financial["basis"]
                        candidates.append(candidate)
        # Fixed deterministic ranking ensures raising budgets cannot discard a cheaper prefix.
        candidates.sort(
            key=lambda c: (c["capital_mvr"], -(c["estimated_gained_residents"] or 0), c["id"])
        )
        selected, selected_operations = [], []
        capital, operating, gained_ids = 0.0, 0.0, set()
        for candidate in candidates:
            if len(selected) >= payload.max_recommendations:
                break
            proposal_operations = selected_operations + candidate["operations"]
            world, _ = apply_operations(
                self.repository,
                PlanningRequest(assumptions=assumptions, operations=proposal_operations),
            )
            financial = economics(self.world, world, assumptions)
            required_capital = financial["delta"]["capital_mvr"]
            required_operating = financial["delta"]["annual_operating_mvr"]
            if required_operating is None:
                continue
            if (
                payload.annual_operating_budget_mvr is not None
                and required_operating > payload.annual_operating_budget_mvr
            ):
                continue
            if required_capital > payload.capital_budget_mvr:
                break
            # A second sector may improve the same residents; union IDs, never sum benefits.
            gained_ids.update(candidate["_gained_ids"])
            selected.append({k: v for k, v in candidate.items() if not k.startswith("_")})
            selected_operations = proposal_operations
            capital, operating = required_capital, required_operating
        populations = {
            o["id"]: o.get(f"population{assumptions.population_year}")
            for o in self.repository.baseline.get("origins", [])
        }
        no_population = not any(self._origins(i, assumptions) for i in scopes)
        return {
            "status": "draft_package" if selected else "no_eligible_candidates",
            "selection_method": (
                "Deterministic lower-capital-first prefix of eligible candidates. "
                "Candidate sites maximize modeled access over up to 12 source gap locations. "
                "This bounded screening heuristic is not a globally optimal investment portfolio."
            ),
            "selected": selected,
            "operations": selected_operations,
            "map_features": {
                "type": "FeatureCollection",
                "features": [
                    feature
                    for candidate in selected
                    for feature in candidate.get("map_features", {}).get("features", [])
                ],
            },
            "total_capital_mvr": capital,
            "total_annual_operating_mvr": operating,
            "first_year_total_mvr": capital + operating,
            "estimated_gained_residents": round(sum(populations[o] or 0 for o in gained_ids), 3)
            if not no_population
            else None,
            "unique_residents_basis": (
                "Union of source origin IDs gaining the stated sector-specific access target. "
                "A resident gaining both school and hospital access is counted once; "
                "access is not demand or service capacity."
            ),
            "remaining_capital_mvr": round(payload.capital_budget_mvr - capital, 2),
            "remaining_annual_operating_mvr": round(
                payload.annual_operating_budget_mvr - operating, 2
            )
            if payload.annual_operating_budget_mvr is not None
            else None,
            "eligibility": {
                "capital_within_budget": capital <= payload.capital_budget_mvr,
                "operating_budget_confirmed": payload.annual_operating_budget_mvr is not None,
                "annual_within_budget": operating <= payload.annual_operating_budget_mvr
                if payload.annual_operating_budget_mvr is not None
                else None,
                "statutory_approval": "not_assessed",
                "site_review_required": True,
            },
            "assumptions": assumptions.model_dump(mode="json"),
            "warnings": sorted(
                set(
                    warnings
                    + [
                        "Recommendations are draft screening sites, not automatic statutory "
                        "approvals. No source data is changed.",
                        "Costs use the existing editable planning factors; land, lifecycle "
                        "maintenance, capacity, staffing and procurement "
                        "need verified local estimates.",
                        "No ferry corridor is automatically proposed without reviewed terminal "
                        "identities, crossing durations and marine suitability evidence.",
                        "Set a separate annual operating budget to screen recurring affordability."
                        if payload.annual_operating_budget_mvr is None
                        else "Capital and additional annual operating budgets "
                        "are screened separately.",
                    ]
                )
            ),
            "source_receipts": self.repository.receipts,
        }
