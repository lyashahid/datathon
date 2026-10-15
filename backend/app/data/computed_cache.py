"""Bounded, content-addressed computed results; source data remain authoritative.

Memory and local disk are the fast path. Optional PostgreSQL shares expensive
results between installations, and is never required to serve a request. Only
explicitly selected deterministic calculations use this store; live providers
keep their independent short TTL and stale-evidence rules.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import queue
import re
import struct
import threading
import time
import zlib
from collections import OrderedDict
from concurrent.futures import Future, TimeoutError
from functools import lru_cache
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Awaitable, Callable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from starlette.concurrency import run_in_threadpool

LOGGER = logging.getLogger(__name__)
CACHE_FORMAT = "computed-json-v1"
MAX_ITEM_BYTES = 32 * 1024 * 1024
MAX_AGE_SECONDS = 7 * 86400
SHARED_NAMESPACES = frozenset(
    {
        "snapshot-http",
        "accessibility-default",
        "passenger-forecast",
        "evidence-analysis",
        "planning-public-baseline",
    }
)


@lru_cache(maxsize=1)
def model_code_version() -> str:
    root = Path(__file__).resolve().parents[1]
    return digest(
        [
            (path.relative_to(root).as_posix(), hashlib.sha256(path.read_bytes()).hexdigest())
            for path in sorted(root.rglob("*.py"))
        ]
    )


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def encode(payload: bytes) -> bytes:
    return (
        struct.pack("!d", time.time())
        + hashlib.sha256(payload).digest()
        + zlib.compress(payload, 3)
    )


def decode(stored: bytes) -> bytes | None:
    """Reject corrupt, oversized or expired data before exposing any cached JSON."""
    try:
        created = struct.unpack("!d", stored[:8])[0]
        if not 0 <= time.time() - created <= MAX_AGE_SECONDS:
            return None
        inflater = zlib.decompressobj()
        payload = inflater.decompress(stored[40:], MAX_ITEM_BYTES + 1)
        if len(payload) > MAX_ITEM_BYTES or not inflater.eof or inflater.unused_data:
            return None
        return payload if hashlib.sha256(payload).digest() == stored[8:40] else None
    except ValueError, struct.error, zlib.error:
        return None


def postgres_connection_options(url: str) -> tuple[str, dict[str, Any]]:
    """Translate Prisma's schema option without retaining/logging credentials."""
    parts = urlsplit(url)
    values = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = values.pop("schema", "public")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", schema):
        raise ValueError("Invalid database schema identifier")
    # Security/time limits are application-owned, rather than DSN overrides.
    values.pop("connect_timeout", None)
    values.pop("options", None)
    values["sslmode"] = "require"
    cleaned = urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(values), parts.fragment)
    )
    return cleaned, {
        "connect_timeout": 2,
        "options": f"-c search_path={schema} -c statement_timeout=750 -c lock_timeout=300",
        "autocommit": True,
    }


