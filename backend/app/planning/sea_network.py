"""Nationwide sea evidence and a qualified population/frequency screening proxy.

Whole-island projected residents are potential demand, not ferry passengers.
Published route-start departures are supply opportunities, not observed trips.
Neither quantity establishes occupancy, available seats or fleet sufficiency.
"""

from __future__ import annotations

import copy
import hashlib
import math
from collections import defaultdict
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from statistics import median, quantiles
from typing import Any

from app.data.computed_cache import model_code_version
from app.planning.repository import IDENTITY_BRIDGE

PRESSURE_METHOD = (
    "Sum the 2026 projected residents of the route's distinct matched islands, then "
    "divide by unique published route-start sailing chains over the seven days "
    "beginning on the selected date. This does not count a separate departure at "
    "every intermediate port. Low/moderate/high are relative thirds of the "
    "captured network's known ratios, not congestion or capacity thresholds."
)
PRESSURE_LIMITATION = (
    "Whole-island population is potential demand, not observed ferry passengers. "
    "Trips made, visitors, transfers, competing services, seats, vessel assignments "
    "and occupancy are unknown; no fleet shortage or excess service is inferred."
)


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _daily_supply(route: dict[str, Any], day: date) -> tuple[float | None, bool, bool]:
    """Return known opportunities, completeness and whether headways were used.

    Interval/headway arithmetic remains an estimate. Unknown windows never turn
    into zero service, and historical/map-only records never become current supply.
    """
    if (
        route.get("proposed")
        or route.get("evidence") == "mapped_route"
        or route.get("validity_status") in {"historical", "unverified", "validity_unconfirmed"}
        or not route.get("valid_from")
        or route["valid_from"] > day.isoformat()
        or (route.get("valid_until") and route["valid_until"] < day.isoformat())
    ):
        return None, False, False
    timing = route.get("timing_status")
    if timing == "complete_timetable":
        # _finish_route already deduplicates physical route-start departure clocks
        # after equivalent publication calendars are merged by the sea service.
        return float(len(route["departures"])), True, False
    published = {
        value
        for value in route.get("published_departures", [])
        if _number(value) and 0 <= value < 1440
    }
    windows = route.get("frequency_windows", [])
    if timing not in {"departure_only", "published_arrival"} and not published and not windows:
        return None, False, False
    # Integrate a piecewise rate over a union of intervals. Overlapping publication
    # windows cannot double the same service, and explicit clocks inside an
    # interval are not counted again on top of its estimated frequency.
    intervals = [
        (window["start_minutes"], window["end_minutes"], window["headway_minutes"])
        for window in windows
        if all(
            _number(window.get(key)) for key in ("start_minutes", "end_minutes", "headway_minutes")
        )
        and 0 <= window["start_minutes"] < window["end_minutes"] <= 1440
        and window["headway_minutes"] > 0
    ]
    boundaries = sorted({value for start, end, _ in intervals for value in (start, end)})
    estimated = sum(
        (end - start) / max(headway for a, b, headway in intervals if a <= start and end <= b)
        for start, end in zip(boundaries, boundaries[1:])
        if any(a <= start and end <= b for a, b, _ in intervals)
    )
    clocks = sum(not any(a <= value < b for a, b, _ in intervals) for value in published)
    return float(clocks + estimated), not bool(route.get("unknown_windows")), bool(intervals)


def _population(islands: list[dict[str, Any]], route: dict[str, Any]) -> float | None:
    totals = {
        IDENTITY_BRIDGE.get(island["id"], island["id"]): island.get("population2026")
        for island in islands
    }
    identities = {
        IDENTITY_BRIDGE.get(stop.get("island_id"), stop.get("island_id")) for stop in route["stops"]
    }
    if (
        None in identities
        or not identities
        or any(not _number(totals.get(identity)) or totals[identity] < 0 for identity in identities)
    ):
        return None
    return round(sum(totals[identity] for identity in identities), 2)


