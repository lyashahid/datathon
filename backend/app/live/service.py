"""Transient live snapshot orchestration, cache handling, and SSE encoding."""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, AsyncIterator

import httpx

from app.data.cache import FileCache
from app.live.config import DEFAULT_LIVE_CONFIG, LiveConfig
from app.live.models import LiveQuery
from app.live.providers import (
    AdsbLolProvider,
    FachaProvider,
    FollowMeProvider,
    LiveProvider,
    OpenSkyProvider,
    OpenWatersProvider,
    RtlBusProvider,
    _bbox,
)


class LiveService:
    """Deep module exposing a normalized, failure-isolated live layer."""

    def __init__(self, data_dir: Path, config: LiveConfig | None = None) -> None:
        self.cache = FileCache(data_dir / "cache")
        self.config = config or DEFAULT_LIVE_CONFIG
        self.providers: dict[str, LiveProvider] = {
            "adsb.lol": AdsbLolProvider(self.config),
            "openwaters": OpenWatersProvider(self.config),
            "facha": FachaProvider(self.config),
            "rtl": RtlBusProvider(self.config),
            "followme": FollowMeProvider(self.config, self.cache),
            "opensky": OpenSkyProvider(self.config, self.cache),
        }
        self._last_status: dict[str, dict[str, Any]] = {}

    def reload(self) -> None:
        """Reset in-memory status without deleting transient cache files."""

        self._last_status = {}

    def status(self) -> dict[str, Any]:
        providers = []
        for name, provider in self.providers.items():
            providers.append(
                {
                    **_provider_information(name),
                    **(
                        self._last_status.get(
                            name,
                            {
                                "provider": name,
                                "enabled": provider.enabled,
                                "status": "not_queried" if provider.enabled else "disabled",
                                "event_count": 0,
                            },
                        )
                    ),
                }
            )
        return {
            "version": "live-v1",
            "providers": providers,
            "cache_ttl_seconds": self.config.cache_ttl_seconds,
            "poll_interval_seconds": self.config.poll_interval_seconds,
            "deterministic_data_affected": False,
        }

    async def snapshot(self, query: LiveQuery | None = None) -> dict[str, Any]:
        request = query or LiveQuery(
            latitude=self.config.default_latitude,
            longitude=self.config.default_longitude,
            radius_nm=self.config.default_radius_nm,
        )
        names = [
            name for name in ("adsb.lol", "openwaters", "rtl", "followme") if name in self.providers
        ]
        provider_results = list(
            await asyncio.gather(*[self._fetch_cached(name, request) for name in names])
        )
        aircraft = next(result for result in provider_results if result["provider"] == "adsb.lol")
        vessels = next(result for result in provider_results if result["provider"] == "openwaters")
        if (
            "opensky" in self.providers
            and request.include_fallback
            and not _events_in_query(aircraft.get("events", []), request)
        ):
            provider_results.append(await self._fetch_cached("opensky", request))
        if request.include_fallback and (
            vessels.get("status") == "error" or request.radius_nm <= 10
        ):
            provider_results.append(await self._fetch_cached("facha", request))
        else:
            provider_results.append(
                {
                    "provider": "facha",
                    "enabled": self.providers["facha"].enabled,
                    "status": "not_used" if self.providers["facha"].enabled else "disabled",
                    "event_count": 0,
                    "events": [],
                }
            )
        summaries = [_provider_summary(result, request) for result in provider_results]
        for summary in summaries:
            self._last_status[summary["provider"]] = summary
        events = [event for result in provider_results for event in result.get("events", [])]
        events = _deduplicate_events(_events_in_query(events, request))
        return {
            "version": "live-v1",
            "retrieved_at": datetime.now(UTC).isoformat(),
            "query": request.model_dump(mode="json"),
            "providers": summaries,
            "locations": events,
            "events": events,
            "coverage": "available" if events else "no_current_coverage",
            "counts": {
                kind: sum(event.get("kind") == kind for event in events)
                for kind in ("aircraft", "vessel", "bus")
            },
            "scope": {
                "bbox": list(_bbox(request)),
                "bbox_order": "min_lat,min_lon,max_lat,max_lon",
                "island_name": request.island_name,
            },
            "position_policy": (
                "Provider observations only. Old position timestamps are excluded; "
                "unknown position timestamps are labelled. "
                "Animation between observations does not measure a route."
            ),
            "deterministic_data_affected": False,
        }

    async def vessel_snapshot(self, query: LiveQuery | None = None) -> dict[str, Any]:
        """Return one normalized vessel view across all enabled vessel providers."""

        request = query or LiveQuery(
            latitude=self.config.default_latitude,
            longitude=self.config.default_longitude,
            radius_nm=self.config.default_radius_nm,
        )
        openwaters, followme = await asyncio.gather(
            self._fetch_cached("openwaters", request),
            self._fetch_cached("followme", request)
            if "followme" in self.providers
            else asyncio.sleep(
                0,
                result={
                    "provider": "followme",
                    "enabled": False,
                    "status": "disabled",
                    "event_count": 0,
                    "events": [],
                },
            ),
        )
        provider_results = [openwaters, followme]
        if request.include_fallback and (
            openwaters.get("status") == "error" or request.radius_nm <= 10
        ):
            provider_results.append(await self._fetch_cached("facha", request))
        else:
            provider_results.append(
                {
                    "provider": "facha",
                    "enabled": self.providers["facha"].enabled,
                    "status": "not_used" if self.providers["facha"].enabled else "disabled",
                    "event_count": 0,
                    "events": [],
                }
            )

        events = _events_in_query(
            [event for result in provider_results for event in result.get("events", [])],
            request,
        )
        events = _deduplicate_events(events)
        summaries = [_provider_summary(result, request) for result in provider_results]
        for summary in summaries:
            self._last_status[summary["provider"]] = summary
        statuses = [result.get("status") for result in provider_results if result.get("enabled")]
        coverage = (
            "available"
            if events and all(status == "ok" for status in statuses)
            else ("partial" if events else "no_current_coverage")
        )
        response: dict[str, Any] = {
            "version": "vessel-live-v1",
            "retrieved_at": datetime.now(UTC).isoformat(),
            "query": request.model_dump(mode="json"),
            "providers": summaries,
            "vessels": events,
            "coverage": coverage,
            "deterministic_data_affected": False,
        }
        catalogue = followme.get("catalogue")
        if catalogue is not None:
            response["followme_catalogue"] = catalogue
        return response

    async def stream(
        self,
        query: LiveQuery | None = None,
        *,
        once: bool = True,
    ) -> AsyncIterator[str]:
        """Yield normalized SSE records; continuous mode polls at configured cadence."""

        while True:
            snapshot = await self.snapshot(query)
            for provider in snapshot["providers"]:
                yield _sse("provider_status", provider.get("provider", "unknown"), provider)
            for event in snapshot["events"]:
                yield _sse(event["kind"], event["id"], event)
            if once:
                return
            await asyncio.sleep(self.config.poll_interval_seconds)

    async def _fetch_cached(self, provider_name: str, query: LiveQuery) -> dict[str, Any]:
        provider = self.providers[provider_name]
        if not provider.enabled:
            return {
                "provider": provider_name,
                "enabled": False,
                "status": "disabled",
                "event_count": 0,
                "events": [],
            }
        relative_path = self._cache_path(provider_name, query)
        try:
            cached = self.cache.read_json(relative_path)
            retrieved_at = datetime.fromisoformat(cached["retrieved_at"])
            age = (datetime.now(UTC) - retrieved_at).total_seconds()
            if age <= self._cache_ttl(provider_name):
                result = cached["result"]
                result["cached"] = True
                return dict(result)
        except FileNotFoundError, KeyError, TypeError, ValueError, json.JSONDecodeError:
            pass
        try:
            async with asyncio.timeout(self.config.request_timeout_seconds * 2):
                result = await provider.fetch(query)
        except Exception as error:  # provider failures must not break the live layer
            if cached_result := self._read_stale_result(relative_path, provider_name):
                return _mark_result_stale(cached_result)
            result = {
                "provider": provider_name,
                "enabled": True,
                "status": "error",
                "event_count": 0,
                **_provider_error(provider_name, error),
                "events": [],
            }
        self.cache.write_json(
            relative_path,
            {"retrieved_at": datetime.now(UTC).isoformat(), "result": result},
            source=f"live provider {provider_name}",
            endpoint=provider_name,
            parser_version="live-v1",
        )
        return result

    def _cache_ttl(self, provider_name: str) -> int:
        if provider_name == "followme":
            return self.config.followme_cache_ttl_seconds
        if provider_name == "opensky":
            return self.config.opensky_cache_ttl_seconds
        return self.config.cache_ttl_seconds

    def _read_stale_result(self, relative_path: str, provider_name: str) -> dict[str, Any] | None:
        try:
            cached = self.cache.read_json(relative_path)
            retrieved_at = datetime.fromisoformat(cached["retrieved_at"])
            age = (datetime.now(UTC) - retrieved_at).total_seconds()
            if age <= self._cache_ttl(provider_name) * 3:
                result = cached["result"]
                return result if isinstance(result, dict) else None
        except FileNotFoundError, KeyError, TypeError, ValueError, json.JSONDecodeError:
            return None
        return None

    def _cache_path(self, provider_name: str, query: LiveQuery) -> str:
        material = json.dumps(
            {"provider": provider_name, **query.model_dump(mode="json")},
            sort_keys=True,
        ).encode("utf-8")
        digest = hashlib.sha256(material).hexdigest()[:24]
        return f"live/{provider_name.replace('.', '-')}-{digest}.json"


