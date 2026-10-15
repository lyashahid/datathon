"""Chronology, source integrity, uncertainty and immutable issuance regression checks."""

import copy
import json
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.analytics.service import DatasetService
from app.api.routes.forecasts import router
from app.forecasting.engine import forecast_series, index_month, month_index, point_forecast
from app.forecasting.service import ForecastService


def _series(values=None):
    values = values or [100 + (number % 12) * 15 + number * 2 for number in range(60)]
    return {
        "id": "bus-test",
        "name": "Test published category",
        "mode": "bus",
        "geography": "Example aggregate",
        "unit": "passenger movements",
        "sourceUrl": "https://example.test/official.xlsx",
        "qualification": "Test fixture",
        "lastActualMonth": index_month(month_index("2021-01") + len(values) - 1),
        "points": [
            {"month": index_month(month_index("2021-01") + index), "value": value}
            for index, value in enumerate(values)
        ],
    }


def _source(directory, series=None):
    directory.mkdir(parents=True, exist_ok=True)
    source = {
        "asOf": "2026-01-10T00:00:00+00:00",
        "series": [series or _series()],
        "sourceIds": ["official"],
        "dataQualityNotes": ["Revised-vintage test fixture"],
        "audit": {
            "publishedAt": "2026-01-09",
            "transformVersion": "test-v1",
            "sources": {
                "official": {
                    "url": "https://example.test/official.xlsx",
                    "sha256": "a" * 64,
                    "publication_sheet": "January",
                }
            },
        },
    }
    (directory / "prediction-source.json").write_text(json.dumps(source), encoding="utf-8")
    return source


def test_backtest_uses_the_same_source_for_calculation_and_provenance(tmp_path, monkeypatch):
    public = tmp_path / "public"
    _source(public)
    service = ForecastService(public, tmp_path / "runtime")
    first = service.source()
    revised = copy.deepcopy(first)
    revised["receipt"]["sha256"] = "b" * 64
    reads = []

    def changing_source():
        reads.append(True)
        return first if len(reads) == 1 else revised

    monkeypatch.setattr(service, "source", changing_source)
    result = service.backtest("bus-test", 1)
    assert len(reads) == 1
    assert result["provenance"]["receipt"]["sha256"] == first["receipt"]["sha256"]


def test_models_only_use_available_prefix_and_baselines_are_exact():
    values = list(range(1, 37))
    assert point_forecast(values, 5, "last-month") == 36
    assert point_forecast(values, 5, "seasonal-naive") == 29
    assert point_forecast(values, 13, "seasonal-naive") == 25
    assert point_forecast(values, 2, "mean-3-months") == 35


@pytest.mark.parametrize("horizon", [1, 4, 8, 12])
def test_selection_targets_are_available_at_first_evaluation_origin(horizon):
    series = _series()
    target = index_month(month_index(series["lastActualMonth"]) + horizon)
    result = forecast_series(series, target)
    assert result["status"] == "exploratory"
    assert len(result["benchmarks"]) == 10
    assert len(result["backtest"]) == 6
    assert (
        result["selection"]["lastTargetMonth"]
        <= result["selection"]["firstEvaluationTrainingCutoff"]
    )
    for row in result["backtest"]:
        assert month_index(row["targetMonth"]) - month_index(row["trainingCutoff"]) == horizon
        prefix = [
            point["value"] for point in series["points"] if point["month"] <= row["trainingCutoff"]
        ]
        assert row["estimate"] == pytest.approx(
            point_forecast(prefix, horizon, result["model"], result["parameters"])
        )


def test_future_evaluation_actuals_cannot_change_model_selection_or_calibration():
    series = _series()
    forecast = forecast_series(series, "2026-04")
    changed = copy.deepcopy(series)
    for point in changed["points"][-6:]:
        point["value"] *= 10
    revised = forecast_series(changed, "2026-04")
    assert forecast["model"] == revised["model"]
    assert forecast["selection"] == revised["selection"]
    assert (
        forecast["empiricalRange"]["calibrationCutoff"]
        == revised["empiricalRange"]["calibrationCutoff"]
    )
    # Coverage is evaluated honestly on those held-out outcomes rather than recalibrated to them.
    assert forecast["evaluation"]["mae"] != revised["evaluation"]["mae"]


