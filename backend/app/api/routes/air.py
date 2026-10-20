"""Source-backed domestic aviation connections, independent of transient positions."""

from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request

from app.api.routes.planning import get_planning
from app.planning.air_network import AirNetworkService
from app.planning.service import PlanningService

router = APIRouter(prefix="/api/v1/planning", tags=["aviation"])


def get_air_network(
    request: Request, planning: PlanningService = Depends(get_planning)
) -> AirNetworkService:
    existing = getattr(request.app.state, "air_network", None)
    if existing is None or existing.repository is not request.app.state.repository:
        existing = AirNetworkService(
            request.app.state.repository,
            planning.repository.public_dir,
            cache=planning.computed_cache,
            source_version=getattr(request.app.state, "source_version", None),
        )
        request.app.state.air_network = existing
    return existing


@router.get("/air-network")
def air_network(
    date: date | None = None,
    service: AirNetworkService = Depends(get_air_network),
) -> dict[str, Any]:
    selected = date or datetime.now(UTC).astimezone(timezone(timedelta(hours=5))).date()
    return service.network(selected)
