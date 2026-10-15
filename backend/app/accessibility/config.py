"""Validated, overridable accessibility scoring policy."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DistanceBand(BaseModel):
    max_distance_m: float = Field(gt=0)
    score: float = Field(ge=0, le=1)


class AccessibilityConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str = "accessibility-v1"
    health_weight: float = Field(default=1 / 3, ge=0, le=1)
    education_weight: float = Field(default=1 / 3, ge=0, le=1)
    transport_weight: float = Field(default=1 / 3, ge=0, le=1)
    health_quality_weights: dict[str, float] = Field(
        default_factory=lambda: {"clinic": 0.35, "health_center": 0.65, "hospital": 1.0}
    )
    education_quality_weights: dict[str, float] = Field(default_factory=lambda: {"school": 1.0})
    distance_bands: list[DistanceBand] = Field(
        default_factory=lambda: [
            DistanceBand(max_distance_m=500, score=1.0),
            DistanceBand(max_distance_m=1000, score=0.75),
            DistanceBand(max_distance_m=3000, score=0.4),
        ]
    )
    transport_weights: dict[str, float] = Field(
        default_factory=lambda: {"airport": 1 / 3, "bus": 1 / 3, "ferry": 1 / 3}
    )
    include_unverified_marine: bool = False
    max_route_candidates_per_anchor: int = Field(default=3, ge=1, le=10)
    density_reference_persons_per_km2: float = Field(default=5000.0, gt=0)
    density_domain_impacts: dict[str, float] = Field(
        default_factory=lambda: {"health": 0.2, "education": 0.25, "transport": 0.45}
    )

    @model_validator(mode="after")
    def validate_weights(self) -> AccessibilityConfig:
        domain_total = self.health_weight + self.education_weight + self.transport_weight
        if not 0.999 <= domain_total <= 1.001:
            raise ValueError("health_weight, education_weight, and transport_weight must sum to 1")
        if any(not 0 <= value <= 1 for value in self.density_domain_impacts.values()) or not {
            "health",
            "education",
            "transport",
        }.issubset(self.density_domain_impacts):
            raise ValueError(
                "density_domain_impacts must define health, education, and transport in [0, 1]"
            )
        transport_total = sum(self.transport_weights.values())
        if not 0.999 <= transport_total <= 1.001:
            raise ValueError("transport_weights must sum to 1")
        if any(
            left.max_distance_m >= right.max_distance_m
            for left, right in zip(self.distance_bands, self.distance_bands[1:])
        ):
            raise ValueError("distance_bands must be ordered by increasing max_distance_m")
        return self


DEFAULT_ACCESSIBILITY_CONFIG = AccessibilityConfig()
