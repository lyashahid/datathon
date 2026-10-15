"""Capacity, duty, depot and charging screens for the actual generated vehicle blocks."""

from __future__ import annotations

from typing import Any

from app.planning.models import FleetResources
from app.routing.engine import _distance_m


def resource_audit(
    route: dict[str, Any],
    resource: FleetResources | None,
    stops: dict[str, Any],
    energy_inputs: dict[str, float],
    strict_depots: bool = True,
) -> dict[str, Any]:
    if resource is None:
        return {
            "status": "not_configured",
            "checks": [],
            "vehicle_duties": [],
            "meaning": "Add operator resources to screen capacity, duty, depots and charging.",
        }
    unknown_stops = set(resource.depot_stop_ids).difference(stops)
    if unknown_stops and strict_depots:
        raise ValueError(f"Unknown depot stop IDs: {', '.join(sorted(unknown_stops))}")
    checks = []

    def check(key: str, passed: bool | None, required: Any, available: Any, explanation: str):
        checks.append(
            {
                "key": key,
                "status": "unknown" if passed is None else "passed" if passed else "failed",
                "required": required,
                "available": available,
                "explanation": explanation,
            }
        )

    check(
        "available_fleet",
        None
        if resource.available_vehicles is None
        else resource.available_vehicles >= route["procurement_fleet"],
        route["procurement_fleet"],
        resource.available_vehicles,
        "Includes the selected reserve share; vehicle type is specific to this activity.",
    )
    demand, seats = resource.peak_passengers_per_departure, resource.vehicle_capacity
    check(
        "passenger_capacity",
        None if demand is None or seats is None else demand <= seats,
        demand,
        seats,
        "Explicit peak onboard passengers on one departure, not monthly "
        "ridership divided by trips or resident accessibility converted into demand.",
    )
    per_vehicle: dict[int, list[dict[str, Any]]] = {}
    for block in route["blocks"]:
        per_vehicle.setdefault(block["vehicle"], []).append(block)
    duties = []
    energy_rate = resource.energy_kwh_per_km or energy_inputs.get("electric_kwh_per_km")
    for vehicle, blocks in sorted(per_vehicle.items()):
        first, last = blocks[0], blocks[-1]
        km = (
            None
            if any(b.get("distance_km") is None for b in blocks)
            else sum(b["distance_km"] for b in blocks)
        )
        duty_hours = (last["end"] - first["start"]) / 60
        overnight = max(0, (first["start"] + 1440 - last["end"]) / 60)
        charging_hours = min(overnight, resource.overnight_charging_hours or 0)

        def at_depot(stop_id):
            stop = stops[stop_id]
            return any(
                _distance_m([stop["lon"], stop["lat"]], [stops[d]["lon"], stops[d]["lat"]]) <= 100
                for d in resource.depot_stop_ids
                if d in stops
            )

        depot_checked = bool(resource.depot_stop_ids)
        start_depot = at_depot(first["from"]) if depot_checked else None
        end_depot = at_depot(last["to"]) if depot_checked else None
        # Vehicles ending outside a declared depot get no invented overnight charging access.
        if end_depot is False:
            charging_hours = 0
        energy = km * energy_rate if km is not None and energy_rate is not None else None
        duties.append(
            {
                "vehicle": vehicle,
                "from": first["from"],
                "to": last["to"],
                "start_minutes": first["start"],
                "end_minutes": last["end"],
                "duty_hours": round(duty_hours, 3),
                "vehicle_km": km,
                "battery_energy_kwh": round(energy, 3) if energy is not None else None,
                "overnight_hours_before_next_duty": round(overnight, 3),
                "charging_hours_available": round(charging_hours, 3),
                "starts_at_depot": start_depot,
                "ends_at_depot": end_depot,
            }
        )
    longest = max((d["duty_hours"] for d in duties), default=0)
    check(
        "vehicle_duty",
        None
        if resource.max_vehicle_duty_hours is None
        else longest <= resource.max_vehicle_duty_hours,
        longest,
        resource.max_vehicle_duty_hours,
        "Vehicle duty span includes inter-trip gaps and terminal layover. This is not a "
        "driver-shift or crew-rest certificate.",
    )
    depot_ok = all(d["starts_at_depot"] and d["ends_at_depot"] for d in duties)
    check(
        "depot_positioning",
        depot_ok if resource.depot_stop_ids else None,
        sorted({d["from"] for d in duties} | {d["to"] for d in duties}),
        resource.depot_stop_ids or None,
        "First and last terminals must be within 100 m of "
        "a declared depot. Deadhead distances, energy and times are not invented.",
    )
    if route["fleet_type"] == "electric":
        energy_known = all(d["battery_energy_kwh"] is not None for d in duties)
        maximum = (
            max((d["battery_energy_kwh"] for d in duties), default=0) if energy_known else None
        )
        battery_usable = (
            resource.battery_kwh * (1 - resource.battery_reserve_share)
            if (resource.battery_kwh is not None)
            else None
        )
        check(
            "battery_range",
            None if maximum is None or battery_usable is None else maximum <= battery_usable,
            maximum,
            battery_usable,
            "Each vehicle begins fully charged; reserve is protected. No daytime charging "
            "or spare-vehicle swaps are inferred.",
        )
        power = resource.charger_power_kw
        slots = resource.charger_count
        hours = resource.overnight_charging_hours
        charger_known = (
            energy_known and power is not None and slots is not None and hours is not None
        )
        total_energy = sum(d["battery_energy_kwh"] for d in duties) if energy_known else None
        supplied = slots * power * hours * resource.charging_efficiency if charger_known else None
        individual_ok = (
            all(
                d["battery_energy_kwh"]
                <= power * d["charging_hours_available"] * resource.charging_efficiency
                for d in duties
            )
            if charger_known
            else None
        )
        # These are necessary screens, not a claim that overlapping plug windows are scheduled.
        check(
            "overnight_energy",
            None if not charger_known else total_energy <= supplied and bool(individual_ok),
            total_energy,
            supplied,
            "Dedicated chargers for this route: constant-power energy pool and each vehicle's "
            "window before its next daily duty. Shared depots, overlapping plug windows, "
            "charge taper and grid outages need an actual charging schedule.",
        )
    failed = any(c["status"] == "failed" for c in checks)
    incomplete = any(c["status"] == "unknown" for c in checks)
    return {
        "status": "constraints_failed"
        if failed
        else "incomplete"
        if incomplete
        else "screens_passed",
        "checks": checks,
        "vehicle_duties": duties,
        "resources": resource.model_dump(mode="json"),
        "unavailable_depot_stop_ids": sorted(unknown_stops),
        "meaning": "Necessary feasibility screens for greedy blocks, not optimized "
        "dispatch approval. Resources belong exclusively to this route/propulsion group. "
        "Baseline and scenario are screened against the same declared resource envelope.",
    }
