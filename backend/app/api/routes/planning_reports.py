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
    # Browser impact requests deliberately omit the world to stay small. The
    # report needs canonical stop names and service detail, so request the full
    # internal representation without trusting client-supplied labels/totals.
    report_request = payload.model_copy(
        update={"assumptions": payload.assumptions.model_copy(update={"include_world": True})}
    )
    evaluation = invoke(service, "evaluate", report_request)
    includes_ferry = any(
        (operation.service or {}).get("mode") == "ferry" for operation in payload.operations
    )
    return Response(
        build_planning_report(
            payload,
            evaluation,
            title,
            service.baseline(None if includes_ferry else payload.island_id),
        ),
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="proposal-review.pdf"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
