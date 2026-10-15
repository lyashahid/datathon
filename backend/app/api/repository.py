"""Read-only access to normalized file-based national data."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from shapely.affinity import scale
from shapely.geometry import mapping, shape

from app.data.cache import FileCache
from app.data.map_context import MapContext
from app.data.population import attach_population, population_summary


class NormalizedRepository:
    def __init__(self, data_dir: Path) -> None:
        self.cache = FileCache(data_dir / "cache")
        self.islands: list[dict[str, Any]] = []
        self.islands_by_id: dict[str, dict[str, Any]] = {}
        self.facilities: list[dict[str, Any]] = []
        self.facilities_by_id: dict[str, dict[str, Any]] = {}
        self.population: list[dict[str, Any]] = []
        self.transport: dict[str, Any] = {"features": [], "summary": {}}
        self.summary: dict[str, Any] = {}
        self.facility_review: dict[str, Any] = {"records": [], "summary": {}}
        self.map_context = MapContext(data_dir)

    def reload(self) -> None:
        self.islands = self._read_feature_collection("normalized/islands.geojson")
        self.islands_by_id = {
            item["properties"]["id"]: item
            for item in self.islands
            if item.get("properties", {}).get("id")
        }
        self.facilities = self._read_json("normalized/facilities.json", default=[])
        self.facilities_by_id = {item["id"]: item for item in self.facilities if item.get("id")}
        self.population = self._read_json("normalized/population.json", default=[])
        attach_population(self.population, self.islands)
        self.transport = self._read_json(
            "normalized/transport.json", default={"features": [], "summary": {}}
        )
        self.summary = self._read_json("derived/national_summary.json", default={})
        self.summary["population_attached_count"] = sum(
            item.get("island_id") is not None for item in self.population
        )
        self.summary["population_coverage"] = {
            "islands_with_census": len(
                {x["island_id"] for x in self.population if x.get("island_id")}
            ),
            "reference_year": 2022,
            "basis": "census residents; named atoll/island and disjoint city wards",
        }
        accessibility = self._read_json("derived/accessibility-default.json", default={})
        if isinstance(accessibility.get("scores"), list) and accessibility.get("summary"):
            self.summary["accessibility_status"] = "calculated"
            self.summary["accessibility"] = accessibility["summary"]
        else:
            self.summary["accessibility_status"] = "not_available"
        self.facility_review = self._read_json(
            "normalized/facility-mapping-review.json",
            default={"records": [], "summary": {}},
        )

    def list_islands(
        self,
        *,
        query: str | None = None,
        atoll: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        filtered = self.islands
        if query:
            needle = query.casefold()
            filtered = [
                island
                for island in filtered
                if needle in str(island.get("properties", {}).get("name", "")).casefold()
            ]
        if atoll:
            needle = atoll.casefold()
            filtered = [
                island
                for island in filtered
                if needle == str(island.get("properties", {}).get("atoll", "")).casefold()
            ]
        total = len(filtered)
        return filtered[offset : offset + limit], total

    def island_detail(self, island_id: str) -> dict[str, Any] | None:
        island = self.islands_by_id.get(island_id)
        if island is None:
            return None
        properties = island["properties"]
        facilities = [item for item in self.facilities if item.get("island_id") == island_id]
        population = [item for item in self.population if item.get("island_id") == island_id]
        return {
            "id": properties["id"],
            "name": properties.get("name"),
            "atoll": properties.get("atoll"),
            "category": properties.get("category"),
            "usage": properties.get("usage"),
            "area_ha": properties.get("area_ha"),
            "geometry": island.get("geometry"),
            "centroid": properties.get("centroid"),
            "population": population,
            "facility_count": len(facilities),
            "accessibility": None,
        }

    def population_summary(self, island_id: str) -> dict[str, Any]:
        records = [item for item in self.population if item.get("island_id") == island_id]
        return population_summary(records)

    def infrastructure(
        self, *, island_id: str | None = None, category: str | None = None
    ) -> list[dict[str, Any]]:
        result = self.facilities
        if island_id:
            result = [item for item in result if item.get("island_id") == island_id]
        if category:
            result = [item for item in result if item.get("category") == category]
        return result

    def transport_features(self, island_id: str | None = None) -> list[dict[str, Any]]:
        features = self.transport.get("features", [])
        if island_id:
            features = [item for item in features if item.get("island_id") == island_id]
        return features

    def map_features(
        self,
        *,
        layer: str = "all",
        island_id: str | None = None,
        category: str | None = None,
        include_unlocated: bool = False,
        simplify_m: float = 0,
    ) -> dict[str, Any]:
        """Return map-ready GeoJSON without inventing missing coordinates."""

        features: list[dict[str, Any]] = []
        unlocated_count = 0
        matched_osm_count = 0
        if layer in {"all", "islands"}:
            for island in self.islands:
                if island_id and island.get("properties", {}).get("id") != island_id:
                    continue
                if simplify_m and island.get("geometry"):
                    # Rendering-only simplification in a local metre scale.
                    # The stored polygon and all policy/routing inputs stay exact.
                    geometry = shape(island["geometry"])
                    if geometry.is_empty:
                        features.append(island)
                        continue
                    longitude_scale = max(1e-6, math.cos(math.radians(geometry.centroid.y)))
                    projected = scale(geometry, xfact=longitude_scale, yfact=1, origin=(0, 0))
                    simplified = projected.simplify(simplify_m / 111_320, preserve_topology=True)
                    restored = scale(simplified, xfact=1 / longitude_scale, yfact=1, origin=(0, 0))
                    features.append({**island, "geometry": mapping(restored)})
                else:
                    features.append(island)
        if layer in {"all", "infrastructure"}:
            osm_by_id = {item.get("id"): item for item in self.transport.get("features", [])}
            for facility in self.infrastructure(island_id=island_id, category=category):
                geometry = facility.get("geometry")
                if geometry is None:
                    unlocated_count += 1
                    if not include_unlocated:
                        continue
                features.append(
                    {
                        "type": "Feature",
                        "id": facility.get("id"),
                        "geometry": geometry,
                        "properties": {
                            "name": facility.get("name"),
                            "category": facility.get("category"),
                            "island_id": facility.get("island_id"),
                            "source": facility.get("source"),
                            "source_record_id": facility.get("source_record_id"),
                            "geometry_quality": facility.get("geometry_quality"),
                            "match_status": facility.get("match_status"),
                            "geometry_source": facility.get("geometry_source"),
                            "osm_object_id": facility.get("osm_object_id"),
                            "osm_match_score": facility.get("osm_match_score"),
                            "osm_match": facility.get("osm_match"),
                            "mapping_review": facility.get("mapping_review"),
                            "osm_name": osm_by_id.get(facility.get("osm_object_id"), {}).get(
                                "name"
                            ),
                        },
                    }
                )
        if layer in {"all", "transport"}:
            matched_osm_ids = {
                facility.get("osm_object_id")
                for facility in self.facilities
                if facility.get("osm_object_id")
                and (not island_id or facility.get("island_id") == island_id)
            }
            for transport in self.transport_features(island_id):
                if category and transport.get("category") != category:
                    continue
                if layer == "all" and transport.get("id") in matched_osm_ids:
                    matched_osm_count += 1
                    continue
                geometry = transport.get("geometry")
                if geometry is None:
                    unlocated_count += 1
                    if not include_unlocated:
                        continue
                features.append(
                    {
                        "type": "Feature",
                        "id": transport.get("id"),
                        "geometry": geometry,
                        "properties": {
                            "name": transport.get("name"),
                            "category": transport.get("category"),
                            "island_id": transport.get("island_id"),
                            "source": transport.get("source", "OpenStreetMap"),
                            "source_id": transport.get("source_id"),
                            "object_type": transport.get("object_type"),
                            "tags": transport.get("tags", {}),
                        },
                    }
                )
        return {
            "type": "FeatureCollection",
            "features": features,
            "summary": {
                "layer": layer,
                "feature_count": len(features),
                "unlocated_count": unlocated_count,
                "matched_osm_count": matched_osm_count,
                "coordinates": "[longitude, latitude]",
                "island_id": island_id,
                "render_simplification_m": simplify_m,
            },
        }

    def mapping_review(
        self,
        *,
        island_id: str | None = None,
        category: str | None = None,
        decision: str | None = None,
        priority: str | None = None,
        action: str | None = None,
    ) -> dict[str, Any]:
        records = self.facility_review.get("records", [])
        if island_id:
            records = [item for item in records if item.get("island_id") == island_id]
        if category:
            records = [item for item in records if item.get("category") == category]
        if decision:
            records = [item for item in records if item.get("decision") == decision]
        if priority:
            records = [item for item in records if item.get("review_priority") == priority]
        if action:
            records = [item for item in records if item.get("recommended_action") == action]
        return {
            "version": self.facility_review.get("version", "facility-mapping-review-v2"),
            "records": records,
            "summary": {
                "record_count": len(records),
                "decision_filter": decision,
                "category_filter": category,
                "island_id": island_id,
                "priority_filter": priority,
                "action_filter": action,
                "queue_summary": self.facility_review.get("queue_summary", {}),
            },
        }

    def _read_feature_collection(self, relative_path: str) -> list[dict[str, Any]]:
        value = self._read_json(relative_path, default={"features": []})
        return value.get("features", [])

    def _read_json(self, relative_path: str, default: Any) -> Any:
        try:
            return self.cache.read_json(relative_path)
        except FileNotFoundError:
            return default


def _age_group_start(label: str) -> int | None:
    text = label.strip().casefold()
    if text == "75 or older":
        return 75
    try:
        return int(text.split("-", 1)[0])
    except ValueError, IndexError:
        return None
