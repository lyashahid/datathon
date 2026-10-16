"""Prepare additive national resident origins from already cached public inputs.

Run from the repository root with backend/.venv/Scripts/python.exe -B
backend/scripts/prepare_national_origins.py. No downloads or changes to the
Greater Malé baseline are performed. Pillow/NumPy read the existing GeoTIFF.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import osmium
from openpyxl import load_workbook
from PIL import Image
from shapely import wkb
from shapely.geometry import Polygon, mapping, shape
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data.normalize.names import normalize_atoll_code  # noqa: E402
from app.data.population import ATOLLS, attach_population  # noqa: E402
from app.planning.national_infrastructure import (  # noqa: E402
    GRAPH_OSM_SOURCE_ID,
    graph_source_pbf,
)
from app.planning.population_origins import (  # noqa: E402
    ORIGIN_ALLOCATION_VERSION,
    PopulationRaster,
    allocate_island,
    polygonal,
)

ROOT = Path(__file__).resolve().parents[2]
GREATER_MALE = {"island:1443", "island:1442", "island:1382", "island:1483"}
PROJECTION_ALIASES = {("l", "Mundhoo"): "Mundoo", ("gdh", "Madeveli"): "Madaveli"}
RESIDENTIAL_BUILDINGS = {
    "apartments",
    "house",
    "residential",
    "detached",
    "semidetached_house",
    "terrace",
    "bungalow",
    "dormitory",
    "static_caravan",
    "hut",
}


def load_projections(path: Path, islands: list[dict[str, Any]]) -> tuple[list, list]:
    records = []
    excluded = []
    workbook = load_workbook(path, data_only=True, read_only=True)
    for row_number, row in enumerate(workbook["Resident Population"].values, 1):
        if len(row) <= 26 or not isinstance(row[1], str):
            continue
        if not isinstance(row[14], (float, int)) or not isinstance(row[26], (float, int)):
            continue
        code = normalize_atoll_code(row[0]) if isinstance(row[0], str) else ""
        if code not in ATOLLS:
            continue  # Republic, Malé wards and atoll aggregate rows.
        original = row[1].strip()
        record = {
            "locality": PROJECTION_ALIASES.get((code, original), original),
            "sourceLocality": original,
            "atoll_code": code,
            "population2026": float(row[14]),
            "population2030": float(row[26]),
            "sourceRow": row_number,
        }
        if "non-administrative" in original.casefold():
            excluded.append(dict(record, reason="atoll_nonadministrative_aggregate_not_island"))
        else:
            records.append(record)
    workbook.close()
    attach_population(records, islands)
    joined = []
    seen = set()
    for record in records:
        if not record.get("island_id"):
            excluded.append(dict(record, reason="unmatched_or_ambiguous_island"))
            continue
        if record["island_id"] in seen:
            raise ValueError(f"Duplicate projection geography: {record['island_id']}")
        seen.add(record["island_id"])
        joined.append(record)
    return joined, excluded


def load_raster(path: Path) -> PopulationRaster:
    with Image.open(path) as image:
        scale = image.tag_v2.get(33550)
        tiepoint = image.tag_v2.get(33922)
        keys = image.tag_v2.get(34735, ())
        entries = {keys[i]: keys[i + 3] for i in range(4, len(keys), 4)}
        if not scale or not tiepoint or entries.get(2048) != 4326 or entries.get(1025) != 1:
            raise ValueError("Expected north-up EPSG:4326 PixelIsArea GeoTIFF")
        if image.tag_v2.get(34264):
            raise ValueError("Rotated GeoTIFF is unsupported; inspect transform before allocating")
        # Tiepoint indices need not be zero in general.
        west = tiepoint[3] - tiepoint[0] * scale[0]
        north = tiepoint[4] + tiepoint[1] * scale[1]
        values = np.array(image)
        if values.ndim != 2:
            raise ValueError("Expected single-band population counts")
        return PopulationRaster(
            values,
            west,
            north,
            scale[0],
            scale[1],
            float(image.tag_v2.get(42113, -99999)),
        )


class ResidentialSupport(osmium.SimpleHandler):
    """Use explicit OSM residential polygons; generic buildings remain unknown."""

    def __init__(self, islands: list[dict[str, Any]]) -> None:
        super().__init__()
        self.ids = [feature["properties"]["id"] for feature in islands]
        self.geometries = [polygonal(shape(feature["geometry"])) for feature in islands]
        self.tree = STRtree(self.geometries)
        self.areas: dict[str, list[Any]] = defaultdict(list)
        self.buildings: dict[str, list[Any]] = defaultdict(list)
        self.wkb_factory = osmium.geom.WKBFactory()

    def add_support(self, geometry: Any, *, residential_area: bool) -> None:
        polygon = polygonal(geometry)
        if polygon.is_empty or polygon.area <= 0:
            return
        for index in self.tree.query(polygon, predicate="intersects"):
            index = int(index)
            clipped = polygonal(polygon.intersection(self.geometries[index]))
            if clipped.is_empty or clipped.area <= 0:
                continue
            destination = self.areas if residential_area else self.buildings
            destination[self.ids[index]].append(clipped)

    def way(self, way: Any) -> None:
        tags = dict(way.tags)
        residential_area = tags.get("landuse") == "residential"
        residential_building = tags.get("building") in RESIDENTIAL_BUILDINGS
        if not (residential_area or residential_building) or not way.is_closed():
            return
        try:
            coordinates = [(node.lon, node.lat) for node in way.nodes]
        except osmium.InvalidLocationError, RuntimeError:
            return
        if len(coordinates) < 4:
            return
        self.add_support(Polygon(coordinates), residential_area=residential_area)

    def area(self, area: Any) -> None:
        # Closed ways are already handled above. Osmium assembles relation rings,
        # including inner holes and split outer ways, from their actual members.
        if area.from_way():
            return
        tags = dict(area.tags)
        residential_area = tags.get("landuse") == "residential"
        residential_building = tags.get("building") in RESIDENTIAL_BUILDINGS
        if not (residential_area or residential_building):
            return
        try:
            geometry = wkb.loads(self.wkb_factory.create_multipolygon(area), hex=True)
        except (osmium.InvalidLocationError, RuntimeError, ValueError):
            return
        self.add_support(geometry, residential_area=residential_area)


def receipt(path: Path) -> dict[str, Any]:
    return {
        "path": path.relative_to(ROOT).as_posix(),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "bytes": path.stat().st_size,
    }


def prepare() -> dict[str, Any]:
    paths = {
        "islands": ROOT / "backend/data/cache/normalized/islands.geojson",
        "projections": ROOT / "data/raw/island-projections2022-2030.xlsx",
        "raster": ROOT / "data/raw/worldpop2026.tif",
    }
    paths["osm"], osm_metadata = graph_source_pbf(ROOT)
    paths["osmMetadata"] = paths["osm"].with_name(paths["osm"].name + ".meta.json")
    reader = osmium.io.Reader(str(paths["osm"]))
    try:
        replication_timestamp = reader.header().get("osmosis_replication_timestamp")
    finally:
        reader.close()
    islands = json.loads(paths["islands"].read_text(encoding="utf-8"))["features"]
    by_id = {feature["properties"]["id"]: feature for feature in islands}
    projections, excluded = load_projections(paths["projections"], islands)
    selected = [by_id[record["island_id"]] for record in projections]
    support = ResidentialSupport(selected)
    support.apply_file(str(paths["osm"]), locations=True, idx="flex_mem")
    raster = load_raster(paths["raster"])
    origins, output_islands = [], []
    reports = []
    for record in sorted(projections, key=lambda item: item["island_id"]):
        identity = record["island_id"]
        if identity in GREATER_MALE:
            continue
        feature = by_id[identity]
        allocated, report = allocate_island(
            feature,
            record["population2026"],
            record["population2030"],
            raster,
            residential_areas=support.areas.get(identity, []),
            residential_buildings=support.buildings.get(identity, []),
        )
        for origin in allocated:
            origin["sourceIds"] = [
                GRAPH_OSM_SOURCE_ID if identifier == "osm-geofabrik" else identifier
                for identifier in origin["sourceIds"]
            ]
        origins.extend(allocated)
        basis = dict(
            report,
            years=[2026, 2030],
            officialProjectionSource="mbs-island-projections",
            projectionSheet="Resident Population",
            projectionSourceRow=record["sourceRow"],
            projectionSourceLocality=record["sourceLocality"],
            projectionJoin=record["match_status"],
            projectionAliasApplied=record["sourceLocality"] != record["locality"],
        )
        properties = feature["properties"]
        output_islands.append(
            {
                "id": identity,
                "name": properties["name"],
                "atoll": properties["atoll"],
                "geometry": mapping(polygonal(shape(feature["geometry"]))),
                "population2026": record["population2026"],
                "population2030": record["population2030"],
                "resident2026": record["population2026"],
                "resident2030": record["population2030"],
                "populationBasis": basis,
                "sourceIds": sorted({sid for origin in allocated for sid in origin["sourceIds"]}),
                "qualification": report["qualification"],
            }
        )
        reports.append(report)
    source_receipts = [receipt(path) for path in paths.values()]
    fingerprint = hashlib.sha256(
        json.dumps(source_receipts, sort_keys=True).encode()
        + Path(__file__).read_bytes()
        + (ROOT / "backend/app/planning/population_origins.py").read_bytes()
    ).hexdigest()[:16]
    warnings = [
        "Official island projections are not observed neighborhood populations.",
        "WorldPop R2025A is alpha; rejected island weights are never amplified.",
        "Fallback origins are modeled assumptions; unverified resident locations remain explicit.",
        "2030 conserves official totals using the same spatial support as 2026.",
        "Non-administrative atoll aggregates, harbours and combined industrial-island "
        "projections cannot be assigned to individual islands and remain unallocated.",
        "Greater Malé retains the existing separate baseline without recalibration.",
        "Residential OSM closed ways and assembled multipolygon relations are used; "
        "inner holes are preserved, and mapping completeness remains unverified.",
    ]
    artifact = {
        "schemaVersion": 1,
        "version": f"{ORIGIN_ALLOCATION_VERSION}:{fingerprint}",
        "referenceDate": "2026-10-16",
        "islands": output_islands,
        "origins": origins,
        "sources": [
            {
                "id": "mbs-island-projections",
                "name": "Maldives Bureau of Statistics island resident projections 2022–2030",
                "url": "https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2026/08/IslandLevelProjection_2022-2030.xlsx",
                "qualification": "Official projections; not fresh observed counts.",
            },
            {
                "id": "worldpop2026",
                "name": "WorldPop 2026 R2025A v1 constrained ~100 m alpha",
                "url": "https://hub.worldpop.org/geodata/summary?id=74288",
                "license": "CC BY 4.0",
                "qualification": "Modeled distribution, screened separately per island.",
            },
            {
                "id": "onemap-islands",
                "name": "OneMap official island boundaries",
                "url": "https://onemap.mv/",
                "qualification": "Source land boundary, not settlement extent.",
            },
            {
                "id": GRAPH_OSM_SOURCE_ID,
                "name": "OpenStreetMap national cached graph and residential support snapshot",
                "url": osm_metadata["endpoint"],
                "license": "ODbL 1.0",
                "fetchedAt": osm_metadata["retrieved_at"],
                "referencePeriod": replication_timestamp,
                "sha256": osm_metadata["sha256"],
                "rawPath": paths["osm"].relative_to(ROOT).as_posix(),
                "qualification": "Residential mapping completeness varies; no occupancy inferred.",
            },
        ],
        "sourceReceipts": source_receipts,
        "coverage": {
            "additionalIslands": len(output_islands),
            "additionalOrigins": len(origins),
            "methods": dict(Counter(report["method"] for report in reports)),
            "population2026": math.fsum(island["population2026"] for island in output_islands),
            "population2030": math.fsum(island["population2030"] for island in output_islands),
            "preservedGreaterMaleIds": sorted(GREATER_MALE),
        },
        "excludedProjectionRows": excluded,
        "warnings": warnings,
        "screeningAssumptions": {
            "acceptedWorldPopScaleRange": [0.5, 2.0],
            "minimumMappedResidentialCoverage": 0.5,
            "minimumResidentialBuildingCount": 10,
            "minimumResidentialBuildingFootprintM2PerResident": 10,
            "minimumResidentialAreaM2PerResident": 10,
            "minimumResidentialAreaCoverageOfSufficientBuildings": 0.5,
            "qualification": (
                "Conservative screening rules, not measured accuracy or confidence intervals."
            ),
        },
    }
    validate(artifact)
    return artifact


def validate(artifact: dict[str, Any]) -> None:
    by_island: dict[str, list[dict[str, Any]]] = defaultdict(list)
    identities = set()
    for origin in artifact["origins"]:
        if origin["id"] in identities:
            raise ValueError("Duplicate origin identity")
        identities.add(origin["id"])
        by_island[origin["islandId"]].append(origin)
    for island in artifact["islands"]:
        geometry = shape(island["geometry"])
        allocated = by_island[island["id"]]
        if not allocated:
            raise ValueError(f"No origins for {island['id']}")
        for year in (2026, 2030):
            total = math.fsum(origin[f"population{year}"] for origin in allocated)
            if abs(total - island[f"population{year}"]) > 1e-6:
                raise ValueError(f"Population not conserved: {island['id']} {year}")
        for origin in allocated:
            from shapely.geometry import Point

            if not geometry.covers(Point(origin["coordinate"])):
                raise ValueError(f"Origin outside its island: {origin['id']}")
            if any(
                not math.isfinite(origin[f"population{year}"]) or origin[f"population{year}"] < 0
                for year in (2026, 2030)
            ):
                raise ValueError("Invalid population weight")


if __name__ == "__main__":
    output = ROOT / "data/public/national-population-origins.json"
    result = prepare()
    output.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    print(json.dumps(result["coverage"], indent=2))
    print(f"Wrote {output}")
