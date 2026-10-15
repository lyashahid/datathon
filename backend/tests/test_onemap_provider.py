from pathlib import Path

import app.data.providers.onemap as onemap_module
from app.data.cache import FileCache
from app.data.providers.onemap import OneMapProvider


class FakeResponse:
    def __init__(self, payload: dict, url: str) -> None:
        self._payload = payload
        self.status_code = 200
        self.url = url

    @property
    def headers(self) -> dict[str, str]:
        return {"content-type": "application/json"}


class FakeClient:
    def __init__(self) -> None:
        self.pages = 0

    def get_json(self, url: str, params: dict):
        if url == onemap_module.LAYER_URL:
            return FakeResponse({"name": "Island", "maxRecordCount": 2}, url), {
                "name": "Island",
                "maxRecordCount": 2,
            }
        self.pages += 1
        if self.pages == 1:
            features = [
                {
                    "type": "Feature",
                    "properties": {
                        "OBJECTID": 1,
                        "islandName": "Alpha",
                        "atoll": "AA",
                        "category": "inhabited",
                        "Usage": "residential",
                        "longitude": "73.5",
                        "latitude": "4.2",
                    },
                    "geometry": None,
                },
                {
                    "type": "Feature",
                    "properties": {
                        "OBJECTID": 2,
                        "islandName": "Alpha",
                        "atoll": "AA",
                        "category": "resort",
                        "Usage": "tourism",
                        "longitude": None,
                        "latitude": None,
                    },
                    "geometry": None,
                },
            ]
        else:
            features = []
        return FakeResponse({"features": features}, url), {"features": features}


def test_onemap_paginates_and_reports_duplicates(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(onemap_module, "PAGE_SIZE", 2)
    provider = OneMapProvider(FileCache(tmp_path), FakeClient())

    result = provider.discover()

    assert result["feature_count"] == 2
    assert result["page_count"] == 2
    assert result["duplicate_island_names"] == ["Alpha"]
    assert result["missing_centroids"] == 1
    assert (tmp_path / "raw/onemap/islands.geojson").exists()
