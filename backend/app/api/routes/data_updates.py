"""Source freshness and reviewed nationwide schedule integration."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.data_updates.models import NationalJourney, ScheduleAccept, ScheduleSnapshot
from app.data_updates.service import DataUpdateService

router = APIRouter(prefix="/api/v1/data-updates", tags=["source-updates"])


def get_service(request: Request) -> DataUpdateService:
    if not hasattr(request.app.state, "data_updates"):
        settings = request.app.state.settings
        request.app.state.data_updates = DataUpdateService(
            settings.public_data_dir, settings.data_dir, request.app.state.repository
        )
    return request.app.state.data_updates


def invoke(method: Any, *args: Any) -> Any:
    try:
        return method(*args)
    except KeyError as error:
        raise HTTPException(404, str(error).strip("'")) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.get("")
def status(service: DataUpdateService = Depends(get_service)) -> dict[str, Any]:
    return invoke(service.status)


@router.post("/check")
async def check(service: DataUpdateService = Depends(get_service)) -> dict[str, Any]:
    return await service.check()


@router.get("/schedules")
def catalogue(service: DataUpdateService = Depends(get_service)) -> dict[str, Any]:
    return invoke(service.catalogue)


@router.post("/schedules/stage")
def stage(
    body: ScheduleSnapshot, service: DataUpdateService = Depends(get_service)
) -> dict[str, Any]:
    return invoke(service.stage, body)


@router.post("/schedules/{snapshot_id}/accept")
def accept(
    snapshot_id: str, body: ScheduleAccept, service: DataUpdateService = Depends(get_service)
) -> dict[str, Any]:
    return invoke(service.accept, snapshot_id, body)


@router.post("/schedules/journey")
def journey(
    body: NationalJourney, service: DataUpdateService = Depends(get_service)
) -> dict[str, Any]:
    return invoke(service.journey, body)
