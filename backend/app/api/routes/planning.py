"""Planning policy endpoints, with no mutation of national source data."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.planning.calibration import (
    FACTOR_UNITS,
    CalibrationImport,
    TariffRequest,
    receipt,
    tariff_delta,
)
from app.planning.economics import COST_DEFAULTS
from app.planning.models import JourneyRequest, PlanningRequest
from app.planning.opportunities import BudgetSuggestionRequest, OpportunityService
from app.planning.repository import PlanningRepository
from app.planning.service import PlanningService

router = APIRouter(prefix="/api/v1/planning", tags=["policy-planning"])


def delivery_references(request: Request) -> dict[str, Any]:
    settings = getattr(request.app.state, "settings", None)
    public_dir = (
        settings.public_data_dir
        if settings
        else Path(__file__).resolve().parents[4] / "data/public"
    )
    path = public_dir / "delivery-evidence/references.json"
    return json.loads(path.read_text(encoding="utf8")) if path.exists() else {}


@router.get("/calibration")
def calibration_catalog(request: Request) -> dict[str, Any]:
    return {
        "factors": [
            {"key": key, "unit": unit, "illustrative_default": COST_DEFAULTS.get(key)}
            for key, unit in FACTOR_UNITS.items()
        ],
        "references": delivery_references(request),
        "meaning": "Upload local quotations/measurements with source, scope and validity. "
        "Defaults are illustrations; uploaded official labels are user claims, not certification.",
    }


@router.post("/calibration/validate")
def validate_calibration(payload: CalibrationImport) -> dict[str, Any]:
    return {
        "status": "validated",
        "records": [receipt(record) for record in payload.records],
        "warnings": [
            "Units and schema validated. Linked documents and geography are not "
            "independently verified. Select records explicitly in a scenario."
        ],
    }


@router.post("/calibration/tariff")
def calculate_tariff(payload: TariffRequest, request: Request) -> dict[str, Any]:
    references = delivery_references(request)
    if not references.get("tariffs"):
        raise HTTPException(
            status_code=503, detail="Official delivery reference snapshot unavailable"
        )
    return tariff_delta(payload, references)


@lru_cache(maxsize=1)
def default_service() -> PlanningService:
    return PlanningService(PlanningRepository(Path(__file__).resolve().parents[4] / "data/public"))


def get_planning(request: Request) -> PlanningService:
    return getattr(request.app.state, "planning", None) or default_service()


def get_opportunities(
    request: Request, service: PlanningService = Depends(get_planning)
) -> OpportunityService:
    existing = getattr(request.app.state, "planning_opportunities", None)
    accessibility = getattr(request.app.state, "accessibility", None)
    if existing is None or existing.planning is not service:
        existing = OpportunityService(service, accessibility)
        request.app.state.planning_opportunities = existing
    return existing


@router.get("/opportunities")
def opportunities(
    include_geometry: bool = True, service: OpportunityService = Depends(get_opportunities)
) -> dict[str, Any]:
    return service.overview(include_geometry=include_geometry)


@router.post("/opportunities/suggest")
def suggest_opportunities(
    payload: BudgetSuggestionRequest,
    service: OpportunityService = Depends(get_opportunities),
) -> dict[str, Any]:
    try:
        return service.suggest(payload)
    except (ValueError, KeyError, TypeError, IndexError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/opportunities/{island_id}")
def island_opportunities(
    island_id: str, service: OpportunityService = Depends(get_opportunities)
) -> dict[str, Any]:
    result = service.detail(island_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Island not found in the opportunity inventory")
    return result


@router.get("/baseline")
def baseline(
    island_id: str | None = None, service: PlanningService = Depends(get_planning)
) -> dict[str, Any]:
    return service.baseline(island_id)


def invoke(service: PlanningService, method: str, payload: PlanningRequest) -> dict[str, Any]:
    try:
        return getattr(service, method)(payload)
    except (ValueError, KeyError, TypeError, IndexError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/evaluate")
def evaluate(
    payload: PlanningRequest, service: PlanningService = Depends(get_planning)
) -> dict[str, Any]:
    return invoke(service, "evaluate", payload)


@router.post("/quote")
def quote(
    payload: PlanningRequest, service: PlanningService = Depends(get_planning)
) -> dict[str, Any]:
    return invoke(service, "quote", payload)


@router.post("/journey")
def journey(
    payload: JourneyRequest, service: PlanningService = Depends(get_planning)
) -> dict[str, Any]:
    return invoke(service, "journey", payload)


@router.post("/timetable")
def timetable(
    payload: PlanningRequest, service: PlanningService = Depends(get_planning)
) -> dict[str, Any]:
    return invoke(service, "timetable", payload)


@router.post("/fleet")
def fleet(
    payload: PlanningRequest, service: PlanningService = Depends(get_planning)
) -> dict[str, Any]:
    return invoke(service, "fleet", payload)
