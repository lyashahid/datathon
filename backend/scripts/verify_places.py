"""Bounded real-upstream verification of the complete integrated places API.

Run from backend: .venv/Scripts/python.exe scripts/verify_places.py --browser
Use --base-url http://127.0.0.1:8000 to verify a running backend, or omit it to
exercise the same mounted FastAPI application in process. No upstream responses,
reviews, cookies or image pixels are persisted; the report records counts and
provider availability for this environment and time only.
"""

import argparse
import asyncio
import json
import os
import sys
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

import httpx
from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.vela.integration import mount_places, places_lifespan  # noqa: E402
from vendor.vela_api.config import Settings  # noqa: E402


@asynccontextmanager
async def api_client(base_url: str | None, browser: bool):
    headers = {"X-API-Key": os.getenv("VELA_API_KEY", "")}
    if base_url:
        async with httpx.AsyncClient(base_url=base_url, timeout=65, headers=headers) as client:
            yield client
        return
    application = FastAPI()
    configured = Settings.from_env()
    if browser:
        from dataclasses import replace

        configured = replace(configured, browser_enabled=True)
    mount_places(application, configured)
    async with places_lifespan(application):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=application),
            base_url="http://integrated-local-api",
            timeout=65,
            headers=headers,
        ) as client:
            yield client


