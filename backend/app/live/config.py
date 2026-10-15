"""Validated live-provider configuration and Maldives coverage defaults."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class LiveConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_agent: str = "MobilitySandboxMV/0.1 (live layer; contact: unset)"
    cache_ttl_seconds: int = Field(default=60, ge=1, le=3600)
    request_timeout_seconds: float = Field(default=10.0, gt=0, le=60)
    poll_interval_seconds: int = Field(default=60, ge=5, le=3600)
    aircraft_enabled: bool = True
    vessel_enabled: bool = True
    bus_enabled: bool = False
    followme_enabled: bool = True
    adsb_url: str = "https://api.adsb.lol/v2/point"
    opensky_url: str = "https://opensky-network.org/api/states/all"
    opensky_cache_ttl_seconds: int = Field(default=300, ge=180, le=3600)
    openwaters_url: str = "https://ais.openwaters.io/v1/vessels"
    facha_url: str = "https://api.facha.dev/v1/ship/radius"
    rtl_url: str = "https://bo.rtl.mv:4455/maldives/api"
    followme_catalogue_url: str = "https://m.followme.mv/public/"
    followme_device_url: str = "https://m.followme.mv/public/api/device.php"
    followme_neighbours_url: str = "https://m.followme.mv/public/api/neighbours.php"
    followme_islands_url: str = "https://m.followme.mv/public/api/islands.php"
    followme_eta_url: str = "https://m.followme.mv/public/api/eta.php"
    followme_cache_ttl_seconds: int = Field(default=15, ge=1, le=3600)
    followme_catalogue_ttl_seconds: int = Field(default=900, ge=1, le=86400)
    followme_min_interval_seconds: float = Field(default=1.0, ge=0, le=60)
    default_latitude: float = Field(default=4.1755, ge=-90, le=90)
    default_longitude: float = Field(default=73.5093, ge=-180, le=180)
    default_radius_nm: float = Field(default=250, gt=0, le=500)


DEFAULT_LIVE_CONFIG = LiveConfig()
