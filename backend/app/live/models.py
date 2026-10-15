"""Request and normalized event models for transient live data."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def parse_bbox(value: str) -> tuple[float, float, float, float]:
    """Parse a GeoJSON-style bbox as min_lon,min_lat,max_lon,max_lat."""

    try:
        min_lon, min_lat, max_lon, max_lat = (float(part.strip()) for part in value.split(","))
    except (TypeError, ValueError) as error:
        raise ValueError("bbox must be min_lon,min_lat,max_lon,max_lat") from error
    if not (72.0 <= min_lon < max_lon <= 75.0 and -1.0 <= min_lat < max_lat <= 8.5):
        raise ValueError("bbox must be within the Maldives live-data bounds")
    return min_lat, min_lon, max_lat, max_lon


class LiveQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(default=4.1755, ge=-90, le=90)
    longitude: float = Field(default=73.5093, ge=-180, le=180)
    radius_nm: float = Field(default=250, gt=0, le=500)
    include_fallback: bool = True
    route_code: str | None = Field(default=None, max_length=80)
    bbox: str | None = None
    followme_vessel_ids: list[int] = Field(default=[], max_length=20)
    include_followme_catalogue: bool = False
    discover_nearby: bool = False
    island_name: str | None = Field(default=None, max_length=120)
    max_age_seconds: int = Field(default=120, ge=1, le=3600)
    include_stale: bool = False

    @field_validator("island_name")
    @classmethod
    def clean_island_name(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @model_validator(mode="after")
    def bound_discovery(self) -> "LiveQuery":
        if self.discover_nearby:
            if self.bbox:
                min_lat, min_lon, max_lat, max_lon = parse_bbox(self.bbox)
                if max_lat - min_lat > 1 or max_lon - min_lon > 1:
                    raise ValueError(
                        "Nearby discovery needs a local bbox, at most 1 degree per side"
                    )
            elif self.radius_nm > 25:
                raise ValueError("Nearby discovery is limited to a 25 nautical-mile scope")
        return self

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, value: str | None) -> str | None:
        if value is not None:
            parse_bbox(value)
        return value

    @field_validator("followme_vessel_ids")
    @classmethod
    def validate_followme_ids(cls, value: list[int]) -> list[int]:
        if any(vessel_id <= 0 for vessel_id in value):
            raise ValueError("FollowMe vessel IDs must be positive")
        return value


class LiveEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["aircraft", "vessel", "bus"]
    provider: str
    external_object_id: str
    position: dict[str, float]
    observed_at: datetime | None = None
    retrieved_at: datetime
    properties: dict[str, Any] = Field(default_factory=dict)
    island_id: str | None = None
    node_id: str | None = None
    updated_at: datetime | None = None
    stale: bool = False
    source_quality: str = "provider_live"
