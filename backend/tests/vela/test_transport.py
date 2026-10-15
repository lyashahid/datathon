"""HTTP transport regressions use MockTransport only; never contact Google."""

import asyncio
import time

import httpx
import pytest

from vendor.vela_api.common import ApiError
from vendor.vela_api.config import Settings, load_calibration
from vendor.vela_api.transport import GoogleClient, validate_url

DATA = "https://www.google.com/maps/preview/directions"
IMAGE = "https://lh3.googleusercontent.com/example"


def client(handler, **settings):
    value = GoogleClient(load_calibration(), Settings(**settings), httpx.MockTransport(handler))
    value._warm_at = time.monotonic()  # Individual requests isolate warm behavior.
    return value


@pytest.mark.parametrize(
    "url",
    [
        "http://www.google.com/maps",
        "https://example.com/",
        "https://127.0.0.1/",
        "https://[::1]/",
        "https://localhost/",
        "https://www.google.com.evil.test/",
        "https://evilgoogle.com/",
        "https://www.google.com:444/",
        "https://user:pass@www.google.com/",
        "https://www.google.com:notaport/",
        "https://www.google.com@evil.test/",
    ],
)
def test_data_url_allowlist_rejects_ssrf_inputs(url):
    with pytest.raises(ApiError) as error:
        validate_url(url)
    assert error.value.code == "invalid_upstream_url"
    assert error.value.status_code == 400


@pytest.mark.parametrize(
    "url",
    [
        "https://googleusercontent.com/x",
        "https://lh3.googleusercontent.com/x",
        "https://maps.gstatic.com/x",
        "https://geo.ggpht.com/x",
        "https://streetviewpixels-pa.googleapis.com/v1/tile",
    ],
)
def test_owned_image_domains_are_allowed(url):
    validate_url(url, image=True)


@pytest.mark.parametrize(
    "url",
    [
        DATA,
        "http://lh3.googleusercontent.com/x",
        "https://lh3.googleusercontent.com:8443/x",
        "https://lh3.googleusercontent.com.evil.test/x",
        "https://evilgoogleusercontent.com/x",
        "https://user@lh3.googleusercontent.com/x",
        "https://127.0.0.1/image.jpg",
        "file:///etc/passwd",
        "data:image/png;base64,AAAA",
    ],
)
def test_image_allowlist_is_separate_and_checks_suffix_boundaries(url):
    with pytest.raises(ApiError) as error:
        validate_url(url, image=True)
    assert error.value.code == "invalid_upstream_url"


@pytest.mark.asyncio
async def test_rejected_url_does_not_touch_transport():
    calls = []
    upstream = client(lambda request: calls.append(request))
    try:
        with pytest.raises(ApiError):
            await upstream.get_image("https://localhost/private")
        assert calls == []
    finally:
        await upstream.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,code,result_status",
    [
        (429, "upstream_rate_limited", 503),
        (401, "upstream_blocked", 503),
        (403, "upstream_blocked", 503),
        (404, "upstream_http_error", 502),
        (500, "upstream_http_error", 502),
    ],
)
async def test_status_failures_are_classified_without_automatic_retries(
    status, code, result_status
):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, text="upstream error")

    upstream = client(handler)
    try:
        with pytest.raises(ApiError) as error:
            await upstream.get_text(DATA)
        assert error.value.code == code
        assert error.value.status_code == result_status
        assert len(calls) == 1
        if code == "upstream_http_error":
            assert error.value.details == {"upstream_status": status}
    finally:
        await upstream.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exception,code,status",
    [
        (httpx.ReadTimeout, "upstream_timeout", 504),
        (httpx.ConnectTimeout, "upstream_timeout", 504),
        (httpx.ConnectError, "upstream_unavailable", 502),
    ],
)
async def test_transport_exceptions_have_stable_codes(exception, code, status):
    def handler(request):
        raise exception("synthetic failure", request=request)

    upstream = client(handler)
    try:
        with pytest.raises(ApiError) as error:
            await upstream.get_text(DATA)
        assert (error.value.code, error.value.status_code) == (code, status)
    finally:
        await upstream.close()


class Chunks(httpx.AsyncByteStream):
    def __init__(self, *chunks, delay=0):
        self.chunks, self.delay = chunks, delay
        self.closed = False

    async def __aiter__(self):
        for chunk in self.chunks:
            if self.delay:
                await asyncio.sleep(self.delay)
            yield chunk

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
@pytest.mark.parametrize("image", [False, True])
async def test_streamed_size_limits_bound_data_and_images_and_close_stream(image):
    stream = Chunks(b"abc", b"def", b"ghi")
    upstream = client(
        lambda request: httpx.Response(
            200,
            stream=stream,
            headers={"Content-Type": "image/jpeg" if image else "application/json"},
        ),
        max_response_bytes=5,
        max_image_bytes=5,
    )
    try:
        with pytest.raises(ApiError) as error:
            if image:
                await upstream.get_image(IMAGE)
            else:
                await upstream.get_text(DATA)
        assert error.value.code == "upstream_response_too_large"
        assert stream.closed
    finally:
        await upstream.close()


@pytest.mark.asyncio
async def test_stream_deadline_is_translated_and_stream_closed():
    stream = Chunks(b"first", delay=0.1)
    upstream = client(lambda request: httpx.Response(200, stream=stream), request_timeout=0.02)
    try:
        with pytest.raises(ApiError) as error:
            await upstream.get_text(DATA)
        assert (error.value.code, error.value.status_code) == ("upstream_timeout", 504)
        assert stream.closed
    finally:
        await upstream.close()


