"""Deterministic planning-screening recommendation endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.recommendation.models import (
    RecommendationDispatchRequest,
    RecommendationRequest,
    RecommendationType,
)
from app.recommendation.service import RecommendationService

router = APIRouter(prefix="/api/v1/recommendations", tags=["recommendations"])


def get_recommendations(request: Request) -> RecommendationService:
    return request.app.state.recommendations


def _recommend(
    recommendation_type: RecommendationType,
    request: RecommendationRequest,
    service: RecommendationService,
) -> dict[str, Any]:
    if request.island_id and request.island_id not in service.islands:
        raise HTTPException(status_code=404, detail=f"Island not found: {request.island_id}")
    return service.recommend(
        recommendation_type,
        island_id=request.island_id,
        limit=request.limit,
        config=request.config,
    )


@router.post("")
def recommend(
    request: RecommendationDispatchRequest,
    service: RecommendationService = Depends(get_recommendations),
) -> dict[str, Any]:
    return _recommend(request.type, request, service)
