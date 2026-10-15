"""Scenario simulation endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.repository import NormalizedRepository
from app.api.routes.national import get_repository
from app.simulation.engine import ScenarioEngine
from app.simulation.models import CompareRequest, SimulationRequest

router = APIRouter(prefix="/api/v1/simulation", tags=["simulation"])


def get_engine(request: Request) -> ScenarioEngine:
    return request.app.state.simulation


@router.post("/run")
def run_simulation(
    request: SimulationRequest,
    engine: ScenarioEngine = Depends(get_engine),
    repository: NormalizedRepository = Depends(get_repository),
) -> dict[str, Any]:
    if request.island_id and request.island_id not in repository.islands_by_id:
        raise HTTPException(status_code=404, detail=f"Island not found: {request.island_id}")
    return engine.run(request.scenario, request.island_id)


@router.post("/compare")
def compare_simulations(
    request: CompareRequest,
    engine: ScenarioEngine = Depends(get_engine),
    repository: NormalizedRepository = Depends(get_repository),
) -> dict[str, Any]:
    if request.island_id and request.island_id not in repository.islands_by_id:
        raise HTTPException(status_code=404, detail=f"Island not found: {request.island_id}")
    return engine.compare(request.first, request.second, request.island_id)
