"""Open-Meteo current forecasts; dated cache receipts never become observations."""

import asyncio
import copy
import json
import time
from collections import OrderedDict
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException


class ConditionsService:
    def __init__(self, client: httpx.AsyncClient | None = None, ttl: int = 600):
        self.client = client
        self.ttl = ttl
        self.cache: OrderedDict[tuple, tuple[float, dict]] = OrderedDict()
        self._owns_client = client is None
        self._refreshes: dict[tuple, asyncio.Task[dict]] = {}
        self._slots = asyncio.Semaphore(8)

    async def close(self) -> None:
        """Release owned connections and any refresh still running at shutdown."""
        pending = list(self._refreshes.values())
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        self._refreshes.clear()
        if self._owns_client and self.client is not None:
            await self.client.aclose()
            self.client = None

    def _response(self, result: dict, latitude: float, longitude: float, cached: bool) -> dict:
        result = copy.deepcopy(result)
        # Nearby clicks can share a grid cache key; keep the requested map point exact.
        result["requested"] = {"latitude": latitude, "longitude": longitude}
        result["receipt"]["cached"] = cached
        return result

    async def forecast(self, latitude: float, longitude: float, marine: bool = False) -> dict:
        key = (marine, round(latitude, 4), round(longitude, 4))
        cached = self.cache.get(key)
        if cached and time.monotonic() - cached[0] < self.ttl:
            self.cache.move_to_end(key)
            return self._response(cached[1], latitude, longitude, cached=True)
        task = self._refreshes.get(key)
        shared = task is not None
        if task is None:
            task = asyncio.create_task(self._refresh(key, latitude, longitude, marine))
            self._refreshes[key] = task

            def completed(refresh: asyncio.Task) -> None:
                self._refreshes.pop(key, None)
                # A disconnected caller may leave no waiter to retrieve a failed task.
                if not refresh.cancelled():
                    refresh.exception()

            task.add_done_callback(completed)
        # One disconnected caller must not cancel a refresh used by another map.
        result = await asyncio.shield(task)
        return self._response(
            result, latitude, longitude, cached=shared or result["receipt"]["cached"]
        )

    async def _refresh(self, key: tuple, latitude: float, longitude: float, marine: bool) -> dict:
        cached = self.cache.get(key)
        try:
            # Bound queue wait and the entire response stream, not just each chunk.
            async with asyncio.timeout(20), self._slots:
                if self.client is None:
                    self.client = httpx.AsyncClient(
                        limits=httpx.Limits(max_connections=8, max_keepalive_connections=8)
                    )
                return await self._fetch(key, latitude, longitude, marine)
        except (httpx.HTTPError, TimeoutError, ValueError, KeyError) as exc:
            if cached:
                result = copy.deepcopy(cached[1])
                result["status"] = "stale"
                result["receipt"].update(cached=True, stale=True)
                result["warning"] = f"Refresh failed; last successful forecast retained: {exc}"
                return result
            raise HTTPException(
                502, "Environmental provider unavailable; no forecast cached."
            ) from exc

    async def _fetch(self, key: tuple, latitude: float, longitude: float, marine: bool) -> dict:
        url = (
            "https://marine-api.open-meteo.com/v1/marine"
            if marine
            else "https://api.open-meteo.com/v1/forecast"
        )
        variables = (
            "wave_height,wave_direction,wave_period,wind_wave_height"
            if marine
            else (
                "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,"
                "weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m"
            )
        )
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "current": variables,
            "hourly": variables,
            "forecast_days": 3,
            "timezone": "UTC",
        }
        async with self.client.stream("GET", url, params=params, timeout=15) as response:
            response.raise_for_status()
            content = bytearray()
            async for chunk in response.aiter_bytes():
                content.extend(chunk)
                if len(content) > 1_000_000:
                    raise ValueError("Oversize forecast response")
        payload = json.loads(content)
        if not isinstance(payload, dict) or not isinstance(payload.get("current"), dict):
            raise ValueError("Missing current forecast")
        for field in ("current_units", "hourly", "hourly_units"):
            if not isinstance(payload.get(field, {}), dict):
                raise ValueError(f"Invalid {field} forecast structure")
        available = any(payload["current"].get(v) is not None for v in variables.split(","))
        result = {
            "status": "available" if available else "no_grid_coverage",
            "requested": {"latitude": latitude, "longitude": longitude},
            "grid": {
                k: payload.get(k)
                for k in (
                    "latitude",
                    "longitude",
                    "elevation",
                    "timezone",
                    "utc_offset_seconds",
                )
            },
            "current": payload["current"],
            "current_units": payload.get("current_units", {}),
            "hourly": payload.get("hourly", {}),
            "hourly_units": payload.get("hourly_units", {}),
            "receipt": {
                "provider": "Open-Meteo",
                "url": str(response.request.url),
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
                "cached": False,
                "stale": False,
                "cache_ttl_seconds": self.ttl,
                "data_kind": "model_forecast",
                "license": "CC BY 4.0",
                "qualification": (
                    "Model grid forecast, not a local sensor or an official warning. "
                    "Marine conditions do not establish sailing safety "
                    "or service operation."
                    if marine
                    else "Model grid forecast, not a local sensor or an official weather warning."
                ),
            },
        }
        self.cache[key] = (time.monotonic(), copy.deepcopy(result))
        self.cache.move_to_end(key)
        while len(self.cache) > 512:
            self.cache.popitem(last=False)
        return result

    def status(self) -> dict:
        return {
            "weather": {"provider": "Open-Meteo", "enabled": True},
            "marine": {"provider": "Open-Meteo Marine", "enabled": True},
            "traffic": {"provider": "Vela Google consumer directions", "enabled": True},
            "qualification": "Availability is established by each request; no synthetic readings.",
            "cache_entries": len(self.cache),
            "cache_ttl_seconds": self.ttl,
        }
