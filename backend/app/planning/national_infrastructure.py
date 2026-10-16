"""Convert the existing national inventory into routable planning evidence.

Official directories establish institution identities. Existing OSM matches and
roads establish approximate locations, never inspected entrances or capacity.
Unlocated and provisional matches remain in the national inventory, not routes.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

import osmium

from app.planning.repository import IDENTITY_BRIDGE
from app.routing.builder import _IslandIndex

RTL_URL = "https://bo.rtl.mv:4455/maldives/api/booking/v2/bus/routedetails"
GRAPH_OSM_SOURCE_ID = "osm-geofabrik-national-graph"
ACCEPTED_MATCHES = {"exact_normalized_name", "exact_source_identifier", "reviewed_osm_match"}


def source_receipt(path: Path, root: Path) -> dict[str, Any]:
    return {
        "path": path.relative_to(root).as_posix(),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "bytes": path.stat().st_size,
    }


def graph_source_pbf(root: Path) -> tuple[Path, dict[str, Any]]:
    """Use the original normalized graph's source, never an unrelated root snapshot."""
    cache = root / "backend/data/cache"
    path = cache / "raw/osm/maldives-latest.osm.pbf"
    metadata_path = path.with_name(path.name + ".meta.json")
    graph_metadata_path = cache / "graphs/land.json.meta.json"
    if not all(item.is_file() for item in (path, metadata_path, graph_metadata_path)):
        raise ValueError("Cached land graph OSM source/metadata unavailable; rebuild normalization")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    graph_metadata = json.loads(graph_metadata_path.read_text(encoding="utf-8"))
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != metadata.get("sha256"):
        raise ValueError("Cached graph OSM source checksum differs from its capture metadata")
    if not metadata.get("retrieved_at") or not graph_metadata.get("retrieved_at"):
        raise ValueError("Cached graph/source capture dates unavailable; rebuild normalization")
    if metadata["retrieved_at"] > graph_metadata["retrieved_at"]:
        raise ValueError("Cached OSM source is newer than the land graph; rebuild normalization")
    return path, metadata


