"""Large JSON response equality and compression boundaries."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.responses import Response, StreamingResponse
from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.main import create_app
from tests.test_national_api import _write_fixture_data


@pytest.mark.parametrize("endpoint", ["features", "context?bbox=73,3,73.1,3.1"])
def test_map_gzip_preserves_complete_geojson_and_reduces_wire_size(tmp_path: Path, endpoint):
    _write_fixture_data(tmp_path)
    facilities = tmp_path / "cache" / "normalized" / "facilities.json"
    data = json.loads(facilities.read_text(encoding="utf-8"))
    data[0]["name"] = "Long source-backed map label " * 300
    facilities.write_text(json.dumps(data), encoding="utf-8")
    app = create_app(Settings(environment="test", data_dir=tmp_path))
    context = {"type": "FeatureCollection", "features": [{"properties": {"name": data[0]["name"]}}]}
    app.state.repository.map_context = SimpleNamespace(query=lambda _: context)
    with TestClient(app) as client:
        identity = client.get(f"/api/v1/map/{endpoint}", headers={"accept-encoding": "identity"})
        compressed = client.get(f"/api/v1/map/{endpoint}", headers={"accept-encoding": "gzip"})
    assert identity.status_code == compressed.status_code == 200
    assert identity.json() == compressed.json()
    assert compressed.headers["content-encoding"] == "gzip"
    assert "Accept-Encoding" in compressed.headers["vary"]
    assert int(compressed.headers["content-length"]) < int(identity.headers["content-length"])
    assert "content-encoding" not in identity.headers


@pytest.mark.parametrize("content_type", ["text/event-stream", "image/jpeg", "image/png"])
def test_compression_preserves_streams_and_already_compressed_media(tmp_path: Path, content_type):
    app = create_app(Settings(environment="test", data_dir=tmp_path))
    body = b"Source content retained\n" * 300

    @app.get("/audit-response")
    def example():
        if content_type == "text/event-stream":
            return StreamingResponse(iter([body]), media_type=content_type)
        return Response(body, media_type=content_type)

    with TestClient(app) as client:
        response = client.get("/audit-response", headers={"accept-encoding": "gzip"})
    assert response.content == body
    assert "content-encoding" not in response.headers
