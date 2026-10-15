# ruff: noqa: E501
import asyncio
import hmac
import json
import logging
import math
import uuid
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.security import APIKeyHeader

from . import __version__
from .browser import BrowserReviews
from .cache import RateLimiter, TTLCache
from .common import ApiError
from .config import Settings, load_calibration
from .directions import DirectionsService
from .media import MediaService
from .models import (
    DetailsData,
    DetailsRequest,
    DirectionsData,
    DirectionsRequest,
    Envelope,
    ErrorResponse,
    PanoramaData,
    PhotosData,
    ReviewsData,
    SearchData,
    SuggestData,
)
from .search import SearchService
from .transport import GoogleClient, validate_url

Language = Annotated[str, Query(pattern=r"^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$", max_length=12)]
Region = Annotated[str, Query(pattern=r"^[A-Za-z]{2}$")]
FeatureId = Annotated[str, Query(pattern=r"^0x[0-9a-fA-F]{1,16}:0x[0-9a-fA-F]{1,16}$")]
PanoId = Annotated[str, Query(pattern=r"^[A-Za-z0-9_-]{1,256}$")]
Latitude = Annotated[float, Query(ge=-90, le=90, allow_inf_nan=False)]
Longitude = Annotated[float, Query(ge=-180, le=180, allow_inf_nan=False)]
Token = Annotated[str | None, Query(max_length=4096)]
ERRORS = {
    status: {"model": ErrorResponse}
    for status in (400, 401, 404, 413, 422, 429, 500, 502, 503, 504)
}
KEY = APIKeyHeader(name="X-API-Key", auto_error=False)


