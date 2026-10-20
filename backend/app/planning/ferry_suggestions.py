"""Source-qualified ferry suggestions and exact-draft cached impact previews."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.data.computed_cache import model_code_version
from app.planning.models import PlanningAssumptions, PlanningOperation, PlanningRequest
from app.planning.transport import FerryServiceRequest, TransportPlanningService

DISPLAY_METADATA_FIELDS = frozenset(
    {
        "ui_capital",
        "ui_annual",
        "ui_package",
        "ui_map_features",
        "ui_bus_summary",
        "ui_ferry_summary",
    }
)


class FerrySuggestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    origin_island_id: str = Field(default="island:1442", pattern=r"^island:\d+$")
    assumptions: PlanningAssumptions = Field(default_factory=PlanningAssumptions)
    operations: list[PlanningOperation] = Field(default_factory=list, max_length=96)


class FerrySuggestionService:
    def __init__(self, transport: TransportPlanningService) -> None:
        self.transport = transport

    def suggest(self, body: FerrySuggestionRequest) -> dict[str, Any]:
        planning = self.transport.planning
        path = planning.repository.public_dir / "policy-evidence/ferry-suggestions.json"
        artifact = json.loads(path.read_text(encoding="utf8")) if path.exists() else {}
        suggestion = next(
            (
                item
                for item in artifact.get("suggestions", [])
                if item.get("origin_island_id") == body.origin_island_id
            ),
            None,
        )
        if not suggestion:
            return {
                "status": "evidence_needed",
                "operations": [],
                "map_features": {"type": "FeatureCollection", "features": []},
                "summary": None,
                "quote": None,
                "impact": None,
                "suggestion": None,
                "inputs": None,
                "reasons": ["No reviewed suggestion is retained for this origin island."],
            }
        inputs = FerryServiceRequest(
            origin_island_id=body.origin_island_id,
            destination_island_id=suggestion["destination_island_id"],
            assumptions=body.assumptions,
            operations=body.operations,
            **suggestion.get("settings", {}),
        )
        # Keep every semantic input. Display-only estimates/grouping can settle
        # between a preview and its acceptance without triggering duplicate work.
        # Explicitly retain all other metadata, including unknown future fields.
        semantic_inputs = inputs.model_dump(mode="json")
        for operation in semantic_inputs["operations"]:
            operation["metadata"] = {
                key: value
                for key, value in operation["metadata"].items()
                if key not in DISPLAY_METADATA_FIELDS
            }
        cache_inputs = [
            model_code_version(),
            artifact,
            semantic_inputs,
            planning.repository.baseline_fingerprint(),
            planning.repository.calendars,
            planning.repository.receipts,
            self.transport.terminals,
            self.transport.updates.catalogue(),
            # Intervening shorelines matter as well as the two landing islands.
            self.transport.repository.islands_by_id,
            self.transport.routing.marine,
        ]

        def calculate() -> dict[str, Any]:
            draft = self.transport.ferry_service(inputs)
            draft["inputs"] = inputs.model_dump(mode="json", exclude_none=True)
            draft["suggestion"] = suggestion
            draft["impact"] = None
            draft["request_fingerprint"] = planning._digest(inputs.model_dump(mode="json"))
            if draft["status"] == "ready":
                # Preserve the reviewed evidence in the proposal and its PDF, rather
                # than relying on a transient browser preview for provenance.
                first = draft["operations"][0]
                first.setdefault("metadata", {})["ferry_suggestion"] = suggestion
                request = PlanningRequest(
                    island_id=body.origin_island_id,
                    assumptions=body.assumptions,
                    operations=[
                        *body.operations,
                        *[PlanningOperation.model_validate(item) for item in draft["operations"]],
                    ],
                )
                draft["impact"] = planning.evaluate(request)
            return draft

        result = (
            planning.computed_cache.get_or_compute(
                "ferry-suggestion-public"
                if not body.operations
                and body.assumptions
                == PlanningAssumptions(
                    goal="transport",
                    target_minutes=30,
                    capital_budget_mvr=50_000_000,
                    annual_operating_budget_mvr=12_000_000,
                    include_origin_geometry=False,
                    include_journey_geometry=False,
                    include_world=False,
                )
                else "ferry-suggestion",
                cache_inputs,
                calculate,
            )
            if planning.computed_cache
            else calculate()
        )
        # Cached outcomes ignore only display metadata; the returned provenance
        # must still describe this caller's exact current, combined proposal.
        result["inputs"] = inputs.model_dump(mode="json", exclude_none=True)
        result["request_fingerprint"] = planning._digest(inputs.model_dump(mode="json"))
        if result["impact"] is not None:
            request = PlanningRequest(
                island_id=body.origin_island_id,
                assumptions=body.assumptions,
                operations=[
                    *body.operations,
                    *[PlanningOperation.model_validate(item) for item in result["operations"]],
                ],
            )
            result["impact"]["request_fingerprint"] = planning._digest(
                request.model_dump(mode="json")
            )
        return result