@pytest.mark.asyncio
async def test_whole_call_deadline_includes_waiting_for_concurrency_slot():
    upstream = client(
        lambda request: httpx.Response(200, text="ok"),
        max_concurrent_requests=1,
        request_timeout=0.02,
    )
    await upstream._semaphore.acquire()
    try:
        with pytest.raises(ApiError) as error:
            await asyncio.wait_for(upstream.get_text(DATA), 0.15)
        assert (error.value.code, error.value.status_code) == ("upstream_timeout", 504)
    finally:
        upstream._semaphore.release()
        await upstream.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "target", ["https://example.com/x", "http://www.google.com/x", "https://127.0.0.1/x"]
)
async def test_redirect_allowlist_is_checked_before_following(target):
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={"Location": target})

    upstream = client(handler)
    try:
        with pytest.raises(ApiError) as error:
            await upstream.get_text(DATA)
        assert error.value.code == "invalid_upstream_url"
        assert len(calls) == 1
    finally:
        await upstream.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "target", ["https://consent.google.com/m", "https://www.google.com/sorry/index"]
)
async def test_consent_and_verification_redirects_are_not_followed(target):
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={"Location": target})

    upstream = client(handler)
    try:
        with pytest.raises(ApiError) as error:
            await upstream.get_text(DATA)
        assert (error.value.code, error.value.status_code) == ("upstream_blocked", 503)
        assert len(calls) == 1
    finally:
        await upstream.close()


@pytest.mark.asyncio
async def test_allowed_relative_redirect_does_not_duplicate_original_query():
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(302, headers={"Location": "/maps/final?pb=redirected"})
        return httpx.Response(200, text="final")

    upstream = client(handler)
    try:
        assert await upstream.get_text(DATA, params={"pb": "original"}) == "final"
        assert str(calls[1].url) == "https://www.google.com/maps/final?pb=redirected"
    finally:
        await upstream.close()


@pytest.mark.asyncio
async def test_303_post_redirect_discards_body_and_switches_to_get():
    calls = []

    def handler(request):
        calls.append(request)
        return (
            httpx.Response(303, headers={"Location": "/maps/final"})
            if len(calls) == 1
            else httpx.Response(200, text="ok")
        )

    upstream = client(handler)
    try:
        assert await upstream.post_text(DATA, data={"f.req": "synthetic"}) == "ok"
        assert [r.method for r in calls] == ["POST", "GET"]
        assert calls[1].content == b""
    finally:
        await upstream.close()


@pytest.mark.asyncio
async def test_redirect_loop_is_bounded():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(302, headers={"Location": "/maps/loop"})

    upstream = client(handler)
    try:
        with pytest.raises(ApiError) as error:
            await upstream.get_text(DATA)
        assert error.value.code == "upstream_redirects"
        assert len(calls) == 4
    finally:
        await upstream.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content_type", ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]
)
async def test_raster_content_types_and_image_headers(content_type):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            200,
            content=b"raster fixture",
            headers={"Content-Type": content_type + "; fixture=test"},
        )

    upstream = client(handler)
    try:
        assert await upstream.get_image(IMAGE) == (b"raster fixture", content_type)
        assert calls[0].headers["Accept"] == "image/*"
        assert calls[0].headers["Sec-Fetch-Dest"] == "image"
        assert "X-API-Key" not in calls[0].headers
    finally:
        await upstream.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content_type", ["text/html", "image/svg+xml", "application/octet-stream", ""]
)
async def test_html_svg_and_untyped_content_are_not_proxied_as_images(content_type):
    upstream = client(
        lambda request: httpx.Response(
            200, text="<html>untrusted</html>", headers={"Content-Type": content_type}
        )
    )
    try:
        with pytest.raises(ApiError) as error:
            await upstream.get_image(IMAGE)
        assert error.value.code == "upstream_content_type"
    finally:
        await upstream.close()


@pytest.mark.asyncio
async def test_warm_happens_on_first_call_even_when_monotonic_uptime_is_small(monkeypatch):
    monkeypatch.setattr("vendor.vela_api.transport.time.monotonic", lambda: 100.0)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, text="ok")

    upstream = GoogleClient(load_calibration(), Settings(), httpx.MockTransport(handler))
    try:
        await upstream.get_text(DATA)
        assert [r.url.path for r in calls] == ["/maps", "/maps/preview/directions"]
    finally:
        await upstream.close()


@pytest.mark.asyncio
async def test_parallel_requests_warm_once_and_share_anonymous_cookie():
    calls = []

    async def handler(request):
        calls.append(request)
        if request.url.path == "/maps":
            await asyncio.sleep(0.01)
            return httpx.Response(
                200, text="warm", headers={"Set-Cookie": "NID=anonymous; Path=/; Secure"}
            )
        return httpx.Response(200, text="data")

    upstream = GoogleClient(load_calibration(), Settings(), httpx.MockTransport(handler))
    try:
        assert await asyncio.gather(upstream.get_text(DATA), upstream.get_text(DATA)) == [
            "data",
            "data",
        ]
        assert sum(r.url.path == "/maps" for r in calls) == 1
        assert all(
            r.headers.get("cookie") == "NID=anonymous" for r in calls if r.url.path != "/maps"
        )
    finally:
        await upstream.close()


@pytest.mark.asyncio
async def test_failed_warm_is_best_effort_and_attempts_are_throttled():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(403 if request.url.path == "/maps" else 200, text="ok")

    upstream = GoogleClient(load_calibration(), Settings(), httpx.MockTransport(handler))
    try:
        assert await upstream.get_text(DATA) == "ok"
        assert await upstream.get_text(DATA) == "ok"
        assert sum(r.url.path == "/maps" for r in calls) == 1
    finally:
        await upstream.close()
