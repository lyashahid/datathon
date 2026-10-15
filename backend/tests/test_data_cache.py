import hashlib
from pathlib import Path

import pytest

from app.data.cache import FileCache


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
