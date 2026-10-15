"""Validated GeoJSON longitude/latitude pairs shared by public requests."""

from typing import Annotated

from pydantic import Field

Coordinates = tuple[
    Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)],
    Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)],
]
