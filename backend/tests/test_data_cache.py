import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from app.data.cache import FileCache, atomic_write


def test_file_cache_writes_content_and_metadata_atomically(tmp_path: Path) -> None:
    cache = FileCache(tmp_path)
    content = b"sample source content"

    path = cache.write_bytes(
        "raw/example.txt",
        content,
        source="test-source",
        endpoint="https://example.invalid/source",
        content_type="text/plain",
    )

    assert path.read_bytes() == content
    metadata = cache.read_metadata("raw/example.txt")
    assert metadata["source"] == "test-source"
    assert metadata["sha256"] == hashlib.sha256(content).hexdigest()
    assert metadata["status"] == "fresh"


def test_file_cache_rejects_paths_outside_root(tmp_path: Path) -> None:
    cache = FileCache(tmp_path)

    with pytest.raises(ValueError):
        cache.path("../outside.txt")


def test_atomic_publication_keeps_readers_on_previous_complete_file(tmp_path, monkeypatch):
    import app.data.cache as cache_module

    path = tmp_path / "source.json"
    path.write_bytes(b'{"version":"previous"}')
    entered, release = threading.Event(), threading.Event()
    replace = cache_module.os.replace

    def blocked_replace(source, destination):
        entered.set()
        assert release.wait(5)
        replace(source, destination)

    monkeypatch.setattr(cache_module.os, "replace", blocked_replace)
    with ThreadPoolExecutor(max_workers=1) as pool:
        writer = pool.submit(atomic_write, path, b'{"version":"next"}')
        assert entered.wait(5)
        try:
            assert path.read_bytes() == b'{"version":"previous"}'
        finally:
            release.set()
        writer.result(5)
    assert path.read_bytes() == b'{"version":"next"}'
    assert list(tmp_path.glob("*.tmp")) == []


def test_atomic_publication_preserves_original_and_cleans_temp_after_failure(tmp_path, monkeypatch):
    path = tmp_path / "source.json"
    path.write_bytes(b"original")

    def fail(*_):
        raise OSError("storage unavailable")

    monkeypatch.setattr("app.data.cache.os.replace", fail)
    with pytest.raises(OSError, match="storage unavailable"):
        atomic_write(path, b"next")
    assert path.read_bytes() == b"original"
    assert list(tmp_path.iterdir()) == [path]


def test_exclusive_publication_keeps_frozen_issues_immutable(tmp_path):
    path = tmp_path / "frozen.json"
    atomic_write(path, b"first complete issue", exclusive=True)
    with pytest.raises(FileExistsError):
        atomic_write(path, b"second issue", exclusive=True)
    assert path.read_bytes() == b"first complete issue"
    assert list(tmp_path.iterdir()) == [path]
