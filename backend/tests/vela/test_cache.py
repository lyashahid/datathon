from vendor.vela_api.cache import RateLimiter, TTLCache


def test_cache_copy_isolation_and_capacity():
    cache = TTLCache(1, 120)
    original = {"nested": []}
    cache.put("a", original)
    original["nested"].append(1)
    result = cache.get("a")
    result["nested"].append(2)
    assert cache.get("a") == {"nested": []}
    cache.put("b", {})
    assert cache.get("a") is None


def test_expiry_and_per_client_window(monkeypatch):
    monkeypatch.setattr("vendor.vela_api.cache.time.monotonic", lambda: 100.0)
    cache = TTLCache(2, 10)
    cache.put("a", {})
    limiter = RateLimiter(1)
    assert limiter.allow("a")
    assert not limiter.allow("a")
    assert limiter.allow("b")
    monkeypatch.setattr("vendor.vela_api.cache.time.monotonic", lambda: 160.1)
    assert cache.get("a") is None
    assert limiter.allow("a")
