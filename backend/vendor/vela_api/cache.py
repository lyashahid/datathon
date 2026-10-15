import time
from collections import OrderedDict, deque
from copy import deepcopy


class TTLCache:
    def __init__(self, size=256, ttl=120):
        self.size, self.ttl = size, ttl
        self._items = OrderedDict()

    def get(self, key):
        item = self._items.get(key)
        if item is None:
            return None
        expires, value = item
        if expires <= time.monotonic():
            del self._items[key]
            return None
        self._items.move_to_end(key)
        return deepcopy(value)

    def put(self, key, value):
        if self.ttl <= 0:
            return
        self._items[key] = (time.monotonic() + self.ttl, deepcopy(value))
        self._items.move_to_end(key)
        while len(self._items) > self.size:
            self._items.popitem(last=False)


class RateLimiter:
    """Bounded, per-process sliding minute limiter; not a distributed quota."""

    def __init__(self, limit, max_clients=1024):
        self.limit, self.max_clients = limit, max_clients
        self._clients = OrderedDict()

    def allow(self, client):
        now = time.monotonic()
        requests = self._clients.setdefault(client, deque())
        while requests and requests[0] <= now - 60:
            requests.popleft()
        self._clients.move_to_end(client)
        while len(self._clients) > self.max_clients:
            self._clients.popitem(last=False)
        if len(requests) >= self.limit:
            return False
        requests.append(now)
        return True
