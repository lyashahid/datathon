"""Integration namespace, lifespan, binary transport and cache-context checks."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.vela.integration import get_directions_service, mount_places, places_lifespan
from tests.vela.test_api import (
    AUTH,
    FID,
    LOCATION,
    PANO,
    PLACE,
    SEARCH_ARGS,
    Directions,
    FakeClient,
    Media,
    Search,
)
from vendor.vela_api.config import Settings, load_calibration


def application():
    upstream = FakeClient()

    @asynccontextmanager
    async def lifespan(app):
        async with places_lifespan(app):
            yield

    parent = FastAPI(lifespan=lifespan)
    child = mount_places(parent, Settings(api_key="secret"), client=upstream)
    return parent, child, upstream


def test_complete_integrated_namespace_and_lifespan():
    parent, child, upstream = application()
    with TestClient(parent) as http:
        child.state.search = Search()
        child.state.media = Media()
        child.state.directions = Directions()
        base = "/api/v1/places"
        assert get_directions_service(parent) is child.state.directions
        assert http.get(f"{base}/status").json()["upstream_checked"] is False
        spec = http.get(f"{base}/openapi.json").json()
        expected = {
            "/status",
            "/search",
            "/suggest",
            "/details",
            "/{place_id}",
            "/photos",
            "/reviews",
            "/directions",
            "/streetview",
            "/streetview/panorama",
            "/streetview/tile",
            "/image",
        }
        assert set(spec["paths"]) == expected
        assert http.get(f"{base}/search", params=SEARCH_ARGS).status_code == 401
        searched = http.get(f"{base}/search", params=SEARCH_ARGS, headers=AUTH)
        assert searched.status_code == 200
        assert searched.json()["data"]["places"][0]["name"] == PLACE["name"]
        cached = http.get(f"{base}/{FID}", headers=AUTH)
        assert cached.status_code == 200
        assert cached.json()["data"]["feature_id"] == FID
        detailed = http.post(
            f"{base}/details",
            json={"place_id": FID, "name": PLACE["name"], **LOCATION},
            headers=AUTH,
        )
        assert detailed.status_code == 200
        # The catch-all must not swallow media routes registered after it upstream.
        for path, query in (
            ("photos", {"feature_id": FID}),
            ("reviews", {"feature_id": FID}),
            ("suggest", SEARCH_ARGS),
            ("streetview", LOCATION),
            ("streetview/panorama", {"pano_id": PANO}),
        ):
            response = http.get(f"{base}/{path}", params=query, headers=AUTH)
            assert response.status_code == 200, (path, response.text)
        image = http.get(
            f"{base}/image",
            params={"url": "https://lh3.googleusercontent.com/photo"},
            headers=AUTH,
        )
        assert image.status_code == 200
        assert image.headers["content-type"] == "image/jpeg"
        assert image.headers["cache-control"] == "private, max-age=120"
        assert image.content.startswith(b"\xff\xd8")
        tile = http.get(
            f"{base}/streetview/tile",
            params={"pano_id": PANO, "zoom": 1, "x": 0, "y": 0},
            headers=AUTH,
        )
        assert tile.status_code == 200
        assert tile.content.startswith(b"\xff\xd8")
    assert upstream.closed


def test_bundled_calibration_and_browser_script_provenance():
    import hashlib
    import json
    from importlib.resources import files

    package = files("vendor.vela_api")
    provenance = json.loads(package.joinpath("provenance.json").read_text(encoding="utf-8"))
    calibration = package.joinpath("data/calibration.json").read_bytes()
    assert hashlib.sha256(calibration).hexdigest() == provenance["calibration_sha256"]
    assert load_calibration()["version"] == provenance["calibration_version"]
    assert "GNU GENERAL PUBLIC LICENSE" in package.joinpath("LICENSE").read_text()
    assert "__velaReviewResult" in package.joinpath("data/reviews.js").read_text()
