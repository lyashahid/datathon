# ruff: noqa: E501
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field


class Coordinates(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class Place(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: str
    location: Coordinates
    feature_id: str | None = None
    place_id: str | None = None
    address: str | None = None
    category: str | None = None
    rating: float | None = None
    review_count: int | None = None
    phone: str | None = None
    website: str | None = None
    open_now: bool | None = None
    status_text: str | None = None
    permanently_closed: bool = False
    temporarily_closed: bool = False
    price_level: int | None = None
    price_text: str | None = None
    hours: list[str] = Field(default_factory=list)
    photo_urls: list[str] = Field(default_factory=list)
    photo_dates: list[str | None] = Field(default_factory=list)
    photo_categories: list[str | None] = Field(default_factory=list)
    distance_meters: float | None = None
    departments: list[dict[str, Any]] = Field(default_factory=list)
    about: list[dict[str, Any]] = Field(default_factory=list)
    updates: list[dict[str, Any]] = Field(default_factory=list)
    similar_places: list[dict[str, Any]] = Field(default_factory=list)
    popular_times: dict[str, Any] | None = None
    rating_histogram: list[int] | None = None
    fuel_price: str | None = None
    fuel_price_at: int | None = None
    place_type: str | None = None
    country_code: str | None = None
    action_url: str | None = None
    action_label: str | None = None
    wheelchair_accessible: bool = False
    featured_review: str | None = None
    editorial_summary: str | None = None
    owner_description: str | None = None
    sv_pano_id: str | None = None
    sv_yaw_deg: float | None = None
    saved_note: str | None = None
    pin_color: int | None = None
    pin_icon_url: str | None = None
    map_layer: str | None = None


class DetailsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    place_id: str = Field(
        min_length=1,
        max_length=256,
        description="feature_id or Google place_id from search; not the app's cached ID",
    )
    name: str = Field(min_length=1, max_length=300)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    address: str | None = Field(default=None, max_length=600)
    language: str = Field(
        default="en", pattern=r"^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$", max_length=12
    )
    region: str = Field(default="us", pattern=r"^[A-Za-z]{2}$")


class DirectionsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: Coordinates
    destination: Coordinates
    mode: Literal["driving", "walking", "bicycling"] = "driving"
    waypoints: list[Coordinates] = Field(default_factory=list, max_length=8)
    avoid: list[Literal["tolls", "highways", "ferries"]] = Field(default_factory=list, max_length=3)
    language: str = Field(default="en", pattern=r"^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$")
    region: str = Field(default="us", pattern=r"^[A-Za-z]{2}$")


class Metadata(BaseModel):
    request_id: str
    provider: Literal["google_consumer"] = "google_consumer"
    calibration_version: int
    cached: bool = False
    warnings: list[str] = Field(default_factory=list)


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Any | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody
    request_id: str


class SearchData(BaseModel):
    query: str
    places: list[Place]
    focused_single: bool = False
    stripped_focus: bool = False
    focus: Place | None = None
    next_offset: int | None = None
    completeness: Literal["unknown"] = "unknown"


class SuggestData(BaseModel):
    query: str
    places: list[Place]
    queries: list[str]
    completeness: Literal["unknown"] = "unknown"


class DetailsData(Place):
    completeness: Literal["unknown"] = "unknown"


class Photo(BaseModel):
    model_config = ConfigDict(extra="allow")
    url: str
    posted_text: str | None = None
    category: str | None = None


class PhotosData(BaseModel):
    model_config = ConfigDict(extra="allow")
    photos: list[Photo]
    next_token: str | None = None
    completeness: Literal["unknown"] = "unknown"


class Review(BaseModel):
    model_config = ConfigDict(extra="allow")
    author: str
    rating: int | None = None
    author_photo: str | None = None
    relative_time: str | None = None
    text: str | None = None
    photos: list[str] = Field(default_factory=list)


class ReviewsData(BaseModel):
    model_config = ConfigDict(extra="allow")
    reviews: list[Review]
    next_token: str | None = None
    end: bool | None = None
    completeness: Literal["limited", "unknown"] = "limited"
    backend: Literal["native", "browser"] = "native"
    pagination_verified: bool = False


class Geometry(BaseModel):
    type: Literal["LineString"]
    coordinates: list[list[float]]


class DirectionStep(BaseModel):
    instruction: str
    distance_meters: float | None = None
    maneuver: str | None = None
    turn_side: str | None = None
    turn_type: str | None = None
    road_names: list[str] = Field(default_factory=list)
    lane_hint: str | None = None


class LegTime(BaseModel):
    distance_meters: float
    typical_seconds: float
    traffic_seconds: float | None = None


class TrafficSpan(BaseModel):
    level: int
    start_meters: float
    length_meters: float


class Route(BaseModel):
    model_config = ConfigDict(extra="allow")
    source: Literal["google_consumer"] = "google_consumer"
    summary: str | None = None
    distance_meters: float | None = None
    typical_seconds: float | None = None
    traffic_seconds: float | None = None
    geometry: Geometry | None = None
    typical_low_seconds: float | None = None
    typical_high_seconds: float | None = None
    start: Coordinates | None = None
    end: Coordinates | None = None
    geometry_available: bool = False
    steps: list[DirectionStep] = Field(default_factory=list)
    leg_times: list[LegTime] = Field(default_factory=list)
    traffic_spans: list[TrafficSpan] = Field(default_factory=list)
    guidance_available: bool = Field(
        default=False,
        description="Supplied instruction text exists; turn positions and navigation readiness are unverified.",
    )


class DirectionsData(BaseModel):
    routes: list[Route]
    mode: Literal["driving", "walking", "bicycling"]
    completeness: Literal["unknown"] = "unknown"


class LevelDimensions(BaseModel):
    width: int
    height: int


class PanoramaNeighbor(BaseModel):
    pano_id: str
    latitude: float
    longitude: float
    bearing_degrees: float
    distance_meters: float


class PanoramaHistory(BaseModel):
    pano_id: str
    year: int
    month: int


class PanoramaData(BaseModel):
    model_config = ConfigDict(extra="allow")
    pano_id: str
    latitude: float
    longitude: float
    heading_degrees: float
    tile_size: int
    max_zoom: int = Field(description="Number of levels; highest valid index is max_zoom - 1")
    level_dimensions: list[LevelDimensions]
    address_label: str | None = None
    copyright: str | None = None
    capture_year: int | None = None
    capture_month: int | None = None
    neighbors: list[PanoramaNeighbor] = Field(default_factory=list)
    history: list[PanoramaHistory] = Field(default_factory=list)


DataType = TypeVar("DataType")


class Envelope(BaseModel, Generic[DataType]):
    data: DataType
    meta: Metadata
