"""Auditable planning illustrations, keeping capital separate from annual costs."""

from __future__ import annotations

import math
from typing import Any

from app.planning.calibration import calibrate
from app.planning.costs import COST_DEFAULTS, cost_basis, default_factor_basis
from app.planning.models import PlanningAssumptions
from app.planning.resources import resource_audit
from app.planning.routing import service_day_trips
from app.routing.engine import _distance_m


def fleet_activity(
    world: dict[str, Any],
    assumptions: PlanningAssumptions,
    energy_inputs: dict[str, float] | None = None,
    strict_depots: bool = True,
) -> dict[str, Any]:
    stops = {s["id"]: s for s in world["stops"]}
    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    selected_trips: dict[str, list[dict[str, Any]]] = {}
    for pattern in world["patterns"]:
        trips = service_day_trips(pattern, assumptions.date)
        if trips:
            # Calendar expansion includes previous-service-day trips after midnight.
            selected_trips[pattern["id"]] = trips
            # Vehicles cannot circulate between different modes/propulsion fleets.
            kind = "ferry" if pattern["mode"] == "ferry" else pattern.get("fleet", "diesel")
            groups.setdefault((pattern["routeId"], pattern["mode"], kind), []).append(pattern)
    routes = []
    for (route_id, mode, kind), patterns in groups.items():
        reasons, activities = [], []
        km, hours = 0.0, 0.0
        for pattern in patterns:
            trips = selected_trips[pattern["id"]]
            distance = pattern.get("distanceM")
            if not distance:
                reasons.append("Routed distance missing; operating cost/emissions unavailable")
            for trip in trips:
                start, end = (
                    trip["stopTimes"][0]["departureMinutes"],
                    (trip["stopTimes"][-1]["arrivalMinutes"]),
                )
                hours += (end - start) / 60
                if distance:
                    km += distance / 1000
                activities.append(
                    {
                        "start": start,
                        "end": end + assumptions.layover_minutes,
                        "from": pattern["stopIds"][0],
                        "to": pattern["stopIds"][-1],
                        "pattern": pattern["id"],
                        "trip": trip["id"],
                        "distance_km": distance / 1000 if distance else None,
                    }
                )
        vehicles: list[dict[str, Any]] = []
        blocks = []
        for activity in sorted(activities, key=lambda x: (x["start"], x["trip"])):
            available = []
            for index, vehicle in enumerate(vehicles):
                if vehicle["available"] > activity["start"]:
                    continue
                first, second = stops.get(vehicle["at"]), stops.get(activity["from"])
                if (
                    first
                    and second
                    and _distance_m([first["lon"], first["lat"]], [second["lon"], second["lat"]])
                    <= 100
                ):
                    available.append(index)
            index = (
                min(available, key=lambda i: vehicles[i]["available"])
                if available
                else (len(vehicles))
            )
            if index == len(vehicles):
                vehicles.append({})
            vehicles[index].update({"available": activity["end"], "at": activity["to"]})
            blocks.append(dict(activity, vehicle=index + 1))
        observed = any(p.get("provenance") == "observed" for p in patterns)
        if observed:
            reasons.append(
                "Captured remaining departures only; annual repetition is a user "
                "assumption and fleet is not verified operator dispatch"
            )
        endpoints = {a["from"] for a in activities} | {a["to"] for a in activities}
        if any(
            sum(a["from"] == stop for a in activities) != sum(a["to"] == stop for a in activities)
            for stop in endpoints
        ):
            reasons.append(
                "Captured terminal departures/arrivals are unbalanced; modeled vehicles may "
                "accumulate away from their first terminal. Import return/deadhead duties "
                "before approving recurring dispatch."
            )
        # No teleporting/deadhead-free fleet reuse: only co-located end/start stops are linked.
        fleet = len(vehicles)
        routes.append(
            {
                "route_id": route_id,
                "activity_id": f"{route_id}|{mode}|{kind}",
                "name": patterns[0]["name"],
                "mode": mode,
                "fleet_type": kind,
                "service_date": assumptions.date.isoformat(),
                "departures": len(activities),
                "required_fleet": fleet,
                "procurement_fleet": math.ceil(fleet * (1 + assumptions.fleet_reserve_share)),
                "service_day_vehicle_km": round(km, 3)
                if not reasons or all("distance" not in r for r in reasons)
                else None,
                "service_day_vehicle_hours": round(hours, 3),
                "annual_vehicle_km": round(km * assumptions.annual_operating_days, 3)
                if all("distance" not in r for r in reasons)
                else None,
                "annual_vehicle_hours": round(hours * assumptions.annual_operating_days, 3),
                "blocks": blocks,
                "warnings": reasons,
                "method": "Greedy chronological vehicle blocks; reuse only after layover at "
                "co-located terminal (100 m). No unobserved deadhead trips. Initial depot, crew, "
                "charging, maintenance and across-day positioning require an operating plan.",
            }
        )
    resource_plans = {plan.activity_id: plan for plan in assumptions.fleet_resources}
    for route in routes:
        plan = resource_plans.get(route["activity_id"])
        route["charging_units_costed"] = (
            (plan.charger_count if plan and plan.charger_count is not None else 1)
            if route["fleet_type"] == "electric"
            else 0
        )
        route["resource_audit"] = resource_audit(
            route, plan, stops, energy_inputs or {}, strict_depots
        )
    return {
        "routes": routes,
        "required_fleet": sum(r["required_fleet"] for r in routes),
        "procurement_fleet": sum(r["procurement_fleet"] for r in routes),
        "annual_operating_days_assumption": assumptions.annual_operating_days,
        "inactive_resource_plans": sorted(
            set(resource_plans).difference(route["activity_id"] for route in routes)
        ),
    }


