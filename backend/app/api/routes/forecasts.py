"""Passenger outlook, chronological evaluation and frozen forecast receipt endpoints."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.analytics.sources import public_data_directory
from app.forecasting.models import (
    ForecastIssueRequest,
    ForecastSourceAcceptRequest,
    ForecastSourceStageRequest,
)
from app.forecasting.service import ForecastService

router = APIRouter(prefix="/api/v1/forecasts", tags=["passenger-forecasts"])


def get_service(request: Request) -> ForecastService:
    if not hasattr(request.app.state, "forecasts"):
        settings = request.app.state.settings
        request.app.state.forecasts = ForecastService(
            public_data_directory(settings), settings.data_dir
        )
    return request.app.state.forecasts


def _invoke(method: Any, *args: Any, **kwargs: Any) -> Any:
    try:
        return method(*args, **kwargs)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error).strip("'")) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("")
def forecast_bundle(
    target_month: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    service: ForecastService = Depends(get_service),
) -> dict[str, Any]:
    return _invoke(service.bundle, target_month)


@router.get("/series")
def list_series(service: ForecastService = Depends(get_service)) -> dict[str, Any]:
    items = _invoke(service.series)
    return {"items": items, "total": len(items)}


@router.get("/analysis")
def source_analysis(service: ForecastService = Depends(get_service)) -> dict[str, Any]:
    return _invoke(service.analysis)


@router.get("/sources")
def source_history(service: ForecastService = Depends(get_service)) -> dict[str, Any]:
    return _invoke(service.source_history)


@router.get("/sources/template")
def source_contract(service: ForecastService = Depends(get_service)) -> dict[str, Any]:
    source = _invoke(service.source)
    return {key: value for key, value in source.items() if key != "receipt"}


@router.post("/sources/stage")
def stage_source(
    body: ForecastSourceStageRequest, service: ForecastService = Depends(get_service)
) -> dict[str, Any]:
    return _invoke(service.stage_source, body.source)


@router.post("/sources/{version_id}/accept")
def accept_source(
    version_id: str,
    body: ForecastSourceAcceptRequest,
    service: ForecastService = Depends(get_service),
) -> dict[str, Any]:
    return _invoke(service.accept_source, version_id, body.review_note, body.accept_revisions)


@router.get("/series/{series_id}")
def get_series(
    series_id: str,
    target_month: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    service: ForecastService = Depends(get_service),
) -> dict[str, Any]:
    bundle = _invoke(service.bundle, target_month, [series_id])
    return {
        "forecast": bundle["monthly"][0],
        "provenance": bundle["provenance"],
        "dataQualityNotes": bundle["dataQualityNotes"],
    }


@router.get("/backtests/{series_id}")
def backtest(
    series_id: str,
    horizon_months: int = Query(default=1, ge=1, le=12),
    service: ForecastService = Depends(get_service),
) -> dict[str, Any]:
    return _invoke(service.backtest, series_id, horizon_months)


@router.get("/issues")
def list_issues(service: ForecastService = Depends(get_service)) -> dict[str, Any]:
    items = _invoke(service.issues)
    return {"items": items, "total": len(items)}


@router.post("/issues")
def issue_forecast(
    body: ForecastIssueRequest,
    service: ForecastService = Depends(get_service),
) -> dict[str, Any]:
    return _invoke(service.issue_forecast, body.target_month, body.series_ids)


@router.get("/issues/{issue_id}")
def get_issue(issue_id: str, service: ForecastService = Depends(get_service)) -> dict[str, Any]:
    return _invoke(service.issue, issue_id)