def _sse(event: str, event_id: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\nid: {event_id}\ndata: {payload}\n\n"


def _events_in_query(events: list[dict[str, Any]], query: LiveQuery) -> list[dict[str, Any]]:
    min_lat, min_lon, max_lat, max_lon = _bbox(query)
    now = datetime.now(UTC)
    filtered: list[dict[str, Any]] = []
    for event in events:
        position = event.get("position", {})
        try:
            latitude = float(position["latitude"])
            longitude = float(position["longitude"])
        except KeyError, TypeError, ValueError:
            continue
        if not (min_lat <= latitude <= max_lat and min_lon <= longitude <= max_lon):
            continue
        if event.get("stale") and not query.include_stale:
            continue
        retrieved_at = _event_time(event.get("retrieved_at"))
        observed_at = _event_time(event.get("observed_at")) or _event_time(event.get("updated_at"))
        position_age = (now - observed_at).total_seconds() if observed_at else None
        # Clock errors must not make observations from the future appear live.
        if position_age is not None and position_age < -60:
            continue
        retrieval_age = (now - retrieved_at).total_seconds() if retrieved_at else None
        expired = (position_age is not None and position_age > query.max_age_seconds) or (
            retrieval_age is not None and retrieval_age > query.max_age_seconds
        )
        if expired and not query.include_stale:
            continue
        filtered.append(
            {
                **event,
                "stale": bool(event.get("stale") or expired),
                "position_age_seconds": max(0, round(position_age, 1))
                if position_age is not None
                else None,
                "position_time_quality": "provider_observed" if observed_at else "retrieval_only",
                "source_quality": "stale_provider_observation"
                if expired
                else event.get("source_quality", "provider_live"),
            }
        )
    return filtered


def _deduplicate_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deduplicate provider-local IDs without guessing cross-provider identity."""

    result: dict[str, dict[str, Any]] = {}
    for event in events:
        event_id = str(event.get("id", ""))
        if event_id and event_id not in result:
            result[event_id] = event
    return list(result.values())


def _event_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed


def _mark_result_stale(result: dict[str, Any]) -> dict[str, Any]:
    stale = dict(result)
    stale["status"] = "stale"
    stale["stale"] = True
    stale["events"] = [
        {
            **event,
            "stale": True,
            "source_quality": "stale_cached",
        }
        for event in result.get("events", [])
    ]
    return stale


def _provider_information(name: str) -> dict[str, Any]:
    information = {
        "adsb.lol": (
            "ADSB.lol",
            "https://www.adsb.lol/docs/open-data/api/",
            "aircraft",
            "Volunteer ADS-B receivers; ODbL 1.0. Access and receiver coverage vary.",
        ),
        "opensky": (
            "OpenSky Network",
            "https://openskynetwork.github.io/opensky-api/rest.html",
            "aircraft",
            "Anonymous research API; receiver coverage varies; at most one refresh per 5 minutes.",
        ),
        "openwaters": (
            "Open Waters AIS",
            "https://openwaters.io/ais/",
            "vessel",
            "AIS reception only; an empty response does not establish no boats.",
        ),
        "facha": (
            "Facha vessel API",
            "https://api.facha.dev",
            "vessel",
            "Fallback vessel reception within 10 nautical miles.",
        ),
        "followme": (
            "FollowMe public GPS",
            "https://m.followme.mv/public/",
            "vessel",
            "Public devices only; nearby discovery uses a 20 km circle around a public seed. "
            "Partial coverage.",
        ),
        "rtl": (
            "RTL buses",
            "https://rtl.mv",
            "bus",
            "Route-specific feed; requires explicitly enabled operator access and route code.",
        ),
    }
    display_name, source_url, kind, note = information.get(
        name, (name, None, None, "Provider coverage varies.")
    )
    return {
        "display_name": display_name,
        "source_url": source_url,
        "kind": kind,
        "coverage_note": note,
    }


def _provider_summary(result: dict[str, Any], query: LiveQuery) -> dict[str, Any]:
    events = result.get("events", [])
    visible = _events_in_query(events, query)
    return {
        **_provider_information(result["provider"]),
        **{key: value for key, value in result.items() if key not in {"events", "catalogue"}},
        "provider_event_count": len(events),
        "visible_event_count": len(visible),
        "filtered_event_count": len(events) - len(visible),
    }


def _provider_error(name: str, error: Exception) -> dict[str, Any]:
    if isinstance(error, httpx.HTTPStatusError):
        code = error.response.status_code
        if code in {401, 403}:
            message = (
                "Provider declined access. Configure a real operator contact in LIVE_USER_AGENT "
                "or the provider's required access; no positions are fabricated."
            )
            return {"status": "configuration_required", "http_status": code, "message": message}
        if code == 429:
            return {
                "status": "rate_limited",
                "http_status": code,
                "message": (
                    "Provider request quota reached; the feed will retry after its cache interval."
                ),
            }
        return {
            "http_status": code,
            "message": f"Provider returned HTTP {code}; other movement feeds remain available.",
        }
    return {
        "message": (
            f"{type(error).__name__}: live provider unavailable; "
            "other movement feeds remain available."
        )
    }
