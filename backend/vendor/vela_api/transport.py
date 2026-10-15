"""Bounded HTTP transport using an anonymous process-local cookie session."""

import asyncio
import time
from urllib.parse import urljoin, urlsplit

import httpx

from .common import ApiError

DATA_HOSTS = {"www.google.com", "google.com", "maps.google.com", "maps.googleapis.com"}
IMAGE_HOSTS = {"streetviewpixels-pa.googleapis.com"}


def valid_image_url(url):
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return (
        parts.scheme == "https"
        and not parts.username
        and not parts.password
        and parts.port in (None, 443)
        and (
            host in IMAGE_HOSTS
            or any(
                host == s or host.endswith("." + s)
                for s in ("googleusercontent.com", "ggpht.com", "gstatic.com")
            )
        )
    )


def validate_url(url, image=False):
    try:
        parts = urlsplit(url)
        valid = (
            valid_image_url(url)
            if image
            else (
                parts.scheme == "https"
                and parts.hostname in DATA_HOSTS
                and parts.port in (None, 443)
                and not parts.username
                and not parts.password
            )
        )
    except ValueError:
        valid = False
    if not valid:
        raise ApiError(
            "invalid_upstream_url", "The URL is outside the fixed upstream allowlist.", 400
        )


class GoogleClient:
    def __init__(self, calibration, settings, transport=None):
        self.calibration = calibration
        self.settings = settings
        self._client = httpx.AsyncClient(
            http2=True,
            timeout=httpx.Timeout(settings.request_timeout, connect=10),
            follow_redirects=False,
            transport=transport,
            limits=httpx.Limits(
                max_connections=settings.max_concurrent_requests, max_keepalive_connections=8
            ),
            headers={
                "User-Agent": calibration["userAgent"],
                "Referer": "https://www.google.com/maps/",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-CH-UA": calibration["secChUa"],
                "Sec-CH-UA-Mobile": "?0",
                "Sec-CH-UA-Platform": '"Windows"',
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
            },
        )
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_requests)
        self._warm_lock = asyncio.Lock()
        self._warm_at = None
        self._warm_attempt = None

    async def close(self):
        await self._client.aclose()

    async def warm(self):
        now = time.monotonic()
        if (self._warm_at is not None and now - self._warm_at < 6 * 3600) or (
            self._warm_attempt is not None and now - self._warm_attempt < 60
        ):
            return
        async with self._warm_lock:
            now = time.monotonic()
            if (self._warm_at is not None and now - self._warm_at < 6 * 3600) or (
                self._warm_attempt is not None and now - self._warm_attempt < 60
            ):
                return
            try:
                await self._request(
                    "GET",
                    self.calibration["sessionWarmUrl"],
                    warm=False,
                    headers={
                        "Sec-Fetch-Dest": "document",
                        "Sec-Fetch-Mode": "navigate",
                        "Sec-Fetch-Site": "none",
                    },
                )
                self._warm_at = time.monotonic()
            except ApiError:
                # A best-effort warm must not hide the actual data request's result.
                pass
            finally:
                self._warm_attempt = time.monotonic()

    async def _request(self, method, url, *, image=False, warm=True, **kwargs):
        validate_url(url, image)
        if warm and not image:
            await self.warm()
        limit = self.settings.max_image_bytes if image else self.settings.max_response_bytes
        try:
            # A whole-call deadline includes semaphore wait, redirects, and streaming.
            async with asyncio.timeout(self.settings.request_timeout):
                async with self._semaphore:
                    for redirects in range(4):
                        async with self._client.stream(method, url, **kwargs) as response:
                            if response.status_code in (301, 302, 303, 307, 308):
                                next_url = urljoin(
                                    str(response.url), response.headers.get("location", "")
                                )
                                if "consent.google." in next_url or "/sorry/" in next_url:
                                    raise ApiError(
                                        "upstream_blocked",
                                        "Google requires consent or a verification challenge.",
                                        503,
                                    )
                                validate_url(next_url, image)
                                url = next_url
                                # The redirect URL already incorporates the original parameters.
                                kwargs.pop("params", None)
                                if response.status_code == 303:
                                    method = "GET"
                                    kwargs.pop("data", None)
                                    kwargs.pop("json", None)
                                continue
                            if response.status_code == 429:
                                raise ApiError(
                                    "upstream_rate_limited",
                                    "Google rate-limited this session. Retry later.",
                                    503,
                                )
                            if response.status_code in (401, 403):
                                raise ApiError(
                                    "upstream_blocked",
                                    "Google refused this anonymous session.",
                                    503,
                                )
                            if response.status_code >= 400:
                                raise ApiError(
                                    "upstream_http_error",
                                    "Google returned an unsuccessful HTTP status.",
                                    502,
                                    {"upstream_status": response.status_code},
                                )
                            content = bytearray()
                            async for chunk in response.aiter_bytes():
                                content.extend(chunk)
                                if len(content) > limit:
                                    raise ApiError(
                                        "upstream_response_too_large",
                                        "The upstream reply exceeds the configured size limit.",
                                    )
                            media_type = response.headers.get("content-type", "").split(";", 1)[0]
                            if image and media_type not in {
                                "image/jpeg",
                                "image/png",
                                "image/webp",
                                "image/avif",
                                "image/gif",
                            }:
                                raise ApiError(
                                    "upstream_content_type",
                                    "The upstream image did not return a supported raster format.",
                                )
                            return bytes(content), media_type
                    raise ApiError("upstream_redirects", "The upstream redirected too many times.")
        except (httpx.TimeoutException, TimeoutError) as exc:
            raise ApiError(
                "upstream_timeout", "The upstream request exceeded its deadline.", 504
            ) from exc
        except httpx.RequestError as exc:
            raise ApiError("upstream_unavailable", "The upstream connection failed.", 502) from exc

    async def get_text(self, url, params=None, headers=None):
        content, _ = await self._request("GET", url, params=params, headers=headers)
        return content.decode("utf-8", errors="replace")

    async def post_text(self, url, data=None, json_body=None, params=None, headers=None):
        content, _ = await self._request(
            "POST", url, params=params, headers=headers, data=data, json=json_body
        )
        return content.decode("utf-8", errors="replace")

    async def get_image(self, url):
        return await self._request(
            "GET",
            url,
            image=True,
            headers={
                "Accept": "image/*",
                "Sec-Fetch-Dest": "image",
                "Sec-Fetch-Mode": "no-cors",
                "Sec-Fetch-Site": "cross-site",
            },
        )