def economics(
    before: dict[str, Any], after: dict[str, Any], assumptions: PlanningAssumptions
) -> dict[str, Any]:
    calibration = calibrate(
        COST_DEFAULTS,
        assumptions.calibration_records,
        assumptions.calibration_selection,
        assumptions.cost_overrides,
        assumptions.energy_overrides,
        assumptions.date,
        default_basis=default_factor_basis(),
    )
    costs = calibration["costs"]
    fleets = [
        fleet_activity(before, assumptions, calibration["energy"], strict_depots=False),
        fleet_activity(after, assumptions, calibration["energy"]),
    ]
    results = []
    unrounded = []
    reasons = list(calibration["warnings"])
    for world, fleet in zip((before, after), fleets):
        capital, operating, emissions = 0.0, 0.0, 0.0
        facility_emissions, embodied = 0.0, 0.0
        facility_emissions_known, embodied_known = True, True
        unknown_facility_emissions, unknown_embodied = [], []
        available = True
        unknown_distance_patterns = {}
        world_stops = {stop["id"]: stop for stop in world["stops"]}
        for route in fleet["routes"]:
            kind = "ferry" if route["mode"] == "ferry" else route["fleet_type"]
            if kind == "ferry":
                capital += route["procurement_fleet"] * costs["ferry_capital_mvr"]
            else:
                capital += route["procurement_fleet"] * costs[f"{kind}_bus_capital_mvr"]
                if kind == "electric" and route["procurement_fleet"]:
                    capital += (
                        costs["electric_charging_capital_mvr"] * route["charging_units_costed"]
                    )
            km = route["annual_vehicle_km"]
            if km is None:
                available = False
                active_patterns = sorted(
                    (
                        pattern
                        for pattern in world["patterns"]
                        if pattern["routeId"] == route["route_id"]
                        and pattern["mode"] == route["mode"]
                        and (
                            pattern["mode"] == "ferry"
                            or pattern.get("fleet", "diesel") == route["fleet_type"]
                        )
                        and service_day_trips(pattern, assumptions.date)
                    ),
                    key=lambda pattern: pattern["id"],
                )
                unknown_distance_patterns[route["activity_id"]] = {
                    "patterns": active_patterns,
                    "stops": {
                        stop_id: world_stops[stop_id]
                        for pattern in active_patterns
                        for stop_id in pattern["stopIds"]
                    },
                }
            else:
                operating += km * costs[f"{kind}_operating_mvr_per_km"]
                emissions += km * costs[f"{kind}_kg_co2e_per_km"]
            reasons.extend(route["warnings"])
            plan = route["resource_audit"].get("resources", {})
            if (
                kind == "electric"
                and plan.get("energy_kwh_per_km") is not None
                and calibration["energy"].get("electric_kwh_per_km") is not None
                and plan["energy_kwh_per_km"] != calibration["energy"]["electric_kwh_per_km"]
            ):
                reasons.append(
                    f"{route['name']}: route resource consumption differs from the "
                    "per-km costing input; align both assumptions before budget review"
                )
        for facility in world["facilities"]:
            if facility.get("planningStatus") != "proposed":
                continue
            if facility.get("proposedOpeningDate", "9999") > assumptions.date.isoformat():
                continue
            kind = facility["kind"]
            facility_costs = facility.get("costOverrides", {})
            for value in facility_costs.values():
                if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                    raise ValueError("Facility costs must be finite nonnegative assumptions")
            capital += facility_costs.get("capital_mvr", costs[f"{kind}_capital_mvr"])
            operating += facility_costs.get(
                "annual_operating_mvr", costs[f"{kind}_annual_operating_mvr"]
            )
            if facility_costs.get("annual_operating_kg_co2e") is None:
                facility_emissions_known = False
                unknown_facility_emissions.append(facility["id"])
                reasons.append(
                    f"{facility['name']}: annual facility operating emissions need an explicit "
                    "energy/emissions estimate; project operating totals are unavailable"
                )
            else:
                facility_emissions += facility_costs["annual_operating_kg_co2e"]
            if facility_costs.get("embodied_kg_co2e") is None:
                embodied_known = False
                unknown_embodied.append(facility["id"])
                reasons.append(
                    f"{facility['name']}: embodied facility emissions need an explicit "
                    "construction estimate; they are unknown, not zero"
                )
            else:
                embodied += facility_costs["embodied_kg_co2e"]
        unrounded.append(
            {
                "known_operating_mvr": operating,
                "known_fleet_operating_kg_co2e": emissions,
                "unknown_distance_patterns": unknown_distance_patterns,
                "annual_operating_mvr": operating if available else None,
                "annual_operating_kg_co2e": emissions + facility_emissions
                if available and facility_emissions_known
                else None,
                "annual_fleet_operating_kg_co2e": emissions if available else None,
                "annual_facility_operating_kg_co2e": facility_emissions
                if facility_emissions_known
                else None,
                "embodied_facility_kg_co2e": embodied if embodied_known else None,
            }
        )
        results.append(
            {
                "fleet_replacement_capital_mvr": round(capital, 2),
                "annual_operating_mvr": round(operating, 2) if available else None,
                "annual_operating_kg_co2e": round(emissions + facility_emissions, 2)
                if available and facility_emissions_known
                else None,
                "annual_fleet_operating_kg_co2e": round(emissions, 2) if available else None,
                "annual_facility_operating_kg_co2e": round(facility_emissions, 2)
                if facility_emissions_known
                else None,
                "embodied_facility_kg_co2e": round(embodied, 2) if embodied_known else None,
                "unknown_facility_operating_emissions": unknown_facility_emissions,
                "unknown_facility_embodied_emissions": unknown_embodied,
                "required_fleet": fleet["required_fleet"],
                "procurement_fleet": fleet["procurement_fleet"],
            }
        )
    new_stops = len(
        {s["id"] for s in after["stops"] if not s.get("reusedInfrastructure")}.difference(
            {s["id"] for s in before["stops"]}
        )
    )
    capital = new_stops * costs["stop_capital_mvr"]
    old_facilities = {f["id"] for f in before["facilities"]}
    for facility in after["facilities"]:
        if (
            facility["id"] not in old_facilities
            and facility.get("planningStatus") == "proposed"
            and facility.get("proposedOpeningDate", "9999") <= assumptions.date.isoformat()
        ):
            capital += facility.get("costOverrides", {}).get(
                "capital_mvr", costs[f"{facility['kind']}_capital_mvr"]
            )
    old_routes = {r["activity_id"]: r for r in fleets[0]["routes"]}
    for route in fleets[1]["routes"]:
        old = old_routes.get(route["activity_id"])
        kind = "ferry" if route["mode"] == "ferry" else route["fleet_type"]
        units = max(0, route["procurement_fleet"] - (old["procurement_fleet"] if old else 0))
        factor = costs["ferry_capital_mvr"] if kind == "ferry" else costs[f"{kind}_bus_capital_mvr"]
        capital += units * factor
        if units and kind == "electric" and not old:
            capital += costs["electric_charging_capital_mvr"] * route["charging_units_costed"]
    delta_operating = subtract(
        unrounded[1]["annual_operating_mvr"], unrounded[0]["annual_operating_mvr"]
    )
    delta_emissions = subtract(
        unrounded[1]["annual_operating_kg_co2e"], unrounded[0]["annual_operating_kg_co2e"]
    )
    delta_fleet_emissions = subtract(
        unrounded[1]["annual_fleet_operating_kg_co2e"],
        unrounded[0]["annual_fleet_operating_kg_co2e"],
    )
    # The same unknown operating distances cancel in a project comparison.
    # Absolute totals remain unknown; changed or removed unknown-distance
    # services still make the corresponding delta unavailable.
    if (
        unrounded[0]["unknown_distance_patterns"]
        and unrounded[0]["unknown_distance_patterns"] == unrounded[1]["unknown_distance_patterns"]
    ):
        delta_operating = subtract(
            unrounded[1]["known_operating_mvr"], unrounded[0]["known_operating_mvr"]
        )
        delta_fleet_emissions = subtract(
            unrounded[1]["known_fleet_operating_kg_co2e"],
            unrounded[0]["known_fleet_operating_kg_co2e"],
        )
        facility_delta = subtract(
            unrounded[1]["annual_facility_operating_kg_co2e"],
            unrounded[0]["annual_facility_operating_kg_co2e"],
        )
        delta_emissions = (
            round(delta_fleet_emissions + facility_delta, 3) if facility_delta is not None else None
        )
        reasons.append(
            "Identical services with unknown operating distances cancel from the project "
            "change. Absolute operating cost and emissions totals remain unavailable."
        )
    displaced = assumptions.displaced_passenger_km * costs["displaced_kg_co2e_per_passenger_km"]
    net_emissions = delta_emissions - displaced if delta_emissions is not None else None
    return {
        "currency": "MVR",
        "basis": "MVR planning allowances with local benchmarks and explicit assumptions; "
        "inspect cost sources and factor provenance. Not supplier quotations.",
        "cost_basis": cost_basis(),
        "before": results[0],
        "after": results[1],
        "delta": {
            "capital_mvr": round(capital, 2),
            "annual_operating_mvr": delta_operating,
            "annual_operating_kg_co2e": delta_emissions,
            "annual_fleet_operating_kg_co2e": delta_fleet_emissions,
            "annual_facility_operating_kg_co2e": subtract(
                unrounded[1]["annual_facility_operating_kg_co2e"],
                unrounded[0]["annual_facility_operating_kg_co2e"],
            ),
            "embodied_facility_kg_co2e": subtract(
                unrounded[1]["embodied_facility_kg_co2e"],
                unrounded[0]["embodied_facility_kg_co2e"],
            ),
            "displaced_kg_co2e": displaced,
            "net_annual_kg_co2e": net_emissions,
            "additional_fleet": results[1]["required_fleet"] - results[0]["required_fleet"],
            "new_stops": new_stops,
        },
        "budget": {
            "capital_budget_mvr": assumptions.capital_budget_mvr,
            "capital_remaining_mvr": assumptions.capital_budget_mvr - capital
            if assumptions.capital_budget_mvr is not None
            else None,
            "capital_within_budget": capital <= assumptions.capital_budget_mvr
            if assumptions.capital_budget_mvr is not None
            else None,
            "annual_operating_budget_mvr": assumptions.annual_operating_budget_mvr,
            "annual_remaining_mvr": assumptions.annual_operating_budget_mvr - delta_operating
            if assumptions.annual_operating_budget_mvr is not None and delta_operating is not None
            else None,
        },
        "assumptions": costs,
        "calibration": calibration,
        "sensitivity": {
            "low": 0.7,
            "central": 1,
            "high": 1.4,
            "capital_mvr": {"low": capital * 0.7, "central": capital, "high": capital * 1.4},
            "meaning": "Illustrative -30%/+40% cost sensitivity, not statistical confidence",
        },
        "fleets": {"before": fleets[0], "after": fleets[1]},
        "warnings": sorted(
            set(
                reasons
                + [
                    "Costs are editable planning allowances, not supplier quotations. "
                    "Construction land, capacity, staffing, "
                    "facility energy, embodied emissions and lifecycle maintenance require "
                    "explicit estimates. Baseline existing facility emissions are outside "
                    "this project-change account; vehicle embodied emissions are unmeasured.",
                    "Annual service activity repeats the selected service day for the "
                    "explicitly chosen "
                    "operating-day count; a partial snapshot is not observed annual operation.",
                    "Accessibility gains do not predict ridership or private mode shift; displaced "
                    "passenger-km is a separate explicit assumption.",
                    "Financial savings do not imply sale receipts for retired vehicles "
                    "or facilities.",
                ]
            )
        ),
    }


def subtract(after: float | None, before: float | None) -> float | None:
    return round(after - before, 3) if after is not None and before is not None else None
