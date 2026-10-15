"""Dataset grain, typed filtering, aggregation, missingness, export and receipts."""

import csv
import io
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.analytics.models import (
    ChartComparisonRequest,
    ChartRequest,
    ChartSource,
    DatasetFilter,
    DatasetQuery,
)
from app.analytics.service import DatasetService
from app.api.routes.datasets import router
from app.forecasting.analysis import EvidenceAnalysis


def _service(tmp_path):
    public = tmp_path / "public"
    public.mkdir()
    (public / "policy-evidence").mkdir()
    data = {
        "generatedAt": "2026-10-14T00:00:00Z",
        "sources": [{"id": "official", "url": "https://example.test/source"}],
        "observations": [
            {
                "id": "a",
                "geography": "Malé",
                "metric": "Passengers",
                "value": 100,
                "unit": "movements",
                "available": True,
            },
            {
                "id": "b",
                "geography": "Malé",
                "metric": "Passengers",
                "value": 50,
                "unit": "movements",
                "available": False,
            },
            {
                "id": "c",
                "geography": "Vilimale",
                "metric": "Passengers",
                "value": None,
                "unit": "movements",
            },
            {
                "id": "d",
                "geography": "Malé",
                "metric": "Household income",
                "value": 1000,
                "unit": "MVR",
            },
            {
                "id": "e",
                "geography": "Vilimale",
                "metric": "Passengers",
                "value": 20,
                "unit": "movements",
            },
            {
                "id": "f",
                "geography": '=HYPERLINK("bad")',
                "metric": "Passengers",
                "value": 10,
                "unit": "movements",
            },
        ],
        "layers": [],
    }
    (public / "policy-evidence" / "bundle.json").write_text(json.dumps(data), encoding="utf-8")
    return DatasetService(public, tmp_path / "runtime")


def test_typed_schema_and_receipts_preserve_missing_observations(tmp_path):
    service = _service(tmp_path)
    schema = service.schema("policy-observations")
    value = next(item for item in schema["columns"] if item["name"] == "value")
    assert value["type"] == "number"
    assert value["missing_count"] == 1
    assert schema["row_count"] == 6
    assert len(schema["provenance"]["receipt"]["sha256"]) == 64
    assert schema["provenance"]["sources"][0]["id"] == "official"


def _population_sources(tmp_path):
    public = tmp_path / "public"
    public.mkdir()
    normalized = tmp_path / "runtime" / "cache" / "normalized"
    normalized.mkdir(parents=True)
    (normalized / "population.json").write_text(
        json.dumps([{"locality": "Meedhoo", "atoll_code": "R", "population": 1872}]),
        encoding="utf-8",
    )
    return public, normalized


def _population_islands(path, identifier="island:old", name="Meedhoo"):
    path.write_text(
        json.dumps(
            {"features": [{"properties": {"id": identifier, "name": name, "atoll": "Raa"}}]}
        ),
        encoding="utf-8",
    )


def test_population_join_cache_refreshes_when_only_island_identity_changes(tmp_path):
    public, normalized = _population_sources(tmp_path)
    islands_path = normalized / "islands.geojson"
    _population_islands(islands_path)
    service = DatasetService(public, tmp_path / "runtime")
    first = service.query("national-population", DatasetQuery())
    assert first["items"][0]["island_id"] == "island:old"
    _population_islands(islands_path, identifier="island:new")
    second = service.query("national-population", DatasetQuery())
    assert second["items"][0]["island_id"] == "island:new"
    first_receipt = first["dataset"]["provenance"]["receipt"]
    second_receipt = second["dataset"]["provenance"]["receipt"]
    assert first_receipt["sha256"] == second_receipt["sha256"]
    assert first_receipt["dependencies"][0]["sha256"] != second_receipt["dependencies"][0]["sha256"]


def test_population_join_cache_handles_dependency_added_and_removed(tmp_path):
    public, normalized = _population_sources(tmp_path)
    service = DatasetService(public, tmp_path / "runtime")
    first = service.query("national-population", DatasetQuery())
    assert "island_id" not in first["items"][0]
    islands_path = normalized / "islands.geojson"
    _population_islands(islands_path)
    assert (
        service.query("national-population", DatasetQuery())["items"][0]["island_id"]
        == "island:old"
    )
    islands_path.unlink()
    assert "island_id" not in service.query("national-population", DatasetQuery())["items"][0]


def test_evidence_profiles_refresh_population_mapping_when_join_source_changes(tmp_path):
    public, normalized = _population_sources(tmp_path)
    islands_path = normalized / "islands.geojson"
    _population_islands(islands_path)
    analysis = EvidenceAnalysis(public, tmp_path / "runtime")

    def population_profile():
        return next(item for item in analysis.profiles() if item["id"] == "national-population")

    assert population_profile()["geographyCoverage"]["mappedRecords"] == 1
    _population_islands(islands_path, name="Another locality")
    assert population_profile()["geographyCoverage"]["mappedRecords"] == 0


