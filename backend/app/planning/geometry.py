"""Map paths for proposed services, with the route evidence kept explicit."""

from __future__ import annotations

from typing import Any

from app.planning.models import PlanningAssumptions
from app.planning.routing import WalkingNetwork

FERRY_CORRIDOR_WARNING = "Planning corridor between stops; not a charted navigation route."
BUS_PATH_WARNING = (
    "Shortest path on the available driving graph; proposed running times remain assumptions."
)


def prepare_service_geometry(
    world: dict[str, Any],
    pattern_ids: set[str],
    assumptions: PlanningAssumptions,
    warnings: list[str],
) -> None:
    """Derive missing scenario paths once, never overwrite supplied segment shapes.

    The road graph already contains access and direction restrictions. Ferry
    endpoint corridors are a visual planning assumption, not observed sailings
    or navigable channels. Neither derivation changes the supplied timetable.
    """
    stops = {stop["id"]: stop for stop in world["stops"]}
    driving: WalkingNetwork | None = None
    trees: dict[str, tuple[dict[str, float], dict[str, Any]]] = {}
    paths: dict[tuple[str, str], tuple[list[list[float]], str, str]] = {}
    for pattern in world["patterns"]:
        if pattern["id"] not in pattern_ids:
            continue
        supplied = pattern.get("segmentGeometry", [])
        prior_sources = pattern.get("segmentGeometrySources", [])
        prior_warnings = pattern.get("segmentGeometryWarnings", [])
        geometries, sources, qualifications = [], [], []
        for index, (first_id, second_id) in enumerate(
            zip(pattern["stopIds"], pattern["stopIds"][1:])
        ):
            coordinates = supplied[index] if index < len(supplied) else []
            if coordinates:
                # A closure detour already has graph provenance. Fresh imports
                # are normalized to supplied geometry by validate_service.
                source = (
                    prior_sources[index]
                    if index < len(prior_sources)
                    else "source_service_geometry"
                )
                qualification = prior_warnings[index] if index < len(prior_warnings) else None
            else:
                first, second = stops[first_id], stops[second_id]
                if pattern["mode"] == "ferry":
                    coordinates = [[first["lon"], first["lat"]], [second["lon"], second["lat"]]]
                    source, qualification = "assumed_endpoint_corridor", FERRY_CORRIDOR_WARNING
                else:
                    if driving is None:
                        driving = WalkingNetwork(world["network"], drive=True)
                    key = first_id, second_id
                    if key not in paths:
                        start = driving.snap(first, assumptions.max_snap_m)
                        end = driving.snap(second, assumptions.max_snap_m)
                        coordinates = []
                        source = "unavailable"
                        qualification = (
                            "No directed driving route between these stops is available "
                            "in the planning graph; the timetable is an unverified assumption."
                        )
                        if not start or not end:
                            qualification = (
                                "A stop cannot snap to a drivable road within the selected "
                                "tolerance; no bus path is drawn."
                            )
                        else:
                            if start[0] not in trees:
                                trees[start[0]] = driving.tree(start[0], 100000)
                            distances, previous = trees[start[0]]
                            if end[0] in distances:
                                coordinates = driving.geometry(previous, start[0], end[0])
                                if len(coordinates) >= 2:
                                    source, qualification = (
                                        "osm_network_shortest_path",
                                        BUS_PATH_WARNING,
                                    )
                                    if start[1] > 1 or end[1] > 1:
                                        qualification += (
                                            f" Stops snap to road nodes within "
                                            f"{assumptions.max_snap_m:g} m."
                                        )
                                else:
                                    coordinates = []
                                    qualification = (
                                        "The driving graph has no complete mapped geometry "
                                        "for this segment; no bus path is drawn."
                                    )
                        paths[key] = coordinates, source, qualification
                    coordinates, source, qualification = paths[key]
            geometries.append(coordinates)
            sources.append(source)
            qualifications.append(qualification)
            if source in {"unavailable", "assumed_endpoint_corridor"}:
                warnings.append(f"{pattern['name']}: {qualification}")
        pattern["segmentGeometry"] = geometries
        pattern["segmentGeometrySources"] = sources
        pattern["segmentGeometryWarnings"] = qualifications
