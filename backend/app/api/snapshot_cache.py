"""Cache only explicit, deterministic, unauthenticated snapshot GET responses."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qs

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request

from app.data.computed_cache import ComputedCache, SourceVersion

SNAPSHOT_PATH = re.compile(
    r"^/api/v1/(?:national/summary|accessibility/summary|map/(?:features|context)|"
    r"islands(?:/[^/]+(?:/profile)?)?|planning/(?:baseline|opportunities(?:/[^/]+)?)|"
    r"datasets(?:/[^/]+/schema)?)$"
)
NETWORK_PATHS = {"/api/v1/planning/sea-network", "/api/v1/planning/air-network"}


def network_snapshot_inputs(scope: dict[str, Any]) -> Any:
    """Use the service's complete key, including mutable reviewed source evidence."""
    from app.api.routes.air import get_air_network
    from app.api.routes.planning import (
        DEFAULT_SEA_NETWORK_DATE,
        get_planning,
        get_sea_connections,
        get_transport_planning,
    )

    request = Request(scope)
    query = parse_qs(scope.get("query_string", b"").decode())
    selected = date.fromisoformat(query["date"][-1]) if "date" in query else None
    planning = get_planning(request)
    if scope["path"] == "/api/v1/planning/air-network":
        selected = selected or datetime.now(UTC).astimezone(timezone(timedelta(hours=5))).date()
        return get_air_network(request, planning).network_inputs(selected)
    transport = get_transport_planning(request, planning)
    return get_sea_connections(request, transport).network_inputs(
        selected or DEFAULT_SEA_NETWORK_DATE
    )


class UncacheableResponse(Exception):
    def __init__(self, messages: list[dict[str, Any]]) -> None:
        self.messages = messages


class SnapshotCacheMiddleware:
    """Serialized JSON fast path, conditional validators, no live/error caching.

    Kept inside GZip middleware so one cached representation serves browsers and
    direct clients with different compression support. A source snapshot stays
    immutable until the application's reload/restart boundary.
    """

    def __init__(
        self,
        app: Any,
        cache: ComputedCache,
        source: SourceVersion,
        network_inputs: Callable[[dict[str, Any]], Any] | None = None,
    ) -> None:
        self.app = app
        self.cache = cache
        self.source = source
        self.network_inputs = network_inputs

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] != "GET"
            or not (
                SNAPSHOT_PATH.fullmatch(scope["path"])
                or (scope["path"] in NETWORK_PATHS and self.network_inputs is not None)
                or (
                    scope["path"] == "/api/v1/forecasts"
                    and parse_qs(scope.get("query_string", b"").decode())
                    == {"history_only": ["true"]}
                )
            )
            or any(key.lower() in {b"authorization", b"cookie"} for key, _ in scope["headers"])
        ):
            await self.app(scope, receive, send)
            return
        inputs = None
        if scope["path"] in NETWORK_PATHS:
            try:
                inputs = await run_in_threadpool(self.network_inputs, scope)
            except ValueError, KeyError, TypeError, IndexError:
                # Preserve the endpoint's validation/error response; never cache
                # a failed source receipt or an invalid service date.
                await self.app(scope, receive, send)
                return
        version = self.source.version()
        messages: list[dict[str, Any]] = []

        async def calculate() -> bytes:
            async def capture(message: dict[str, Any]) -> None:
                messages.append(message)

            await self.app(scope, receive, capture)
            start = next((m for m in messages if m["type"] == "http.response.start"), {})
            headers = dict(start.get("headers", []))
            if (
                start.get("status") != 200
                or b"application/json" not in headers.get(b"content-type", b"")
                or b"set-cookie" in headers
                or b"content-encoding" in headers
            ):
                raise UncacheableResponse(messages)
            return b"".join(
                m.get("body", b"") for m in messages if m["type"] == "http.response.body"
            )

        try:
            payload = await self.cache.aget_or_compute_bytes(
                "snapshot-http",
                [version, scope["path"], scope.get("query_string", b"").hex(), inputs],
                calculate,
            )
        except UncacheableResponse as response:
            for message in response.messages:
                await send(message)
            return
        etag = b'W/"' + hashlib.sha256(payload).hexdigest().encode() + b'"'
        headers = [
            (b"etag", etag),
            (b"cache-control", b"private, max-age=0, must-revalidate"),
            (b"x-data-version", version.encode()),
        ]
        conditions = [value for key, value in scope["headers"] if key.lower() == b"if-none-match"]
        matches = any(
            candidate.strip().removeprefix(b"W/") in {etag.removeprefix(b"W/"), b"*"}
            for value in conditions
            for candidate in value.split(b",")
        )
        if matches:
            await send({"type": "http.response.start", "status": 304, "headers": headers})
            await send({"type": "http.response.body", "body": b""})
        else:
            headers.extend(
                [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(payload)).encode()),
                ]
            )
            await send({"type": "http.response.start", "status": 200, "headers": headers})
            await send({"type": "http.response.body", "body": payload})
