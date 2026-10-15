"""Geofabrik Maldives PBF acquisition and required-tag discovery."""

from __future__ import annotations

import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

import osmium

from app.data.cache import FileCache
from app.data.http import PublicSourceClient

PRIMARY_URL = "https://download.geofabrik.de/asia/maldives-latest.osm.pbf"
FALLBACK_URL = "https://download.openstreetmap.fr/extracts/asia/maldives.osm.pbf"


class OsmProvider:
    source_name = "OpenStreetMap / Geofabrik Maldives extract"

    def __init__(self, cache: FileCache, client: PublicSourceClient) -> None:
        self.cache = cache
        self.client = client

    def discover(self) -> dict[str, Any]:
        errors: list[str] = []
        response = None
        endpoint = PRIMARY_URL
        for candidate in (PRIMARY_URL, FALLBACK_URL):
            try:
                response = self.client.get_bytes(candidate)
                endpoint = candidate
                break
            except Exception as exc:  # provider fallback must preserve the reason
                errors.append(f"{candidate}: {exc}")
        if response is None:
            raise RuntimeError("OSM primary and fallback downloads failed: " + " | ".join(errors))

        with tempfile.NamedTemporaryFile(suffix=".osm.pbf", delete=False) as temporary:
            temporary.write(response.content)
            temporary_path = Path(temporary.name)
        try:
            counts = _count_features(temporary_path)
        finally:
            temporary_path.unlink(missing_ok=True)

        path = self.cache.write_bytes(
            "raw/osm/maldives-latest.osm.pbf",
            response.content,
            source=self.source_name,
            endpoint=endpoint,
            http_status=response.status_code,
            content_type=response.headers.get("content-type"),
            parser_version="osm-discovery-v1",
        )
        return {
            "source": self.source_name,
            "endpoint": endpoint,
            "fallback_errors": errors,
            "file": str(path),
            "file_size_bytes": len(response.content),
            "required_tag_counts": counts,
        }


class _RequiredTagHandler(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.object_counts: Counter[str] = Counter()
        self.tag_counts: Counter[str] = Counter()

    def _inspect(self, object_type: str, tags: Any) -> None:
        self.object_counts[object_type] += 1
        for key in (
            "highway",
            "route",
            "landuse",
            "amenity",
            "public_transport",
            "aeroway",
            "place",
            "man_made",
        ):
            value = tags.get(key)
            if value is not None:
                self.tag_counts[f"{key}={value}"] += 1

    def node(self, node: Any) -> None:
        self._inspect("node", node.tags)

    def way(self, way: Any) -> None:
        self._inspect("way", way.tags)

    def relation(self, relation: Any) -> None:
        self._inspect("relation", relation.tags)


def _count_features(path: Path) -> dict[str, Any]:
    handler = _RequiredTagHandler()
    handler.apply_file(str(path), locations=False)
    selected = {
        key: count
        for key, count in sorted(handler.tag_counts.items())
        if key.startswith((
            "highway=",
            "route=ferry",
            "route=bus",
            "landuse=residential",
            "place=",
            "amenity=bus_station",
            "amenity=ferry_terminal",
            "amenity=parking",
            "amenity=taxi",
            "public_transport=",
            "aeroway=",
            "man_made=pier",
        ))
    }
    return {"object_counts": dict(handler.object_counts), "selected_tags": selected}