@pytest.mark.parametrize("horizon", [1, 3, 6, 12])
def test_three_partitions_respect_observable_targets_and_calibration_is_separate(horizon):
    series = _series()
    result = forecast_series(series, index_month(month_index(series["lastActualMonth"]) + horizon))
    selection = result["selection"]
    calibration = result["calibration"]
    assert selection["lastTargetMonth"] <= selection["firstEvaluationTrainingCutoff"]
    if calibration:
        assert selection["lastTargetMonth"] <= calibration[0]["trainingCutoff"]
        assert calibration[-1]["targetMonth"] <= result["backtest"][0]["trainingCutoff"]
        assert result["empiricalRange"]["residualCount"] == len(calibration)
        assert not set(row["targetMonth"] for row in calibration).intersection(
            row["targetMonth"] for row in result["backtest"]
        )
    else:
        assert result["empiricalRange"] is None


def test_calibration_outcomes_change_range_but_cannot_choose_the_policy():
    series = _series()
    target = "2026-01"
    original = forecast_series(series, target)
    changed = copy.deepcopy(series)
    calibration_months = {row["targetMonth"] for row in original["calibration"]}
    for point in changed["points"]:
        if point["month"] in calibration_months:
            point["value"] *= 10
    recalibrated = forecast_series(changed, target)
    assert original["model"] == recalibrated["model"]
    assert original["parameters"] == recalibrated["parameters"]
    assert original["selection"] == recalibrated["selection"]
    assert original["empiricalRange"]["radius"] != recalibrated["empiricalRange"]["radius"]


def test_ensemble_requires_pre_evaluation_weights_and_complexity_guard_is_visible():
    with pytest.raises(ValueError, match="frozen ensemble"):
        point_forecast(list(range(1, 40)), 3, "selection-ensemble")
    values = list(range(1, 40))
    weights = {"last-month": 0.25, "mean-3-months": 0.75}
    assert point_forecast(values, 3, "selection-ensemble", {"weights": weights}) == 38.25
    result = forecast_series(_series(), "2026-01")
    assert result["selection"]["complexityImprovementRequired"] == 0.05
    if result["model"] not in ("last-month", "seasonal-naive", "mean-3-months", "mean-6-months"):
        assert result["selection"]["candidateImprovement"] >= 0.05


@pytest.mark.parametrize("change", ["gap", "duplicate", "negative", "boolean"])
def test_bad_monthly_history_never_gets_silently_imputed(change):
    series = _series()
    if change == "gap":
        series["points"].pop(10)
    elif change == "duplicate":
        series["points"][10]["month"] = series["points"][9]["month"]
    elif change == "negative":
        series["points"][10]["value"] = -1
    else:
        series["points"][10]["value"] = True
    result = forecast_series(series, "2026-04")
    assert result["status"] == "unavailable"
    assert result["estimate"] is None
    assert result["unavailableReason"]


def test_zero_counts_have_defined_metrics_and_short_history_is_unavailable():
    result = forecast_series(_series([0] * 60), "2026-04")
    assert result["evaluation"]["mae"] == 0
    assert result["evaluation"]["wape"] is None
    assert result["evaluation"]["skill"]["lastMonth"] is None
    short = _series(list(range(20)))
    assert forecast_series(short, "2022-10")["status"] == "unavailable"


def test_frozen_issue_is_idempotent_and_tampering_is_rejected(tmp_path):
    source_dir = tmp_path / "public"
    _source(source_dir)
    service = ForecastService(source_dir, tmp_path / "runtime")
    now = datetime(2026, 1, 14, tzinfo=timezone.utc)
    first = service.issue_forecast("2026-04", now=now)
    second = service.issue_forecast("2026-04", now=now)
    assert first["created"] is True and second["created"] is False
    assert first["issue"] == second["issue"]
    assert first["scores"][0]["status"] == "pending"
    path = service.runtime_dir / (first["issue"]["id"] + ".json")
    issue = json.loads(path.read_text(encoding="utf-8"))
    issue["forecasts"][0]["estimate"] += 1
    path.write_text(json.dumps(issue), encoding="utf-8")
    with pytest.raises(ValueError, match="integrity"):
        service.issue(first["issue"]["id"])


def test_issue_requires_current_target_and_complete_nonfuture_provenance(tmp_path):
    _source(tmp_path)
    service = ForecastService(tmp_path, tmp_path / "runtime")
    now = datetime(2026, 1, 14, tzinfo=timezone.utc)
    with pytest.raises(ValueError, match="Past"):
        service.issue_forecast("2025-12", now=now)
    with pytest.raises(ValueError, match="future"):
        service.issue_forecast("2026-04", now=datetime(2026, 1, 1, tzinfo=timezone.utc))


