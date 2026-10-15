"""OneMap ArcGIS island discovery provider."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from app.data.cache import FileCache
from app.data.http import PublicSourceClient

LAYER_URL = (
    "https://services7.arcgis.com/yvCbn3q8PPtPLZIM/arcgis/rest/services/"
    "island_20240509/FeatureServer/0"
)
QUERY_URL = f"{LAYER_URL}/query"
PAGE_SIZE = 1000


class OneMapProvider:
    source_name = "OneMap / Maldives Geomatics Department"

    def __init__(self, cache: FileCache, client: PublicSourceClient) -> None:
        self.cache = cache
        self.client = client

    def discover(self) -> dict[str, Any]:
        metadata_response, metadata = self.client.get_json(LAYER_URL, {"f": "json"})
        self.cache.write_json(
            "raw/onemap/layer.json",
            metadata,
            source=self.source_name,
            endpoint=LAYER_URL,
            http_status=metadata_response.status_code,
            parser_version="onemap-discovery-v1",
        )

        features: list[dict[str, Any]] = []
        offset = 0
        page_count = 0
        while True:
            params = {
                "where": "1=1",
                "outFields": "*",
                "returnGeometry": "true",
                "outSR": "4326",
                "f": "geojson",
                "resultOffset": offset,
                "resultRecordCount": PAGE_SIZE,
            }
            page_response, page = self.client.get_json(QUERY_URL, params)
            page_features = page.get("features", [])
            page_count += 1
            self.cache.write_json(
                f"raw/onemap/query_{offset}.geojson",
                page,
                source=self.source_name,
                endpoint=str(page_response.url),
                http_status=page_response.status_code,
                parser_version="onemap-discovery-v1",
            )
            features.extend(page_features)
            if len(page_features) < PAGE_SIZE and not page.get("properties", {}).get(
                "exceededTransferLimit", False
            ):
                break
            offset += len(page_features)
            if not page_features:
                break

        collection = {"type": "FeatureCollection", "features": features}
        self.cache.write_json(
            "raw/onemap/islands.geojson",
            collection,
            source=self.source_name,
            endpoint=QUERY_URL,
            parser_version="onemap-discovery-v1",
        )
        return self._summarize(metadata, features, page_count)

    @staticmethod
    def _summarize(
        metadata: dict[str, Any], features: list[dict[str, Any]], pages: int
    ) -> dict[str, Any]:
        properties = [feature.get("properties", {}) for feature in features]
        names = [str(item.get("islandName", "")).strip() for item in properties]
        duplicate_names = sorted(
            name for name, count in Counter(name for name in names if name).items() if count > 1
        )
        missing_centroids = sum(
            not _has_coordinate(item.get("longitude")) or not _has_coordinate(item.get("latitude"))
            for item in properties
        )
        return {
            "source": OneMapProvider.source_name,
            "endpoint": LAYER_URL,
            "layer_name": metadata.get("name"),
            "feature_count": len(features),
            "page_count": pages,
            "max_record_count": metadata.get("maxRecordCount"),
            "categories": dict(
                sorted(Counter(_value(item, "category") for item in properties).items())
            ),
            "usages": dict(sorted(Counter(_value(item, "Usage") for item in properties).items())),
            "atolls": dict(sorted(Counter(_value(item, "atoll") for item in properties).items())),
            "duplicate_island_names": duplicate_names,
            "missing_centroids": missing_centroids,
        }


def _value(properties: dict[str, Any], key: str) -> str:
    value = properties.get(key)
    return str(value).strip() if value not in (None, "") else "(missing)"


def _has_coordinate(value: Any) -> bool:
    if value in (None, ""):
        return False
    text = str(value).strip()
    try:
        float(text)
        return True
    except ValueError:
        pass
    numbers = re.findall(r"[-+]?\d+(?:\.\d+)?", text)
    if len(numbers) < 3:
        return False
    degrees, minutes, seconds = (float(number) for number in numbers[:3])
    return 0 <= minutes < 60 and 0 <= seconds < 60 and abs(degrees) <= 180
