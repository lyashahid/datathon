"""Adapters for optional live aircraft, vessel, and bus providers."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
import unicodedata
from datetime import UTC, datetime, timedelta, timezone
from typing import Any, Protocol

import httpx
from bs4 import BeautifulSoup

from app.data.cache import FileCache
from app.live.config import LiveConfig
from app.live.models import LiveEvent, LiveQuery, parse_bbox


class LiveProvider(Protocol):
    name: str
    enabled: bool

    async def fetch(self, query: LiveQuery) -> dict[str, Any]:
        """Return normalized events and provider status for one snapshot."""


class FollowMeProvider:
    """Public vessel positions, using bounded public neighbour discovery.

    Discovery resolves a public island catalogue to a public vessel, then uses
    the same neighbour endpoint as the provider's public map. Coordinates are
    never inferred from catalogue location labels.
    """

    name = "followme"

    def __init__(self, config: LiveConfig, cache: FileCache) -> None:
        self.config = config
        self.cache = cache
        self.enabled = config.followme_enabled
        self._request_lock = asyncio.Lock()
        self._last_request_at = 0.0

    async def fetch(self, query: LiveQuery) -> dict[str, Any]:
        if not self.enabled:
            return _status(self.name, False, "disabled")

        catalogue: list[dict[str, Any]] = []
        async with httpx.AsyncClient(
            timeout=self.config.request_timeout_seconds,
            follow_redirects=True,
            headers={
                "User-Agent": self.config.user_agent,
                "Accept": "application/json, text/html",
            },
        ) as client:
            if query.include_followme_catalogue:
                catalogue = await self.fetch_catalogue(client)

            events: list[dict[str, Any]] = []
            if query.followme_vessel_ids:
                for vessel_id in query.followme_vessel_ids:
                    payload = await self._get_json(
                        client,
                        self.config.followme_device_url,
                        params={"id": vessel_id},
                        source_record_id=str(vessel_id),
                    )
                    event = _followme_event(payload, vessel_id)
                    if event is not None:
                        events.append(event)
                        self._write_latest(event)
            elif query.discover_nearby:
                return await self._discover_nearby(client, query)
            else:
                events = self._read_latest(query.max_age_seconds)

        result = _status(
            self.name,
            True,
            "ok" if events else ("catalogue_only" if catalogue else "no_selection"),
            len(events),
        )
        result["events"] = events
        if catalogue:
            result["catalogue"] = catalogue
        return result

    async def _discover_nearby(self, client: httpx.AsyncClient, query: LiveQuery) -> dict[str, Any]:
        latitude, longitude, _radius = _query_center_radius(query)
        seed: dict[str, Any] | None = None
        metadata: dict[str, dict[str, Any]] = {}
        latest = sorted(
            self._read_latest(900),
            key=lambda event: _distance_m(
                latitude,
                longitude,
                event["position"]["latitude"],
                event["position"]["longitude"],
            ),
        )
        if (
            latest
            and _distance_m(
                latitude,
                longitude,
                latest[0]["position"]["latitude"],
                latest[0]["position"]["longitude"],
            )
            <= 10_000
        ):
            seed = latest[0]
        if seed is None and query.island_name:
            islands = await self._get_json(
                client,
                self.config.followme_islands_url,
                params={"q": query.island_name},
                source_record_id=query.island_name,
            )
            candidates = islands.get("islands", []) if isinstance(islands, dict) else []
            name_key = _name_key(query.island_name)
            candidates = sorted(
                [item for item in candidates if isinstance(item, dict)],
                key=lambda item: not _name_key(str(item.get("name", ""))).endswith(name_key),
            )
            # Homonymous islands can occur in different atolls: verify the seed
            # coordinate against the requested area before using its neighbours.
            for island in candidates[:3]:
                island_id = island.get("id")
                if not isinstance(island_id, int) or island_id <= 0:
                    continue
                catalogue = await self._island_catalogue(client, island_id)
                metadata.update({str(item["id"]): item for item in catalogue})
                fresh = sorted(catalogue, key=lambda item: _report_age(item.get("report_text")))
                for item in fresh[:2]:
                    vessel_id = int(item["id"])
                    payload = await self._get_json(
                        client,
                        self.config.followme_device_url,
                        params={"id": vessel_id},
                        source_record_id=str(vessel_id),
                    )
                    candidate = _followme_event(payload, vessel_id)
                    if (
                        candidate is not None
                        and _distance_m(
                            latitude,
                            longitude,
                            candidate["position"]["latitude"],
                            candidate["position"]["longitude"],
                        )
                        <= 20_000
                    ):
                        seed = candidate
                        break
                if seed is not None:
                    break
        if seed is None:
            return {
                **_status(self.name, True, "no_current_coverage"),
                "message": (
                    "No public vessel seed was found near this island. "
                    "This does not establish an absence of boats."
                ),
                "discovery": {
                    "method": "public_island_neighbours",
                    "radius_m": 20_000,
                    "complete": False,
                },
            }
        # Public neighbour rows do not carry vehicle types. Join their public
        # IDs to the cached public catalogue so buses/cars are not ship icons.
        try:
            public_catalogue = await self.fetch_catalogue(client)
            metadata.update({str(item["id"]): item for item in public_catalogue})
        except httpx.HTTPError, ValueError, KeyError:
            pass
        vessel_id = int(seed["external_object_id"])
        payload = await self._get_json(
            client,
            self.config.followme_neighbours_url,
            params={"id": vessel_id, "radius": 20_000},
            source_record_id=str(vessel_id),
        )
        data = payload.get("data", {}) if isinstance(payload, dict) else {}
        rows = data.get("boats", []) if isinstance(data, dict) else []
        if not isinstance(rows, list) or payload.get("status") != "ok":
            raise ValueError("FollowMe neighbour response is unavailable")
        events = []
        for row in rows[:500]:
            if not isinstance(row, dict) or not isinstance(row.get("id"), int):
                continue
            event = _followme_event({"status": "ok", "device": row}, row["id"])
            if event is not None:
                event = _classify_followme_event(event, metadata)
                if event is None:
                    continue
                event["properties"]["discovery_method"] = "public_neighbours"
                events.append(event)
        classified_seed = _classify_followme_event(seed, metadata)
        if classified_seed and seed["id"] not in {event["id"] for event in events}:
            classified_seed["properties"]["discovery_method"] = "public_neighbours"
            events.append(classified_seed)
        self._write_latest_events(events)
        return {
            **_status(self.name, True, "ok" if events else "no_current_coverage", len(events)),
            "events": events,
            "discovery": {
                "method": "public_island_neighbours",
                "seed_id": vessel_id,
                "radius_m": 20_000,
                "seed_position": seed["position"],
                "provider_record_count": len(rows),
                "truncated": len(rows) > 500,
                "complete": False,
            },
            "message": (
                "Public GPS positions within 20 km of a nearby public vessel, "
                "clipped to your map scope. Coverage is partial."
            ),
        }

    async def _island_catalogue(
        self, client: httpx.AsyncClient, island_id: int
    ) -> list[dict[str, Any]]:
        path = f"live/followme/island-{island_id}.json"
        try:
            cached = self.cache.read_json(path)
            retrieved = _parse_datetime(cached.get("retrieved_at"))
            if (
                retrieved
                and (datetime.now(UTC) - retrieved).total_seconds()
                <= self.config.followme_catalogue_ttl_seconds
            ):
                return cached["records"]
        except FileNotFoundError, KeyError, TypeError, ValueError:
            pass
        body = await self._get_bytes(
            client,
            self.config.followme_catalogue_url,
            suffix="html",
            accept="text/html",
            params={"mode": "location", "island_id": island_id},
            source_record_id=str(island_id),
        )
        records = _catalogue_records(BeautifulSoup(body, "html.parser"))
        self.cache.write_json(
            path,
            {"retrieved_at": datetime.now(UTC).isoformat(), "records": records},
            source="FollowMe public island catalogue",
            endpoint=self.config.followme_catalogue_url,
            parser_version="followme-neighbours-v2",
        )
        return records

    def _write_latest(self, event: dict[str, Any]) -> None:
        self._write_latest_events([event])

    def _write_latest_events(self, events: list[dict[str, Any]]) -> None:
        try:
            latest = self.cache.read_json("live/followme/latest.json")
        except FileNotFoundError, ValueError, TypeError, json.JSONDecodeError:
            latest = {}
        if not isinstance(latest, dict):
            latest = {}
        latest.update({event["external_object_id"]: event for event in events})
        latest = dict(
            sorted(
                latest.items(),
                key=lambda item: str(item[1].get("retrieved_at", "")),
                reverse=True,
            )[:1000]
        )
        self.cache.write_json(
            "live/followme/latest.json",
            latest,
            source="FollowMe normalized live cache",
            endpoint=self.config.followme_device_url,
            parser_version="followme-v1",
        )

    def _read_latest(self, max_age_seconds: int) -> list[dict[str, Any]]:
        try:
            latest = self.cache.read_json("live/followme/latest.json")
        except FileNotFoundError, ValueError, TypeError, json.JSONDecodeError:
            return []
        if not isinstance(latest, dict):
            return []
        now = datetime.now(UTC)
        events = []
        for value in latest.values():
            if not isinstance(value, dict):
                continue
            retrieved_at = _parse_datetime(value.get("retrieved_at"))
            if retrieved_at is None or (now - retrieved_at).total_seconds() > max_age_seconds:
                continue
            events.append(value)
        return events

    async def fetch_catalogue(self, client: httpx.AsyncClient) -> list[dict[str, Any]]:
        try:
            cached = self.cache.read_json("live/followme/catalogue.json")
            retrieved_at = _parse_datetime(cached["retrieved_at"])
            records = cached["records"]
            if (
                retrieved_at is not None
                and isinstance(records, list)
                and cached.get("parser_version") == "followme-catalogue-v2"
                and (datetime.now(UTC) - retrieved_at).total_seconds()
                <= self.config.followme_catalogue_ttl_seconds
            ):
                return records
        except FileNotFoundError, KeyError, TypeError, ValueError, json.JSONDecodeError:
            pass
        body = await self._get_bytes(
            client,
            self.config.followme_catalogue_url,
            suffix="html",
            accept="text/html",
        )
        records = _catalogue_records(BeautifulSoup(body, "html.parser"))
        self.cache.write_json(
            "live/followme/catalogue.json",
            {
                "retrieved_at": datetime.now(UTC).isoformat(),
                "records": records,
                "parser_version": "followme-catalogue-v2",
            },
            source="FollowMe normalized catalogue cache",
            endpoint=self.config.followme_catalogue_url,
            parser_version="followme-catalogue-v1",
        )
        return records

    async def neighbours(self, vessel_id: int, radius_m: int) -> dict[str, Any]:
        if not self.enabled:
            return _status(self.name, False, "disabled")
        async with httpx.AsyncClient(
            timeout=self.config.request_timeout_seconds,
            headers={"User-Agent": self.config.user_agent, "Accept": "application/json"},
        ) as client:
            payload = await self._get_json(
                client,
                self.config.followme_neighbours_url,
                params={"id": vessel_id, "radius": radius_m},
                source_record_id=str(vessel_id),
            )
        return {"provider": self.name, "status": "ok", "vessel_id": vessel_id, "data": payload}

    async def eta(self, vessel_id: int) -> dict[str, Any]:
        if not self.enabled:
            return _status(self.name, False, "disabled")
        async with httpx.AsyncClient(
            timeout=self.config.request_timeout_seconds,
            headers={"User-Agent": self.config.user_agent, "Accept": "application/json"},
        ) as client:
            payload = await self._get_json(
                client,
                self.config.followme_eta_url,
                params={"id": vessel_id},
                source_record_id=str(vessel_id),
            )
        return {"provider": self.name, "status": "ok", "vessel_id": vessel_id, "data": payload}

    async def _get_json(
        self,
        client: httpx.AsyncClient,
        url: str,
        *,
        params: dict[str, Any],
        source_record_id: str,
    ) -> Any:
        body = await self._get_bytes(
            client,
            url,
            suffix="json",
            accept="application/json",
            params=params,
            source_record_id=source_record_id,
        )
        return json.loads(body)

    async def _get_bytes(
        self,
        client: httpx.AsyncClient,
        url: str,
        *,
        suffix: str,
        accept: str,
        params: dict[str, Any] | None = None,
        source_record_id: str | None = None,
    ) -> bytes:
        async with self._request_lock:
            loop = asyncio.get_running_loop()
            wait = self.config.followme_min_interval_seconds - (loop.time() - self._last_request_at)
            if wait > 0:
                await asyncio.sleep(wait)
            async with client.stream(
                "GET", url, params=params, headers={"Accept": accept}
            ) as response:
                response.raise_for_status()
                chunks = []
                byte_count = 0
                async for chunk in response.aiter_bytes():
                    byte_count += len(chunk)
                    if byte_count > 8_000_000:
                        raise ValueError("FollowMe response exceeds the 8 MB live-data bound")
                    chunks.append(chunk)
                body = b"".join(chunks)
            self._last_request_at = loop.time()
        digest = hashlib.sha256(
            (url + "?" + json.dumps(params or {}, sort_keys=True)).encode("utf-8")
        ).hexdigest()[:24]
        self.cache.write_bytes(
            f"raw/live/followme/{digest}.{suffix}",
            body,
            source="FollowMe",
            endpoint=str(response.url),
            http_status=response.status_code,
            content_type=response.headers.get("content-type"),
            source_record_id=source_record_id,
            parser_version="followme-v1",
        )
        return body


def _classify_followme_event(
    event: dict[str, Any], metadata: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    """Apply the same public identity to neighbour rows and fallback seed positions."""
    detail = metadata.get(event["external_object_id"], {})
    properties = {**event["properties"]}
    for field in ("type", "operator"):
        if detail.get(field):
            properties[field] = detail[field]
    vehicle_type = str(properties.get("type") or "").lower()
    if vehicle_type == "car":
        return None
    return {
        **event,
        "properties": properties,
        "kind": "bus" if vehicle_type == "bus" else event["kind"],
    }


def _followme_event(payload: Any, requested_id: int) -> dict[str, Any] | None:
    if not isinstance(payload, dict) or payload.get("status") != "ok":
        return None
    device = payload.get("device")
    if not isinstance(device, dict):
        return None
    latitude = _number(device.get("latitude"))
    longitude = _number(device.get("longitude"))
    if latitude is None or longitude is None or not _in_bounds(latitude, longitude):
        return None
    vessel_id = str(device.get("id") or requested_id)
    updated_at = _followme_time(device.get("updated_at"))
    event = LiveEvent(
        id=f"followme:{vessel_id}",
        kind="vessel",
        provider="followme",
        external_object_id=vessel_id,
        position={"latitude": latitude, "longitude": longitude},
        observed_at=updated_at,
        updated_at=updated_at,
        retrieved_at=datetime.now(UTC),
        source_quality="verified_public_json",
        properties={
            key: device.get(key)
            for key in ("name", "speed", "heading", "reef_dist_m", "fence")
            if device.get(key) is not None
        },
    )
    result = event.model_dump(mode="json")
    if isinstance(device.get("updated_at"), str):
        result["properties"]["provider_timestamp_raw"] = device["updated_at"]
        result["properties"]["timestamp_timezone_assumption"] = "Maldives local time (UTC+05:00)"
    return result


def _followme_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace(" ", "T").replace("Z", "+00:00"))
    except ValueError:
        return None
    # Public JSON uses the operator's Maldives wall clock. Treating a naive
    # timestamp as UTC makes a 5-hour-old observation appear current.
    return (
        parsed.replace(tzinfo=timezone(timedelta(hours=5))).astimezone(UTC)
        if parsed.tzinfo is None
        else parsed.astimezone(UTC)
    )


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed


def _text(node: Any) -> str | None:
    if node is None:
        return None
    value = node.get_text(" ", strip=True)
    return value or None


def _catalogue_records(document: BeautifulSoup) -> list[dict[str, Any]]:
    records = []
    for card in document.select("article.boat-card[data-boat-id]")[:1000]:
        vessel_id = str(card.get("data-boat-id", ""))
        if not vessel_id.isdigit() or int(vessel_id) <= 0:
            continue
        # The public card also contains phone numbers. Only operational label
        # fields are retained in normalized/catalogue responses.
        report = _text(card.select_one("time"))
        location = _text(card.select_one(".boat-status"))
        records.append(
            {
                "id": vessel_id,
                "name": _text(card.select_one("h1, h2, h3, .boat-name")),
                "operator": _text(card.select_one(".operator-name, .operator, [data-operator]")),
                "type": _text(card.select_one(".boat-meta-link span, .type, [data-type]")),
                "report_text": report,
                "status_text": " · ".join(value for value in (report, location) if value),
            }
        )
    return records


def _name_key(value: str) -> str:
    return re.sub(
        r"[^a-z0-9]",
        "",
        unicodedata.normalize("NFKD", value.lower()).encode("ascii", "ignore").decode(),
    )


def _report_age(value: Any) -> float:
    text = str(value or "").lower()
    if "just now" in text:
        return 0
    match = re.search(r"(\d+)\s*(min|hour|day|sec)", text)
    if not match:
        return math.inf
    multiplier = {"sec": 1, "min": 60, "hour": 3600, "day": 86400}[match[2]]
    return int(match[1]) * multiplier


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi, delta_lambda = phi2 - phi1, math.radians(lon2 - lon1)
    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    return 6_371_000 * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0, 1 - a)))


class AdsbLolProvider:
    name = "adsb.lol"

    def __init__(self, config: LiveConfig) -> None:
        self.config = config
        self.enabled = config.aircraft_enabled

    async def fetch(self, query: LiveQuery) -> dict[str, Any]:
        if not self.enabled:
            return _status(self.name, False, "disabled")
        latitude, longitude, radius_nm = _query_center_radius(query)
        url = f"{self.config.adsb_url}/{latitude}/{longitude}/{radius_nm}"
        async with httpx.AsyncClient(timeout=self.config.request_timeout_seconds) as client:
            response = await client.get(
                url,
                headers={"User-Agent": self.config.user_agent, "Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
        rows = payload if isinstance(payload, list) else payload.get("ac", [])
        events = [
            event
            for index, row in enumerate(rows if isinstance(rows, list) else [])
            if isinstance(row, dict)
            and (
                event := _aircraft_event(
                    row, index, payload.get("now") if isinstance(payload, dict) else None
                )
            )
            is not None
        ]
        return {
            **_status(
                self.name,
                True,
                "ok" if events else "no_current_coverage",
                len(events),
            ),
            "events": events,
        }


class OpenSkyProvider:
    """Anonymous research fallback, bounded and limited to one call per 5 minutes.

    The anonymous endpoint has 400 credits/day. Cooldown is provider-wide, so
    changing islands cannot spend additional credits on every map movement.
    """

    name = "opensky"

    def __init__(self, config: LiveConfig, cache: FileCache | None = None) -> None:
        self.config = config
        self.enabled = config.aircraft_enabled
        self.cache = cache
        self._lock = asyncio.Lock()
        self._last_request_at = 0.0
        self._last_result: dict[str, Any] | None = None

    async def fetch(self, query: LiveQuery) -> dict[str, Any]:
        if not self.enabled:
            return _status(self.name, False, "disabled")
        async with self._lock:
            loop = asyncio.get_running_loop()
            if not self._last_request_at and self.cache is not None:
                try:
                    record = self.cache.read_json("live/opensky/latest.json")
                    retrieved = _parse_datetime(record.get("retrieved_at"))
                    age = (datetime.now(UTC) - retrieved).total_seconds() if retrieved else -1
                    if 0 <= age < self.config.opensky_cache_ttl_seconds:
                        self._last_request_at = loop.time() - age
                        self._last_result = record["result"]
                except FileNotFoundError, ValueError, KeyError, TypeError:
                    pass
            elapsed = loop.time() - self._last_request_at
            if self._last_request_at and elapsed < self.config.opensky_cache_ttl_seconds:
                return {
                    **(self._last_result or _status(self.name, True, "cooldown")),
                    "cached": True,
                    "message": (
                        "OpenSky anonymous feed refreshes at most every 5 minutes; "
                        "coverage is receiver dependent."
                    ),
                    "retry_after_seconds": math.ceil(
                        self.config.opensky_cache_ttl_seconds - elapsed
                    ),
                }
            min_lat, min_lon, max_lat, max_lon = _bbox(query)
            params = {"lamin": min_lat, "lomin": min_lon, "lamax": max_lat, "lomax": max_lon}
            self._last_request_at = loop.time()
            self._remember_result(_status(self.name, True, "cooldown"))
            async with httpx.AsyncClient(timeout=self.config.request_timeout_seconds) as client:
                response = await client.get(
                    self.config.opensky_url,
                    params=params,
                    headers={"User-Agent": self.config.user_agent, "Accept": "application/json"},
                )
                response.raise_for_status()
                if len(response.content) > 8_000_000:
                    raise ValueError("OpenSky response exceeds the live-data bound")
                payload = response.json()
            rows = payload.get("states") or [] if isinstance(payload, dict) else []
            events = [
                event
                for index, row in enumerate(rows[:500] if isinstance(rows, list) else [])
                if (event := _opensky_event(row, index)) is not None
            ]
            self._last_result = {
                **_status(self.name, True, "ok" if events else "no_current_coverage", len(events)),
                "events": events,
                "source_query_bbox": [min_lon, min_lat, max_lon, max_lat],
                "remaining_daily_credits": response.headers.get("X-Rate-Limit-Remaining"),
                "message": (
                    "Anonymous OpenSky receiver observations, refreshed at most every 5 minutes. "
                    "No report does not establish no aircraft."
                ),
            }
            self._remember_result(self._last_result)
            return self._last_result

    def _remember_result(self, result: dict[str, Any]) -> None:
        if self.cache is not None:
            self.cache.write_json(
                "live/opensky/latest.json",
                {"retrieved_at": datetime.now(UTC).isoformat(), "result": result},
                source="OpenSky transient observation and anonymous quota cooldown",
                endpoint=self.config.opensky_url,
                parser_version="opensky-live-v1",
            )


class OpenWatersProvider:
    name = "openwaters"

    def __init__(self, config: LiveConfig) -> None:
        self.config = config
        self.enabled = config.vessel_enabled

    async def fetch(self, query: LiveQuery) -> dict[str, Any]:
        if not self.enabled:
            return _status(self.name, False, "disabled")
        min_lat, min_lon, max_lat, max_lon = _bbox(query)
        params = {
            "bbox": f"{min_lat},{min_lon},{max_lat},{max_lon}",
            "kind": "vessel",
            "max_age_moving": "30m",
        }
        async with httpx.AsyncClient(timeout=self.config.request_timeout_seconds) as client:
            response = await client.get(
                self.config.openwaters_url,
                params=params,
                headers={
                    "User-Agent": self.config.user_agent,
                    "Accept": "application/geo+json",
                },
            )
            response.raise_for_status()
            payload = response.json()
        features = payload.get("features", []) if isinstance(payload, dict) else []
        events = [
            event
            for index, feature in enumerate(features if isinstance(features, list) else [])
            if (event := _vessel_event("openwaters", feature, index)) is not None
        ]
        return {
            **_status(
                self.name,
                True,
                "ok" if events else "no_current_coverage",
                len(events),
            ),
            "events": events,
        }


class FachaProvider:
    name = "facha"

    def __init__(self, config: LiveConfig) -> None:
        self.config = config
        self.enabled = config.vessel_enabled

    async def fetch(self, query: LiveQuery) -> dict[str, Any]:
        if not self.enabled:
            return _status(self.name, False, "disabled")
        url = (
            f"{self.config.facha_url}/{_query_center_radius(query)[0]}/"
            f"{_query_center_radius(query)[1]}/{min(_query_center_radius(query)[2], 10)}"
        )
        async with httpx.AsyncClient(timeout=self.config.request_timeout_seconds) as client:
            response = await client.get(
                url,
                headers={"User-Agent": self.config.user_agent, "Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
        rows = _rows(payload, ("ships", "vessels", "data"))
        events = [
            event
            for index, row in enumerate(rows)
            if (event := _vessel_event("facha", row, index)) is not None
        ]
        return {
            **_status(
                self.name,
                True,
                "ok" if events else "no_current_coverage",
                len(events),
            ),
            "events": events,
        }


class RtlBusProvider:
    """Authorized-feed seam; disabled until the bus feed is explicitly enabled."""

    name = "rtl"

    def __init__(self, config: LiveConfig) -> None:
        self.config = config
        self.enabled = config.bus_enabled

    async def fetch(self, query: LiveQuery) -> dict[str, Any]:
        if not self.enabled:
            return _status(self.name, False, "disabled")
        if not query.route_code:
            return _status(self.name, True, "query_required", message="route_code is required")
        url = f"{self.config.rtl_url}/booking/v1/bus/livecoordinates"
        async with httpx.AsyncClient(timeout=self.config.request_timeout_seconds) as client:
            response = await client.post(
                url,
                json={"routeCode": query.route_code},
                headers={"User-Agent": self.config.user_agent, "Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
        rows = payload.get("busList", []) if isinstance(payload, dict) else []
        events = [
            event
            for index, row in enumerate(rows if isinstance(rows, list) else [])
            if (event := _bus_event(row, index)) is not None
        ]
        return {
            **_status(self.name, True, "ok" if events else "no_current_coverage", len(events)),
            "events": events,
        }


def _status(
    provider: str,
    enabled: bool,
    status: str,
    event_count: int = 0,
    message: str | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "provider": provider,
        "enabled": enabled,
        "status": status,
        "event_count": event_count,
        "retrieved_at": datetime.now(UTC).isoformat(),
        "events": [],
    }
    if message:
        result["message"] = message
    return result


def _aircraft_event(
    row: dict[str, Any], index: int, snapshot_time: Any = None
) -> dict[str, Any] | None:
    latitude = _number(row.get("lat"))
    longitude = _number(row.get("lon"))
    if latitude is None or longitude is None or not _in_bounds(latitude, longitude):
        return None
    external_id = str(row.get("hex") or row.get("r") or f"unknown-{index}")
    baseline = _epoch_time(
        snapshot_time if snapshot_time is not None else row.get("now")
    ) or datetime.now(UTC)
    position_age = _number(row.get("seen_pos", row.get("seen")))
    observed_at = (
        baseline - timedelta(seconds=max(0, position_age)) if position_age is not None else None
    )
    event = LiveEvent(
        id=f"adsb.lol:{external_id}",
        kind="aircraft",
        provider="adsb.lol",
        external_object_id=external_id,
        position={"latitude": latitude, "longitude": longitude},
        observed_at=observed_at,
        retrieved_at=datetime.now(UTC),
        updated_at=observed_at,
        source_quality="provider_live",
        properties={
            key: row.get(key)
            for key in ("flight", "r", "t", "alt_baro", "gs", "track", "category")
            if row.get(key) is not None
        },
    )
    return event.model_dump(mode="json")


def _opensky_event(row: Any, index: int) -> dict[str, Any] | None:
    if not isinstance(row, list) or len(row) < 11:
        return None
    latitude, longitude = _number(row[6]), _number(row[5])
    if latitude is None or longitude is None or not _in_bounds(latitude, longitude):
        return None
    observed = _epoch_time(row[3])
    velocity = _number(row[9])
    altitude = _number(row[7])
    external_id = str(row[0] or f"unknown-{index}")
    return LiveEvent(
        id=f"opensky:{external_id}",
        kind="aircraft",
        provider="opensky",
        external_object_id=external_id,
        position={"latitude": latitude, "longitude": longitude},
        observed_at=observed,
        updated_at=observed,
        retrieved_at=datetime.now(UTC),
        source_quality="provider_live",
        properties={
            "flight": str(row[1] or "").strip(),
            "track": _number(row[10]),
            "gs": velocity * 1.943844 if velocity is not None else None,
            "alt_baro": altitude * 3.28084 if altitude is not None else None,
            "on_ground": row[8] is True,
            "position_source": row[16] if len(row) > 16 else None,
        },
    ).model_dump(mode="json")


def _vessel_event(provider: str, feature: dict[str, Any], index: int) -> dict[str, Any] | None:
    properties = feature.get("properties", {}) if isinstance(feature, dict) else {}
    if not properties and isinstance(feature, dict):
        properties = feature
    geometry = feature.get("geometry", {}) if isinstance(feature, dict) else {}
    coordinates = geometry.get("coordinates", []) if isinstance(geometry, dict) else []
    longitude = (
        _number(coordinates[0])
        if len(coordinates) >= 2
        else _number(properties.get("lon", properties.get("longitude")))
    )
    latitude = (
        _number(coordinates[1])
        if len(coordinates) >= 2
        else _number(properties.get("lat", properties.get("latitude")))
    )
    if latitude is None or longitude is None or not _in_bounds(latitude, longitude):
        return None
    external_id = str(
        properties.get("mmsi") or properties.get("imo") or feature.get("id") or f"unknown-{index}"
    )
    event = LiveEvent(
        id=f"{provider}:{external_id}",
        kind="vessel",
        provider=provider,
        external_object_id=external_id,
        position={"latitude": latitude, "longitude": longitude},
        observed_at=_observed_at(properties.get("seen"), properties.get("timestamp")),
        retrieved_at=datetime.now(UTC),
        updated_at=_observed_at(properties.get("seen"), properties.get("timestamp")),
        source_quality="provider_live",
        properties={
            key: properties.get(key)
            for key in (
                "mmsi",
                "imo",
                "name",
                "callsign",
                "flag",
                "type",
                "sog",
                "cog",
                "heading",
                "nav_status",
                "destination",
                "source",
                "station",
            )
            if properties.get(key) is not None
        },
    )
    return event.model_dump(mode="json")


def _bus_event(row: dict[str, Any], index: int) -> dict[str, Any] | None:
    latitude = _number(row.get("latitude"))
    longitude = _number(row.get("longitude"))
    if latitude is None or longitude is None or not _in_bounds(latitude, longitude):
        return None
    external_id = str(row.get("busCode") or row.get("plateNumber") or f"unknown-{index}")
    event = LiveEvent(
        id=f"rtl:{external_id}",
        kind="bus",
        provider="rtl",
        external_object_id=external_id,
        position={"latitude": latitude, "longitude": longitude},
        retrieved_at=datetime.now(UTC),
        source_quality="provider_live",
        properties={
            key: row.get(key) for key in ("busCode", "plateNumber") if row.get(key) is not None
        },
    )
    return event.model_dump(mode="json")


def _rows(payload: Any, keys: tuple[str, ...]) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for key in keys:
            if isinstance(payload.get(key), list):
                return [row for row in payload[key] if isinstance(row, dict)]
    return []


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except TypeError, ValueError:
        return None


def _observed_at(*values: Any) -> datetime | None:
    for value in values:
        number = _number(value)
        if number is not None:
            if number > 1_000_000_000:
                return _epoch_time(number)
            return datetime.now(UTC) - timedelta(seconds=number)
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                continue
    return None


def _epoch_time(value: Any) -> datetime | None:
    number = _number(value)
    if number is None or number < 1_000_000_000:
        return None
    if number > 100_000_000_000:
        number /= 1000
    try:
        return datetime.fromtimestamp(number, UTC)
    except OverflowError, OSError, ValueError:
        return None


def _bbox(query: LiveQuery) -> tuple[float, float, float, float]:
    if query.bbox is not None:
        return parse_bbox(query.bbox)
    if query.latitude == 4.1755 and query.longitude == 73.5093 and query.radius_nm == 250:
        return 3.0, 72.0, 8.5, 75.0
    latitude_delta = query.radius_nm / 60
    longitude_delta = query.radius_nm / (60 * max(0.2, abs(math.cos(math.radians(query.latitude)))))
    return (
        query.latitude - latitude_delta,
        query.longitude - longitude_delta,
        query.latitude + latitude_delta,
        query.longitude + longitude_delta,
    )


def _query_center_radius(query: LiveQuery) -> tuple[float, float, float]:
    """Convert an optional bbox into a point/radius query for point providers."""

    if query.bbox is None:
        return query.latitude, query.longitude, query.radius_nm
    min_lat, min_lon, max_lat, max_lon = parse_bbox(query.bbox)
    latitude = (min_lat + max_lat) / 2
    longitude = (min_lon + max_lon) / 2
    latitude_radius = (max_lat - min_lat) / 2
    longitude_radius = (max_lon - min_lon) * max(0.2, abs(math.cos(math.radians(latitude)))) / 2
    radius_nm = math.hypot(latitude_radius, longitude_radius) * 60
    return latitude, longitude, radius_nm


def _in_bounds(latitude: float, longitude: float) -> bool:
    return -1.0 <= latitude <= 8.5 and 72.0 <= longitude <= 75.0