def test_later_vintage_scoring_requires_matching_category_and_later_publication(tmp_path):
    source = _source(tmp_path)
    service = ForecastService(tmp_path, tmp_path / "runtime")
    issue = service.issue_forecast("2026-04", now=datetime(2026, 1, 14, tzinfo=timezone.utc))[
        "issue"
    ]
    for month in ("2026-01", "2026-02", "2026-03", "2026-04"):
        source["series"][0]["points"].append({"month": month, "value": 400})
    source["series"][0]["lastActualMonth"] = "2026-04"
    source["audit"]["publishedAt"] = "2026-05-07"
    (tmp_path / "prediction-source.json").write_text(json.dumps(source), encoding="utf-8")
    assert service.issue(issue["id"])["scores"][0]["status"] == "later-vintage-score"
    source["series"][0]["geography"] = "Different category geography"
    (tmp_path / "prediction-source.json").write_text(json.dumps(source), encoding="utf-8")
    assert service.issue(issue["id"])["scores"][0]["status"] == "ineligible"


def test_real_audited_bus_quarantine_and_legacy_issue_integrity():
    public_dir = Path(__file__).resolve().parents[2] / "data" / "public"
    service = ForecastService(public_dir, public_dir / "unused-runtime")
    source = service.source()
    bus = next(item for item in source["series"] if item["mode"] == "bus")
    assert bus["lastActualMonth"] == "2026-05"
    assert all(point["month"] != "2026-06" for point in bus["points"])
    assert all(item["integrityVerified"] for item in service.issues())


def test_forecast_routes_reject_invalid_and_unknown_inputs(tmp_path):
    _source(tmp_path)
    app = FastAPI()
    app.state.settings = SimpleNamespace(public_data_dir=tmp_path, data_dir=tmp_path / "runtime")
    app.include_router(router)
    client = TestClient(app)
    assert client.get("/api/v1/forecasts?target_month=2026-13").status_code == 422
    assert client.get("/api/v1/forecasts/series/unknown").status_code == 404
    assert (
        client.get("/api/v1/forecasts/backtests/bus-test?horizon_months=4").json()["status"]
        == "exploratory"
    )
    assert (
        client.post(
            "/api/v1/forecasts/issues", json={"target_month": "2026-04", "extra": 1}
        ).status_code
        == 422
    )


def _official_import(source):
    incoming = copy.deepcopy(source)
    incoming["asOf"] = "2026-10-14T00:00:00+00:00"
    incoming["audit"]["publishedAt"] = "2026-09-07"
    incoming["audit"]["sources"]["official"]["url"] = (
        "https://statisticsmaldives.gov.mv/mbs/MIF.xlsx"
    )
    incoming["series"][0]["sourceUrl"] = "https://statisticsmaldives.gov.mv/mbs/MIF.xlsx"
    incoming["series"][0]["points"].append({"month": "2026-01", "value": 400})
    incoming["series"][0]["lastActualMonth"] = "2026-01"
    return incoming


def test_passenger_import_requires_review_preserves_original_and_frozen_issues(tmp_path):
    baseline = _source(tmp_path)
    original = (tmp_path / "prediction-source.json").read_bytes()
    service = ForecastService(tmp_path, tmp_path / "runtime")
    frozen = service.issue_forecast("2026-04", now=datetime(2026, 1, 14, tzinfo=timezone.utc))
    incoming = _official_import(baseline)
    staged = service.stage_source(incoming)
    assert service.source()["series"][0]["lastActualMonth"] == "2025-12"
    assert staged["differences"][0]["addedMonths"] == [{"month": "2026-01", "value": 400}]
    accepted = service.accept_source(
        staged["versionId"], "Checked the official monthly table and definitions.", False
    )
    assert accepted["review"]
    assert service.source()["receipt"]["data_status"] == "user_reviewed_import"
    assert service.source()["series"][0]["lastActualMonth"] == "2026-01"
    assert (
        DatasetService(tmp_path, tmp_path / "runtime").schema("passenger-monthly")["row_count"]
        == 61
    )
    assert (tmp_path / "prediction-source.json").read_bytes() == original
    assert service.issue(frozen["issue"]["id"])["issue"] == frozen["issue"]
    assert (
        service.accept_source(
            staged["versionId"], "Repeated review of the same accepted source.", False
        )["versionId"]
        == staged["versionId"]
    )


