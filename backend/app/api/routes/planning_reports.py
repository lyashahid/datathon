"""Download a canonical planning comparison as an actual PDF document."""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from app.api.routes.planning import get_planning, invoke
from app.planning.models import PlanningRequest
from app.planning.report import build_planning_report
from app.planning.service import PlanningService

router = APIRouter(prefix="/api/v1/planning", tags=["policy-planning"])


@router.post("/report.pdf", response_class=Response)
def report_pdf(
    payload: PlanningRequest,
    title: str = Query(default="Community investment proposal", min_length=1, max_length=160),
    service: PlanningService = Depends(get_planning),
) -> Response:
    evaluation = invoke(service, "evaluate", payload)
    return Response(
        build_planning_report(payload, evaluation, title, service.baseline(payload.island_id)),
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="proposal-review.pdf"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