def test_rows_filter_sort_page_and_projection(tmp_path):
    service = _service(tmp_path)
    result = service.query(
        "policy-observations",
        DatasetQuery(
            filters=[DatasetFilter(column="unit", value="movements")],
            sort="value",
            descending=True,
            limit=2,
            offset=1,
            columns=["id", "value"],
        ),
    )
    assert result["total"] == 5
    assert result["items"] == [{"id": "b", "value": 50}, {"id": "e", "value": 20}]
    assert service.query("policy-observations", DatasetQuery(q="vilimale"))["total"] == 2
    missing = service.query(
        "policy-observations", DatasetQuery(filters=[DatasetFilter(column="value", op="missing")])
    )
    assert missing["items"][0]["value"] is None


def test_boolean_is_not_numeric_one_and_invalid_numeric_filters_are_rejected(tmp_path):
    service = _service(tmp_path)
    assert (
        service.query(
            "policy-observations",
            DatasetQuery(filters=[DatasetFilter(column="available", value=1)]),
        )["total"]
        == 0
    )
    assert (
        service.query(
            "policy-observations",
            DatasetQuery(filters=[DatasetFilter(column="available", value=True)]),
        )["total"]
        == 1
    )
    with pytest.raises(ValueError):
        DatasetFilter(column="value", op="gte", value="100")
    with pytest.raises(ValueError):
        DatasetFilter(column="value", op="in", value="100")


@pytest.mark.parametrize(
    "query",
    [
        DatasetQuery(sort="unknown"),
        DatasetQuery(columns=["unknown"]),
        DatasetQuery(filters=[DatasetFilter(column="unknown", value=1)]),
    ],
)
def test_unknown_columns_are_rejected(tmp_path, query):
    with pytest.raises(ValueError, match="Unknown columns"):
        _service(tmp_path).query("policy-observations", query)


def test_chart_aggregates_full_filtered_data_and_tracks_missing_measures(tmp_path):
    service = _service(tmp_path)
    chart = service.chart(
        "policy-observations",
        ChartRequest(
            group_by="geography",
            measure="value",
            aggregation="sum",
            limit=1,
            filters=[DatasetFilter(column="unit", value="movements")],
        ),
    )
    assert chart["matched_rows"] == 5
    assert chart["total_groups"] == 3
    assert chart["truncated"] is True
    full = service.chart(
        "policy-observations",
        ChartRequest(
            group_by="geography",
            measure="value",
            aggregation="mean",
            filters=[DatasetFilter(column="unit", value="movements")],
        ),
    )
    male = next(item for item in full["items"] if item["group"] == "Malé")
    villi = next(item for item in full["items"] if item["group"] == "Vilimale")
    assert male["value"] == 75
    assert villi["value"] == 20
    assert villi["missing_measure_count"] == 1


def test_mixed_units_cannot_be_summed_without_explicit_scope(tmp_path):
    service = _service(tmp_path)
    with pytest.raises(ValueError, match="Mixed units"):
        service.chart(
            "policy-observations",
            ChartRequest(group_by="geography", measure="value", aggregation="sum"),
        )
    grouped = service.chart(
        "policy-observations", ChartRequest(group_by="unit", measure="value", aggregation="sum")
    )
    assert next(item for item in grouped["items"] if item["group"] == "MVR")["value"] == 1000
    counts = service.chart(
        "policy-observations", ChartRequest(group_by="unit", aggregation="count")
    )
    assert sum(item["value"] for item in counts["items"]) == 6


def test_all_missing_measures_are_null_and_count_is_record_count(tmp_path):
    service = _service(tmp_path)
    chart = service.chart(
        "policy-observations",
        ChartRequest(
            group_by="geography",
            measure="value",
            aggregation="sum",
            filters=[DatasetFilter(column="value", op="missing")],
        ),
    )
    assert chart["items"][0]["value"] is None
    assert chart["items"][0]["missing_measure_count"] == 1
    count = service.chart(
        "policy-observations", ChartRequest(group_by="geography", aggregation="count")
    )
    assert sum(item["value"] for item in count["items"]) == 6


def test_csv_exports_all_filtered_rows_and_neutralizes_formula_strings(tmp_path):
    service = _service(tmp_path)
    csv_text = service.csv(
        "policy-observations", DatasetQuery(limit=1, columns=["geography", "value"], sort="value")
    )
    records = list(csv.DictReader(io.StringIO(csv_text)))
    assert len(records) == 6
    assert any(row["geography"].startswith("'=HYPERLINK") for row in records)
    assert service.query("policy-observations", DatasetQuery(q="HYPERLINK"))["items"][0][
        "geography"
    ].startswith("=")


