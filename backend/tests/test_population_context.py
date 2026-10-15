import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.repository import NormalizedRepository
from app.config.settings import Settings
from app.data.map_context import MapContext
from app.data.population import attach_population, population_summary
from app.main import create_app


def island(identity: str, name: str, atoll: str, category: str = "Residential Island") -> dict:
    return {"properties": {"id": identity, "name": name, "atoll": atoll, "category": category}}


def census(locality: str, atoll: str, value: int, source: str = "P3", **fields) -> dict:
    return {
        "locality": locality,
        "atoll_code": atoll,
        "population": value,
        "source": f"MBS Census 2022 {source}",
        "year": 2022,
        **fields,
    }


def test_same_named_islands_cannot_receive_another_atolls_population() -> None:
    records = [
        census("Meedhoo", "S", 1892),
        census("Meedhoo", "R", 1872),
        census("Meedhoo", "Dh", 1118),
    ]
    islands = [
        island("addu", "Addu Meedhoo", "Seenu"),
        island("raa", "Meedhoo", "Raa"),
        island("dhaalu", "Meedhoo", "Dhaalu"),
    ]
    attach_population(records, islands)
    assert [x["island_id"] for x in records] == ["addu", "raa", "dhaalu"]
    records.append(census("Meedhoo", "HA", 99))
    attach_population(records, islands)
    assert records[-1]["island_id"] is None


def test_explicit_transliteration_is_atoll_constrained_and_residential() -> None:
    records = [census("Uligamu", "HA", 400), census("Maafushi", "K", 4471)]
    islands = [
        island("uligan", "Uligan", "Haa Alifu"),
        island("resident", "Maafushi", "Kaafu"),
        island("resort", "Maafushi", "Kaafu", "Resort Island"),
    ]
    attach_population(records, islands)
    assert [x["island_id"] for x in records] == ["uligan", "resident"]
    assert records[0]["match_status"] == "matched_atoll_name_alias"


def test_city_total_and_atoll_age_tables_are_not_assigned_to_one_island() -> None:
    records = [census("Maale", "", 211908, "P5"), census("Maale", "", 500, "P6")]
    attach_population(records, [island("island:1443", "Maale", "MLE")])
    assert all(x["island_id"] is None for x in records)


def test_male_disjoint_wards_and_phases_have_census_totals_without_harbours() -> None:
    rows = [
        ("Henveiru", 34012),
        ("Galolhu", 28484),
        ("Machchangolhi", 27706),
        ("Maafannu", 47036),
        ("Hulhumaale Phase 1", 35859),
        ("Hulhumaale Phase 2", 29855),
        ("Maale", 211908),
        ("Harbours (Maale, Hulhumaale & Vilimaale)", 1399),
    ]
    records = [
        census(name, "", value, "P5", sex="both", nationality="total") for name, value in rows
    ]
    attach_population(
        records, [island("island:1443", "Malé", "MLE"), island("island:1442", "Hulhumalé", "MLE")]
    )
    male = population_summary([x for x in records if x["island_id"] == "island:1443"])
    assert male["total"] == 137238
    assert male["status"] == "census"
    assert len(male["localities"]) == 4
    assert (
        population_summary([x for x in records if x["island_id"] == "island:1442"])["total"]
        == 65714
    )


def test_unknown_population_is_null_and_overlapping_tables_do_not_double_count() -> None:
    assert population_summary([])["total"] is None
    assert population_summary([])["status"] == "unavailable"
    assert population_summary([])["by_sex"] == {}
    assert population_summary([])["by_nationality"] == {}
    records = [
        census("Example", "R", 10),
        census("Example", "R", 10, "P5", sex="both", nationality="total"),
    ]
    assert population_summary(records)["total"] == 10


def test_canonical_p5_identity_retains_source_identity_and_distinguishes_atolls() -> None:
    records = [
        census(
            "Meedhoo",
            code,
            10,
            "P5",
            id="population:duplicate",
            source_record_id=f"{code}:Meedhoo",
            sex="both",
            nationality="total",
        )
        for code in ("R", "Dh")
    ]
    islands = [island("raa", "Meedhoo", "Raa"), island("dhaalu", "Meedhoo", "Dhaalu")]
    attach_population(records, islands)
    ids = [x["id"] for x in records]
    assert len(set(ids)) == 2
    assert records[0]["source_record_id"] == "R:Meedhoo"
    assert records[0]["captured_record_id"] == "population:duplicate"
    attach_population(records, islands)
    assert [x["id"] for x in records] == ids
    assert records[0]["captured_record_id"] == "population:duplicate"


def test_captured_nationwide_population_recovers_all_administrative_islands() -> None:
    data_dir = Path(__file__).resolve().parents[1] / "data"
    if not (data_dir / "cache/normalized/population.json").exists():
        pytest.skip("captured national data not installed")
    repository = NormalizedRepository(data_dir)
    repository.reload()
    p3 = [x for x in repository.population if x["source"].endswith("P3")]
    assert len(p3) == 186
    assert all(x["island_id"] for x in p3)
    assert sum(x["population"] for x in p3) == 236911
    assert repository.summary["population_coverage"]["islands_with_census"] == 190
    assert repository.population_summary("island:1442")["total"] == 65714
    assert repository.population_summary("island:1152")["total"] == 13759


def test_context_query_is_spatial_and_receipt_survives(tmp_path: Path) -> None:
    path = tmp_path / "cache/derived/map-context.geojson"
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "metadata": {"source_sha256": "hash"},
                "features": [
                    {"bbox": [73, 4, 73.1, 4.1], "properties": {"kind": "road"}},
                    {"bbox": [73, -0.6, 73.1, -0.5], "properties": {"kind": "building"}},
                ],
            }
        ),
        encoding="utf-8",
    )
    result = MapContext(tmp_path).query([72.99, 3.99, 73.2, 4.2])
    assert result["summary"]["roads"] == 1
    assert result["summary"]["buildings"] == 0
    assert result["metadata"]["source_sha256"] == "hash"
    assert not result["summary"]["truncated"]


@pytest.mark.parametrize("bbox", ["0,0,1,1,1", "nan,0,1,1", "1,0,0,1", "72,-1,74,8"])
def test_context_endpoint_rejects_invalid_or_unbounded_queries(tmp_path: Path, bbox: str) -> None:
    with TestClient(create_app(Settings(environment="test", data_dir=tmp_path))) as client:
        assert client.get("/api/v1/map/context", params={"bbox": bbox}).status_code == 422


def test_context_absence_is_explicit_and_not_a_fabricated_basemap(tmp_path: Path) -> None:
    assert MapContext(tmp_path).query([73, 4, 73.1, 4.1])["summary"]["status"] == "unavailable"
