"""Bounded, reproducible planning inputs. Times are minutes in Maldives local time."""

from __future__ import annotations

from datetime import date as ServiceDate
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.coordinates import Coordinates
from app.planning.calibration import CalibrationRecord


class FleetResources(BaseModel):
    """Explicit resources for auditing chronological blocks; no guessed demand or depots."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    activity_id: str = Field(min_length=1, max_length=250)
    available_vehicles: int | None = Field(default=None, ge=0, le=10000)
    vehicle_capacity: int | None = Field(default=None, gt=0, le=10000)
    peak_passengers_per_departure: float | None = Field(default=None, ge=0, le=1e6)
    max_vehicle_duty_hours: float | None = Field(default=None, gt=0, le=48)
    depot_stop_ids: list[str] = Field(default_factory=list, max_length=50)
    battery_kwh: float | None = Field(default=None, gt=0, le=100000)
    battery_reserve_share: float = Field(default=0.2, ge=0, lt=1)
    energy_kwh_per_km: float | None = Field(default=None, gt=0, le=100)
    charger_count: int | None = Field(default=None, ge=0, le=10000)
    charger_power_kw: float | None = Field(default=None, gt=0, le=10000)
    overnight_charging_hours: float | None = Field(default=None, gt=0, le=24)
    charging_efficiency: float = Field(default=0.9, gt=0, le=1)


class PlanningAssumptions(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    date: ServiceDate = ServiceDate(2026, 10, 10)
    departure_minutes: float = Field(default=920, ge=0, lt=1440)
    target_minutes: float = Field(default=30, gt=0, le=180)
    goal: Literal["healthcare", "education"] = "healthcare"
    population_year: Literal[2026, 2030] = 2026
    walk_m_per_minute: float = Field(default=80, ge=10, le=180)
    max_journey_minutes: float = Field(default=180, gt=0, le=360)
    max_access_walk_minutes: float = Field(default=15, ge=0, le=60)
    max_transfer_walk_minutes: float = Field(default=10, ge=0, le=30)
    max_transfers: int = Field(default=2, ge=0, le=4)
    max_snap_m: float = Field(default=100, gt=0, le=1000)
    boarding_buffer_minutes: float = Field(default=2, ge=0, le=30)
    annual_operating_days: int = Field(default=300, ge=1, le=366)
    layover_minutes: float = Field(default=10, ge=0, le=120)
    fleet_reserve_share: float = Field(default=0.15, ge=0, le=1)
    capital_budget_mvr: float | None = Field(default=None, ge=0)
    annual_operating_budget_mvr: float | None = Field(default=None, ge=0)
    displaced_passenger_km: float = Field(default=0, ge=0, le=1e12)
    cost_overrides: dict[str, float] = Field(default_factory=dict)
    energy_overrides: dict[str, float] = Field(default_factory=dict)
    calibration_records: list[CalibrationRecord] = Field(default_factory=list, max_length=100)
    calibration_selection: dict[str, str] = Field(default_factory=dict)
    fleet_resources: list[FleetResources] = Field(default_factory=list, max_length=100)
    require_audited_wheelchair: bool = False
    include_origin_geometry: bool = False
    include_journey_geometry: bool = True
    include_world: bool = True

    @model_validator(mode="after")
    def validate_costs(self) -> PlanningAssumptions:
        import math

        if any(
            not math.isfinite(v) or v < 0
            for v in [*self.cost_overrides.values(), *self.energy_overrides.values()]
        ):
            raise ValueError("Cost and emission assumptions must be finite nonnegative values")
        if len({resource.activity_id for resource in self.fleet_resources}) != len(
            self.fleet_resources
        ):
            raise ValueError("Each fleet activity may have only one resource plan")
        if self.target_minutes > self.max_journey_minutes:
            raise ValueError("Target must fit within the maximum journey horizon")
        return self


class PlanningOperation(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    type: Literal[
        "add_hospital",
        "add_school",
        "add_stop",
        "move_stop",
        "disable_facility",
        "disable_stop",
        "enable_stop",
        "disable_service",
        "enable_service",
        "shift_timetable",
        "set_frequency",
        "set_hours",
        "set_fleet",
        "add_service",
        "replace_service",
        "road_closure",
        "pedestrian_connection",
        "weather_disruption",
    ]
    target_id: str | None = None
    island_id: str | None = None
    coordinates: Coordinates | None = None
    name: str | None = Field(default=None, max_length=200)
    opening_date: ServiceDate | None = None
    minutes: float | None = Field(default=None, ge=-720, le=720)
    headway_minutes: float | None = Field(default=None, gt=0, le=720)
    start_minutes: float | None = Field(default=None, ge=0, lt=2880)
    end_minutes: float | None = Field(default=None, gt=0, le=2880)
    fleet: Literal["diesel", "electric"] | None = None
    service: dict[str, Any] | None = None
    from_node_id: str | None = None
    to_node_id: str | None = None
    distance_m: float | None = Field(default=None, gt=0, le=1e6)
    disabled_modes: list[Literal["walk", "bus", "ferry"]] = Field(default_factory=list)
    bidirectional: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def required_fields(self) -> PlanningOperation:
        if self.type in {"add_hospital", "add_school", "add_stop", "move_stop"}:
            if self.coordinates is None:
                raise ValueError(f"{self.type} requires coordinates")
        if (
            self.type
            not in {
                "add_hospital",
                "add_school",
                "add_stop",
                "add_service",
                "pedestrian_connection",
                "weather_disruption",
            }
            and not self.target_id
        ):
            raise ValueError(f"{self.type} requires target_id")
        if self.type == "set_frequency" and self.headway_minutes is None:
            raise ValueError("set_frequency requires headway_minutes")
        if self.type == "shift_timetable" and self.minutes is None:
            raise ValueError("shift_timetable requires minutes")
        if self.type == "set_fleet" and not self.fleet:
            raise ValueError("set_fleet requires fleet")
        if self.type == "set_hours" and (
            self.start_minutes is None
            or self.end_minutes is None
            or self.end_minutes <= self.start_minutes
        ):
            raise ValueError("set_hours requires an ordered start/end window")
        if self.type in {"add_service", "replace_service"} and not self.service:
            raise ValueError("A complete service pattern is required")
        if self.type == "pedestrian_connection" and (not self.from_node_id or not self.to_node_id):
            raise ValueError("pedestrian_connection requires graph node IDs")
        if self.type == "weather_disruption" and not self.disabled_modes:
            raise ValueError("weather_disruption requires disabled_modes")
        return self


class PlanningRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    island_id: str | None = None
    assumptions: PlanningAssumptions = Field(default_factory=PlanningAssumptions)
    operations: list[PlanningOperation] = Field(default_factory=list, max_length=100)
    scenario: dict[str, Any] | None = None


class JourneyRequest(PlanningRequest):
    origin_id: str
    destination_id: str | None = None
    appointment_minutes: float | None = Field(default=None, ge=0, le=720)
    return_deadline_minutes: float | None = Field(default=None, gt=0, le=2880)