def assess_pressure(
    routes: list[dict[str, Any]],
    weekly_routes: list[tuple[date, list[dict[str, Any]]]],
    islands: list[dict[str, Any]],
) -> dict[str, Any]:
    """Attach transparent route-level metrics without manufacturing ferry demand."""
    supply: dict[str, list[tuple[float | None, bool, bool]]] = defaultdict(list)
    headways: dict[str, set[float]] = defaultdict(set)
    for day, records in weekly_routes:
        for route in records:
            supply[route["id"]].append(_daily_supply(route, day))
            headways[route["id"]].update(
                window["headway_minutes"]
                for window in route.get("frequency_windows", [])
                if _number(window.get("headway_minutes")) and window["headway_minutes"] > 0
            )
    ratios = []
    for route in routes:
        days = supply[route["id"]]
        complete = len(days) == 7 and all(value is not None and known for value, known, _ in days)
        known = [value for value, _, _ in days if value is not None]
        weekly = round(sum(known), 2) if complete else None
        population = _population(islands, route)
        ratio = (
            round(population / weekly, 2)
            if population is not None and weekly and weekly > 0
            else None
        )
        windows = sorted(headways[route["id"]])
        estimated = any(estimate for _, _, estimate in days)
        route["pressure"] = {
            "level": "unknown",
            "label": "Estimated pressure unknown",
            "explanation": PRESSURE_LIMITATION,
            "population": population,
            "population_year": 2026,
            "departures_per_week": weekly,
            "known_departures_per_week": round(sum(known), 2) if known else None,
            "residents_per_weekly_departure": ratio,
            "headway_minutes": windows[0] if len(windows) == 1 else None,
            "headway_min_minutes": windows[0] if windows else None,
            "headway_max_minutes": windows[-1] if windows else None,
            "frequency_basis": "published_headway_estimate"
            if estimated
            else "published_departures"
            if complete
            else "unknown",
            "frequency_complete": complete,
            "capacity": None,
            "capacity_basis": None,
            "ridership": None,
            "basis": "population_per_weekly_departure" if ratio is not None else "unknown",
        }
        if ratio is not None:
            ratios.append(ratio)
        else:
            reason = (
                "One or more served islands has no separate 2026 population projection. "
                if population is None
                else "A complete date-valid weekly departure count is unavailable. "
                if weekly is None
                else "No departures are published in this seven-day interval. "
            )
            route["pressure"]["explanation"] = reason + PRESSURE_LIMITATION
    low, high = (
        quantiles(ratios, n=3, method="inclusive")
        if len(ratios) >= 3
        else ((median(ratios), median(ratios)) if ratios else (None, None))
    )
    for route in routes:
        pressure = route["pressure"]
        ratio = pressure["residents_per_weekly_departure"]
        if ratio is None:
            continue
        level = "low" if ratio < low else "high" if ratio > high else "medium"
        label = "moderate" if level == "medium" else level
        opportunities = (
            "estimated service opportunities"
            if pressure["frequency_basis"] == "published_headway_estimate"
            else "published route-start departures"
        )
        pressure.update(
            level=level,
            label=f"Estimated pressure {label}",
            explanation=(
                f"{pressure['population']:,.0f} projected residents across distinct served "
                f"islands / {pressure['departures_per_week']:g} "
                f"{opportunities} "
                f"in seven days = {ratio:,.1f} residents per weekly departure. "
                "This is relative to the captured network. " + PRESSURE_LIMITATION
            ),
        )
    return {
        "low_max": round(low, 2) if low is not None else None,
        "high_min": round(high, 2) if high is not None else None,
        "reference_routes": len(ratios),
        "unit": "projected_residents_per_weekly_route_start_departure",
        "boundary_rule": "Below low_max is low; above high_min is high; boundaries are moderate.",
    }


@lru_cache(maxsize=32)
def _file_content(path: Path, modified: int, size: int) -> str:
    # Metadata bounds memoization; content, rather than deployment timestamps,
    # identifies the source in persistent keys across server restarts.
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _file_version(path: Path) -> str | None:
    try:
        metadata = path.stat()
        return _file_content(path, metadata.st_mtime_ns, metadata.st_size)
    except FileNotFoundError:
        return None


