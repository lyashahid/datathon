"""Small public-source HTTP client used by discovery providers."""

from __future__ import annotations

from typing import Any

import httpx


class PublicSourceError(RuntimeError):
    """Raised when a public source cannot be fetched or decoded."""


class PublicSourceClient:
    def __init__(
        self,
        *,
        timeout: float = 60.0,
        user_agent: str = "MobilitySandboxMV/0.1 (public-data-discovery)",
        client: httpx.Client | None = None,
    ) -> None:
        self._client = client or httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": user_agent, "Accept": "*/*"},
        )
        self._owns_client = client is None

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def get_bytes(self, url: str, params: dict[str, Any] | None = None) -> httpx.Response:
        try:
            response = self._client.get(url, params=params)
            response.raise_for_status()
            return response
        except httpx.HTTPError as exc:
            raise PublicSourceError(f"GET failed for {url}: {exc}") from exc

    def get_json(
        self, url: str, params: dict[str, Any] | None = None
    ) -> tuple[httpx.Response, Any]:
        response = self.get_bytes(url, params)
        try:
            return response, response.json()
        except ValueError as exc:
            raise PublicSourceError(f"Response was not valid JSON: {url}") from exc
