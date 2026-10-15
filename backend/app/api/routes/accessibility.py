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


@router.post(
    "/accessibility/score",
    summary="Calculate an island access index with plain-language reasons and evidence coverage",
)
def score_accessibility(
    request: AccessibilityScoreRequest,
    service: AccessibilityService = Depends(get_accessibility),
) -> dict[str, Any]:
    result = service.score_island(request.island_id, request.config)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Island not found: {request.island_id}")
    return result


@router.get(
    "/accessibility/summary",
    summary="Access indices, reasons and evidence coverage for every island",
)
def accessibility_summary(
    compact: bool = False,
    service: AccessibilityService = Depends(get_accessibility),
) -> dict[str, Any]:
    artifact = service.default_artifact()
    if not compact:
        return artifact
    return {
        **{key: value for key, value in artifact.items() if key != "scores"},
        "representation": "compact",
        "scores": [
            {
                "island_id": row["island_id"],
                "score": row["score"],
                "confidence": row["confidence"],
                "domain_weights": row["domain_weights"],
                "domains": {
                    key: {
                        field: value
                        for field, value in details.items()
                        if field in {"score", "mapped_counts"}
                    }
                    for key, details in row["domains"].items()
                },
                "population": {
                    key: value
                    for key, value in row["population"].items()
                    if key in {"total", "status", "year"}
                },
                "assessment": {
                    key: value
                    for key, value in row["assessment"].items()
                    if key in {"score", "out_of", "label", "summary", "components", "coverage"}
                },
            }
            for row in artifact["scores"]
        ],
    }
