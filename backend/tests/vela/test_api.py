"""REST boundary, isolation, validation, and response-contract tests; offline."""

import asyncio
from contextlib import contextmanager
from copy import deepcopy
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from vendor.vela_api.app import create_app
from vendor.vela_api.common import ApiError
from vendor.vela_api.config import Settings
from vendor.vela_api.media import tile_url

AUTH = {"X-API-Key": "secret"}
FID = "0x123:0x456"
PANO = "ExamplePano_123"
LOCATION = {"latitude": 38.5, "longitude": -121.7}
SEARCH_ARGS = {"query": "coffee", **LOCATION}
PLACE = {
    "id": "vela-example",
    "name": "Example Cafe",
    "feature_id": FID,
    "place_id": "ChIJExample",
    "location": LOCATION,
    "address": "1 Example St",
}
PANORAMA = {
    "pano_id": PANO,
    **LOCATION,
    "heading_degrees": 12.5,
    "tile_size": 512,
    "max_zoom": 2,
    "level_dimensions": [{"width": 1024, "height": 512}, {"width": 2048, "height": 1024}],
}
DIRECTIONS_BODY = {"origin": LOCATION, "destination": {"latitude": 38.6, "longitude": -121.5}}


class FakeClient:
    def __init__(self):
        self.images = []
        self.closed = False

    async def get_text(self, *args, **kwargs):
        raise AssertionError("Unexpected text request: adapters are replaced by offline fixtures")

    async def post_text(self, *args, **kwargs):
        raise AssertionError("Unexpected POST request: adapters are replaced by offline fixtures")

    async def get_image(self, url):
        self.images.append(url)
        return b"\xff\xd8\xfffixture\xff\xd9", "image/jpeg"

    async def close(self):
        self.closed = True


class Search:
    def __init__(self):
        self.calls = []
        self.failure = None
        self.delay = 0
        self.data = {
            "query": "coffee",
            "places": [PLACE],
            "next_offset": None,
            "completeness": "unknown",
        }

    async def search(self, *args):
        self.calls.append(("search", args))
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.failure:
            raise self.failure
        return deepcopy(self.data)

    async def suggest(self, *args):
        self.calls.append(("suggest", args))
        return {
            "query": args[0],
            "places": [deepcopy(PLACE)],
            "queries": ["coffee near me"],
            "completeness": "unknown",
        }

    async def details(self, *args):
        self.calls.append(("details", args))
        return {**deepcopy(PLACE), "completeness": "unknown"}


class Media:
    tile_url = staticmethod(tile_url)

    def __init__(self):
        self.calls = []

    async def photos(self, *args):
        self.calls.append(("photos", args))
        return {
            "photos": [
                {
                    "url": "https://lh3.googleusercontent.com/photo",
                    "posted_text": "May 2026",
                    "category": None,
                }
            ],
            "next_token": "next-photo",
            "completeness": "unknown",
        }

    async def reviews(self, *args):
        self.calls.append(("reviews", args))
        return {
            "reviews": [
                {"author": name, "rating": 4, "text": "Example"} for name in ("A", "B", "C")
            ],
            "next_token": "unverified-next",
            "end": False,
            "completeness": "limited",
        }

    async def streetview(self, *args):
        self.calls.append(("streetview", args))
        return deepcopy(PANORAMA)

    async def panorama(self, *args):
        self.calls.append(("panorama", args))
        return deepcopy(PANORAMA)


class Directions:
    def __init__(self):
        self.calls = []

    async def directions(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "routes": [
                {
                    "source": "google_consumer",
                    "distance_meters": 1000,
                    "typical_seconds": 600,
                    "traffic_seconds": None,
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-121.7, 38.5], [-121.5, 38.6]],
                    },
                    "geometry_available": True,
                    "guidance_available": False,
                    "steps": [],
                    "leg_times": [],
                    "traffic_spans": [],
                    "typical_low_seconds": None,
                    "typical_high_seconds": None,
                }
            ],
            "mode": kwargs["mode"],
            "completeness": "unknown",
        }


class Browser:
    def __init__(self):
        self.calls = []

    async def reviews(self, *args):
        self.calls.append(args)
        return {
            "reviews": [{"author": "Visible Author", "rating": 5}],
            "backend": "browser",
            "completeness": "limited",
            "pagination_verified": False,
        }

    async def close(self):
        pass


