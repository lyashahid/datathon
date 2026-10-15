"""Local OSM cartographic context; never a live traffic or routing claim."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from shapely.geometry import box, shape
from shapely.strtree import STRtree


class MapContext:
    def __init__(self, data_dir: Path) -> None:
        path = data_dir / "cache" / "derived" / "map-context.geojson"
        source = data_dir / "cache" / "raw" / "osm" / "maldives-latest.osm.pbf"
        if not path.exists() and source.exists():
            build_context(data_dir)
        self.data: dict[str, Any] = {"type": "FeatureCollection", "features": [], "metadata": {}}
        if path.exists():
            self.data = json.loads(path.read_text(encoding="utf-8"))
        self.features = self.data.get("features", [])
        self.index = STRtree([box(*x["bbox"]) for x in self.features])

    def query(self, bounds: list[float], limit: int = 30000) -> dict[str, Any]:
        indexes = sorted(int(x) for x in self.index.query(box(*bounds)))
        features = [self.features[x] for x in indexes[:limit]]
        return {
            "type": "FeatureCollection",
            "features": features,
            "metadata": self.data.get("metadata", {}),
            "summary": {
                "feature_count": len(features),
                "matching_count": len(indexes),
                "truncated": len(indexes) > limit,
                "roads": sum(x["properties"]["kind"] == "road" for x in features),
                "buildings": sum(x["properties"]["kind"] == "building" for x in features),
                "landuse": sum(x["properties"]["kind"] == "landuse" for x in features),
                "status": "captured_snapshot" if self.features else "unavailable",
            },
        }


def build_context(data_dir: Path) -> dict[str, Any]:
    """Derive renderable road/building/park shapes from the captured source PBF."""
    import hashlib
    from datetime import UTC, datetime

    import osmium

    source = data_dir / "cache" / "raw" / "osm" / "maldives-latest.osm.pbf"
    receipt = json.loads(source.with_suffix(source.suffix + ".meta.json").read_text("utf-8"))
    features: list[dict[str, Any]] = []

    class Handler(osmium.SimpleHandler):
        def way(self, way: Any) -> None:
            tags = dict(way.tags)
            highway = tags.get("highway")
            building = tags.get("building") not in {None, "no"}
            green = tags.get("leisure") in {"park", "garden", "playground", "pitch"}
            green = green or tags.get("landuse") in {"forest", "grass", "recreation_ground"}
            if not highway and not building and not green:
                return
            try:
                coordinates = [[round(n.lon, 7), round(n.lat, 7)] for n in way.nodes]
            except osmium.InvalidLocationError:
                return
            if len(coordinates) < 2:
                return
            polygon = (building or green) and len(coordinates) >= 4
            if polygon and coordinates[0] != coordinates[-1]:
                return
            geometry = {
                "type": "Polygon" if polygon else "LineString",
                "coordinates": [coordinates] if polygon else coordinates,
            }
            item = {
                "type": "Feature",
                "id": f"osm:way:{way.id}",
                "geometry": geometry,
                "properties": {
                    "kind": "road" if highway else "building" if building else "landuse",
                    "name": tags.get("name:en") or tags.get("name"),
                    "highway": highway,
                    "bridge": tags.get("bridge") not in {None, "no"},
                    "osm_id": str(way.id),
                },
                "bbox": list(shape(geometry).bounds),
            }
            features.append(item)

    Handler().apply_file(str(source), locations=True)
    result = {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "source": "OpenStreetMap contributors / Geofabrik Maldives extract",
            "source_url": receipt.get("endpoint"),
            "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "retrieved_at": receipt.get("retrieved_at"),
            "generated_at": datetime.now(UTC).isoformat(),
            "licence": "ODbL 1.0",
            "attribution_url": "https://www.openstreetmap.org/copyright",
            "transformation": "osm-cartographic-context-v1",
            "qualification": "Captured OSM roads, buildings and green spaces. Mapping coverage "
            "varies; these shapes do not establish current road access or building occupancy.",
            "feature_count": len(features),
        },
    }
    target = data_dir / "cache" / "derived" / "map-context.geojson"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), "utf-8")
    return result["metadata"]
