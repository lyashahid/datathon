"""Reproducible baseline/scenario access, appointments, timetable and financial service."""

from __future__ import annotations

import copy
import hashlib
import json
from collections import OrderedDict
from datetime import timedelta
from threading import RLock
from typing import Any

from app.data.computed_cache import ComputedCache, model_code_version
from app.planning.economics import COST_DEFAULTS, economics
from app.planning.models import JourneyRequest, PlanningAssumptions, PlanningRequest
from app.planning.repository import IDENTITY_BRIDGE, PlanningRepository
from app.planning.routing import JourneyRouter, WalkingNetwork, service_day_trips
from app.planning.transport import transport_summary
from app.planning.transport_impact import transport_impact
from app.planning.world import apply_operations, baseline_world


class PlanningService:
    def __init__(
        self, repository: PlanningRepository, *, cache: ComputedCache | None = None
    ) -> None:
        self.repository = repository
        self.computed_cache = cache
        self._cache_lock = RLock()
        self._networks: OrderedDict[tuple[str, bool], WalkingNetwork] = OrderedDict()
        self._routers: OrderedDict[tuple[str, str], JourneyRouter] = OrderedDict()

    @staticmethod
    def _digest(value: Any) -> str:
        return hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

    def _baseline_view(self) -> dict[str, Any]:
        """Internal read-only view; scenario overlays still copy before changing data."""
        baseline = self.repository.baseline
        return {
            "network": baseline.get("network", {"nodes": [], "edges": []}),
            "facilities": baseline.get("facilities", []),
            "stops": baseline.get("transit", {}).get("stops", []),
            "patterns": baseline.get("transit", {}).get("patterns", []),
        }

    def _router(self, world: dict[str, Any], assumptions: PlanningAssumptions) -> JourneyRouter:
        # Content keys invalidate closures, stop moves, calendars, facility edits
        # and in-process snapshot changes. Budget/geometry changes do not alter a
        # journey, and consequently reuse the same exact routing calculations.
        world = self._world_for_goal(world, assumptions)
        routing_inputs = assumptions.model_dump(
            mode="json",
            include={
                "date",
                "departure_minutes",
                "goal",
                "walk_m_per_minute",
                "max_journey_minutes",
                "max_access_walk_minutes",
                "max_transfer_walk_minutes",
                "max_transfers",
                "max_snap_m",
                "boarding_buffer_minutes",
                "require_audited_wheelchair",
            },
        )
        key = self._digest(world), self._digest(routing_inputs)
        with self._cache_lock:
            if key in self._routers:
                self._routers.move_to_end(key)
                return self._routers[key]
            network_key = self._digest(world["network"]), assumptions.require_audited_wheelchair
            if network_key not in self._networks:
                self._networks[network_key] = WalkingNetwork(
                    world["network"],
                    assumptions.require_audited_wheelchair,
                    cache_tree_nodes=150_000,
                )
                while len(self._networks) > 2:
                    self._networks.popitem(last=False)
            self._networks.move_to_end(network_key)
            router = JourneyRouter(world, assumptions, network=self._networks[network_key])
            self._routers[key] = router
            while len(self._routers) > 4:
                self._routers.popitem(last=False)
            return router

    def _world_for_goal(
        self, world: dict[str, Any], assumptions: PlanningAssumptions
    ) -> dict[str, Any]:
        if assumptions.goal != "transport":
            return world
        proposed_ids = {
            stop["id"] for stop in world["stops"] if stop["id"].startswith("proposal:add_stop:")
        }
        served_proposed = self._served_proposed_stops(world, proposed_ids, assumptions)
        destinations = {
            stop["id"]: stop
            for stop in world["stops"]
            if not stop.get("disabled")
            and (stop["id"] not in proposed_ids or stop["id"] in served_proposed)
        }
        disabled = {stop["id"] for stop in world["stops"] if stop.get("disabled")}
        for terminal in self.repository.ferry_terminals.values():
            if terminal["id"] in destinations or terminal["id"] in disabled:
                continue
            lon, lat = terminal["coordinates"]
            destinations[terminal["id"]] = {
                "id": terminal["id"],
                "name": terminal["name"],
                "islandId": self.repository.planning_id(terminal["island_id"]),
                "lon": lon,
                "lat": lat,
                "mode": "ferry",
            }
        return {**world, "transport_destinations": list(destinations.values())}

    @staticmethod
    def _served_proposed_stops(
        world: dict[str, Any], proposed_ids: set[str], assumptions: PlanningAssumptions
    ) -> set[str]:
        """New infrastructure needs a dated, boardable service before claiming access."""
        if not proposed_ids:
            return set()
        stops = {stop["id"]: stop for stop in world["stops"] if not stop.get("disabled")}
        served = set()
        for pattern in world["patterns"]:
            if pattern.get("mode") != "bus" or pattern.get("enabled") is False:
                continue
            stop_ids = pattern["stopIds"]
            for index, stop_id in enumerate(stop_ids[:-1]):
                if (
                    stop_id not in proposed_ids
                    or stop_id not in stops
                    or stops[stop_id].get("pickupAllowed") is False
                    or not any(
                        identity in stops and stops[identity].get("dropoffAllowed") is not False
                        for identity in stop_ids[index + 1 :]
                    )
                ):
                    continue
                departures = [
                    trip["stopTimes"][index]["departureMinutes"]
                    for trip in service_day_trips(pattern, assumptions.date, stop_index=index)
                ]
                departure = assumptions.departure_minutes
                if (
                    departures
                    and min(departures) <= departure <= max(departures)
                    and any(
                        departure <= minute <= departure + assumptions.max_journey_minutes
                        for minute in departures
                    )
                ):
                    served.add(stop_id)
        return served

    def quote(self, request: PlanningRequest) -> dict[str, Any]:
        """Authoritative project cost gate without any resident access searches."""
        world, warnings = apply_operations(self.repository, request, share_unchanged_network=True)
        financial = economics(self._baseline_view(), world, request.assumptions)
        checks = {}
        reasons = []
        over_budget = False
        unavailable = False
        for key, label, limit, projected in (
            (
                "capital",
                "Capital",
                request.assumptions.capital_budget_mvr,
                financial["delta"]["capital_mvr"],
            ),
            (
                "annual_operating",
                "Annual operating",
                request.assumptions.annual_operating_budget_mvr,
                financial["delta"]["annual_operating_mvr"],
            ),
        ):
            within = projected <= limit if limit is not None and projected is not None else None
            checks[key] = {
                "limit_mvr": limit,
                "projected_mvr": projected,
                "remaining_mvr": round(limit - projected, 3)
                if limit is not None and projected is not None
                else None,
                "within_budget": within,
            }
            if limit is not None and projected is None:
                unavailable = True
                reasons.append(f"{label} costs are unavailable; this budget cannot be verified.")
            elif within is False:
                over_budget = True
                reasons.append(f"{label} cost exceeds the budget by MVR {projected - limit:,.2f}.")
        bounded = (
            request.assumptions.capital_budget_mvr is not None
            or request.assumptions.annual_operating_budget_mvr is not None
        )
        return {
            "economics": financial,
            "transport_connectivity": {
                "impact": transport_impact(
                    self._baseline_view(),
                    world,
                    request.assumptions,
                    island_id=request.island_id,
                    island_names=self.repository.island_names,
                )
            },
            "budget": {
                "allowed": not over_budget and not unavailable,
                "status": "over_budget"
                if over_budget
                else "unavailable"
                if unavailable
                else "within_budget"
                if bounded
                else "unbounded",
                "reasons": reasons,
                **checks,
            },
            "coverage": self.coverage(request),
            "warnings": sorted(set(warnings + financial["warnings"])),
        }

    def baseline(self, island_id: str | None = None) -> dict[str, Any]:
        result = self.repository.summary(island_id)
        scope = self.repository.planning_id(island_id)
        nodes = {n["id"]: n for n in self.repository.baseline.get("network", {}).get("nodes", [])}
        result["graph_edges"] = [
            {
                k: v
                for k, v in e.items()
                if k
                in {
                    "id",
                    "from",
                    "to",
                    "distanceM",
                    "walkAllowed",
                    "driveAllowed",
                    "name",
                    "sourceOsmWayId",
                    "geometry",
                }
            }
            for e in self.repository.baseline.get("network", {}).get("edges", [])
            if not scope or nodes.get(e["from"], {}).get("islandId") == scope
        ]
        result["cost_defaults"] = COST_DEFAULTS
        return result

    def coverage(self, request: PlanningRequest) -> dict[str, Any]:
        scope = self.repository.planning_id(request.island_id)
        supported = {island["id"] for island in self.repository.baseline.get("islands", [])}
        snapshot = self.repository.baseline.get("referenceDate")
        return {
            "status": "outside_snapshot" if scope and scope not in supported else "partial",
            "service_date": request.assumptions.date.isoformat(),
            "snapshot_date": snapshot,
            "snapshot_date_matches": request.assumptions.date.isoformat() == snapshot,
            "timezone": "Indian/Maldives",
            "meaning": "Computed shortest journeys in available walking and dated transit "
            "evidence. Results are modeled access, not observed travel or admissions availability.",
            "bus_calendar": "remaining_departures_only"
            if request.assumptions.date.isoformat() == snapshot
            else "no_recurring_calendar_verified",
            "ferry_crossing_times": "requires_explicit_import",
        }

    def evaluate(self, request: PlanningRequest) -> dict[str, Any]:
        if self.computed_cache is not None:
            # Hash all source content, including origins/calendar mutations and
            # every model input. Compact/full representations never collide.
            public_fields = {
                "goal",
                "include_origin_geometry",
                "include_journey_geometry",
                "include_world",
            }
            public_baseline = (
                not request.operations
                and request.scenario is None
                and request.assumptions.model_dump(exclude=public_fields)
                == PlanningAssumptions().model_dump(exclude=public_fields)
            )
            return self.computed_cache.get_or_compute(
                "planning-public-baseline" if public_baseline else "planning-evaluation",
                [
                    model_code_version(),
                    self.repository.baseline,
                    self.repository.calendars,
                    self.repository.receipts,
                    self.repository.ferry_terminals,
                    request.model_dump(mode="json"),
                ],
                lambda: self._evaluate(request),
            )
        return self._evaluate(request)

    def _evaluate(self, request: PlanningRequest) -> dict[str, Any]:
        before_world = self._baseline_view()
        after_world, operation_warnings = apply_operations(
            self.repository, request, share_unchanged_network=True
        )
        origins = self._origins(request)
        before = self._router(before_world, request.assumptions)
        after = self._router(after_world, request.assumptions)
        comparisons = []
        summary = {
            key: 0.0
            for key in (
                "population",
                "baseline_reachable_residents",
                "scenario_reachable_residents",
                "gained_residents",
                "lost_residents",
                "unknown_residents",
                "became_unavailable_residents",
                "worsened_residents",
                "weighted_minutes_saved",
            )
        }
        bands = {"before": self._bands(), "after": self._bands()}
        for origin in origins:
            population = origin.get(f"population{request.assumptions.population_year}")
            if population is None:
                continue
            population = float(population)
            first = before.route(
                origin, include_geometry=request.assumptions.include_journey_geometry
            )
            second = after.route(
                origin, include_geometry=request.assumptions.include_journey_geometry
            )
            within_first = first["minutes"] is not None and (
                first["minutes"] <= request.assumptions.target_minutes
            )
            within_second = second["minutes"] is not None and (
                second["minutes"] <= request.assumptions.target_minutes
            )
            known_first = first["status"] == "reachable"
            known_second = second["status"] == "reachable"
            gained = within_second and not within_first
            # Missing observations are never reported as a measured loss.
            lost = within_first and known_second and not within_second
            worsened = known_first and known_second and second["minutes"] > first["minutes"]
            unavailable = known_first and not known_second
            delta = first["minutes"] - second["minutes"] if known_first and known_second else None
            summary["population"] += population
            for key, active in (
                ("baseline_reachable_residents", within_first),
                ("scenario_reachable_residents", within_second),
                ("gained_residents", gained),
                ("lost_residents", lost),
                ("unknown_residents", not known_second),
                ("became_unavailable_residents", unavailable),
                ("worsened_residents", worsened),
            ):
                if active:
                    summary[key] += population
            if delta is not None:
                summary["weighted_minutes_saved"] += population * delta
            for side, journey in (("before", first), ("after", second)):
                for band in bands[side]:
                    minutes = journey["minutes"]
                    if (minutes is None and band["label"] == "Unavailable") or (
                        minutes is not None
                        and band["min_minutes"] is not None
                        and minutes > band["min_minutes"]
                        and (band["max_minutes"] is None or minutes <= band["max_minutes"])
                    ):
                        band["residents"] += population
                        break
            comparison = {
                "origin_id": origin["id"],
                "island_id": origin["islandId"],
                "national_island_id": IDENTITY_BRIDGE.get(origin["islandId"]),
                "population": population,
                "coordinates": [origin["lon"], origin["lat"]],
                "before": first,
                "after": second,
                "delta_minutes": delta,
                "gained_access": gained,
                "lost_access": lost,
                "worsened_journey": worsened,
                "became_unavailable": unavailable,
            }
            if request.assumptions.include_origin_geometry:
                comparison["geometry"] = origin.get("geometry")
            comparisons.append(comparison)
        for key, value in summary.items():
            summary[key] = round(value, 3)
        for values in bands.values():
            for band in values:
                band["residents"] = round(band["residents"], 3)
        warnings = self.repository.summary(request.island_id)["warnings"] + operation_warnings
        if request.assumptions.goal == "transport":
            warnings.append(
                "Transport access measures walking to mapped boarding points. "
                "Existing mapped locations are inventory evidence, not verified service "
                "availability. New proposed stops receive credit only with an enabled "
                "bus service operating at the selected date/time and an upcoming departure "
                "within the journey horizon. Walking access does not establish capacity, "
                "passenger demand or an inter-island arrival time."
            )
        coverage = self.coverage(request)
        if not origins:
            warnings.append(
                "No source-backed resident origins for this scope/year; totals and "
                "access percentages are unavailable, not zero residents"
            )
            summary = dict.fromkeys(summary, None)
            for values in bands.values():
                for band in values:
                    band["residents"] = None
        if not coverage["snapshot_date_matches"]:
            warnings.append(
                "Selected date is outside the verified bus snapshot: only walking "
                "and explicitly imported/calendared services can be evaluated"
            )
        if request.assumptions.require_audited_wheelchair:
            warnings.append(
                "The base graph has no complete audited wheelchair path network; "
                "untagged edges are excluded rather than certified"
            )
        financial = economics(before_world, after_world, request.assumptions)
        island_summaries = []
        for island_id in sorted({x["island_id"] for x in comparisons}):
            rows = [x for x in comparisons if x["island_id"] == island_id]
            island_summaries.append(
                {
                    "island_id": island_id,
                    "national_island_id": IDENTITY_BRIDGE.get(island_id),
                    "population": round(sum(x["population"] for x in rows), 3),
                    "gained_residents": round(
                        sum(x["population"] for x in rows if x["gained_access"]), 3
                    ),
                    "lost_residents": round(
                        sum(x["population"] for x in rows if x["lost_access"]), 3
                    ),
                }
            )
        return {
            "status": "partial" if origins else "outside_snapshot",
            "summary": summary,
            "target_minutes": request.assumptions.target_minutes,
            "travel_time_bands": bands,
            "origins": comparisons,
            "island_summaries": island_summaries,
            "economics": financial,
            "transport_connectivity": {
                "before": transport_summary(before_world, request.assumptions),
                "after": transport_summary(after_world, request.assumptions),
                "impact": transport_impact(
                    before_world,
                    after_world,
                    request.assumptions,
                    island_id=request.island_id,
                    island_names=self.repository.island_names,
                ),
            },
            "world": copy.deepcopy({k: after_world[k] for k in ("facilities", "stops", "patterns")})
            if request.assumptions.include_world
            else {
                "facilities": [],
                "stops": [],
                "patterns": [],
            },
            "coverage": coverage,
            "assumptions": request.assumptions.model_dump(mode="json"),
            "warnings": sorted(set(warnings)),
            "source_receipts": self.repository.receipts,
            "version_pins": {
                "dataset": self.repository.baseline.get("version"),
                "model": "fastapi-service-planning-1.0",
            },
            "population_basis": self.repository.baseline.get("assumptions", {}).get(
                "populationSpatialDistribution"
            ),
            "access_method": (
                "Shortest walking time to mapped boarding points. Proposed new stops "
                "require an enabled, dated bus service operating at the selected time. "
                "Existing mapped locations retain their unverified inventory status. "
                "Gained access means a new modeled walk within the target, not ridership "
                "or a verified end-to-end transport journey."
                if request.assumptions.goal == "transport"
                else "Shortest elapsed time including walking, scheduled waits, "
                "boarding buffers, directed transit trips and bounded transfers. Gained access "
                "means a new modeled journey within the target; loss requires a known journey "
                "moving outside the target. Unavailable evidence is separate from measured loss."
            ),
        }

    def journey(self, request: JourneyRequest) -> dict[str, Any]:
        origin = next((x for x in self._origins(request) if x["id"] == request.origin_id), None)
        if origin is None:
            raise ValueError("Resident origin ID not found in the selected supported scope")
        world, warnings = apply_operations(self.repository, request)
        world = self._world_for_goal(world, request.assumptions)
        destinations = None
        if request.destination_id:
            from app.planning.routing import destination_eligible

            destinations = [
                f
                for f in world.get("transport_destinations", world["facilities"])
                if f["id"] == request.destination_id
                and (
                    request.assumptions.goal == "transport"
                    or destination_eligible(f, request.assumptions)
                )
            ]
            if not destinations:
                raise ValueError("Destination is not eligible/open for this goal and scenario date")
        outward = JourneyRouter(world, request.assumptions, destinations).route(
            origin, include_geometry=request.assumptions.include_journey_geometry
        )
        result = {
            "status": outward["status"],
            "origin_id": origin["id"],
            "outward": outward,
            "return_journey": None,
            "home_at_minutes": None,
            "meets_deadline": None,
            "departure_minutes": request.assumptions.departure_minutes,
            "appointment_minutes": request.appointment_minutes,
            "coverage": self.coverage(request),
            "warnings": warnings,
            "source_receipts": self.repository.receipts,
        }
        if request.appointment_minutes is None or outward["status"] != "reachable":
            return result
        destination = next(
            f
            for f in world.get("transport_destinations", world["facilities"])
            if f["id"] == outward["destination_id"]
        )
        return_departure = outward["arrival_minutes"] + request.appointment_minutes
        day_offset = int(return_departure // 1440)
        assumptions = request.assumptions.model_copy(
            update={
                "date": request.assumptions.date + timedelta(days=day_offset),
                "departure_minutes": return_departure % 1440,
            }
        )
        # Home is an exact routing endpoint, not a hospital/school inventory mutation.
        home_target = dict(origin, name="Return home")
        return_origin = dict(destination, id="return:destination")
        # Reviewed validity is checked at each leg's departure, including midnight rollover.
        return_request = request.model_copy(update={"assumptions": assumptions})
        return_world, return_warnings = apply_operations(self.repository, return_request)
        result["warnings"].extend(f"Return journey: {warning}" for warning in return_warnings)
        inward = JourneyRouter(return_world, assumptions, [home_target]).route(
            return_origin, include_geometry=assumptions.include_journey_geometry
        )
        result["return_journey"] = inward
        result["return_departure_minutes"] = return_departure
        result["destination"] = destination
        if inward["status"] == "reachable":
            home_at = return_departure + inward["minutes"]
            result["home_at_minutes"] = round(home_at, 3)
            result["meets_deadline"] = (
                home_at <= request.return_deadline_minutes
                if (request.return_deadline_minutes is not None)
                else None
            )
            result["status"] = (
                "deadline_missed" if result["meets_deadline"] is False else "feasible"
            )
        else:
            result["status"] = "return_unavailable"
        result["warnings"].append(
            "Appointment duration and return deadline are explicit user "
            "assumptions; destination appointments/slots are not booked"
        )
        return result

    def timetable(self, request: PlanningRequest) -> dict[str, Any]:
        world, warnings = apply_operations(self.repository, request)
        stop_ids = {
            s["id"]
            for s in world["stops"]
            if not request.island_id
            or s["islandId"] == self.repository.planning_id(request.island_id)
        }
        patterns = []
        for pattern in world["patterns"]:
            if not request.island_id or stop_ids.intersection(pattern["stopIds"]):
                patterns.append(
                    {
                        "id": pattern["id"],
                        "route_id": pattern["routeId"],
                        "name": pattern["name"],
                        "mode": pattern["mode"],
                        "provenance": pattern.get("provenance"),
                        "stop_ids": pattern["stopIds"],
                        "calendar": pattern.get("calendar"),
                        "trips": service_day_trips(pattern, request.assumptions.date),
                        "source_ids": pattern.get("sourceIds", []),
                    }
                )
        return {
            "date": request.assumptions.date.isoformat(),
            "timezone": "Indian/Maldives",
            "patterns": patterns,
            "official_ferry_calendars": self.repository.calendars.get("calendars", []),
            "coverage": self.coverage(request),
            "warnings": warnings,
            "source_receipts": self.repository.receipts,
        }

    def fleet(self, request: PlanningRequest) -> dict[str, Any]:
        after, warnings = apply_operations(self.repository, request)
        result = economics(baseline_world(self.repository), after, request.assumptions)
        result["warnings"].extend(warnings)
        result["coverage"] = self.coverage(request)
        return result

    def _origins(self, request: PlanningRequest) -> list[dict[str, Any]]:
        scope = self.repository.planning_id(request.island_id)
        return [
            origin
            for origin in self.repository.baseline.get("origins", [])
            if (not scope or origin["islandId"] == scope)
            and origin.get(f"population{request.assumptions.population_year}") is not None
        ]

    @staticmethod
    def _bands() -> list[dict[str, Any]]:
        return [
            {"label": "0–15 min", "min_minutes": -1, "max_minutes": 15, "residents": 0.0},
            {"label": "15–30 min", "min_minutes": 15, "max_minutes": 30, "residents": 0.0},
            {"label": "30–60 min", "min_minutes": 30, "max_minutes": 60, "residents": 0.0},
            {"label": "Over 60 min", "min_minutes": 60, "max_minutes": None, "residents": 0.0},
            {"label": "Unavailable", "min_minutes": None, "max_minutes": None, "residents": 0.0},
        ]
