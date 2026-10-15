import json
from pathlib import Path

from app.cli import prewarm
from app.cli.accessibility import build_accessibility_artifact
from app.config.settings import Settings
from app.data.cache import FileCache
from app.data.validation import REQUIRED_ARTIFACTS, CacheValidator


def _write_valid_artifacts(data_dir: Path) -> None:
    cache = FileCache(data_dir / "cache")
    values = {
        "normalized/islands.geojson": {
            "type": "FeatureCollection",
            "features": [{"properties": {"id": "island:1"}}],
        },
        "normalized/population.json": [],
        "normalized/facilities.json": [],
        "normalized/facility-mapping-review.json": {
            "version": "facility-mapping-review-v1",
            "records": [],
            "summary": {},
        },
        "normalized/transport.json": {"features": []},
        "normalized/provenance.json": {},
        "derived/national_summary.json": {},
        "derived/demand-anchors.json": {"anchors": []},
        "derived/accessibility-default.json": {
            "version": "accessibility-v1",
            "scores": [],
            "summary": {"island_count": 0},
        },
        "graphs/land.json": {"islands": {}},
        "graphs/marine.json": {"nodes": [], "edges": []},
        "graphs/air.json": {"nodes": [], "edges": []},
        "graphs/summary.json": {},
    }
    for relative_path in REQUIRED_ARTIFACTS:
        cache.write_json(
            relative_path,
            values[relative_path],
            source="test",
            endpoint="test",
            parser_version="test-v1",
        )


def test_cache_validator_checks_structure_and_checksum(tmp_path: Path) -> None:
    _write_valid_artifacts(tmp_path)
    validator = CacheValidator(tmp_path)

    valid = validator.validate()
    assert valid["status"] == "ok"
    assert valid["checked_files"] == len(REQUIRED_ARTIFACTS)

    artifact = tmp_path / "cache" / "graphs" / "air.json"
    artifact.write_text(artifact.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    invalid = validator.validate()
    assert invalid["status"] == "error"
    assert any("checksum mismatch" in error for error in invalid["errors"])

    cache = FileCache(tmp_path / "cache")
    cache.write_json(
        "normalized/transport.json",
        {"features": [{"geometry": {"type": "Point", "coordinates": [200, 4]}}]},
        source="test",
        endpoint="test",
        parser_version="test-v1",
    )
    malformed = validator.validate()
    assert any("malformed geometry" in error for error in malformed["errors"])


def test_prewarm_reports_offline_readiness(monkeypatch, tmp_path: Path) -> None:
    class FakeNormalizer:
        def __init__(self, _data_dir: Path) -> None:
            pass

        def run(self) -> dict[str, object]:
            return {"islands": 1}

    monkeypatch.setattr(prewarm, "NationalNormalizer", FakeNormalizer)
    monkeypatch.setattr(
        prewarm,
        "build_accessibility_artifact",
        lambda _data_dir: {"summary": {"island_count": 1}},
    )
    monkeypatch.setattr(
        prewarm,
        "CacheValidator",
        lambda _data_dir: type(
            "FakeValidator",
            (),
            {"validate": lambda _self: {"status": "ok", "errors": [], "warnings": []}},
        )(),
    )

    report = prewarm.run_prewarm(
        Settings(environment="test", data_dir=tmp_path),
        refresh_sources=False,
    )

    assert report["readiness"]["status"] == "ready"
    assert report["phases"]["source_refresh"]["status"] == "skipped"
    assert report["phases"]["normalization"]["status"] == "ok"
    assert json.loads(json.dumps(report))["version"] == "prewarm-v1"


def test_accessibility_artifact_rebuild_is_deterministic(tmp_path: Path) -> None:
    cache = FileCache(tmp_path / "cache")
    artifacts = {
        "normalized/islands.geojson": {
            "features": [
                {"properties": {"id": "island:1", "centroid": [73.0, 3.0]}}
            ]
        },
        "normalized/facilities.json": [],
        "normalized/transport.json": {"features": []},
        "derived/demand-anchors.json": {"anchors": []},
        "graphs/land.json": {"islands": {}},
        "graphs/marine.json": {"nodes": [], "edges": []},
        "graphs/air.json": {"nodes": [], "edges": []},
    }
    for relative_path, value in artifacts.items():
        cache.write_json(
            relative_path,
            value,
            source="test",
            endpoint="test",
            parser_version="test-v1",
        )

    first = build_accessibility_artifact(tmp_path)
    second = build_accessibility_artifact(tmp_path)

    assert first == second