@contextmanager
def running(**settings):
    upstream = FakeClient()
    app = create_app(Settings(api_key="secret", **settings), client=upstream)
    with TestClient(app, raise_server_exceptions=False) as http:
        app.state.search, app.state.media, app.state.directions = Search(), Media(), Directions()
        yield http, app, upstream
    assert upstream.closed


def assert_envelope(response):
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["meta"]["request_id"] == response.headers["X-Request-ID"]
    assert value["meta"]["provider"] == "google_consumer"
    assert isinstance(value["meta"]["calibration_version"], int)
    return value


def test_health_and_documentation_are_public_and_do_not_call_upstream():
    with running() as (http, app, upstream):
        health = http.get("/health")
        assert health.status_code == 200
        assert health.json()["upstream_checked"] is False
        assert health.headers["X-Request-ID"]
        spec = http.get("/openapi.json").json()
        assert spec["components"]["securitySchemes"]["APIKeyHeader"]["name"] == "X-API-Key"
        assert spec["paths"]["/v1/search"]["get"]["security"] == [{"APIKeyHeader": []}]
        assert http.get("/docs").status_code == 200
        assert app.state.search.calls == []
        assert upstream.images == []


@pytest.mark.parametrize(
    "headers", [{}, {"X-API-Key": "wrong"}, {"Authorization": "Bearer secret"}]
)
def test_protected_route_requires_exact_local_api_key(headers):
    with running() as (http, app, _):
        response = http.get("/v1/search", params=SEARCH_ARGS, headers=headers)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"
        assert response.json()["request_id"] == response.headers["X-Request-ID"]
        assert "secret" not in response.text
        assert app.state.search.calls == []


def test_search_cache_keeps_fresh_metadata_and_locale_is_part_of_key():
    with running() as (http, app, _):
        first = assert_envelope(http.get("/v1/search", params=SEARCH_ARGS, headers=AUTH))
        second = assert_envelope(http.get("/v1/search", params=SEARCH_ARGS, headers=AUTH))
        assert first["meta"]["cached"] is False
        assert second["meta"]["cached"] is True
        assert first["meta"]["request_id"] != second["meta"]["request_id"]
        assert len(app.state.search.calls) == 1
        third = assert_envelope(
            http.get(
                "/v1/search", params={**SEARCH_ARGS, "language": "fr", "region": "CA"}, headers=AUTH
            )
        )
        assert third["meta"]["cached"] is False
        assert app.state.search.calls[-1][1] == ("coffee", 38.5, -121.7, 25000, 0, "fr", "CA")
        assert http.get("/v1/search", params=SEARCH_ARGS).status_code == 401


def test_suggest_parameters_and_response_fields():
    with running() as (http, app, _):
        value = assert_envelope(
            http.get("/v1/suggest", params={**SEARCH_ARGS, "span_meters": 5000}, headers=AUTH)
        )
        assert value["data"]["queries"] == ["coffee near me"]
        assert value["data"]["places"][0]["feature_id"] == FID
        assert app.state.search.calls == [("suggest", ("coffee", 38.5, -121.7, 5000, "en", "us"))]


def test_post_details_supplies_context_and_cached_get_preserves_provider_identity():
    with running() as (http, app, _):
        body = {
            "place_id": FID,
            "name": PLACE["name"],
            **LOCATION,
            "address": PLACE["address"],
            "language": "fr",
            "region": "CA",
        }
        value = assert_envelope(http.post("/v1/places/details", json=body, headers=AUTH))
        assert value["data"]["completeness"] == "unknown"
        assert app.state.search.calls[-1] == (
            "details",
            (FID, "Example Cafe", 38.5, -121.7, "1 Example St", "fr", "CA"),
        )
        assert http.get("/v1/places/vela-example", headers=AUTH).status_code == 404
        http.get("/v1/search", params=SEARCH_ARGS, headers=AUTH)
        for identifier in (PLACE["id"], FID, PLACE["place_id"]):
            assert_envelope(http.get(f"/v1/places/{identifier}", headers=AUTH))
        assert app.state.search.calls[-1][1][0] == FID


def test_cached_place_seed_is_process_instance_local():
    with running() as (first, _, _), running() as (second, second_app, _):
        first.get("/v1/search", params=SEARCH_ARGS, headers=AUTH)
        response = second.get("/v1/places/vela-example", headers=AUTH)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "place_context_missing"
        assert second_app.state.search.calls == []