def test_passenger_import_revision_guard_and_integrity(tmp_path):
    baseline = _source(tmp_path)
    service = ForecastService(tmp_path, tmp_path / "runtime")
    incoming = _official_import(baseline)
    incoming["series"][0]["points"][10]["value"] += 1
    staged = service.stage_source(incoming)
    with pytest.raises(ValueError, match="Historical revisions"):
        service.accept_source(
            staged["versionId"], "Reviewed new actuals but not historical revisions.", False
        )
    service.accept_source(
        staged["versionId"], "Reviewed the revised October count against publication.", True
    )
    path = service.source_versions.directory / (staged["versionId"] + ".json")
    stored = json.loads(path.read_text(encoding="utf-8"))
    stored["source"]["series"][0]["points"][0]["value"] += 10
    path.write_text(json.dumps(stored), encoding="utf-8")
    with pytest.raises(ValueError, match="integrity"):
        service.source()


def test_restaging_after_active_vintage_changes_preserves_the_original_review_context(tmp_path):
    baseline = _source(tmp_path)
    service = ForecastService(tmp_path, tmp_path / "runtime")
    first_source = _official_import(baseline)
    first = service.stage_source(first_source)
    second_source = copy.deepcopy(first_source)
    second_source["series"][0]["points"][-1]["value"] += 10
    second = service.stage_source(second_source)
    service.accept_source(
        second["versionId"], "Reviewed the later official passenger count.", False
    )
    with pytest.raises(ValueError, match="active source changed"):
        service.accept_source(
            first["versionId"], "Reviewed against the old passenger source.", False
        )
    restaged = service.stage_source(first_source)
    assert restaged["versionId"] != first["versionId"]
    assert restaged["differences"][0]["revisionCount"] == 1
    service.accept_source(
        restaged["versionId"], "Reviewed the change against the current source.", True
    )
    assert service.source_versions.get(first["versionId"])["review"] is None


@pytest.mark.parametrize(
    "problem",
    [
        "authority",
        "checksum",
        "definition",
        "gap",
        "remove",
        "duplicate-id",
        "naive",
        "future",
        "point-type",
        "points-type",
    ],
)
def test_import_contract_rejects_unverifiable_or_incompatible_sources(tmp_path, problem):
    baseline = _source(tmp_path)
    service = ForecastService(tmp_path, tmp_path / "runtime")
    incoming = _official_import(baseline)
    if problem == "authority":
        incoming["series"][0]["sourceUrl"] = "https://example.test/random.xlsx"
    elif problem == "checksum":
        incoming["audit"]["sources"]["official"]["sha256"] = "invalid"
    elif problem == "definition":
        incoming["series"][0]["unit"] = "unique riders"
    elif problem == "gap":
        incoming["series"][0]["points"].pop(10)
    elif problem == "remove":
        incoming["series"][0]["points"].pop(0)
    elif problem == "duplicate-id":
        incoming["series"].append(copy.deepcopy(incoming["series"][0]))
    elif problem == "naive":
        incoming["asOf"] = "2026-10-14T00:00:00"
    elif problem == "point-type":
        incoming["series"][0]["points"][0] = None
    elif problem == "points-type":
        incoming["series"][0]["points"] = "invalid"
    else:
        incoming["audit"]["publishedAt"] = "2099-10-14"
    with pytest.raises(ValueError):
        service.stage_source(incoming)


def test_all_collection_analysis_profiles_sources_without_fabricated_covariates():
    root = Path(__file__).resolve().parents[2]
    service = ForecastService(root / "data" / "public", root / "backend" / "data")
    report = service.analysis()
    assert report["summary"]["availableCollections"] == 38
    assert report["summary"]["passengerObservations"] == 161
    assert report["summary"]["collectionsWithExactDuplicates"] == []
    assert len(report["horizonDiagnostics"]) == 36
    assert all(
        item["forecastFitness"] == "context-only"
        for item in report["collectionProfiles"]
        if item["id"] != "passenger-monthly"
    )
    population = next(
        item for item in report["collectionProfiles"] if item["id"] == "national-population"
    )
    assert population["geographyCoverage"]["mappedIslands"] == 190
