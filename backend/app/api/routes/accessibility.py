"""Configurable accessibility scoring endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.accessibility.config import AccessibilityConfig
from app.accessibility.service import AccessibilityService

router = APIRouter(prefix="/api/v1", tags=["accessibility"])


class AccessibilityScoreRequest(BaseModel):
    island_id: str
    config: AccessibilityConfig = Field(default_factory=AccessibilityConfig)


def get_accessibility(request: Request) -> AccessibilityService:
    return request.app.state.accessibility


@router.post("/accessibility/score")
def score_accessibility(
    request: AccessibilityScoreRequest,
    service: AccessibilityService = Depends(get_accessibility),
) -> dict[str, Any]:
    result = service.score_island(request.island_id, request.config)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Island not found: {request.island_id}")
    return result


@router.get("/accessibility/summary")
def accessibility_summary(
    service: AccessibilityService = Depends(get_accessibility),
) -> dict[str, Any]:
    return service.default_artifact()