def test_seed_without_lookup_identity_is_explicit_error():
    with running() as (http, app, _):
        seed = {k: v for k, v in PLACE.items() if k not in {"feature_id", "place_id"}}
        app.state.places.put(seed["id"], seed)
        response = http.get(f"/v1/places/{seed['id']}", headers=AUTH)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "place_identity_missing"
        assert app.state.search.calls == []


def test_focus_seed_is_available_even_when_search_places_are_empty():
    with running() as (http, app, _):
        app.state.search.data = {
            "query": "coffee",
            "places": [],
            "focus": PLACE,
            "focused_single": True,
        }
        http.get("/v1/search", params=SEARCH_ARGS, headers=AUTH)
        assert_envelope(http.get(f"/v1/places/{PLACE['id']}", headers=AUTH))


def test_photos_and_native_reviews_preserve_pagination_limits_and_missing_fields():
    with running() as (http, app, _):
        photos = assert_envelope(
            http.get(
                "/v1/photos", params={"feature_id": FID, "token": "photo-cursor"}, headers=AUTH
            )
        )
        assert photos["data"]["next_token"] == "next-photo"
        assert photos["data"]["photos"][0]["posted_text"] == "May 2026"
        assert app.state.media.calls[-1] == ("photos", (FID, "photo-cursor", "en", "us"))
        reviews = assert_envelope(
            http.get("/v1/reviews", params={"feature_id": FID, "limit": 2}, headers=AUTH)
        )
        assert len(reviews["data"]["reviews"]) == 2
        assert reviews["data"]["reviews"][0]["author_photo"] is None
        assert reviews["data"]["returned_before_limit"] == 3
        assert reviews["data"]["truncated_by_limit"] is True
        assert reviews["data"]["pagination_verified"] is False
        assert reviews["data"]["next_token"] == "unverified-next"
        assert reviews["data"]["completeness"] == "limited"


def test_browser_backend_routes_to_browser_and_rejects_native_page_token():
    with running(browser_enabled=True) as (http, app, _):
        browser = Browser()
        app.state.browser = browser
        response = assert_envelope(
            http.get(
                "/v1/reviews",
                params={"feature_id": FID, "backend": "browser", "limit": 1},
                headers=AUTH,
            )
        )
        assert response["data"]["backend"] == "browser"
        assert browser.calls == [(FID, 1, "en", "us")]
        assert app.state.media.calls == []
        rejected = http.get(
            "/v1/reviews",
            params={"feature_id": FID, "backend": "browser", "token": "cursor"},
            headers=AUTH,
        )
        assert rejected.status_code == 422
        assert rejected.json()["error"]["code"] == "unsupported_option"
        assert len(browser.calls) == 1


def test_disabled_browser_backend_is_explicit_503_without_native_fallback():
    with running() as (http, app, _):
        response = http.get(
            "/v1/reviews", params={"feature_id": FID, "backend": "browser"}, headers=AUTH
        )
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "browser_disabled"
        assert app.state.media.calls == []


def test_directions_body_is_normalized_and_adapter_extra_fields_are_preserved():
    with running() as (http, app, _):
        body = {
            **DIRECTIONS_BODY,
            "mode": "driving",
            "waypoints": [LOCATION],
            "avoid": ["tolls"],
            "language": "fr",
            "region": "CA",
        }
        value = assert_envelope(http.post("/v1/directions", json=body, headers=AUTH))
        assert app.state.directions.calls == [body]
        route = value["data"]["routes"][0]
        assert route["traffic_seconds"] is None
        assert route["geometry_available"] is True
        assert route["guidance_available"] is False
        assert route["typical_low_seconds"] is None
        assert value["data"]["completeness"] == "unknown"
        assert_envelope(http.post("/v1/directions", json=body, headers=AUTH))
        assert len(app.state.directions.calls) == 1


