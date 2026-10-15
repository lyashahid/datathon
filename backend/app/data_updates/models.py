"""Strict source receipts and dated island-to-island service contracts."""

from datetime import date, datetime, time
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)


class SourceReceipt(StrictModel):
    publisher: str = Field(min_length=2, max_length=200)
    url: str = Field(max_length=1000)
    retrieved_at: datetime
    reference_period: str = Field(min_length=4, max_length=200)
    licence_note: str = Field(min_length=4, max_length=500)

    @field_validator("url")
    @classmethod
    def official_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if parsed.scheme != "https" or parsed.username or parsed.password:
            raise ValueError("Source evidence must have a public HTTPS URL.")
        if not any(
            host == domain or host.endswith("." + domain)
            for domain in ("rtl.mv", "mtcc.mv", "statisticsmaldives.gov.mv", "gov.mv")
        ):
            raise ValueError("Use the operator or official publisher URL, not a reseller.")
        return value

    @field_validator("retrieved_at")
    @classmethod
    def aware_receipt(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("retrieved_at must include a timezone.")
        if value > datetime.now(value.tzinfo):
            raise ValueError("Source retrieval cannot be in the future.")
        return value


class ScheduledService(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9:_-]{1,100}$")
    name: str = Field(min_length=2, max_length=200)
    mode: Literal["bus", "ferry"]
    from_island_id: str = Field(pattern=r"^island:\d+$")
    to_island_id: str = Field(pattern=r"^island:\d+$")
    from_terminal: str = Field(min_length=2, max_length=200)
    to_terminal: str = Field(min_length=2, max_length=200)
    departure: time
    arrival: time | None = None
    arrival_day_offset: int = Field(default=0, ge=0, le=2)
    runtime_minutes: float | None = Field(default=None, gt=0, le=2880)
    timing_basis: Literal["published_arrival", "assumed_runtime"]
    weekdays: list[int] = Field(min_length=1, max_length=7)
    effective_from: date
    effective_until: date
    source_index: int = Field(default=0, ge=0)

    @field_validator("departure", "arrival")
    @classmethod
    def local_clock(cls, value: time | None) -> time | None:
        if value and (value.tzinfo or value.second or value.microsecond):
            raise ValueError("Use local Maldives HH:MM times, without seconds or offsets.")
        return value

    @field_validator("weekdays")
    @classmethod
    def unique_days(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value) or any(day not in range(1, 8) for day in value):
            raise ValueError("weekdays must be distinct ISO values 1 through 7.")
        return sorted(value)

    @model_validator(mode="after")
    def coherent(self) -> Self:
        if self.from_island_id == self.to_island_id:
            raise ValueError("Nationwide links must connect distinct islands.")
        if self.effective_until < self.effective_from:
            raise ValueError("Service validity end precedes its start.")
        if self.timing_basis == "published_arrival":
            if self.arrival is None or self.runtime_minutes is not None:
                raise ValueError(
                    "Published arrival requires an arrival time and no invented runtime."
                )
            start = self.departure.hour * 60 + self.departure.minute
            end = self.arrival.hour * 60 + self.arrival.minute + self.arrival_day_offset * 1440
            if not 0 < end - start <= 2880:
                raise ValueError(
                    "Arrival must be later than departure; declare an overnight offset."
                )
        elif self.runtime_minutes is None or self.arrival is not None:
            raise ValueError("Assumed runtime requires minutes and no purported published arrival.")
        return self


class ScheduleSnapshot(StrictModel):
    schema_version: Literal[1]
    title: str = Field(min_length=3, max_length=200)
    timezone: Literal["Indian/Maldives"]
    sources: list[SourceReceipt] = Field(min_length=1, max_length=100)
    services: list[ScheduledService] = Field(min_length=1, max_length=2000)
    limitations: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def references(self) -> Self:
        if len({service.id for service in self.services}) != len(self.services):
            raise ValueError("Service IDs must be unique within a snapshot.")
        if any(item.source_index >= len(self.sources) for item in self.services):
            raise ValueError("Service source_index does not resolve to a supplied receipt.")
        return self


class ScheduleAccept(StrictModel):
    reviewed: Literal[True]
    review_note: str = Field(min_length=10, max_length=1000)


class NationalJourney(StrictModel):
    from_island_id: str = Field(pattern=r"^island:\d+$")
    to_island_id: str = Field(pattern=r"^island:\d+$")
    departure_at: datetime
    transfer_minutes: int = Field(default=30, ge=0, le=240)
    max_transfers: int = Field(default=2, ge=0, le=4)
    max_hours: int = Field(default=48, ge=1, le=72)
    include_assumed_runtimes: bool = False

    @field_validator("departure_at")
    @classmethod
    def aware_departure(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Departure must include a timezone offset.")
        return value