async def verify(base_url: str | None, browser: bool, output: Path):
    report = {
        "checked_at": datetime.now(UTC).isoformat(),
        "scope": "Real anonymous Google consumer requests through integrated FastAPI routes. "
        "Malé is the primary sample; San Francisco is an explicitly named imagery coverage sample.",
        "transport": "running_http_server" if base_url else "mounted_fastapi_asgi",
        "privacy": "Only HTTP statuses, count/coverage metadata and provider identities retained.",
        "results": {},
    }
    prefix = "/api/v1/places"
    async with api_client(base_url, browser) as client:

        async def call(name, method, path, **kwargs):
            started = time.monotonic()
            try:
                response = await client.request(method, prefix + path, **kwargs)
            except httpx.HTTPError as error:
                report["results"][name] = {"transport_error": type(error).__name__}
                return None
            entry = {
                "http_status": response.status_code,
                "response_bytes": len(response.content),
                "elapsed_seconds": round(time.monotonic() - started, 3),
            }
            report["results"][name] = entry
            if response.headers.get("content-type", "").startswith("image/"):
                entry["content_type"] = response.headers["content-type"]
                entry["cache_control"] = response.headers.get("cache-control")
                return None
            try:
                payload = response.json()
            except ValueError:
                entry["error"] = "unexpected_non_json_reply"
                return None
            if not response.is_success:
                entry["error"] = payload.get("error", {})
                print(f"{name}: HTTP {response.status_code} {entry['error'].get('code', '')}")
                return None
            entry["meta"] = payload.get("meta")
            print(f"{name}: HTTP {response.status_code}")
            return payload.get("data", payload)

        health = await call("status", "GET", "/status")
        if health:
            report["results"]["status"]["data"] = health
        location = {"latitude": 4.1755, "longitude": 73.5093}
        search_args = {"query": "hospital in Male Maldives", **location, "region": "MV"}
        searched = await call("search_male", "GET", "/search", params=search_args)
        seed = None
        if searched:
            entry = report["results"]["search_male"]
            entry["place_count"] = len(searched["places"])
            entry["completeness"] = searched.get("completeness")
            entry["next_offset"] = searched.get("next_offset")
            seed = next((place for place in searched["places"] if place.get("feature_id")), None)
            if searched.get("next_offset") is not None:
                continued = await call(
                    "search_next_offset",
                    "GET",
                    "/search",
                    params={**search_args, "offset": searched["next_offset"]},
                )
                if continued:
                    report["results"]["search_next_offset"]["place_count"] = len(
                        continued["places"]
                    )
            cached = await call("search_cache_hit", "GET", "/search", params=search_args)
            if cached:
                report["results"]["search_cache_hit"]["place_count"] = len(cached["places"])
        suggested = await call(
            "suggest_male",
            "GET",
            "/suggest",
            params={"query": "hospital", **location, "region": "MV"},
        )
        if suggested:
            report["results"]["suggest_male"].update(
                place_count=len(suggested["places"]), query_count=len(suggested["queries"])
            )
        if seed:
            identity = seed["feature_id"]
            report["search_seed"] = {
                "feature_id": identity,
                "name": seed["name"],
                "location": seed["location"],
            }
            details = await call(
                "details_male",
                "POST",
                "/details",
                json={
                    "place_id": identity,
                    "name": seed["name"],
                    **seed["location"],
                    "address": seed.get("address"),
                    "region": "MV",
                },
            )
            if details:
                report["results"]["details_male"].update(
                    identity_matched=details.get("feature_id") == identity,
                    present_fields=[key for key, value in details.items() if value is not None],
                )
            cached = await call("cached_place_male", "GET", "/" + identity, params={"region": "MV"})
            if cached:
                report["results"]["cached_place_male"]["identity_matched"] = (
                    cached.get("feature_id") == identity
                )
            photos = await call(
                "photos_male", "GET", "/photos", params={"feature_id": identity, "region": "MV"}
            )
            if photos:
                report["results"]["photos_male"].update(
                    photo_count=len(photos["photos"]), has_next_token=bool(photos.get("next_token"))
                )
                if photos["photos"]:
                    await call(
                        "photo_image", "GET", "/image", params={"url": photos["photos"][0]["url"]}
                    )
            reviews = await call(
                "reviews_native_male",
                "GET",
                "/reviews",
                params={"feature_id": identity, "limit": 5, "region": "MV"},
            )
            if reviews:
                report["results"]["reviews_native_male"].update(
                    review_count=len(reviews["reviews"]),
                    end=reviews.get("end"),
                    completeness=reviews["completeness"],
                    pagination_verified=reviews.get("pagination_verified"),
                )
            if browser:
                browser_reviews = await call(
                    "reviews_browser_male",
                    "GET",
                    "/reviews",
                    params={
                        "feature_id": identity,
                        "limit": 5,
                        "backend": "browser",
                        "region": "MV",
                    },
                )
                if browser_reviews:
                    report["results"]["reviews_browser_male"].update(
                        review_count=len(browser_reviews["reviews"]),
                        completeness=browser_reviews["completeness"],
                        settled=browser_reviews.get("settled"),
                    )
        else:
            report["place_dependent_features"] = (
                "No provider feature identity returned; details/media calls not invented."
            )
        for mode in ("walking", "driving", "bicycling"):
            routed = await call(
                f"directions_{mode}_male",
                "POST",
                "/directions",
                json={
                    "origin": location,
                    "destination": {"latitude": 4.1785, "longitude": 73.513},
                    "mode": mode,
                    "region": "MV",
                },
            )
            if routed:
                report["results"][f"directions_{mode}_male"].update(
                    route_count=len(routed["routes"]),
                    geometry_point_counts=[
                        len(route["geometry"]["coordinates"]) if route["geometry"] else 0
                        for route in routed["routes"]
                    ],
                    distance_meters=[route.get("distance_meters") for route in routed["routes"]],
                    typical_seconds=[route.get("typical_seconds") for route in routed["routes"]],
                    traffic_seconds=[route.get("traffic_seconds") for route in routed["routes"]],
                )
        for label, sample in (
            ("male", location),
            ("san_francisco", {"latitude": 37.7749, "longitude": -122.4194}),
        ):
            panorama = await call(
                f"streetview_{label}", "GET", "/streetview", params={**sample, "radius": 200}
            )
            if panorama:
                report["results"][f"streetview_{label}"].update(
                    pano_id=panorama["pano_id"], level_count=panorama["max_zoom"]
                )
                await call(
                    f"panorama_{label}",
                    "GET",
                    "/streetview/panorama",
                    params={"pano_id": panorama["pano_id"]},
                )
                await call(
                    f"tile_{label}",
                    "GET",
                    "/streetview/tile",
                    params={"pano_id": panorama["pano_id"], "zoom": 0, "x": 0, "y": 0},
                )
    report["finished_at"] = datetime.now(UTC).isoformat()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Report saved to {output.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url")
    parser.add_argument("--browser", action="store_true")
    parser.add_argument(
        "--output", type=Path, default=Path("data/metadata/places-live-verification.json")
    )
    options = parser.parse_args()
    asyncio.run(verify(options.base_url, options.browser, options.output))
