"""Notice lifecycle: import, inspect, explicitly review, then optionally use in a scenario."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

router = APIRouter(prefix="/api/v1/operations", tags=["Public notices"])


class NoticeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_url: str = Field(max_length=2048)
    text: str | None = Field(default=None, min_length=20, max_length=16000)
    title: str | None = Field(default=None, max_length=180)
    published_at: AwareDatetime | None = None


class NoticeReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approved", "dismissed"]
    operation_type: Literal["road_closure", "disable_service", "disable_facility"] | None = None
    target_id: str | None = Field(default=None, max_length=200)
    valid_from: AwareDatetime | None = None
    valid_until: AwareDatetime | None = None
    notes: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def validate_mapping(self):
        if self.decision == "approved" and (
            not self.operation_type
            or not self.target_id
            or not self.valid_from
            or not self.valid_until
            or self.valid_until <= self.valid_from
        ):
            raise ValueError(
                "Approval requires a target, operation and ordered aware validity dates."
            )
        return self


@router.get("/snapshot")
def snapshot(request: Request):
    return request.app.state.notices.snapshot()


@router.get("/notices")
def notices(request: Request, status: Literal["candidate", "approved", "dismissed"] | None = None):
    return request.app.state.notices.list(status)


@router.post("/notices/ingest")
async def ingest(body: NoticeInput, request: Request):
    return await request.app.state.notices.ingest(
        body.source_url, body.text, body.title, body.published_at
    )


@router.post("/notices/{notice_id}/review")
def review(notice_id: str, body: NoticeReview, request: Request):
    values = body.model_dump()
    values = {k: v.isoformat() if isinstance(v, datetime) else v for k, v in values.items()}
    return request.app.state.notices.review(notice_id, values)
