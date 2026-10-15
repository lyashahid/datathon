"""Validated public forecasting request models."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ForecastIssueRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    series_ids: list[str] | None = Field(default=None, min_length=1, max_length=20)


class ForecastSourceStageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: dict[str, Any]


class ForecastSourceAcceptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    review_note: str = Field(min_length=20, max_length=2000)
    accept_revisions: bool = False
