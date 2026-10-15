import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.repository import NormalizedRepository
from app.cli.accessibility import build_accessibility_artifact
from app.config.settings import Settings
from app.main import create_app


def _write_fixture_data(data_dir: Path) -> None:
    normalized = data_dir / "cache" / "normalized"
    derived = data_dir / "cache" / "derived"
    normalized.mkdir(parents=True)
    derived.mkdir(parents=True)
    (normalized / "islands.geojson").write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "id": "island:1",
                        "geometry": {"type": "Polygon", "coordinates": []},
                        "properties": {
                            "id": "island:1",
                            "name": "Example",
                            "atoll": "Test",
                            "category": "Residential Island",
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (normalized / "population.json").write_text(
        json.dumps(
            [
                {
                    "id": "population:1",
                    "island_id": "island:1",
                    "source": "MBS Census 2022 P6",
                    "year": 2022,
                    "age_group": "5-9",
                    "sex": "both",
                    "nationality": "total",
                    "population": 100,
                }
            ]
        ),
        encoding="utf-8",
    )
    (normalized / "facilities.json").write_text(
        json.dumps(
            [
                {
                    "id": "facility:health:1",
                    "island_id": "island:1",
                    "category": "health_center",
                    "name": "Example Health Centre",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [73.0, 3.0],
                    },
                }
            ]
        ),
        encoding="utf-8",
    )
    (normalized / "transport.json").write_text(
        json.dumps(
            {
                "features": [
                    {
                        "id": "osm:node:1",
                        "island_id": "island:1",
                        "category": "bus_stop",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [73.001, 3.001],
                        },
                    }
                ],
                "summary": {"feature_count": 1},
            }
        ),
        encoding="utf-8",
    )
    (derived / "national_summary.json").write_text(
        json.dumps({"island_count": 1, "accessibility_status": "not_calculated_in_phase_2"}),
        encoding="utf-8",
    )


def test_national_api_reads_normalized_files(tmp_path: Path) -> None:
    _write_fixture_data(tmp_path)
    client = TestClient(create_app(Settings(environment="test", data_dir=tmp_path)))

    with client:
        islands = client.get("/api/v1/islands?q=Example")
        detail = client.get("/api/v1/islands/island:1")
        profile = client.get("/api/v1/islands/island:1/profile")
        mapped = client.get("/api/v1/map/features?layer=all&island_id=island:1")
        summary = client.get("/api/v1/national/summary")

    assert islands.status_code == 200
    assert islands.json()["total"] == 1
    assert detail.status_code == 200
    assert detail.json()["name"] == "Example"
    assert profile.status_code == 200
    assert profile.json()["population"]["school_age"] == 100
    assert profile.json()["population"]["by_sex"]["both"] == 100
    assert "accessibility" in profile.json()
    assert "data_quality" in profile.json()
    assert "warnings" in profile.json()["data_quality"]
    assert profile.json()["infrastructure"]["items"][0]["category"] == "health_center"
    assert mapped.status_code == 200
    assert mapped.json()["type"] == "FeatureCollection"
    assert mapped.json()["summary"]["feature_count"] == 3
    assert mapped.json()["features"][1]["geometry"]["coordinates"] == [73.0, 3.0]
    assert summary.json()["island_count"] == 1


def test_national_api_returns_consistent_not_found_error(tmp_path: Path) -> None:
    _write_fixture_data(tmp_path)
    client = TestClient(create_app(Settings(environment="test", data_dir=tmp_path)))

    response = client.get("/api/v1/islands/island:missing")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "http_error"


def test_summary_detects_existing_accessibility_artifact(tmp_path: Path) -> None:
    _write_fixture_data(tmp_path)
    artifact = build_accessibility_artifact(tmp_path)
    with TestClient(create_app(Settings(environment="test", data_dir=tmp_path))) as client:
        response = client.get("/api/v1/national/summary")

    assert response.json()["accessibility_status"] == "calculated"
    assert response.json()["accessibility"] == artifact["summary"]


def test_population_summary_does_not_add_overlapping_census_totals(tmp_path: Path) -> None:
    repository = NormalizedRepository(tmp_path)
    repository.population = [
        {"island_id": "island:1", "population": 9177, "source": "MBS Census 2022 P3"},
        {"island_id": "island:1", "population": 9177, "source": "MBS Census 2022 P5",
         "sex": "both", "nationality": "total"},
        {"island_id": "island:1", "population": 4267, "source": "MBS Census 2022 P5",
         "sex": "female", "nationality": "total"},
        {"island_id": "island:1", "population": 4910, "source": "MBS Census 2022 P5",
         "sex": "male", "nationality": "total"},
    ]

    result = repository.population_summary("island:1")

    assert result["total"] == 9177
    assert result["by_sex"]["female"] + result["by_sex"]["male"] == result["total"]