class PostgresStore:
    """One reusable bounded-time connection, bounded write queue, failure cooldown."""

    def __init__(self, url: str) -> None:
        self._url = url
        self._connection: Any = None
        self._lock = threading.Lock()
        self._retry_after = 0.0
        self._failed = False
        self._closed = False
        self._queue: queue.Queue[tuple[str, str, Any] | None] = queue.Queue(maxsize=16)
        self._worker: threading.Thread | None = None
        self._start_lock = threading.Lock()
        self._queued_bytes = 0
        self._last_cleanup = 0.0

    def _connect(self) -> Any:
        import psycopg

        if self._connection is None or self._connection.closed:
            url, options = postgres_connection_options(self._url)
            connection = psycopg.connect(url, **options)
            try:
                connection.execute(
                    "CREATE TABLE IF NOT EXISTS mobility_computed_cache ("
                    "cache_key text PRIMARY KEY, payload bytea NOT NULL, "
                    "created_at timestamptz NOT NULL DEFAULT now())"
                )
            except Exception:
                connection.close()
                raise
            self._connection = connection
            self._failed = False
        return self._connection

    def _failure(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None
        self._retry_after = time.monotonic() + 60
        if not self._failed:
            # Database exceptions may embed the supplied DSN. Never log them.
            LOGGER.warning("Shared computed cache unavailable; using local results for 60 seconds")
        self._failed = True

    def _read(self, key: str) -> bytes | None:
        if self._closed or time.monotonic() < self._retry_after:
            return None
        with self._lock:
            if self._closed or time.monotonic() < self._retry_after:
                return None
            try:
                row = (
                    self._connect()
                    .execute(
                        "SELECT payload FROM mobility_computed_cache "
                        "WHERE cache_key = %s AND created_at >= now() - interval '7 days'",
                        (key,),
                    )
                    .fetchone()
                )
                return bytes(row[0]) if row else None
            except Exception:
                self._failure()
                return None

    def _start(self) -> None:
        with self._start_lock:
            if self._worker is None and not self._closed:
                self._worker = threading.Thread(
                    target=self._work_loop, name="computed-cache-mirror", daemon=True
                )
                self._worker.start()

    def read(self, key: str, on_result: Callable[[bytes], None] | None = None) -> bytes | None:
        if self._closed or time.monotonic() < self._retry_after:
            return None
        self._start()
        future: Future[bytes | None] = Future()
        try:
            self._queue.put_nowait(("read", key, (future, on_result)))
        except queue.Full:
            return None
        try:
            # Remote DNS/TLS/SQL never adds seconds to an interactive request.
            # A late hit still hydrates the local cache in the mirror worker.
            return future.result(timeout=0.01)
        except TimeoutError:
            return None

    def enqueue(self, key: str, payload: bytes) -> None:
        if self._closed or time.monotonic() < self._retry_after:
            return
        self._start()
        with self._start_lock:
            if self._closed:
                return
            if self._queued_bytes + len(payload) > 16 * 1024 * 1024:
                return
            try:
                self._queue.put_nowait(("write", key, payload))
                self._queued_bytes += len(payload)
            except queue.Full:
                pass

    def _work_loop(self) -> None:
        while not self._closed or not self._queue.empty():
            item = self._queue.get()
            try:
                if item is None:
                    break
                action, key, value = item
                if action == "read":
                    future, on_result = value
                    stored = self._read(key)
                    future.set_result(stored)
                    if stored and on_result:
                        on_result(stored)
                    continue
                if self._closed or time.monotonic() < self._retry_after:
                    continue
                with self._lock:
                    if self._closed:
                        continue
                    try:
                        self._connect().execute(
                            "INSERT INTO mobility_computed_cache (cache_key,payload) "
                            "VALUES (%s,%s) "
                            "ON CONFLICT (cache_key) DO UPDATE "
                            "SET payload=excluded.payload, created_at=now()",
                            (key, value),
                        )
                        if time.monotonic() - self._last_cleanup > 60:
                            self._connection.execute(
                                "WITH sized AS (SELECT cache_key, created_at, "
                                "sum(octet_length(payload)) OVER (ORDER BY created_at DESC) "
                                "AS total, "
                                "row_number() OVER (ORDER BY created_at DESC) AS n "
                                "FROM mobility_computed_cache) "
                                "DELETE FROM mobility_computed_cache USING sized "
                                "WHERE mobility_computed_cache.cache_key=sized.cache_key "
                                "AND (sized.total > 536870912 OR sized.n > 4096 "
                                "OR sized.created_at < now() - interval '7 days')"
                            )
                            self._last_cleanup = time.monotonic()
                    except Exception:
                        self._failure()
            finally:
                if item and item[0] == "write":
                    with self._start_lock:
                        self._queued_bytes -= len(item[2])
                self._queue.task_done()
        if self._connection is not None:
            self._connection.close()
            self._connection = None

    def status(self) -> dict[str, Any]:
        return {
            "configured": True,
            "connected": self._connection is not None and not self._connection.closed,
            "fallback": self._failed,
            "queued_writes": self._queue.qsize(),
            "queued_bytes": self._queued_bytes,
        }

    def close(self) -> None:
        self._closed = True
        # Reads/statements have tight time limits. Shutdown never drains a remote
        # queue; the same results are already safely written to local disk.
        if self._lock.acquire(timeout=0.1):
            try:
                if self._connection is not None:
                    self._connection.close()
                    self._connection = None
            finally:
                self._lock.release()
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass


class ComputedCache:
    def __init__(
        self,
        root: Path,
        *,
        memory_bytes: int = 64 * 1024 * 1024,
        disk_bytes: int = 512 * 1024 * 1024,
        max_entries: int = 256,
        database_url: str = "",
    ) -> None:
        self.root = root / CACHE_FORMAT
        self.memory_bytes = memory_bytes
        self.disk_bytes = disk_bytes
        self.max_entries = max_entries
        self._lock = threading.RLock()
        self._memory: OrderedDict[str, tuple[bytes, float]] = OrderedDict()
        self._memory_size = 0
        self._flights: dict[str, Future[bytes]] = {}
        self._async_workers: set[asyncio.Task[None]] = set()
        self._shareable_keys: set[str] = set()
        self.shared = PostgresStore(database_url) if database_url else None
        self.counts = dict(memory_hits=0, disk_hits=0, shared_hits=0, misses=0, waits=0)

    def key(self, namespace: str, value: Any) -> str:
        return digest([CACHE_FORMAT, namespace, value])

    def _remember(self, key: str, payload: bytes, allow_shared: bool = False) -> None:
        if len(payload) > self.memory_bytes:
            with self._lock:
                self._shareable_keys.discard(key)
            return
        with self._lock:
            previous = self._memory.pop(key, None)
            if previous:
                self._memory_size -= len(previous[0])
            self._memory[key] = payload, time.monotonic()
            if allow_shared:
                self._shareable_keys.add(key)
            self._memory_size += len(payload)
            while self._memory_size > self.memory_bytes or len(self._memory) > self.max_entries:
                removed, (old, _) = self._memory.popitem(last=False)
                self._shareable_keys.discard(removed)
                self._memory_size -= len(old)

    def _read(self, key: str, allow_shared: bool = False) -> bytes | None:
        with self._lock:
            entry = self._memory.get(key)
            if entry and time.monotonic() - entry[1] <= MAX_AGE_SECONDS:
                self._memory.move_to_end(key)
                self.counts["memory_hits"] += 1
                return entry[0]
        path = self.root / f"{key}.cache"
        try:
            # Bound the compressed read as well as decompression.
            stored = path.read_bytes() if path.stat().st_size <= MAX_ITEM_BYTES + 1024 else b""
            payload = decode(stored)
        except OSError:
            payload = None
        if payload is not None:
            self._remember(key, payload, allow_shared)
            with self._lock:
                self.counts["disk_hits"] += 1
            return payload
        if self.shared and allow_shared:

            def hydrate(stored: bytes) -> None:
                payload = decode(stored)
                if payload is not None:
                    self._remember(key, payload, allow_shared)
                    self._write_disk(key, stored)

            stored = self.shared.read(key, hydrate)
            payload = decode(stored) if stored else None
            if payload is not None:
                self._remember(key, payload, allow_shared)
                self._write_disk(key, stored)
                with self._lock:
                    self.counts["shared_hits"] += 1
                return payload
        return None

    def _write_disk(self, key: str, stored: bytes) -> None:
        if not self.disk_bytes or len(stored) > self.disk_bytes:
            return
        temporary: Path | None = None
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            with NamedTemporaryFile(dir=self.root, suffix=".tmp", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(stored)
            os.replace(temporary, self.root / f"{key}.cache")
            temporary = None
            self._prune()
        except OSError:
            pass  # Read-only/full local storage must not prevent a valid calculation.
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)

    def _prune(self) -> None:
        with self._lock:
            try:
                files = sorted(
                    ((p.stat().st_mtime, p.stat().st_size, p) for p in self.root.glob("*.cache")),
                    reverse=True,
                )
                total = 0
                for index, (modified, size, path) in enumerate(files):
                    if (
                        total + size > self.disk_bytes
                        or index >= self.max_entries * 4
                        or time.time() - modified > MAX_AGE_SECONDS
                    ):
                        path.unlink(missing_ok=True)
                    else:
                        total += size
            except OSError:
                pass

    def _begin(self, key: str) -> tuple[bool, Future[bytes]]:
        with self._lock:
            if key in self._flights:
                self.counts["waits"] += 1
                return False, self._flights[key]
            future: Future[bytes] = Future()
            self._flights[key] = future
            return True, future

    def _finish(self, key: str, payload: bytes, allow_shared: bool = False) -> None:
        if len(payload) <= MAX_ITEM_BYTES:
            self._remember(key, payload, allow_shared)
            stored = encode(payload)
            self._write_disk(key, stored)
            if self.shared and allow_shared:
                self.shared.enqueue(key, stored)

    def get_or_compute_bytes(
        self, namespace: str, value: Any, compute: Callable[[], bytes]
    ) -> bytes:
        key = self.key(namespace, value)
        shareable = namespace in SHARED_NAMESPACES
        owner, future = self._begin(key)
        if not owner:
            return future.result()
        try:
            payload = self._read(key, shareable)
            if payload is None:
                with self._lock:
                    self.counts["misses"] += 1
                payload = compute()
                self._finish(key, payload, shareable)
            future.set_result(payload)
            return payload
        except BaseException as error:
            future.set_exception(error)
            raise
        finally:
            with self._lock:
                self._flights.pop(key, None)

    async def aget_or_compute_bytes(
        self, namespace: str, value: Any, compute: Callable[[], Awaitable[bytes]]
    ) -> bytes:
        key = self.key(namespace, value)
        shareable = namespace in SHARED_NAMESPACES
        owner, future = self._begin(key)

        async def calculate() -> None:
            try:
                payload = await run_in_threadpool(self._read, key, shareable)
                if payload is None:
                    with self._lock:
                        self.counts["misses"] += 1
                    payload = await compute()
                    await run_in_threadpool(self._finish, key, payload, shareable)
                future.set_result(payload)
            except asyncio.CancelledError:
                future.cancel()
                raise
            except BaseException as error:
                future.set_exception(error)
            finally:
                with self._lock:
                    self._flights.pop(key, None)

        if owner:
            # A disconnected first caller must not cancel joined browsers' work.
            worker = asyncio.create_task(calculate())
            self._async_workers.add(worker)
            worker.add_done_callback(self._async_workers.discard)
        return await asyncio.shield(asyncio.wrap_future(future))

    async def mirror_public_results(self, timeout: float = 30) -> None:
        """Explicit precomputation may seed shared public results from local hits."""
        if self.shared is None:
            return
        with self._lock:
            entries = [
                (key, value[0])
                for key, value in self._memory.items()
                if key in self._shareable_keys
            ]
        deadline = time.monotonic() + timeout
        for key, payload in entries:
            while self.shared._queue.qsize() > 8 and time.monotonic() < deadline:
                await asyncio.sleep(0.05)
            if time.monotonic() >= deadline:
                break
            stored = await run_in_threadpool(encode, payload)
            self.shared.enqueue(key, stored)
        while self.shared._queue.unfinished_tasks and time.monotonic() < deadline:
            await asyncio.sleep(0.05)

    def get_or_compute(self, namespace: str, value: Any, compute: Callable[[], Any]) -> Any:
        # Decoding gives each caller independent mutable dictionaries/lists.
        return json.loads(
            self.get_or_compute_bytes(
                namespace,
                value,
                lambda: json.dumps(
                    compute(), ensure_ascii=False, separators=(",", ":"), allow_nan=False
                ).encode(),
            )
        )

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                **self.counts,
                "memory_bytes": self._memory_size,
                "memory_entries": len(self._memory),
                "in_flight": len(self._flights),
                "shared": self.shared.status() if self.shared else {"configured": False},
            }

    def close(self) -> None:
        if self.shared:
            self.shared.close()

    async def aclose(self) -> None:
        """Stop detached calculations when the application itself shuts down."""
        workers = tuple(self._async_workers)
        try:
            for worker in workers:
                worker.cancel()
            if workers:
                await asyncio.gather(*workers, return_exceptions=True)
        finally:
            self.close()