def test_streetview_panorama_and_valid_tile_flow_share_metadata_cache():
    with running() as (http, app, upstream):
        info = assert_envelope(
            http.get("/v1/streetview", params={**LOCATION, "radius": 200}, headers=AUTH)
        )
        assert info["data"]["max_zoom"] == 2
        assert app.state.media.calls[-1] == ("streetview", (38.5, -121.7, 200))
        assert_envelope(http.get("/v1/streetview/panorama", params={"pano_id": PANO}, headers=AUTH))
        tile = http.get(
            "/v1/streetview/tile", params={"pano_id": PANO, "zoom": 1, "x": 3, "y": 1}, headers=AUTH
        )
        assert tile.status_code == 200
        assert tile.headers["content-type"] == "image/jpeg"
        assert tile.headers["cache-control"] == "private, max-age=120"
        assert tile.content.startswith(b"\xff\xd8")
        assert sum(c[0] == "panorama" for c in app.state.media.calls) == 1
        assert parse_qs(urlsplit(upstream.images[0]).query)["x"] == ["3"]
        assert parse_qs(urlsplit(upstream.images[0]).query)["panoid"] == [PANO]


@pytest.mark.parametrize(
    "query",
    [
        {"zoom": 2, "x": 0, "y": 0},
        {"zoom": 1, "x": 4, "y": 0},
        {"zoom": 1, "x": 0, "y": 2},
        {"zoom": -1, "x": 0, "y": 0},
        {"zoom": 0, "x": -1, "y": 0},
        {"zoom": 0, "x": 128, "y": 0},
    ],
)
def test_invalid_tile_never_downloads_an_image(query):
    with running() as (http, _, upstream):
        response = http.get("/v1/streetview/tile", params={"pano_id": PANO, **query}, headers=AUTH)
        assert response.status_code == 422
        assert upstream.images == []