def _scheduled_sailings(route: dict[str, Any]) -> list[dict[str, float]]:
    """Expose exact two-stop calls already date-validated by the source adapters.

    Negative departures retain a previous service day's crossing after midnight.
    A conflicting arrival for the same departure is ambiguous and stays unused.
    Multi-stop dwell and variable segment speeds cannot be represented by a
    single endpoint interpolation, so those routes keep illustration-only icons.
    """
    if (
        route.get("timing_status") != "complete_timetable"
        or route.get("validity_status") not in {"current", "dated_snapshot"}
        or route.get("proposed")
        or route.get("evidence") != "dated_service"
        or len(route.get("stops", [])) != 2
    ):
        return []
    arrivals: dict[float, set[float]] = defaultdict(set)
    for trip in route.get("_trips", []):
        calls = trip.get("calls", [])
        if len(calls) != 2 or any(
            call.get("id") != stop.get("id") or call.get("island_id") != stop.get("island_id")
            for call, stop in zip(calls, route["stops"])
        ):
            continue
        departure = calls[0].get("departure_minutes")
        arrival = calls[1].get("arrival_minutes")
        if (
            _number(departure)
            and _number(arrival)
            and -1440 <= departure < 1440
            and 0 <= arrival <= 2880
            and arrival > departure
        ):
            arrivals[departure].add(arrival)
    return [
        {"departure_minutes": departure, "arrival_minutes": next(iter(values))}
        for departure, values in sorted(arrivals.items())
        if len(values) == 1
    ]


def network_inputs(service: Any, day: date) -> dict[str, Any]:
    """Identical source keys for calculated objects and serialized HTTP snapshots."""
    service._snapshot()
    reviewed = service.transport.updates.catalogue().get("services", [])
    corridor_path = service.path.with_name("sea-corridors.json")
    return {
        "version": (
            service.source_version.version() if service.source_version else model_code_version()
        ),
        "date": day.isoformat(),
        "baseline": service.planning.repository.baseline_fingerprint(),
        "source": _file_version(service.path),
        "reviewed_services": reviewed,
        "corridors": _file_version(corridor_path),
        "terminals": service.transport.terminals,
        "shoreline": service._shoreline_fingerprint,
    }


def network(service: Any, day: date) -> dict[str, Any]:
    """Preload every retained route, independently of the selected origin island."""
    inputs = network_inputs(service, day)
    key = service.planning._digest(inputs)
    with service._lock:
        if key in service._network_cache:
            service._network_cache.move_to_end(key)
            return copy.deepcopy(service._network_cache[key])

    def calculate() -> dict[str, Any]:
        return _calculate_network(service, day, service._snapshot(), inputs["reviewed_services"])

    cache = service.planning.computed_cache
    result = cache.get_or_compute("sea-network", inputs, calculate) if cache else calculate()
    with service._lock:
        service._network_cache[key] = copy.deepcopy(result)
        while len(service._network_cache) > 8:
            service._network_cache.popitem(last=False)
    return result