def test_source_change_invalidates_table_and_checksum(tmp_path):
    service = _service(tmp_path)
    first = service.schema("policy-observations")
    path = service.public_dir / "policy-evidence" / "bundle.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["observations"].append({"id": "new", "value": 42})
    path.write_text(json.dumps(data), encoding="utf-8")
    second = service.schema("policy-observations")
    assert second["row_count"] == first["row_count"] + 1
    assert second["provenance"]["receipt"]["sha256"] != first["provenance"]["receipt"]["sha256"]


def test_real_catalogue_preserves_all_source_backed_collections():
    root = Path(__file__).resolve().parents[2]
    service = DatasetService(root / "data" / "public", root / "backend" / "data")
    catalogue = service.catalogue()
    assert catalogue["total"] >= 38
    assert catalogue["available"] == catalogue["total"]
    datasets = {item["id"]: item for item in catalogue["items"]}
    assert datasets["passenger-monthly"]["row_count"] == 161
    assert datasets["national-facilities"]["row_count"] == 840
    assert datasets["resident-origins"]["row_count"] == 667
    assert datasets["road-events"]["row_count"] == 0
    assert datasets["airport-observations"]["row_count"] == 210


def test_routes_validate_columns_query_json_and_numeric_chart_measure(tmp_path):
    service = _service(tmp_path)
    app = FastAPI()
    app.state.settings = SimpleNamespace(
        public_data_dir=service.public_dir, data_dir=service.runtime_dir
    )
    app.include_router(router)
    client = TestClient(app)
    assert (
        client.get("/api/v1/datasets/policy-observations/rows?filters=invalid").status_code == 422
    )
    assert client.get("/api/v1/datasets/unknown/rows").status_code == 404
    assert client.get("/api/v1/datasets/policy-observations/rows?sort=unknown").status_code == 422
    assert (
        client.post(
            "/api/v1/datasets/policy-observations/chart",
            json={"group_by": "unit", "aggregation": "sum"},
        ).status_code
        == 422
    )
    result = client.get("/api/v1/datasets/policy-observations/export.csv")
    assert result.status_code == 200
    assert "attachment" in result.headers["content-disposition"]


def _comparison_request(mode="indexed", alignment="common"):
    primary = ChartSource(
        dataset_id="policy-observations",
        query=ChartRequest(
            group_by="geography",
            measure="value",
            aggregation="sum",
            filters=[DatasetFilter(column="unit", value="movements")],
        ),
    )
    comparison = ChartSource(
        dataset_id="policy-observations",
        query=ChartRequest(
            group_by="geography",
            measure="value",
            aggregation="mean",
            filters=[
                DatasetFilter(column="unit", value="movements"),
                DatasetFilter(column="geography", value="Malé"),
            ],
        ),
    )
    return ChartComparisonRequest(
        primary=primary, comparison=comparison, mode=mode, alignment=alignment
    )


def test_indexed_comparison_uses_a_positive_shared_base_and_retains_both_receipts(tmp_path):
    result = _service(tmp_path).compare(_comparison_request())
    assert result["base_key"] == "Malé"
    assert len(result["items"]) == 2
    assert {item["value"] for item in result["items"]} == {100}
    assert {item["raw_value"] for item in result["items"]} == {75, 150}
    assert len(result["datasets"]) == 2
    assert len({item["series"] for item in result["items"]}) == 2


def test_union_comparison_keeps_unobserved_keys_missing(tmp_path):
    result = _service(tmp_path).compare(_comparison_request(alignment="union"))
    absent = [
        item
        for item in result["items"]
        if item["group"] == "Vilimale" and item["series"].startswith("B")
    ]
    assert len(absent) == 1
    assert absent[0]["value"] is None
    assert absent[0]["raw_value"] is None
    assert absent[0]["row_count"] == 0


def test_raw_comparison_cannot_share_different_units_and_keys_require_declared_grain(tmp_path):
    service = _service(tmp_path)
    request = _comparison_request(mode="values")
    request.comparison.query.filters = [DatasetFilter(column="unit", value="MVR")]
    with pytest.raises(ValueError, match="Different units"):
        service.compare(request)
    request = _comparison_request()
    request.key_domain = "calendar-month"
    with pytest.raises(ValueError, match="calendar grain"):
        service.compare(request)
    request.key_domain = "island-id"
    with pytest.raises(ValueError, match="identifier"):
        service.compare(request)


def test_comparison_does_not_silently_align_truncated_charts(tmp_path):
    request = _comparison_request()
    request.primary.query.limit = 1
    with pytest.raises(ValueError, match="complete groups"):
        _service(tmp_path).compare(request)
