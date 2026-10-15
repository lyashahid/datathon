"""Validated scenario and simulation request models."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.coordinates import Coordinates

OperationType = Literal[
    "add_bus_stop",
    "move_bus_stop",
    "remove_bus_stop",
    "add_ferry_terminal",
    "move_ferry_terminal",
    "disable_ferry_terminal",
    "add_ferry_route",
    "remove_ferry_route",
    "change_ferry_route",
    "add_parking",
    "add_park_and_ride",
    "add_mobility_hub",
    "road_closure",
    "pedestrian_connection",
    "airport_access_improvement",
    "weather_disruption",
]


class ScenarioOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: OperationType
    target_id: str | None = None
    island_id: str | None = None
    coordinates: Coordinates | None = None
    from_node_id: str | None = None
    to_node_id: str | None = None
    distance_m: float | None = Field(default=None, gt=0)
    mode: str | None = None
    disabled_modes: list[str] = Field(default_factory=list)
    passenger_eligible: bool = True
    bidirectional: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_operation(self) -> ScenarioOperation:
        requires_target = {
            "move_bus_stop",
            "remove_bus_stop",
            "move_ferry_terminal",
            "disable_ferry_terminal",
            "remove_ferry_route",
            "change_ferry_route",
            "road_closure",
        }
        if self.type in requires_target and not self.target_id:
            raise ValueError(f"{self.type} requires target_id")
        requires_coordinates = {
            "add_bus_stop",
            "move_bus_stop",
            "add_ferry_terminal",
            "move_ferry_terminal",
            "add_parking",
            "add_park_and_ride",
            "add_mobility_hub",
        }
        if self.type in requires_coordinates and not self.coordinates:
            raise ValueError(f"{self.type} requires coordinates")
        if self.type in {
            "add_ferry_route",
            "change_ferry_route",
            "pedestrian_connection",
            "airport_access_improvement",
        }:
            if not self.from_node_id or not self.to_node_id:
                raise ValueError(f"{self.type} requires from_node_id and to_node_id")
        if self.type == "weather_disruption" and not self.disabled_modes:
            raise ValueError("weather_disruption requires disabled_modes")
        return self


class Scenario(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=200)
    operations: list[ScenarioOperation] = Field(default_factory=list, max_length=100)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SimulationRequest(BaseModel):
    scenario: Scenario
    island_id: str | None = None


class CompareRequest(BaseModel):
    first: Scenario
    second: Scenario
    island_id: str | None = None
