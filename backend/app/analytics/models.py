"""Constrained, portable dataset queries and chart definitions."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DatasetFilter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    column: str = Field(min_length=1, max_length=180)
    op: Literal["eq", "ne", "contains", "in", "gte", "lte", "gt", "lt", "missing"] = "eq"
    value: Any = None

    @model_validator(mode="after")
    def validate_value(self) -> "DatasetFilter":
        if self.op == "in" and not isinstance(self.value, list):
            raise ValueError("The in operator requires an array value")
        if self.op == "missing" and self.value is not None and not isinstance(self.value, bool):
            raise ValueError("The missing operator accepts only true or false")
        if self.op in {"gte", "lte", "gt", "lt"} and (
            isinstance(self.value, bool) or not isinstance(self.value, (int, float))
        ):
            raise ValueError("Numeric comparisons require a numeric value")
        return self


class DatasetQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: str | None = Field(default=None, max_length=300)
    filters: list[DatasetFilter] = Field(default_factory=list, max_length=30)
    sort: str | None = Field(default=None, max_length=180)
    descending: bool = False
    limit: int = Field(default=50, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)
    columns: list[str] | None = Field(default=None, min_length=1, max_length=100)


class ChartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    group_by: str = Field(min_length=1, max_length=180)
    series_by: str | None = Field(default=None, max_length=180)
    measure: str | None = Field(default=None, max_length=180)
    aggregation: Literal["count", "sum", "mean", "min", "max"] = "count"
    filters: list[DatasetFilter] = Field(default_factory=list, max_length=30)
    q: str | None = Field(default=None, max_length=300)
    sort: Literal["group", "value"] = "group"
    descending: bool = False
    limit: int = Field(default=100, ge=1, le=500)

    @model_validator(mode="after")
    def measure_required(self) -> "ChartRequest":
        if self.aggregation != "count" and not self.measure:
            raise ValueError("sum, mean, min and max require a numeric measure")
        return self


class ChartSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: str = Field(min_length=1, max_length=160, pattern=r"^[a-z0-9-]+$")
    query: ChartRequest
    label: str | None = Field(default=None, min_length=1, max_length=120)


class ChartComparisonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    primary: ChartSource
    comparison: ChartSource
    mode: Literal["values", "indexed"] = "indexed"
    alignment: Literal["common", "union"] = "common"
    key_domain: Literal["calendar-month", "calendar-year", "island-id", "category"] = "category"
