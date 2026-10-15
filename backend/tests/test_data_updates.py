"""Source checks and national itineraries respect provenance, dates and review boundaries."""

import asyncio
import copy
import json
from datetime import datetime
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.routes.data_updates import get_service, router
from app.data_updates.models import NationalJourney, ScheduleAccept, ScheduleSnapshot
from app.data_updates.service import DataUpdateService


@pytest.fixture
def service(tmp_path):
    repository = SimpleNamespace(
        islands_by_id={f"island:{i}": {"properties": {"name": f"Island {i}"}} for i in range(1, 5)}
    )
    return DataUpdateService(tmp_path / "public", tmp_path, repository)


def snapshot(**changes):
    payload = {
        "schema_version": 1,
        "title": "Reviewed fixture timetable",
        "timezone": "Indian/Maldives",
        "sources": [
            {
                "publisher": "RTL fixture",
                "url": "https://rtl.mv/",
                "retrieved_at": "2026-10-01T00:00:00Z",
                "reference_period": "October 2026",
                "licence_note": "Test fixture; not a live source",
            }
        ],
        "services": [
            {
                "id": "trip-1",
                "name": "Fixture outward",
                "mode": "ferry",
                "from_island_id": "island:1",
                "to_island_id": "island:2",
                "from_terminal": "Terminal A",
                "to_terminal": "Terminal B",
                "departure": "08:00",
                "arrival": "09:00",
                "timing_basis": "published_arrival",
                "weekdays": [1, 2, 3, 4, 5, 6, 7],
                "effective_from": "2026-10-01",
                "effective_until": "2026-10-31",
            }
        ],
    }
    payload["services"][0].update(changes)
    return ScheduleSnapshot.model_validate(payload)


def query(**changes):
    payload = {
        "from_island_id": "island:1",
        "to_island_id": "island:2",
        "departure_at": "2026-10-14T07:30:00+05:00",
        "max_hours": 24,
    }
    payload.update(changes)
    return NationalJourney.model_validate(payload)


def accept(service, body):
    stage = service.stage(body)
    return service.accept(
        stage["id"], ScheduleAccept(reviewed=True, review_note="Reviewed fixture source")
    )


def test_stage_does_not_enable_routing(service):
    result = service.stage(snapshot())
    assert result["review"]["services"] == 1
    assert service.catalogue()["total"] == 0
    assert service.journey(query())["status"] == "no_verified_itinerary"


def test_reviewed_journey_uses_mvt_and_waiting(service):
    accept(service, snapshot())
    result = service.journey(query())
    assert result["status"] == "found"
    assert result["arrival_at"] == "2026-10-14T09:00:00+05:00"
    assert result["elapsed_minutes"] == 90
    assert result["legs"][0]["waiting_minutes"] == 30
    assert result["includes_assumptions"] is False


def test_utc_departure_resolves_to_same_local_schedule(service):
    accept(service, snapshot())
    assert (
        service.journey(query(departure_at="2026-10-14T02:30:00Z"))["arrival_at"]
        == "2026-10-14T09:00:00+05:00"
    )


@pytest.mark.parametrize(
    "changes",
    [{"weekdays": [5]}, {"effective_until": "2026-10-13"}, {"effective_from": "2026-10-16"}],
)
def test_calendar_excludes_unavailable_departures(service, changes):
    accept(service, snapshot(**changes))
    assert service.journey(query())["status"] == "no_verified_itinerary"


def test_missed_departure_waits_for_next_valid_day(service):
    accept(service, snapshot())
    result = service.journey(query(departure_at="2026-10-14T08:01:00+05:00", max_hours=30))
    assert result["arrival_at"] == "2026-10-15T09:00:00+05:00"


def test_overnight_arrival_is_not_relabelled_as_departure_day(service):
    accept(service, snapshot(departure="23:30", arrival="00:30", arrival_day_offset=1))
    result = service.journey(query(departure_at="2026-10-14T23:00:00+05:00"))
    assert result["arrival_at"] == "2026-10-15T00:30:00+05:00"


def test_assumed_runtime_requires_opt_in(service):
    accept(service, snapshot(arrival=None, runtime_minutes=75, timing_basis="assumed_runtime"))
    assert service.journey(query())["status"] == "no_verified_itinerary"
    result = service.journey(query(include_assumed_runtimes=True))
    assert result["arrival_at"] == "2026-10-14T09:15:00+05:00"
    assert result["includes_assumptions"] is True


