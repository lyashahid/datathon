"""Validated recommendation request and ranking policy models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

RecommendationType = Literal[
    "underserved_island",
    "bus_stop",
    "ferry_terminal",
    "ferry_route",
    "parking",
    "mobility_hub",
    "pedestrian",
    "airport_access",
]


class RecommendationConfig(BaseModel):
    """Configurable ranking policy with transparent defaults."""

    model_config = ConfigDict(extra="forbid")

    benefit_weight: float = Field(default=0.7, ge=0, le=1)
    confidence_weight: float = Field(default=0.3, ge=0, le=1)
    max_candidates: int = Field(default=100, ge=1, le=500)

    @model_validator(mode="after")
    def validate_weights(self) -> RecommendationConfig:
        if not 0.999 <= self.benefit_weight + self.confidence_weight <= 1.001:
            raise ValueError("benefit_weight and confidence_weight must sum to 1")
        return self


class RecommendationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    island_id: str | None = None
    limit: int = Field(default=10, ge=1, le=50)
    config: RecommendationConfig = Field(default_factory=RecommendationConfig)


class RecommendationDispatchRequest(RecommendationRequest):
    """Public request selecting one of the recommendation strategies."""

    type: RecommendationType