def create_app(settings=None, client=None, *, route_prefix="/v1", integrated=False):
    settings = settings or Settings.from_env()
    calibration = load_calibration()
    places_prefix = route_prefix if integrated else f"{route_prefix}/places"

    @asynccontextmanager
    async def lifespan(application):
        upstream = client or GoogleClient(calibration, settings)
        application.state.search = SearchService(upstream, calibration)
        application.state.media = MediaService(upstream, calibration)
        application.state.directions = DirectionsService(upstream, calibration)
        application.state.upstream = upstream
        application.state.browser = BrowserReviews(calibration, settings.browser_enabled)
        try:
            yield
        finally:
            await application.state.browser.close()
            if hasattr(upstream, "close"):
                await upstream.close()

    application = FastAPI(
        title="Vela standalone REST API",
        version=__version__,
        lifespan=lifespan,
        description="Portable Google Maps consumer endpoint facade derived from Vela. This is not an official Google API. "
        "No Google API key is required by these adapters. X-API-Key authenticates callers of this service. "
        "Response completeness is limited or unknown; missing upstream fields remain null.",
        license_info={"name": "GPL-3.0-only", "url": "https://www.gnu.org/licenses/gpl-3.0.html"},
        servers=[{"url": "http://127.0.0.1:8000", "description": "Local development"}],
    )
    application.state.cache = TTLCache(settings.cache_size, settings.cache_ttl)
    application.state.places = TTLCache(1024, 6 * 3600)
    application.state.limiter = RateLimiter(settings.rate_limit_per_minute)
    if settings.cors_origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_methods=["GET", "POST"],
            allow_headers=["X-API-Key", "Content-Type"],
            expose_headers=["X-Request-ID"],
        )

    @application.middleware("http")
    async def request_id(request, call_next):
        request.state.request_id = uuid.uuid4().hex
        length = request.headers.get("content-length")
        if length and (not length.isdigit() or int(length) > 64 * 1024):
            return JSONResponse(
                {
                    "error": {
                        "code": "request_too_large",
                        "message": "Request body limit is 64 KiB.",
                    },
                    "request_id": request.state.request_id,
                },
                status_code=413,
                headers={"X-Request-ID": request.state.request_id},
            )
        # Also bound chunked and untrusted Content-Length bodies before JSON parsing.
        if request.method == "POST":
            chunks, size = [], 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > 64 * 1024:
                    return JSONResponse(
                        {
                            "error": {
                                "code": "request_too_large",
                                "message": "Request body limit is 64 KiB.",
                            },
                            "request_id": request.state.request_id,
                        },
                        status_code=413,
                        headers={"X-Request-ID": request.state.request_id},
                    )
                chunks.append(chunk)
            request._body = b"".join(chunks)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    @application.exception_handler(ApiError)
    async def api_error(request, exc):
        headers = (
            {"Retry-After": "60"} if exc.code in ("rate_limited", "upstream_rate_limited") else {}
        )
        return JSONResponse(
            {
                "error": {"code": exc.code, "message": exc.message, "details": exc.details},
                "request_id": request.state.request_id,
            },
            status_code=exc.status_code,
            headers=headers,
        )

    @application.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        # Do not echo invalid inputs or credentials back to clients.
        issues = [
            {"location": list(e["loc"]), "message": e["msg"], "type": e["type"]}
            for e in exc.errors()
        ]
        return JSONResponse(
            {
                "error": {
                    "code": "invalid_request",
                    "message": "Request validation failed.",
                    "details": issues,
                },
                "request_id": request.state.request_id,
            },
            status_code=422,
        )

    @application.exception_handler(Exception)
    async def unexpected(request, exc):
        logging.getLogger("vela_api").error(
            "Unhandled failure request_id=%s type=%s", request.state.request_id, type(exc).__name__
        )
        return JSONResponse(
            {
                "error": {
                    "code": "internal_error",
                    "message": "An unexpected server error occurred.",
                },
                "request_id": request.state.request_id,
            },
            status_code=500,
            headers={"X-Request-ID": request.state.request_id},
        )

    async def authorized(request: Request, key: str | None = Depends(KEY)):
        if settings.api_key and not hmac.compare_digest(
            (key or "").encode(), settings.api_key.encode()
        ):
            raise ApiError("unauthorized", "A valid X-API-Key is required.", 401)
        identity = request.client.host if request.client else "unknown"
        if not application.state.limiter.allow(identity):
            raise ApiError("rate_limited", "The service request limit was exceeded.", 429)

    async def result(request, key, operation, warnings=()):
        cache = application.state.cache
        cached = cache.get(key)
        hit = cached is not None
        if not hit:
            try:
                async with asyncio.timeout(55):
                    cached = await operation()
            except TimeoutError as exc:
                raise ApiError(
                    "upstream_timeout", "The operation exceeded its deadline.", 504
                ) from exc
            cache.put(key, cached)
        return {
            "data": cached,
            "meta": {
                "request_id": request.state.request_id,
                "provider": "google_consumer",
                "calibration_version": calibration["version"],
                "cached": hit,
                "warnings": list(warnings),
            },
        }

    deps = [Depends(authorized)]

    @application.get("/status" if integrated else "/health", tags=["Operations"])
    async def health():
        return {
            "status": "ok",
            "version": __version__,
            "calibration_version": calibration["version"],
            "browser_enabled": settings.browser_enabled,
            "upstream_checked": False,
        }

    @application.get(
        f"{route_prefix}/search",
        response_model=Envelope[SearchData],
        dependencies=deps,
        responses=ERRORS,
        tags=["Places"],
    )
    async def search(
        request: Request,
        query: Annotated[str, Query(min_length=1, max_length=300)],
        latitude: Latitude,
        longitude: Longitude,
        span_meters: Annotated[float, Query(ge=1000, le=500000, allow_inf_nan=False)] = 25000,
        offset: Annotated[int, Query(ge=0, le=1000, multiple_of=20)] = 0,
        language: Language = "en",
        region: Region = "us",
    ):
        args = (query, latitude, longitude, span_meters, offset, language, region)
        answer = await result(
            request,
            ("search", *args),
            lambda: application.state.search.search(*args),
            ["One upstream page per call. next_offset is a heuristic, not a guaranteed page."],
        )
        for place in answer["data"]["places"]:
            for identifier in (place.get("id"), place.get("feature_id"), place.get("place_id")):
                if identifier:
                    application.state.places.put(identifier, place)
        focus = answer["data"].get("focus")
        if focus:
            for identifier in (focus.get("id"), focus.get("feature_id"), focus.get("place_id")):
                if identifier:
                    application.state.places.put(identifier, focus)
        return answer

    @application.get(
        f"{route_prefix}/suggest",
        response_model=Envelope[SuggestData],
        dependencies=deps,
        responses=ERRORS,
        tags=["Places"],
    )
    async def suggest(
        request: Request,
        query: Annotated[str, Query(min_length=1, max_length=300)],
        latitude: Latitude,
        longitude: Longitude,
        span_meters: Annotated[float, Query(ge=2000, le=500000, allow_inf_nan=False)] = 25000,
        language: Language = "en",
        region: Region = "us",
    ):
        args = (query, latitude, longitude, span_meters, language, region)
        return await result(
            request, ("suggest", *args), lambda: application.state.search.suggest(*args)
        )

    async def lookup_details(request, body):
        args = (
            body.place_id,
            body.name,
            body.latitude,
            body.longitude,
            body.address,
            body.language,
            body.region,
        )
        return await result(
            request,
            ("details", *args),
            lambda: application.state.search.details(*args),
            ["Focused search lookup; this does not guarantee every detail field."],
        )

    @application.post(
        f"{places_prefix}/details",
        response_model=Envelope[DetailsData],
        dependencies=deps,
        responses=ERRORS,
        tags=["Places"],
    )
    async def details(request: Request, body: DetailsRequest):
        return await lookup_details(request, body)

    @application.get(
        f"{places_prefix}/{{place_id}}",
        response_model=Envelope[DetailsData],
        dependencies=deps,
        responses=ERRORS,
        tags=["Places"],
    )
    async def cached_place(
        request: Request, place_id: str, language: Language = "en", region: Region = "us"
    ):
        seed = application.state.places.get(place_id)
        if not seed:
            raise ApiError(
                "place_context_missing",
                f"Search for the place on this process first, or use POST {places_prefix}/details with name and coordinates.",
                404,
            )
        identifier = seed.get("feature_id") or seed.get("place_id")
        if not identifier:
            raise ApiError(
                "place_identity_missing", "This result does not have a lookup identity.", 422
            )
        return await lookup_details(
            request,
            DetailsRequest(
                place_id=identifier,
                name=seed["name"],
                latitude=seed["location"]["latitude"],
                longitude=seed["location"]["longitude"],
                address=seed.get("address"),
                language=language,
                region=region,
            ),
        )

    @application.get(
        f"{route_prefix}/photos",
        response_model=Envelope[PhotosData],
        dependencies=deps,
        responses=ERRORS,
        tags=["Media"],
    )
    async def photos(
        request: Request,
        feature_id: FeatureId,
        token: Token = None,
        language: Language = "en",
        region: Region = "us",
    ):
        args = (feature_id, token, language, region)
        return await result(
            request, ("photos", *args), lambda: application.state.media.photos(*args)
        )

    @application.get(
        f"{route_prefix}/reviews",
        response_model=Envelope[ReviewsData],
        dependencies=deps,
        responses=ERRORS,
        tags=["Media"],
    )
    async def reviews(
        request: Request,
        feature_id: FeatureId,
        token: Token = None,
        backend: Literal["native", "browser"] = "native",
        limit: Annotated[int, Query(ge=1, le=50)] = 50,
        language: Language = "en",
        region: Region = "us",
    ):
        if backend == "browser" and token:
            raise ApiError(
                "unsupported_option", "The browser backend does not support page tokens.", 422
            )

        async def operation():
            if backend == "browser":
                return await application.state.browser.reviews(feature_id, limit, language, region)
            value = await application.state.media.reviews(feature_id, token, language, region)
            # Apply the cap without implying that omitted upstream rows can be recovered.
            returned = len(value["reviews"])
            value["reviews"] = value["reviews"][:limit]
            value["backend"] = "native"
            value["returned_before_limit"] = returned
            value["truncated_by_limit"] = returned > limit
            return value

        return await result(
            request,
            ("reviews", feature_id, token, backend, limit, language, region),
            operation,
            [
                "Google may return a limited review feed even when end=true. Native next_token is unverified."
            ],
        )

    @application.post(
        f"{route_prefix}/directions",
        response_model=Envelope[DirectionsData],
        dependencies=deps,
        responses=ERRORS,
        tags=["Directions"],
    )
    async def directions(request: Request, body: DirectionsRequest):
        args = body.model_dump()
        key = ("directions", json.dumps(args, sort_keys=True))
        return await result(
            request,
            key,
            lambda: application.state.directions.directions(**args),
            [
                "Google geometry and timing only. Android navigation and offline routing are not included."
            ],
        )

    @application.get(
        f"{route_prefix}/streetview",
        response_model=Envelope[PanoramaData],
        dependencies=deps,
        responses=ERRORS,
        tags=["Street View"],
    )
    async def streetview(
        request: Request,
        latitude: Latitude,
        longitude: Longitude,
        radius: Annotated[int, Query(json_schema_extra={"enum": [50, 200]})] = 50,
    ):
        if radius not in (50, 200):
            raise ApiError("invalid_argument", "radius must be 50 or 200 meters.", 422)
        return await result(
            request,
            ("streetview", latitude, longitude, radius),
            lambda: application.state.media.streetview(latitude, longitude, radius),
        )

    @application.get(
        f"{route_prefix}/streetview/panorama",
        response_model=Envelope[PanoramaData],
        dependencies=deps,
        responses=ERRORS,
        tags=["Street View"],
    )
    async def panorama(request: Request, pano_id: PanoId):
        return await result(
            request, ("panorama", pano_id), lambda: application.state.media.panorama(pano_id)
        )

    @application.get(
        f"{route_prefix}/streetview/tile",
        response_class=Response,
        dependencies=deps,
        responses={
            **ERRORS,
            200: {"content": {"image/jpeg": {"schema": {"type": "string", "format": "binary"}}}},
        },
        tags=["Street View"],
    )
    async def tile(
        request: Request,
        pano_id: PanoId,
        zoom: Annotated[int, Query(ge=0, le=6)],
        x: Annotated[int, Query(ge=0, le=127)],
        y: Annotated[int, Query(ge=0, le=127)],
    ):
        info = (
            await result(
                request, ("panorama", pano_id), lambda: application.state.media.panorama(pano_id)
            )
        )["data"]
        dimensions = info["level_dimensions"]
        if zoom >= len(dimensions) or zoom >= info["max_zoom"]:
            raise ApiError("invalid_tile", "Zoom is outside this panorama's available levels.", 422)
        if x >= math.ceil(dimensions[zoom]["width"] / info["tile_size"]) or y >= math.ceil(
            dimensions[zoom]["height"] / info["tile_size"]
        ):
            raise ApiError(
                "invalid_tile", "Tile coordinates are outside the panorama dimensions.", 422
            )
        content, content_type = await application.state.upstream.get_image(
            application.state.media.tile_url(pano_id, x, y, zoom)
        )
        return Response(
            content, media_type=content_type, headers={"Cache-Control": "private, max-age=120"}
        )

    @application.get(
        f"{route_prefix}/image",
        response_class=Response,
        dependencies=deps,
        responses={
            **ERRORS,
            200: {
                "content": {
                    mime: {"schema": {"type": "string", "format": "binary"}}
                    for mime in ("image/jpeg", "image/png", "image/webp", "image/avif", "image/gif")
                }
            },
        },
        tags=["Media"],
    )
    async def image(url: Annotated[str, Query(max_length=4096)]):
        validate_url(url, image=True)
        content, content_type = await application.state.upstream.get_image(url)
        return Response(
            content, media_type=content_type, headers={"Cache-Control": "private, max-age=120"}
        )

    if integrated:
        # Register the cached identity catch-all after every static endpoint.
        cached_route = next(
            route for route in application.routes if getattr(route, "name", "") == "cached_place"
        )
        application.routes.remove(cached_route)
        application.routes.append(cached_route)
    return application


app = create_app()