class SourceVersion:
    """Content hash of a loaded source snapshot and all model/response code."""

    def __init__(self, data_dir: Path, public_dir: Path, *, configuration: Any = None) -> None:
        self.data_dir = data_dir
        self.public_dir = public_dir
        self._version: str | None = None
        self._lock = threading.Lock()
        self.configuration = configuration
        self._signature: list[tuple[Path, int, int]] | None = None

    def reset(self) -> None:
        with self._lock:
            self._version = None

    def version(self, *, dynamic: bool = False) -> str:
        with self._lock:
            sources: list[Path] = []
            if self._version is None or dynamic:
                sources = [
                    *sorted((self.data_dir / "cache" / "normalized").glob("*.*")),
                    *sorted((self.data_dir / "cache" / "graphs").glob("*.json")),
                    *sorted((self.data_dir / "cache" / "derived").glob("*.json")),
                    *sorted((self.data_dir / "cache" / "derived").glob("*.geojson")),
                    *sorted(self.public_dir.rglob("*.json")),
                    *sorted(Path(__file__).resolve().parents[1].rglob("*.py")),
                ]
                signature = [
                    (path, path.stat().st_mtime_ns, path.stat().st_size)
                    for path in sources
                    if path.is_file() and not path.name.endswith(".meta.json")
                ]
                if signature != self._signature:
                    self._version = None
                    self._signature = signature
            if self._version is None:
                hashes = []
                for path in sources:
                    if path.is_file() and not path.name.endswith(".meta.json"):
                        with path.open("rb") as stream:
                            if path.is_relative_to(self.data_dir):
                                name = "backend-data/" + path.relative_to(self.data_dir).as_posix()
                            elif path.is_relative_to(self.public_dir):
                                name = "public-data/" + path.relative_to(self.public_dir).as_posix()
                            else:
                                name = (
                                    "code/"
                                    + path.relative_to(
                                        Path(__file__).resolve().parents[1]
                                    ).as_posix()
                                )
                            hashes.append((name, hashlib.file_digest(stream, "sha256").hexdigest()))
                self._version = digest([self.configuration, hashes])
            # Reviewed passenger vintages are the mutable exception to the
            # bundled snapshot: their atomic pointer changes catalogue content.
            active = self.data_dir / "metadata" / "passenger-sources" / "active.json"
            try:
                pointer = active.read_bytes()
            except FileNotFoundError:
                pointer = b""
            return digest([self._version, pointer.hex()])