class RoadTags(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.tags: dict[str, dict[str, str]] = {}

    def way(self, way: Any) -> None:
        if way.tags.get("highway"):
            self.tags[str(way.id)] = dict(way.tags)


def planning_network(land: dict[str, Any], tags: dict[str, dict[str, str]]) -> dict[str, Any]:
    nodes, edges = {}, []
    for island_id, graph in sorted(land.get("islands", {}).items()):
        if island_id in IDENTITY_BRIDGE.values():
            continue
        for node in graph["nodes"]:
            identity = f"national:osm:{node['id']}"
            lon, lat = node["coordinates"]
            nodes[identity] = {
                "id": identity,
                "lon": lon,
                "lat": lat,
                "islandId": island_id,
                "provenance": "existing national OSM road node",
            }
        grouped: dict[str, list[dict[str, Any]]] = {}
        for edge in graph["edges"]:
            grouped.setdefault(edge["id"].removesuffix(":reverse"), []).append(edge)
        for identity, pair in sorted(grouped.items()):
            forward = next((e for e in pair if not e["id"].endswith(":reverse")), None)
            reverse = next((e for e in pair if e["id"].endswith(":reverse")), None)
            edge = forward or reverse
            if edge is None:
                continue
            way_tags = tags.get(edge["source_way_id"], {})
            if way_tags.get("highway") in {"construction", "proposed", "raceway"}:
                continue
            permission = edge.get("permissions", {})
            walk = bool(permission.get("walk"))
            if way_tags.get("access") in {"no", "private"} and way_tags.get("foot") not in {
                "yes",
                "designated",
                "permissive",
                "destination",
            }:
                walk = False
            foot_direction = way_tags.get("oneway:foot", "no")
            # Car one-way rules must not silently become pedestrian one-way rules.
            walk_forward = foot_direction != "-1"
            walk_reverse = foot_direction not in {"yes", "1", "true"}
            if forward is None:
                walk_forward, walk_reverse = walk_reverse, walk_forward
            edges.append(
                {
                    "id": f"national:{identity}",
                    "from": f"national:osm:{edge['from_id']}",
                    "to": f"national:osm:{edge['to_id']}",
                    "distanceM": edge["distance_m"],
                    "geometry": edge["geometry"],
                    "islandId": island_id,
                    "walkAllowed": walk,
                    "walkForwardAllowed": walk_forward,
                    "walkReverseAllowed": walk_reverse,
                    "driveAllowed": bool(permission.get("car")),
                    "driveForwardAllowed": True,
                    "driveReverseAllowed": forward is not None and reverse is not None,
                    "auditedWheelchairAllowed": False,
                    "sourceOsmWayId": edge["source_way_id"],
                    "highway": way_tags.get("highway"),
                    "name": way_tags.get("name"),
                    "sourceIds": [GRAPH_OSM_SOURCE_ID],
                }
            )
    used = {identity for edge in edges for identity in (edge["from"], edge["to"])}
    return {"nodes": [node for identity, node in nodes.items() if identity in used], "edges": edges}


def planning_facilities(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict]:
    accepted, excluded = [], Counter()
    for item in records:
        island_id = item.get("island_id")
        category = item.get("category")
        if category not in {"school", "hospital", "clinic", "health_center"}:
            continue
        if island_id in IDENTITY_BRIDGE.values():
            continue
        geometry = item.get("geometry") or {}
        if not island_id or geometry.get("type") != "Point":
            excluded["unlocated"] += 1
            continue
        if item.get("match_status") not in ACCEPTED_MATCHES:
            excluded["unreviewed_location_match"] += 1
            continue
        attributes = item.get("attributes", {})
        status = str(attributes.get("status", "")).casefold()
        kind = "clinic" if category == "health_center" else category
        name = item.get("name") or item["id"]
        level = str(attributes.get("facility_level", "")).casefold()
        general = (
            category == "health_center"
            or (
                category == "hospital"
                and not re.search(r"dental|eye|ophthal|fertility|physiotherap", name, re.I)
            )
            or ("general" in level and "dental" not in level)
        )
        lon, lat = geometry["coordinates"]
        accepted.append(
            {
                "id": item["id"],
                "name": name,
                "islandId": island_id,
                "kind": kind,
                "category": category,
                "lon": lon,
                "lat": lat,
                "coordinate": [lon, lat],
                "verification": "official",
                "operatingStatus": "open"
                if category == "school" or status == "open"
                else "unverified",
                "careScope": "general" if general else "unverified",
                "educationSuitability": "general-school" if category == "school" else None,
                "sourceIds": [
                    "education-schools" if category == "school" else "health-registry",
                    "osm-geofabrik",
                ],
                "officialSourceRecordId": item.get("source_record_id"),
                "coordinateReview": {
                    "status": item.get("match_status"),
                    "inspectedEntrance": False,
                },
                "qualification": "Official directory identity with accepted OSM location. "
                "Approximate campus position; entrances, hours, admissions "
                "and capacity unverified.",
            }
        )
    return accepted, dict(excluded)


def planning_stops(
    features: list[dict[str, Any]], rtl: dict[str, Any], islands: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    index = _IslandIndex(islands)
    stops, catalogues = {}, []
    routes = list(rtl.get("routeResponse", []))
    for group in rtl.get("atollRouteResponse", []):
        routes.extend(group.get("routeResponse", []))
    for route in routes:
        ordered = []
        for item in sorted(route.get("busRouteStopList", []), key=lambda x: x.get("order", 0)):
            try:
                lon, lat = float(item["longitude"]), float(item["latitude"])
            except KeyError, TypeError, ValueError:
                continue
            island_id = index.find([lon, lat])
            if not island_id or island_id in IDENTITY_BRIDGE.values():
                continue
            identity = f"rtl:national:stop:{item['code']}"
            ordered.append(identity)
            stops[identity] = {
                "id": identity,
                "name": item.get("name") or identity,
                "islandId": island_id,
                "lon": lon,
                "lat": lat,
                "coordinate": [lon, lat],
                "mode": "bus",
                "verification": "operator-published",
                "operatorCode": str(item["code"]),
                "sourceIds": ["rtl-national-route-details"],
                "timetableStatus": "unavailable",
                "physicalOperatingStatus": "unverified",
            }
        if ordered:
            catalogues.append(
                {
                    "id": f"rtl:national:route:{route['code']}",
                    "name": route.get("name"),
                    "routeNumber": route.get("routeNumber"),
                    "stopIds": ordered,
                    "sourceIds": ["rtl-national-route-details"],
                    "timetableStatus": "unavailable",
                    "qualification": "Ordered operator stop catalogue only; "
                    "no recurring calendar or journey times inferred.",
                }
            )
    for item in features:
        island_id = item.get("island_id")
        geometry = item.get("geometry") or {}
        if (
            not island_id
            or island_id in IDENTITY_BRIDGE.values()
            or geometry.get("type") != "Point"
        ):
            continue
        tags = item.get("tags", {})
        ferry = tags.get("amenity") == "ferry_terminal" or tags.get("ferry") == "yes"
        bus = (
            tags.get("highway") == "bus_stop"
            or tags.get("amenity") == "bus_station"
            or (
                tags.get("public_transport") in {"platform", "stop_position"}
                and tags.get("bus") == "yes"
            )
        )
        if not ferry and not bus:
            continue
        lon, lat = geometry["coordinates"]
        stops[item["id"]] = {
            "id": item["id"],
            "name": item.get("name") or "Mapped passenger stop",
            "islandId": island_id,
            "lon": lon,
            "lat": lat,
            "coordinate": [lon, lat],
            "mode": "ferry" if ferry else "bus",
            "verification": "osm-mapped",
            "sourceIds": ["osm-geofabrik"],
            "timetableStatus": "unavailable",
            "qualification": "Existing mapped passenger boarding point; "
            "service operation and timetable unverified.",
        }
    return list(stops.values()), catalogues


def prepare(root: Path) -> dict[str, Any]:
    cache = root / "backend/data/cache"

    def read(path: Path) -> Any:
        return json.loads(path.read_text(encoding="utf-8"))

    paths = [
        cache / "graphs/land.json",
        cache / "normalized/facilities.json",
        cache / "normalized/transport.json",
        cache / "normalized/islands.geojson",
    ]
    pbf, pbf_metadata = graph_source_pbf(root)
    handler = RoadTags()
    handler.apply_file(str(pbf), locations=False)
    reader = osmium.io.Reader(str(pbf))
    try:
        replication_timestamp = reader.header().get("osmosis_replication_timestamp")
    finally:
        reader.close()
    network = planning_network(read(paths[0]), handler.tags)
    facilities, excluded = planning_facilities(read(paths[1]))
    rtl_path = root / "data/raw/rtl-national-route-details.json"
    rtl = read(rtl_path) if rtl_path.exists() else {}
    stops, catalogues = planning_stops(read(paths[2])["features"], rtl, read(paths[3])["features"])
    receipts = [
        source_receipt(path, root)
        for path in [
            *paths,
            pbf,
            pbf.with_name(pbf.name + ".meta.json"),
            cache / "graphs/land.json.meta.json",
        ]
    ]
    if rtl_path.exists():
        receipts.append(source_receipt(rtl_path, root))
    artifact = {
        "schemaVersion": 1,
        "sourceSnapshotDate": "2026-10-16",
        "network": network,
        "facilities": facilities,
        "transit": {"stops": stops, "patterns": [], "routeCatalogues": catalogues},
        "sourceReceipts": receipts,
        "graphSource": {
            "sourceId": GRAPH_OSM_SOURCE_ID,
            "path": pbf.relative_to(root).as_posix(),
            "sha256": pbf_metadata["sha256"],
            "retrievedAt": pbf_metadata["retrieved_at"],
            "replicationTimestamp": replication_timestamp,
            "qualification": "Road graph and permissions/tags use the cached normalizer's "
            "same OSM snapshot. A separate older root snapshot is retained as source evidence.",
        },
        "sources": [
            {
                "id": GRAPH_OSM_SOURCE_ID,
                "title": "Geofabrik Maldives source of the normalized national road graph",
                "url": pbf_metadata["endpoint"],
                "fetchedAt": pbf_metadata["retrieved_at"],
                "referencePeriod": replication_timestamp,
                "sha256": pbf_metadata["sha256"],
                "rawPath": pbf.relative_to(root).as_posix(),
                "license": "ODbL 1.0; © OpenStreetMap contributors",
                "qualification": "Existing road graph source snapshot; graph tags use "
                "this same cached extract rather than another captured PBF version.",
            },
            {
                "id": "rtl-national-route-details",
                "title": "RTL operator bus route and stop catalogue",
                "url": RTL_URL,
                "fetchedAt": "2026-10-16",
                "qualification": "Catalogue only; schedules not imported.",
            },
        ],
        "coverage": {
            "network_islands": len({n["islandId"] for n in network["nodes"]}),
            "walking_nodes": len(network["nodes"]),
            "walking_edges": len(network["edges"]),
            "accepted_facilities": len(facilities),
            "excluded_facilities": excluded,
            "transport_stops": len(stops),
            "operator_route_catalogues": len(catalogues),
            "scheduled_patterns": 0,
        },
        "warnings": [
            "Road, campus and boarding geometries reuse existing project OSM evidence; "
            "they are not official surveyed entrances.",
            "Unlocated directory records and unreviewed matches are excluded "
            "from shortest-path destinations.",
            "National stop catalogues do not supply verified recurring timetables. "
            "Missing journeys remain unknown.",
            "The national road graph is clipped to source island polygons; "
            "unmodeled causeway gaps remain disconnected.",
        ],
    }
    digest = hashlib.sha256(
        json.dumps(artifact, sort_keys=True, ensure_ascii=False, allow_nan=False).encode("utf-8")
    ).hexdigest()[:16]
    artifact["version"] = f"national-infrastructure-v1:{digest}"
    return artifact