def test_transfer_allowance_can_change_itinerary(service):
    payload = snapshot().model_dump(mode="json")
    onward = {
        **payload["services"][0],
        "id": "trip-2",
        "name": "Fixture onward",
        "from_island_id": "island:2",
        "to_island_id": "island:3",
        "departure": "09:20",
        "arrival": "10:00",
    }
    payload["services"].append(onward)
    accept(service, ScheduleSnapshot.model_validate(payload))
    assert (
        service.journey(query(to_island_id="island:3", transfer_minutes=30, max_hours=3))["status"]
        == "no_verified_itinerary"
    )
    result = service.journey(query(to_island_id="island:3", transfer_minutes=10, max_hours=3))
    assert result["arrival_at"] == "2026-10-14T10:00:00+05:00"
    assert len(result["legs"]) == 2
    assert (
        service.journey(query(to_island_id="island:3", max_transfers=0, max_hours=3))["status"]
        == "no_verified_itinerary"
    )


def test_snapshot_versions_preserve_prior_receipts(service):
    original = accept(service, snapshot())
    updated = service.stage(snapshot(arrival="10:00"))
    assert updated["review"]["replaces_service_ids"] == ["trip-1"]
    service.accept(
        updated["id"], ScheduleAccept(reviewed=True, review_note="Reviewed revised arrival")
    )
    assert len(service.catalogue()["snapshots"]) == 2
    assert service.catalogue()["total"] == 1
    assert service.journey(query())["arrival_at"].endswith("10:00:00+05:00")
    assert original["snapshot"]["services"][0]["arrival"] == "09:00:00"


def test_idempotent_stage_and_accept_preserve_first_review(service):
    first = accept(service, snapshot())
    assert service.stage(snapshot())["id"] == first["id"]
    second = service.accept(
        first["id"], ScheduleAccept(reviewed=True, review_note="Different later review")
    )
    assert second["accepted_at"] == first["accepted_at"]
    assert second["review_note"] == first["review_note"]


def test_tampered_schedule_receipt_is_rejected(service):
    record = accept(service, snapshot())
    path = service.runtime / "schedules" / (record["id"] + ".json")
    record["snapshot"]["services"][0]["arrival"] = "11:00:00"
    path.write_text(json.dumps(record), "utf-8")
    with pytest.raises(ValueError, match="integrity"):
        service.catalogue()


def test_corrupt_timetable_receipt_returns_readable_api_error(service):
    record = accept(service, snapshot())
    path = service.runtime / "schedules" / (record["id"] + ".json")
    record["snapshot"]["services"][0]["arrival"] = "11:00:00"
    path.write_text(json.dumps(record), "utf-8")
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_service] = lambda: service
    with TestClient(app) as client:
        for endpoint in ("/api/v1/data-updates", "/api/v1/data-updates/schedules"):
            response = client.get(endpoint)
            assert response.status_code == 422
            assert "integrity" in response.json()["detail"]


def test_unknown_island_is_rejected_without_storing(service):
    with pytest.raises(ValueError, match="Unknown OneMap"):
        service.stage(snapshot(to_island_id="island:999"))
    assert not (service.runtime / "schedules").exists()


@pytest.mark.parametrize(
    "changes",
    [
        {"arrival": "07:00"},
        {"weekdays": [1, 1]},
        {"weekdays": [0]},
        {"arrival": None},
        {"runtime_minutes": 60},
        {"departure": "08:00:15"},
        {"from_island_id": "island:2"},
    ],
)
def test_bad_timetable_semantics_fail_validation(changes):
    with pytest.raises(ValidationError):
        snapshot(**changes)


def test_receipt_requires_official_source_and_aware_time():
    payload = snapshot().model_dump(mode="json")
    for changes in (
        {"url": "https://reseller.example/schedule"},
        {"url": "javascript:alert(1)"},
        {"retrieved_at": "2026-10-01T00:00:00"},
    ):
        invalid = copy.deepcopy(payload)
        invalid["sources"][0].update(changes)
        with pytest.raises(ValidationError):
            ScheduleSnapshot.model_validate(invalid)
    with pytest.raises(ValidationError):
        ScheduleAccept.model_validate({"reviewed": False, "review_note": "Cannot accept unchecked"})
    with pytest.raises(ValidationError):
        query(departure_at=datetime(2026, 10, 14, 7, 30))


def test_official_index_check_finds_latest_not_first_release(service):
    async def run():
        async def response(request):
            return httpx.Response(
                200, text="Maldives in Figures – May 2026 Maldives in Figures - June 2026"
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            return await service._check_one(client, service.sources[0])

    result = asyncio.run(run())
    assert result["status"] == "no_new_release"
    assert result["latest_published_month"] == "2026-06"
    assert result["sha256"]


def test_failed_publisher_check_does_not_claim_freshness(service):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda req: httpx.Response(403))
        ) as client:
            return await service._check_one(client, service.sources[0])

    result = asyncio.run(run())
    assert result["status"] == "unavailable"
    assert "sha256" not in result
