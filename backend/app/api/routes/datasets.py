"""Multi-dataset catalogue, typed row queries, chart builder and safe CSV exports."""

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import ValidationError

from app.analytics.models import ChartComparisonRequest, ChartRequest, DatasetQuery
from app.analytics.service import DatasetService
from app.analytics.sources import public_data_directory

router = APIRouter(prefix="/api/v1/datasets", tags=["dataset-explorer"])


def get_service(request: Request) -> DatasetService:
    if not hasattr(request.app.state, "datasets"):
        settings = request.app.state.settings
        request.app.state.datasets = DatasetService(
            public_data_directory(settings), settings.data_dir
        )
    return request.app.state.datasets


def _invoke(method: Any, *args: Any) -> Any:
    try:
        return method(*args)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error).strip("'")) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def _query(
    q: str | None,
    filters: str | None,
    sort: str | None,
    descending: bool,
    limit: int,
    offset: int,
    columns: str | None,
) -> DatasetQuery:
    try:
        return DatasetQuery(
            q=q,
            filters=json.loads(filters) if filters else [],
            sort=sort,
            descending=descending,
            limit=limit,
            offset=offset,
            columns=columns.split(",") if columns else None,
        )
    except (ValueError, ValidationError) as error:
        raise HTTPException(
            status_code=422, detail="Invalid dataset query: " + str(error)
        ) from error


@router.get("")
def catalogue(service: DatasetService = Depends(get_service)) -> dict[str, Any]:
    return _invoke(service.catalogue)


@router.get("/mobility-patterns")
def mobility_patterns(service: DatasetService = Depends(get_service)) -> dict[str, Any]:
    return _invoke(service.mobility_patterns)


@router.get("/island-mobility")
def island_mobility(
    island_id: str = Query(min_length=1, max_length=100),
    service: DatasetService = Depends(get_service),
) -> dict[str, Any]:
    return _invoke(service.island_mobility, island_id)


@router.post("/compare")
def compare(
    body: ChartComparisonRequest,
    service: DatasetService = Depends(get_service),
) -> dict[str, Any]:
    return _invoke(service.compare, body)


@router.get("/{dataset_id}/schema")
def schema(dataset_id: str, service: DatasetService = Depends(get_service)) -> dict[str, Any]:
    return _invoke(service.schema, dataset_id)


@router.get("/{dataset_id}/rows")
def rows(
    dataset_id: str,
    q: str | None = Query(default=None, max_length=300),
    filters: str | None = Query(default=None, max_length=12000),
    sort: str | None = None,
    descending: bool = False,
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    columns: str | None = Query(default=None, max_length=18000),
    service: DatasetService = Depends(get_service),
) -> dict[str, Any]:
    return _invoke(
        service.query, dataset_id, _query(q, filters, sort, descending, limit, offset, columns)
    )


@router.post("/{dataset_id}/query")
def query_rows(
    dataset_id: str,
    body: DatasetQuery,
    service: DatasetService = Depends(get_service),
) -> dict[str, Any]:
    return _invoke(service.query, dataset_id, body)


@router.post("/{dataset_id}/chart")
def chart(
    dataset_id: str,
    body: ChartRequest,
    service: DatasetService = Depends(get_service),
) -> dict[str, Any]:
    return _invoke(service.chart, dataset_id, body)


@router.get("/{dataset_id}/export.csv")
def export_csv(
    dataset_id: str,
    q: str | None = Query(default=None, max_length=300),
    filters: str | None = Query(default=None, max_length=12000),
    sort: str | None = None,
    descending: bool = False,
    columns: str | None = Query(default=None, max_length=18000),
    service: DatasetService = Depends(get_service),
) -> Response:
    csv_data = _invoke(
        service.csv, dataset_id, _query(q, filters, sort, descending, 1000, 0, columns)
    )
    return Response(
        content=csv_data,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{dataset_id}.csv"',
            "X-Content-Type-Options": "nosniff",
        },
    )
