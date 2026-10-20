"""Retained domestic airline route facts, separate from live aircraft observations.

Airport-to-airport lines are schematic connections. Published destinations do
not establish today's timetable, passenger demand, aircraft assignment or load.
"""

from __future__ import annotations

import json
import math
from datetime import date
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from app.data.computed_cache import ComputedCache, SourceVersion, model_code_version

PRESSURE_LIMITATION = (
    "Current route-level passenger demand, available seats and a date-valid departure "
    "frequency are not retained. Airport-island population is not an airline catchment "
    "or observed passenger demand; congestion, occupancy and aircraft shortages are unknown."
)
GEOMETRY_QUALIFICATION = (
    "Schematic connection between mapped airport positions, not a flown track, airway "
    "or an aircraft position. Airport positions are retained OpenStreetMap evidence."
)


def _coordinates(value: Any) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        return None
    lon, lat = value[:2]
    if not all(
        isinstance(number, (int, float)) and not isinstance(number, bool) and math.isfinite(number)
        for number in (lon, lat)
    ) or not (72 <= lon <= 75 and -1 <= lat <= 8.5):
        return None
    return [lon, lat]


def airport_catalogue(features: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Join explicit IATA codes only; never substitute island centroids or names."""
    airports = {}
    for feature in sorted(features, key=lambda row: str(row.get("id", ""))):
        tags = feature.get("tags") or {}
        iata = str(tags.get("iata") or "").strip().upper()
        geometry = feature.get("geometry") or {}
        coordinates = _coordinates(geometry.get("coordinates"))
        if (
            feature.get("category") != "aerodrome"
            or len(iata) != 3
            or not iata.isascii()
            or not iata.isalpha()
            or geometry.get("type") != "Point"
            or coordinates is None
            or tags.get("military")
        ):
            continue
        record = {
            "id": f"airport:{iata}",
            "iata": iata,
            "icao": tags.get("icao"),
            "name": tags.get("name:en") or feature.get("name") or iata,
            "island_id": feature.get("island_id"),
            "coordinates": coordinates,
            "coordinate_source_id": "openstreetmap",
            "source_feature_id": feature.get("id"),
        }
        previous = airports.get(iata)
        if previous is None or (previous["island_id"] is None and record["island_id"]):
            airports[iata] = record
    return airports


def _airport_code(value: Any) -> str | None:
    code = str(value or "").strip().upper()
    return code if len(code) == 3 and code.isascii() and code.isalpha() else None


def _connection_geometry(
    origin: str, destination: str, airports: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    """Draw a restrained schematic arc, never an inferred intermediate airport.

    A local equirectangular projection keeps the bend in metres at Maldives
    latitudes. Canonical endpoint order gives the same curve in either direction;
    a stable pair seed fans neighbouring connections to both sides of the hub.
    """
    if origin not in airports or destination not in airports:
        return None
    first, last = sorted((origin, destination))
    start, end = airports[first]["coordinates"], airports[last]["coordinates"]
    latitude_scale = math.pi * 6_371_008.8 / 180
    longitude_scale = latitude_scale * math.cos(math.radians((start[1] + end[1]) / 2))
    dx = (end[0] - start[0]) * longitude_scale
    dy = (end[1] - start[1]) * latitude_scale
    distance = math.hypot(dx, dy)
    if not distance:
        return {"type": "LineString", "coordinates": [start, end]}
    seed = sha256(f"{first}:{last}".encode("ascii")).digest()
    hub = "MLE" in (first, last)
    bend_fraction = (0.09 + 0.05 * seed[1] / 255) if hub else (0.065 + 0.035 * seed[1] / 255)
    midpoint_bend = min(distance * bend_fraction, 60_000 if hub else 20_000)
    # A quadratic's midpoint is halfway from the chord to its control point.
    control_offset = midpoint_bend * (2 if seed[0] % 2 else -2)
    control_x = dx / 2 - dy / distance * control_offset
    control_y = dy / 2 + dx / distance * control_offset
    segments = max(16, min(48, math.ceil(distance / 20_000)))
    coordinates = [start]
    for index in range(1, segments):
        progress = index / segments
        inverse = 1 - progress
        x = 2 * inverse * progress * control_x + progress * progress * dx
        y = 2 * inverse * progress * control_y + progress * progress * dy
        coordinates.append([start[0] + x / longitude_scale, start[1] + y / latitude_scale])
    coordinates.append(end)
    return {
        "type": "LineString",
        "coordinates": coordinates if origin == first else list(reversed(coordinates)),
    }


def _route_legs(
    identity: str,
    itinerary: list[str],
    airports: dict[str, dict[str, Any]],
    bidirectional: bool,
) -> list[dict[str, Any]]:
    """Keep published stops in order; an absent coordinate cannot create a shortcut."""
    legs = []
    for index, (origin, destination) in enumerate(zip(itinerary, itinerary[1:])):
        start, end = airports.get(origin), airports.get(destination)
        geometry = _connection_geometry(origin, destination, airports)
        legs.append(
            {
                "id": f"{identity}:leg:{index + 1}",
                "index": index,
                "from_iata": origin,
                "to_iata": destination,
                "from_airport_id": f"airport:{origin}",
                "to_airport_id": f"airport:{destination}",
                "from_airport": start,
                "to_airport": end,
                "from_island_id": start["island_id"] if start else None,
                "to_island_id": end["island_id"] if end else None,
                "bidirectional": bidirectional,
                "connection_role": "hub" if "MLE" in (origin, destination) else "regional",
                "geometry": geometry,
                "geometry_basis": "schematic_airport_connection"
                if geometry
                else "airport_coordinates_unavailable",
            }
        )
    return legs


def build_air_network(
    bundle: dict[str, Any], airports: dict[str, dict[str, Any]], day: date
) -> dict[str, Any]:
    """Keep route facts with their provenance; missing schedules remain unknown."""
    sources = {}
    for row in bundle.get("sources", []):
        if not isinstance(row, dict) or not isinstance(row.get("id"), str):
            continue
        url = urlsplit(str(row.get("url") or ""))
        if url.scheme in {"https", "http"} and url.hostname and not url.username:
            sources[row["id"]] = row
    routes = {}
    rejected = 0
    for row in bundle.get("routes", []):
        if not isinstance(row, dict):
            rejected += 1
            continue
        identity = row.get("id")
        origin = _airport_code(row.get("from_iata"))
        destination = _airport_code(row.get("to_iata"))
        via = row.get("via_iata", [])
        via = [_airport_code(value) for value in via] if isinstance(via, list) else [None]
        itinerary = [origin, *via, destination]
        source_ids = sorted(
            {value for value in row.get("source_ids", []) if isinstance(value, str)}
            & sources.keys()
        )
        if (
            not isinstance(identity, str)
            or not identity
            or not row.get("operator")
            or origin == destination
            or any(code is None for code in itinerary)
            or any(start == end for start, end in zip(itinerary, itinerary[1:]))
            or not source_ids
            or row.get("evidence") not in {"published_route", "historical_timetable"}
        ):
            rejected += 1
            continue
        # Duplicate publication records never add a second route/vehicle.
        if identity in routes:
            previous = routes[identity]
            if (
                previous["itinerary_iata"],
                previous["operator"],
                previous["bidirectional"],
            ) != (
                itinerary,
                row["operator"],
                row.get("bidirectional") is True,
            ):
                rejected += 1
                continue
            routes[identity]["source_ids"] = sorted(
                set(routes[identity]["source_ids"]) | set(source_ids)
            )
            continue
        start, end = airports.get(origin), airports.get(destination)
        bidirectional = row.get("bidirectional") is True
        legs = _route_legs(identity, itinerary, airports, bidirectional)
        geometry = (
            {
                "type": "LineString",
                "coordinates": [
                    point
                    for index, leg in enumerate(legs)
                    for point in leg["geometry"]["coordinates"][1 if index else 0 :]
                ],
            }
            if all(leg["geometry"] for leg in legs)
            else None
        )
        from_name = start["name"] if start else row.get("from_name") or origin
        to_name = end["name"] if end else row.get("to_name") or destination
        routes[identity] = {
            "id": identity,
            "name": row.get("name") or f"{from_name} – {to_name}",
            "operator": row["operator"],
            "from_iata": origin,
            "to_iata": destination,
            "via_iata": via,
            "itinerary_iata": itinerary,
            "legs": legs,
            "from_airport_id": f"airport:{origin}",
            "to_airport_id": f"airport:{destination}",
            "from_airport": start,
            "to_airport": end,
            "from_island_id": start["island_id"] if start else None,
            "to_island_id": end["island_id"] if end else None,
            "bidirectional": bidirectional,
            "evidence": row["evidence"],
            "source_ids": source_ids,
            "valid_from": row.get("valid_from"),
            "valid_until": row.get("valid_until"),
            "validity_status": (
                "historical"
                if row.get("valid_until") and row["valid_until"] < day.isoformat()
                else "not_yet_valid"
                if row.get("valid_from") and row["valid_from"] > day.isoformat()
                else "date_unconfirmed"
            ),
            "qualification": row.get("qualification")
            or "Published route fact; operation on the selected date is unconfirmed.",
            "geometry": geometry,
            "geometry_basis": "schematic_airport_connection"
            if geometry
            else "airport_coordinates_unavailable",
            "geometry_qualification": GEOMETRY_QUALIFICATION,
            "schedule": {
                "status": "not_retained",
                "departures": [],
                "departures_per_day": None,
                "departures_per_week": None,
                "qualification": (
                    "A published destination or route does not establish daily flights "
                    "or weekly frequency."
                ),
            },
            "published_schedule": row.get("published_schedule"),
            "pressure": {
                "level": "unknown",
                "label": "Pressure unknown",
                "explanation": PRESSURE_LIMITATION,
                "departures_per_week": None,
                "capacity": None,
                "ridership": None,
                "load_factor": None,
            },
            "live_linkage": {
                "status": "unavailable",
                "flight_ids": [],
                "qualification": (
                    "No verified flight-to-route or aircraft assignment. Live positions "
                    "are an independent observation layer."
                ),
            },
        }
    records = list(routes.values())
    used_airports = {
        endpoint["id"]: endpoint
        for route in records
        for leg in route["legs"]
        for endpoint in (leg["from_airport"], leg["to_airport"])
        if endpoint
    }
    features = [
        {
            "type": "Feature",
            "id": f"air-route:{route['id']}"
            if len(route["legs"]) == 1
            else f"air-route:{leg['id']}",
            "geometry": leg["geometry"],
            "properties": {
                "kind": "air_route",
                **{
                    key: route[key]
                    for key in (
                        "id",
                        "operator",
                        "evidence",
                        "bidirectional",
                    )
                },
                **{
                    key: leg[key]
                    for key in (
                        "from_iata",
                        "to_iata",
                        "from_island_id",
                        "to_island_id",
                        "geometry_basis",
                        "connection_role",
                    )
                },
                "name": route["name"]
                if len(route["legs"]) == 1
                else (
                    f"{(leg['from_airport'] or {}).get('name', leg['from_iata'])} – "
                    f"{(leg['to_airport'] or {}).get('name', leg['to_iata'])}"
                ),
                "route_id": route["id"],
                "leg_id": leg["id"],
                "leg_index": leg["index"],
                "leg_count": len(route["legs"]),
                "itinerary_from_iata": route["from_iata"],
                "itinerary_to_iata": route["to_iata"],
                "pressure_level": route["pressure"]["level"],
                "pressure_label": route["pressure"]["label"],
            },
        }
        for route in records
        for leg in route["legs"]
        if leg["geometry"] is not None
    ]
    if used_airports:
        sources.setdefault(
            "openstreetmap",
            {
                "id": "openstreetmap",
                "title": "Retained mapped airport positions",
                "url": "https://www.openstreetmap.org/copyright",
                "publisher": "OpenStreetMap contributors",
                "qualification": (
                    "OSM aerodrome representative positions; not surveyed aircraft locations."
                ),
            },
        )
    return {
        "service_date": day.isoformat(),
        "timezone": "Indian/Maldives",
        "retrieved_at": bundle.get("retrieved_at"),
        "routes": records,
        "airports": list(used_airports.values()),
        "map_features": {"type": "FeatureCollection", "features": features},
        "sources": list(sources.values()),
        "coverage": {
            "scope": "retained_domestic_airline_route_evidence",
            "route_count": len(records),
            "mapped_routes": sum(route["geometry"] is not None for route in records),
            "unmapped_routes": sum(route["geometry"] is None for route in records),
            "mapped_legs": len(features),
            "unmapped_legs": sum(
                leg["geometry"] is None for route in records for leg in route["legs"]
            ),
            "directed_leg_count": sum(
                len(route["legs"]) * (2 if route["bidirectional"] else 1) for route in records
            ),
            "documented_airports": len(used_airports),
            "rejected_records": rejected,
            "pressure_method": (
                "Unknown: no defensible route-level demand and current frequency evidence retained."
            ),
            "notes": [
                "Retained published airline route facts are not a complete or live domestic "
                "timetable. Missing evidence does not mean no service.",
                GEOMETRY_QUALIFICATION,
                "Any vehicle moving along a schematic route is an illustration, not live tracking, "
                "an aircraft assignment or an operational departure.",
                PRESSURE_LIMITATION,
            ],
        },
    }


@lru_cache(maxsize=8)
def _read_bundle(path: Path, modified_ns: int, size: int) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


class AirNetworkService:
    def __init__(
        self,
        repository: Any,
        public_dir: Path,
        *,
        cache: ComputedCache | None = None,
        source_version: SourceVersion | None = None,
    ) -> None:
        self.repository = repository
        self.path = public_dir / "domestic-air-services.json"
        self.cache = cache
        self.source_version = source_version

    def network_inputs(self, day: date) -> list[Any]:
        if self.path.is_file():
            stat = self.path.stat()
            bundle = _read_bundle(self.path, stat.st_mtime_ns, stat.st_size)
        else:
            bundle = {}
        airports = airport_catalogue(self.repository.transport.get("features", []))
        return [
            self.source_version.version() if self.source_version else model_code_version(),
            day.isoformat(),
            bundle,
            airports,
        ]

    def network(self, day: date) -> dict[str, Any]:
        inputs = self.network_inputs(day)

        def calculate() -> dict[str, Any]:
            return build_air_network(inputs[2], inputs[3], day)

        return (
            self.cache.get_or_compute("air-network", inputs, calculate)
            if self.cache
            else calculate()
        )
