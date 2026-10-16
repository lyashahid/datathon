"""A cached graph must not receive permissions from a different OSM capture."""

import hashlib
import json

import pytest

from app.planning.national_infrastructure import graph_source_pbf


def captured_graph_source(root, *, pbf_date="2026-10-12T13:45:15+00:00"):
    cached = root / "backend/data/cache/raw/osm/maldives-latest.osm.pbf"
    cached.parent.mkdir(parents=True)
    cached.write_bytes(b"cached graph source")
    metadata = {
        "sha256": hashlib.sha256(cached.read_bytes()).hexdigest(),
        "retrieved_at": pbf_date,
        "endpoint": "https://download.geofabrik.de/asia/maldives-latest.osm.pbf",
    }
    cached.with_name(cached.name + ".meta.json").write_text(json.dumps(metadata), encoding="utf-8")
    graph_metadata = root / "backend/data/cache/graphs/land.json.meta.json"
    graph_metadata.parent.mkdir(parents=True)
    graph_metadata.write_text(
        json.dumps({"retrieved_at": "2026-10-13T12:17:18+00:00"}), encoding="utf-8"
    )
    return cached, metadata


def test_tags_use_cached_graph_source_even_when_another_root_snapshot_exists(tmp_path):
    cached, metadata = captured_graph_source(tmp_path)
    alternate = tmp_path / "data/raw/maldives-latest.osm.pbf"
    alternate.parent.mkdir(parents=True)
    alternate.write_bytes(b"different older root snapshot")
    assert graph_source_pbf(tmp_path) == (cached, metadata)


def test_missing_original_graph_source_never_silently_uses_another_snapshot(tmp_path):
    alternate = tmp_path / "data/raw/maldives-latest.osm.pbf"
    alternate.parent.mkdir(parents=True)
    alternate.write_bytes(b"unrelated snapshot")
    with pytest.raises(ValueError, match="rebuild normalization"):
        graph_source_pbf(tmp_path)


def test_changed_or_newer_source_requires_graph_regeneration(tmp_path):
    cached, _ = captured_graph_source(tmp_path)
    cached.write_bytes(b"replaced")
    with pytest.raises(ValueError, match="checksum"):
        graph_source_pbf(tmp_path)
    cached.write_bytes(b"cached graph source")
    metadata_path = cached.with_name(cached.name + ".meta.json")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["retrieved_at"] = "2026-10-14T00:00:00+00:00"
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    with pytest.raises(ValueError, match="newer than the land graph"):
        graph_source_pbf(tmp_path)