def _calculate_network(
    service: Any, day: date, bundle: dict[str, Any], reviewed: list[dict[str, Any]]
) -> dict[str, Any]:
    from app.planning.sea import SeaConnectionsRequest, _source, collection

    world = service.planning._baseline_view()
    # Origin is not used for national topology, geometry or pressure. Reuse the
    # existing strict source adapters rather than introducing another parser.
    identity = next(iter(service.transport.repository.islands_by_id))
    body = SeaConnectionsRequest(origin_island_id=identity, date=day)
    routes = (
        service._official_routes(body)
        + service._world_routes(world, body)
        + service._mapped_routes()
    )
    imports, import_sources = service._reviewed_routes(body, reviewed)
    routes += imports
    routes = list({route["id"]: route for route in reversed(routes)}.values())[::-1]
    weekly = []
    for offset in range(7):
        service_day = day + timedelta(days=offset)
        request = body.model_copy(update={"date": service_day})
        records = service._official_routes(request) + service._world_routes(world, request)
        records += service._reviewed_routes(request, reviewed)[0]
        unique = list({route["id"]: route for route in reversed(records)}.values())[::-1]
        weekly.append((service_day, unique))
    thresholds = assess_pressure(
        routes, weekly, service.planning.repository.baseline.get("islands", [])
    )
    features, ports = [], {}
    for route in routes:
        route["scheduled_sailings"] = _scheduled_sailings(route)
        service._map_geometry(route)
        if route["geometry"] is None:
            continue
        pressure = route["pressure"]
        features.append(
            {
                "type": "Feature",
                "id": route["id"],
                "geometry": route["geometry"],
                "properties": {
                    "kind": "sea_route",
                    "route_id": route["id"],
                    "name": route["name"],
                    "evidence": route["evidence"],
                    "proposed": route["proposed"],
                    "from_island_id": route["from_island_id"],
                    "to_island_id": route["to_island_id"],
                    "geometry_basis": route["geometry_basis"],
                    "pressure_level": pressure["level"],
                    "pressure_label": pressure["label"],
                    "pressure_explanation": pressure["explanation"],
                    **{
                        field: pressure[field]
                        for field in (
                            "population",
                            "departures_per_week",
                            "residents_per_weekly_departure",
                            "headway_minutes",
                            "capacity",
                        )
                    },
                },
            }
        )
        ports.update({stop["terminal_id"]: stop for stop in route["stops"]})
    for identity, port in ports.items():
        features.append(
            {
                "type": "Feature",
                "id": f"sea-port:{identity}",
                "geometry": {"type": "Point", "coordinates": port["coordinates"]},
                "properties": {
                    "kind": "sea_terminal",
                    "terminal_id": identity,
                    "island_id": port["island_id"],
                    "name": port.get("island_name") or service._island(port["island_id"])["name"],
                    "terminal_name": port["name"],
                    "status": "direct",
                },
            }
        )
    sources = {_source(source)["id"]: _source(source) for source in bundle.get("sources", [])}
    sources.update({source["id"]: source for source in import_sources})
    for source in service.planning.repository.baseline.get("sources", []):
        if source.get("id") in {
            identity for route in routes for identity in route["source_ids"]
        } | {"mbs-island-projections"}:
            sources.setdefault(source["id"], _source(source))
    sources.setdefault(
        "openstreetmap",
        {
            "id": "openstreetmap",
            "title": "Mapped ferry corridors",
            "url": "https://www.openstreetmap.org/copyright",
            "publisher": "OpenStreetMap contributors",
        },
    )
    result = {
        "service_date": day.isoformat(),
        "timezone": "Indian/Maldives",
        "routes": [{k: v for k, v in route.items() if k != "_trips"} for route in routes],
        "map_features": collection(features),
        "sources": list(sources.values()),
        "coverage": {
            "scope": "nationwide_retained_evidence",
            "route_count": len(routes),
            "mapped_routes": sum(route["geometry"] is not None for route in routes),
            "unmapped_routes": sum(route["geometry"] is None for route in routes),
            "documented_islands": len(
                {identity for route in routes for identity in route["stop_island_ids"]}
            ),
            "total_islands": len(service.transport.repository.islands_by_id),
            "pressure_method": PRESSURE_METHOD,
            "pressure_thresholds": thresholds,
            "frequency_window_start": day.isoformat(),
            "frequency_window_end": (day + timedelta(days=6)).isoformat(),
            "notes": [
                "All retained evidence is shown, including historical and unverified records; "
                "it is not every ferry operating in the Maldives.",
                "Missing evidence does not mean no service. Lines use recorded ports and modeled "
                "water corridors; missing or unsafe geometry is omitted, never replaced by "
                "island centroids.",
                "Published recurrence is not a live service guarantee. Weather, cancellations "
                "and dated holiday exceptions are unverified.",
                PRESSURE_LIMITATION,
            ],
        },
    }
    return result