def test_image_proxy_accepts_only_allowlisted_https_and_does_not_redirect_caller():
    with running() as (http, _, upstream):
        response = http.get(
            "/v1/image", params={"url": "https://lh3.googleusercontent.com/photo"}, headers=AUTH
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        assert "location" not in response.headers
        assert upstream.images == ["https://lh3.googleusercontent.com/photo"]


@pytest.mark.parametrize(
    "url",
    [
        "http://lh3.googleusercontent.com/photo",
        "https://localhost/private",
        "https://127.0.0.1/private",
        "https://example.com/photo",
        "https://lh3.googleusercontent.com.evil.test/photo",
        "https://user@lh3.googleusercontent.com/photo",
        "https://www.google.com/maps",
    ],
)
def test_image_proxy_ssrf_attempts_are_rejected_without_transport(url):
    with running() as (http, _, upstream):
        response = http.get("/v1/image", params={"url": url}, headers=AUTH)
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "invalid_upstream_url"
        assert upstream.images == []


@pytest.mark.parametrize(
    "query",
    [
        {"latitude": 91},
        {"longitude": -181},
        {"latitude": "nan"},
        {"longitude": "inf"},
        {"offset": 1},
        {"offset": -20},
        {"offset": 1020},
        {"query": ""},
        {"span_meters": 999},
        {"span_meters": "nan"},
        {"language": "en\n"},
        {"region": "USA"},
    ],
)
def test_search_validation_stops_invalid_requests_before_adapter(query):
    with running() as (http, app, _):
        response = http.get("/v1/search", params={**SEARCH_ARGS, **query}, headers=AUTH)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_request"
        assert app.state.search.calls == []


@pytest.mark.parametrize(
    "path,query",
    [
        ("/v1/photos", {"feature_id": "https://localhost"}),
        ("/v1/reviews", {"feature_id": FID, "backend": "other"}),
        ("/v1/reviews", {"feature_id": FID, "limit": 51}),
        ("/v1/photos", {"feature_id": FID, "token": "x" * 4097}),
        ("/v1/streetview", {**LOCATION, "radius": 100}),
        ("/v1/streetview/panorama", {"pano_id": "../../private"}),
    ],
)
def test_media_validation_prevents_invalid_identifiers_options_and_tokens(path, query):
    with running() as (http, app, upstream):
        assert http.get(path, params=query, headers=AUTH).status_code == 422
        assert app.state.media.calls == []
        assert upstream.images == []


@pytest.mark.parametrize(
    "changes",
    [
        {"mode": "transit"},
        {"mode": "flying"},
        {"avoid": ["tunnels"]},
        {"origin": {"latitude": 91, "longitude": 0}},
        {"origin": {"latitude": "nan", "longitude": 0}},
        {"origin": {**LOCATION, "extra": "unwanted"}},
        {"waypoints": [LOCATION] * 9},
        {"url": "https://localhost/private"},
    ],
)
def test_directions_body_validation_prevents_upstream_calls(changes):
    with running() as (http, app, _):
        response = http.post("/v1/directions", json={**DIRECTIONS_BODY, **changes}, headers=AUTH)
        assert response.status_code == 422
        assert app.state.directions.calls == []


def test_missing_and_malformed_json_and_unknown_detail_fields_are_rejected():
    with running() as (http, app, _):
        for kwargs in (
            {},
            {"content": "not json", "headers": {**AUTH, "Content-Type": "application/json"}},
            {"json": {"place_id": FID}},
            {"json": {"place_id": FID, "name": "Cafe", **LOCATION, "url": "http://private"}},
        ):
            response = http.post("/v1/places/details", **({"headers": AUTH} | kwargs))
            assert response.status_code == 422
            assert all("input" not in issue for issue in response.json()["error"]["details"])
        assert app.state.search.calls == []


def test_request_size_limit_checks_declared_and_streamed_bytes_with_request_ids():
    with running() as (http, app, _):
        declared = http.post(
            "/v1/directions", content=b"{}", headers={**AUTH, "Content-Length": "65537"}
        )
        assert declared.status_code == 413
        assert declared.json()["request_id"] == declared.headers["X-Request-ID"]
        streamed = http.post(
            "/v1/directions", content=iter([b"x" * 40000, b"x" * 30000]), headers=AUTH
        )
        assert streamed.status_code == 413
        assert streamed.json()["request_id"] == streamed.headers["X-Request-ID"]
        assert app.state.directions.calls == []


def test_authorization_failures_do_not_consume_rate_limit_but_cache_hits_do():
    with running(rate_limit_per_minute=2) as (http, app, _):
        for _ in range(3):
            assert http.get("/v1/search", params=SEARCH_ARGS).status_code == 401
        for _ in range(2):
            assert http.get("/v1/search", params=SEARCH_ARGS, headers=AUTH).status_code == 200
        response = http.get(
            "/v1/search", params=SEARCH_ARGS, headers={**AUTH, "X-Forwarded-For": "1.2.3.4"}
        )
        assert response.status_code == 429
        assert response.json()["error"]["code"] == "rate_limited"
        assert response.headers["Retry-After"] == "60"
        assert len(app.state.search.calls) == 1
        assert http.get("/health").status_code == 200


def test_upstream_errors_keep_envelope_retry_after_and_are_not_cached():
    with running() as (http, app, _):
        app.state.search.failure = ApiError("upstream_rate_limited", "Retry later", 503)
        for _ in range(2):
            response = http.get("/v1/search", params=SEARCH_ARGS, headers=AUTH)
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "upstream_rate_limited"
            assert response.json()["request_id"] == response.headers["X-Request-ID"]
            assert response.headers["Retry-After"] == "60"
        assert len(app.state.search.calls) == 2


def test_whole_operation_deadline_becomes_504_not_internal_error(monkeypatch):
    real_timeout = asyncio.timeout
    monkeypatch.setattr("vendor.vela_api.app.asyncio.timeout", lambda duration: real_timeout(0.01))
    with running() as (http, app, _):
        app.state.search.delay = 0.2
        response = http.get("/v1/search", params=SEARCH_ARGS, headers=AUTH)
        assert response.status_code == 504
        assert response.json()["error"]["code"] == "upstream_timeout"


def test_unexpected_errors_do_not_expose_internal_details():
    with running() as (http, app, _):
        app.state.search.failure = RuntimeError("private traceback with secret")
        response = http.get("/v1/search", params=SEARCH_ARGS, headers=AUTH)
        assert response.status_code == 500
        assert response.json()["error"]["code"] == "internal_error"
        assert "secret" not in response.text
        assert "traceback" not in response.text
        assert response.json()["request_id"] == response.headers["X-Request-ID"]


def test_cors_is_opt_in_and_allows_key_header_for_configured_origin():
    with running(cors_origins=("https://app.example",)) as (http, _, _):
        response = http.options(
            "/v1/search",
            headers={
                "Origin": "https://app.example",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "X-API-Key",
            },
        )
        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == "https://app.example"
        refused = http.options(
            "/v1/search",
            headers={"Origin": "https://other.example", "Access-Control-Request-Method": "GET"},
        )
        assert refused.status_code == 400
        assert "Access-Control-Allow-Origin" not in refused.headers
