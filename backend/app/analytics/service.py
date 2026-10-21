"""Generic, bounded exploration of real bundled national and policy data collections."""

from __future__ import annotations

import copy
import csv
import hashlib
import io
import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import fmean
from threading import RLock
from typing import Any

from app.analytics.models import ChartComparisonRequest, ChartRequest, DatasetFilter, DatasetQuery
from app.data.population import attach_population
from app.forecasting.source_versions import PassengerSourceVersions


@dataclass(frozen=True)
class DatasetSpec:
    id: str
    title: str
    file: str
    path: str = ""
    category: str = "Policy evidence"
    qualification: str = "Checked source snapshot; inspect record-level qualifications and dates."
    normalized: bool = False


SPECS = (
    DatasetSpec(
        "datathon-taxi-hourly",
        "Avas Ride historical journeys by starting hour, Aug–Sep 2026",
        "datathon/taxis.json",
        "hourly",
        "Historical mobility",
        "Completed-status source records, not unique people or all taxis. Source timezone and "
        "trip-time definition are undocumented. Medians/percentiles must not be summed. "
        "Recorded trip speed is not measured road congestion.",
    ),
    DatasetSpec(
        "datathon-taxi-daily",
        "Avas Ride historical journeys by date, Aug–Sep 2026",
        "datathon/taxis.json",
        "daily",
        "Historical mobility",
        "Historical completed-status records, not unique people. Expired records are excluded "
        "from travel metrics. Daily medians and percentiles must not be summed.",
    ),
    DatasetSpec(
        "datathon-taxi-corridors",
        "Avas Ride recorded island-to-island taxi corridors",
        "datathon/taxis.json",
        "corridors",
        "Historical mobility",
        "Strict mapped-island endpoint matches only; unmatched endpoints are excluded. "
        "Hulhulé is the broad airport island, not a terminal destination. Counts are historical "
        "records, not proven bus demand. Medians/percentiles must not be summed.",
    ),
    DatasetSpec(
        "datathon-taxi-corridor-hours",
        "Avas Ride taxi corridors by starting hour",
        "datathon/taxis.json",
        "corridorHourly",
        "Historical mobility",
        "One directional island corridor/hour profile with at least 30 completed-status records. "
        "Absent groups are withheld, not zero demand. Medians/percentiles must not be pooled "
        "or summed. Trip time is not taxi waiting time or road congestion.",
    ),
    DatasetSpec(
        "datathon-taxi-fares",
        "Avas Ride supplied car fare matrix (assumed MVR)",
        "datathon/taxis.json",
        "fares",
        "Historical mobility",
        "36 supplied zone pairs, interpreted as MVR; the CSV does not state currency. "
        "Fare effective dates and zone boundaries are not documented; "
        "these are source context, not current quotations or the planning cost model.",
    ),
    DatasetSpec(
        "datathon-airport-hourly",
        "MACL airport passenger movements by year and hour",
        "datathon/airport.json",
        "hourly",
        "Historical mobility",
        "Independent arrival/departure events in the supplied clock; timezone and named route "
        "lookup are unavailable. Invalid dates/times are excluded and audited. 2026 is Jan–Jul. "
        "Passenger movements are not unique travellers or ground-transport demand. "
        "Do not add this overlapping MACL series to CAA totals.",
    ),
    DatasetSpec(
        "datathon-airport-monthly",
        "MACL historical monthly airport passenger movements",
        "datathon/airport.json",
        "monthly",
        "Historical mobility",
        "One event/month/region; monthly rows overlap hourly and adult/child/infant totals. "
        "2026 covers Jan–Jul only. Invalid event dates are excluded and audited. "
        "Coverage differs from existing CAA/MBS statistics; no total reconciliation is assumed.",
    ),
    DatasetSpec(
        "datathon-vessel-daily",
        "FollowMe historical GPS coverage by day, Aug 2025",
        "datathon/vessels.json",
        "daily",
        "Historical mobility",
        "Recorded device activity, not ferry passenger counts or published services. Device "
        "collection clock timezone and speed units are undocumented. Devices may recur "
        "across days, so daily device counts must not be added as a unique fleet total.",
    ),
    DatasetSpec(
        "datathon-vessel-islands",
        "FollowMe recorded near-island vessel presence, Aug 2025",
        "datathon/vessels.json",
        "@vessel-islands",
        "Historical mobility",
        "Tracked devices inside or approximately 500m from exactly one mapped island. "
        "Ambiguous matches are excluded. Presence is not a ferry call, service frequency, "
        "passenger demand or a complete vessel census. Island device totals overlap.",
    ),
    DatasetSpec(
        "transport-monthly-context",
        "Official monthly ferry zones and bus/ferry categories, 2020–2026",
        "transport-context.json",
        "observations",
        "Transport",
        "All 19 published transport categories, with source blanks and six repeated June 2026 "
        "bus cells retained as unavailable/quarantined. Categories can overlap; "
        "these records do not extend the three reviewed passenger forecast series.",
    ),
    DatasetSpec(
        "national-planning-islands",
        "Additional resident planning islands",
        "national-population-origins.json",
        "islands",
        "National planning",
        "186 official administrative-island projection matches outside Greater Malé. "
        "Distributions are modeled; inspect the island-specific method and qualifications.",
    ),
    DatasetSpec(
        "national-resident-origins",
        "Additional national resident spatial estimates",
        "national-population-origins.json",
        "origins",
        "National planning",
        "Island projections allocated to screened existing raster or approximate residential "
        "footprints. These are modeled weights, not observed block residents or travel demand.",
    ),
    DatasetSpec(
        "national-planning-destinations",
        "Additional located national planning destinations",
        "national-planning-infrastructure.json",
        "facilities",
        "National planning",
        "Official institution identities with accepted existing location matches. "
        "Coordinates are approximate; no current capacity or entrance audit is implied.",
    ),
    DatasetSpec(
        "national-planning-stops",
        "Additional national passenger boarding points",
        "national-planning-infrastructure.json",
        "transit.stops",
        "National planning",
        "Official operator coordinates and existing mapped passenger stops. "
        "A mapped stop does not establish a verified timetable or operating service.",
    ),
    DatasetSpec(
        "national-operator-route-catalogues",
        "Additional official operator route catalogues",
        "national-planning-infrastructure.json",
        "transit.routeCatalogues",
        "National planning",
        "Official route membership only. Empty timings remain unavailable and do not create "
        "scheduled journeys.",
    ),
    DatasetSpec(
        "passenger-monthly",
        "Official monthly passenger movements",
        "prediction-source.json",
        "@passengers",
        "Passenger forecasts",
        (
            "Bus June 2026 is quarantined; ferry endpoint categories stay separate. Values are "
            "movements, not unique people."
        ),
    ),
    DatasetSpec(
        "planning-islands",
        "Greater Malé planning islands",
        "planning-baseline.json",
        "islands",
        "Planning baseline",
    ),
    DatasetSpec(
        "resident-origins",
        "Resident spatial estimates",
        "planning-baseline.json",
        "origins",
        "Planning baseline",
        (
            "WorldPop spatial weights normalized to island projections; estimates, not measured "
            "block-level population or travel demand."
        ),
    ),
    DatasetSpec(
        "planning-facilities",
        "Audited planning facilities",
        "planning-baseline.json",
        "facilities",
        "Planning baseline",
        (
            "Audited institutional identity and eligibility; mapped points are approximate and "
            "capacity/opening hours are unverified."
        ),
    ),
    DatasetSpec(
        "planning-network-nodes",
        "Planning street network nodes",
        "planning-baseline.json",
        "network.nodes",
        "Planning baseline",
    ),
    DatasetSpec(
        "planning-network-edges",
        "Planning street network edges",
        "planning-baseline.json",
        "network.edges",
        "Planning baseline",
        "OSM network geometry; travel-speed assumptions are not live traffic measurements.",
    ),
    DatasetSpec(
        "transit-stops",
        "Published bus and ferry stop records",
        "planning-baseline.json",
        "transit.stops",
        "Transport",
        (
            "Operator-published coordinates and code membership; physical operation remains "
            "independently unverified."
        ),
    ),
    DatasetSpec(
        "transit-patterns",
        "Transport direction and timing patterns",
        "planning-baseline.json",
        "transit.patterns",
        "Transport",
        "Recorded bus departures are a bounded capture, not a complete recurring bus calendar.",
    ),
    DatasetSpec(
        "transit-routes",
        "Planning service routes",
        "planning-baseline.json",
        "transit.routes",
        "Transport",
    ),
    DatasetSpec(
        "service-calendars",
        "Published recurring ferry calendars",
        "policy-evidence/service-calendars.json",
        "calendars",
        "Transport",
        (
            "Distinct day types and validity dates retained; unknown crossing times are not filled "
            "with observations."
        ),
    ),
    DatasetSpec(
        "current-transit-routes",
        "Reviewed operator route catalogue",
        "transit-operation-review.json",
        "currentRoutes",
        "Transport",
    ),
    DatasetSpec(
        "transit-stop-review",
        "Stop coverage and operating review",
        "transit-operation-review.json",
        "stops",
        "Transport",
    ),
    DatasetSpec(
        "transit-cautions",
        "Reviewed service cautions",
        "transit-operation-review.json",
        "operationalCautions",
        "Operations",
        "Dated cautions are unresolved desk evidence, not an all-clear or current closure census.",
    ),
    DatasetSpec(
        "stop-coordinate-audit",
        "Stop coordinate and name audit",
        "transit-stop-audit.json",
        "stops",
        "Transport",
    ),
    DatasetSpec(
        "education-review",
        "Education location and eligibility audit",
        "education-location-audit.json",
        "records",
        "Facilities",
    ),
    DatasetSpec(
        "facility-operation-review",
        "Education operating evidence",
        "facility-operation-review.json",
        "records",
        "Facilities",
    ),
    DatasetSpec(
        "healthcare-review",
        "Healthcare operating evidence",
        "healthcare-location-audit.json",
        "facilities",
        "Facilities",
    ),
    DatasetSpec(
        "healthcare-gaps",
        "Healthcare mapping gaps",
        "healthcare-location-audit.json",
        "coverageGaps",
        "Facilities",
    ),
    DatasetSpec(
        "policy-observations",
        "Household, education and planning observations",
        "policy-evidence/bundle.json",
        "observations",
        "Policy evidence",
        (
            "Metrics have different units, geographies and periods; filter them before aggregating "
            "values."
        ),
    ),
    DatasetSpec(
        "constituencies",
        "Greater Malé constituency census",
        "policy-evidence/bundle.json",
        "constituencies",
        "Demographics",
    ),
    *(
        DatasetSpec(
            f"constituency-{kind}-context",
            f"Official national constituency {kind} context, Census 2022",
            "constituency-context.json",
            kind,
            "Constituency context",
            "All 93 published source rows with unmatched boundaries. Source-row keys are "
            "not island IDs; repeated Meedhoo names are distinct rows. Filter/group one "
            "metric and use constituency_key for identity. Source ratios become percent "
            "explicitly; rates cannot be summed and means are unweighted. Blank cells stay "
            "null. Do not allocate constituency context to islands or resident origins.",
        )
        for kind in ("population", "employment", "education")
    ),
    DatasetSpec(
        "igmh-utilisation-history",
        "Official IGMH annual institutional history 2005–2025",
        "institution-context.json",
        "igmh",
        "Healthcare context",
        "Six reported institutional metrics with their own units; filter to one metric "
        "before comparing values. Blank/not-available cells stay null. Year-end beds are "
        "not available appointments, and encounters are not unique patients or resident demand.",
    ),
    DatasetSpec(
        "budget-programme-allocations",
        "Official Special Budget programme allocations 2024–2028",
        "official-finance-context.json",
        "budgetAllocations",
        "Finance context",
        "Nonoverlapping terminal programme lines from the captured Special Budget table; "
        "not the whole national budget. Actual/revised/budget years differ. MVR allocations "
        "do not establish delivered services, route subsidy receipts or marginal route costs.",
    ),
    DatasetSpec(
        "mtcc-segment-accounts",
        "MTCC audited Group segment accounts 2024–2025",
        "official-finance-context.json",
        "mtccSegmentAccounts",
        "Finance context",
        "Audited Group Note29 amounts in MVR; group total overlaps segment components, "
        "and metrics differ. No account has been divided into route, trip or passenger cost.",
    ),
    DatasetSpec(
        "mtcc-passenger-annual",
        "MTCC annual reported passenger movements 2022–2025",
        "official-finance-context.json",
        "mtccPassengerAnnual",
        "Transport",
        "Annual operator category totals, not unique people or route boardings. All modes "
        "overlaps bus/ferry; ferry totals overlap zones. May overlap MBS monthly publications.",
    ),
    DatasetSpec(
        "hies-expenditure-context",
        "Official HIES 2019 full expenditure indicators",
        "official-finance-context.json",
        "hiesExpenditure",
        "Finance context",
        "All 63 published indicators across Republic, Malé and Atolls. Nominal 2019 survey "
        "estimates; means, medians and shares cannot be summed. Published fractions are "
        "explicitly converted to percentages. No island or current-price allocation.",
    ),
    DatasetSpec(
        "government-health-license-history",
        "Government health facility license register as at 31 December 2024",
        "government-health-license-context.json",
        "licenses",
        "Healthcare context",
        "All 193 dated published facility license records, including source registration "
        "duplicates. Historical levels and issue dates establish no current opening, "
        "capacity, staffing or appointments. No facility or island match is asserted.",
    ),
    DatasetSpec(
        "weather-alerts",
        "Official captured weather alerts",
        "operations/bundle.json",
        "weatherAlerts",
        "Operations",
        (
            "Captured CAP alerts have sent/onset/expiry times; this dataset is a snapshot, not "
            "current weather."
        ),
    ),
    DatasetSpec(
        "road-events",
        "Captured public road notices",
        "operations/bundle.json",
        "roadEvents",
        "Operations",
        "No published records in a capture does not establish roads are clear.",
    ),
    DatasetSpec(
        "notice-candidates",
        "Notice ingestion review candidates",
        "operations/bundle.json",
        "noticeCandidates",
        "Operations",
        "Candidates require review before becoming authoritative disruptions.",
    ),
    DatasetSpec(
        "national-readiness",
        "Captured island population inventory",
        "operations/bundle.json",
        "nationalReadiness",
        "Demographics",
        (
            "Historical pre-expansion inventory, captured 11 October 2026. Its routingAvailable "
            "field describes that capture; inspect current island planning coverage for routes. "
            "Official census/projections are not observed origin-destination demand."
        ),
    ),
    DatasetSpec(
        "service-evidence",
        "Operator service coverage evidence",
        "operations/bundle.json",
        "serviceEvidence",
        "Operations",
    ),
    DatasetSpec(
        "vessel-port-calls",
        "Published MPL port call records",
        "context/agency-context.json",
        "layers.vessels.portCalls",
        "Agency context",
        "Published port movements, not live AIS tracks or confirmed public passenger services.",
    ),
    DatasetSpec(
        "vessel-observations",
        "MPL port aggregate observations",
        "context/agency-context.json",
        "layers.vessels.observations",
        "Agency context",
    ),
    DatasetSpec(
        "airport-observations",
        "CAA airport monthly and annual statistics",
        "context/agency-context.json",
        "layers.flights.observations",
        "Agency context",
        "Published aggregate CAA statistics; not live flight status or unique passengers.",
    ),
    DatasetSpec(
        "source-register",
        "Planning source and licence register",
        "planning-baseline.json",
        "sources",
        "Provenance",
    ),
    DatasetSpec(
        "policy-source-register",
        "Policy evidence sources",
        "policy-evidence/bundle.json",
        "sources",
        "Provenance",
    ),
    DatasetSpec(
        "national-islands",
        "Normalized national island catalogue",
        "islands.geojson",
        "features",
        "National backend",
        normalized=True,
    ),
    DatasetSpec(
        "national-facilities",
        "Normalized official national facilities",
        "facilities.json",
        "",
        "National backend",
        normalized=True,
    ),
    DatasetSpec(
        "national-population",
        "Normalized Census population records",
        "population.json",
        "",
        "National backend",
        (
            "Rows are demographic records and may overlap; population is not an additive total "
            "without selecting sex, nationality and age scope."
        ),
        True,
    ),
    DatasetSpec(
        "island-census-demographics",
        "Official island Census 2022 demographics",
        "island-context.json",
        "demographics",
        "Demographics",
        "One row per administrative island. Age counts and dependency ratios describe resident "
        "Maldivians only; overlapping age cohorts must not be added together.",
    ),
    DatasetSpec(
        "island-employment-indicators",
        "Official island Census 2022 labour indicators",
        "island-context.json",
        "employment",
        "Demographics",
        "Percentages at island, nationality scope and sex grain. Rates cannot be summed; "
        "no labour-force denominators or commute counts are supplied. "
        "Blank source cells stay null.",
    ),
    DatasetSpec(
        "island-population-projections",
        "Official annual island population projections 2022–2030",
        "island-context.json",
        "projections",
        "Demographics",
        "One island-year per row. MBS allocates atoll projections by ratio; nationality and sex "
        "columns overlap with resident totals. "
        "Select one year and population scope before summing.",
    ),
    DatasetSpec(
        "island-indicator-definitions",
        "Official census indicator definitions",
        "island-context.json",
        "definitions",
        "Provenance",
    ),
    DatasetSpec(
        "school-enrolment",
        "Official school locality enrolment by grade and sex, 2023/24",
        "school-context.json",
        "enrolment",
        "Education",
        "One published school-locality, grade and sex per row, November 2023. "
        "Localities describe where students enrolled, not homes, catchments or campus capacity. "
        "Source blanks stay null; combined localities are not forced onto one island.",
    ),
    DatasetSpec(
        "school-statistics-context",
        "Official school, teacher and national education statistics, 2023/24",
        "school-context.json",
        "statistics",
        "Education",
        "Published table cells with row and column dimensions, units and PDF page provenance. "
        "Tables repeat totals and have different scopes. Select one table, metric and "
        "demographic slice; never sum across tables. Conflicting source values are preserved.",
    ),
    DatasetSpec(
        "hdc-landuse-plan-context",
        "HDC Hulhumalé land-use plan panels, October 2025",
        "hdc-plan-context.json",
        "observations",
        "Land use",
        "Published phase areas, estimated capacity, land-use shares, housing types and lot counts. "
        "Planning values do not establish completed homes, occupancy or observed residents. "
        "Totals overlap phase values; the published capacity-total conflict is preserved.",
    ),
    DatasetSpec(
        "national-transport",
        "Normalized national transport records",
        "transport.json",
        "",
        "National backend",
        normalized=True,
    ),
)


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _flatten(value: dict[str, Any], prefix: str = "", depth: int = 0) -> dict[str, Any]:
    result = {}
    for key, item in value.items():
        name = f"{prefix}.{key}" if prefix else str(key)
        if key == "geometry" and isinstance(item, dict):
            result[f"{name}.type"] = item.get("type")
            continue
        if isinstance(item, dict) and depth < 3:
            result.update(_flatten(item, name, depth + 1))
        elif isinstance(item, (dict, list)):
            result[name] = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        else:
            result[name] = item
    return result


def _feature_row(item: dict[str, Any]) -> dict[str, Any]:
    if item.get("type") == "Feature":
        geometry = item.get("geometry") or {}
        row = {**item.get("properties", {})}
        if item.get("id") is not None:
            row.setdefault("id", item["id"])
        row["geometry_type"] = geometry.get("type")
        if geometry.get("type") == "Point":
            coordinates = geometry.get("coordinates", [])
            if len(coordinates) >= 2:
                row["longitude"], row["latitude"] = coordinates[:2]
        return _flatten(row)
    return _flatten(item)


class DatasetService:
    def __init__(self, public_dir: Path, runtime_dir: Path):
        self.public_dir, self.runtime_dir = Path(public_dir), Path(runtime_dir)
        self._files: dict[Path, tuple[int, int, Any, dict[str, Any]]] = {}
        self._collections: dict[str, tuple[str, list[dict[str, Any]], list[dict[str, Any]]]] = {}
        self._lock = RLock()

    def _read(self, path: Path, normalized: bool = False) -> tuple[Any, dict[str, Any]]:
        stat = path.stat()
        with self._lock:
            cached = self._files.get(path)
            if cached and cached[:2] == (stat.st_mtime_ns, stat.st_size):
                return cached[2], cached[3]
            content = path.read_bytes()
            data = json.loads(content)
            owner = self.runtime_dir if normalized else self.public_dir
            receipt = {
                "artifact": path.relative_to(owner).as_posix(),
                "sha256": hashlib.sha256(content).hexdigest(),
                "bytes": len(content),
                "data_status": "checked_snapshot",
            }
            self._files[path] = (stat.st_mtime_ns, stat.st_size, data, receipt)
            return data, receipt

    def mobility_patterns(self) -> dict[str, Any]:
        """Small historical profiles; source outages never become zero activity."""
        fields = {
            "airport": ("hourly", "monthly"),
            "taxis": ("hourly", "daily", "zones", "zoneHourly", "corridors", "corridorHourly"),
            "vessels": ("daily",),
        }
        result: dict[str, Any] = {}
        for name, collections in fields.items():
            path = self.public_dir / "datathon" / f"{name}.json"
            if not path.is_file():
                result[name] = {"status": "unavailable"}
                continue
            data, receipt = self._read(path)
            keys = (*collections, "coverage", "quality", "summary", "sources", "limitations")
            result[name] = {
                "status": "available",
                "receipt": receipt,
                **{key: data[key] for key in keys if key in data},
            }
        return result

    def island_mobility(self, island_id: str) -> dict[str, Any]:
        """Historical evidence scoped by canonical island identity, never model inputs."""
        catalogue, island_receipt = self._read(
            self.runtime_dir / "cache" / "normalized" / "islands.geojson", normalized=True
        )
        feature = next(
            (
                item
                for item in catalogue.get("features", [])
                if str(item.get("id") or item.get("properties", {}).get("id")) == island_id
            ),
            None,
        )
        if feature is None:
            raise KeyError(f"Island not found: {island_id}")
        properties = feature.get("properties", {})
        result: dict[str, Any] = {
            "island": {
                "id": island_id,
                "name": properties.get("name"),
                "atoll": properties.get("atoll"),
            },
            "catalogue_receipt": island_receipt,
        }

        def source(name: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
            path = self.public_dir / "datathon" / f"{name}.json"
            if not path.is_file():
                return None
            data, receipt = self._read(path)
            return data, {
                "receipt": receipt,
                "sources": data.get("sources", []),
                "limitations": data.get("limitations", []),
            }

        def selected(row: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
            return {key: row[key] for key in keys if key in row}

        vessel_source = source("vessels")
        if vessel_source is None:
            result["vessels"] = {"status": "unavailable", "reason": "Source snapshot unavailable"}
        else:
            data, metadata = vessel_source
            island = next(
                (row for row in data.get("islands", []) if row.get("island_id") == island_id),
                None,
            )
            method, coverage = data.get("method", {}), data.get("coverage", {})
            result["vessels"] = {
                **metadata,
                "status": "available" if island is not None else "no_matched_records",
                "period": data.get("period"),
                "summary": (
                    selected(island, ("tracked_devices", "gps_records", "days_observed"))
                    if island is not None
                    else None
                ),
                "daily": [
                    selected(row, ("date", "tracked_devices", "gps_records"))
                    for row in (island or {}).get("daily", [])
                ],
                "coverage": {
                    "source_days": coverage.get("days"),
                    "source_tracked_devices": coverage.get("tracked_devices"),
                    "spatial_match": method.get("spatial_match"),
                    "time_field": method.get("time_field"),
                    "timezone": method.get("timezone"),
                    "missing_daily_values": "Unknown presence, not zero boats or zero service",
                },
            }

        # These national OneMap IDs have centroids inside the corresponding existing
        # derived Greater Malé polygons used to prepare Avas Ride profiles. No name join.
        capital_zones = {
            "island:1443": "male",
            "island:1442": "hulhumale",
            "island:1483": "hulhule",
        }
        zone = capital_zones.get(island_id)
        if zone is None:
            result["taxis"] = {
                "status": "not_applicable",
                "reason": "Taxi profiles cover only the three matched Greater Malé island zones",
            }
        elif (taxi_source := source("taxis")) is None:
            result["taxis"] = {"status": "unavailable", "reason": "Source snapshot unavailable"}
        else:
            data, metadata = taxi_source
            coverage = data.get("coverage", {})
            profile_keys = (
                "pickup_zone",
                "dropoff_zone",
                "hour",
                "ride_count",
                "median_minutes",
                "p90_minutes",
                "median_km",
                "recorded_speed_kph",
                "source_id",
            )

            def profiles(collection: str, key: str) -> list[dict[str, Any]]:
                return [
                    selected(row, profile_keys)
                    for row in data.get(collection, [])
                    if row.get(key) == zone
                ]

            pickup = profiles("zones", "pickup_zone")
            result["taxis"] = {
                **metadata,
                "status": "available" if pickup else "no_matched_records",
                "zone": {"id": zone, "island_id": island_id, "name": properties.get("name")},
                "period": {"from": coverage.get("date_from"), "through": coverage.get("date_to")},
                "pickup_summary": pickup[0] if pickup else None,
                "pickup_hourly": profiles("zoneHourly", "pickup_zone"),
                "outbound_corridors": profiles("corridors", "pickup_zone"),
                "inbound_corridors": profiles("corridors", "dropoff_zone"),
                "outbound_hourly": profiles("corridorHourly", "pickup_zone"),
                "inbound_hourly": profiles("corridorHourly", "dropoff_zone"),
                "coverage": {
                    "source_completed_records": coverage.get("completed_records"),
                    "source_observed_days": coverage.get("observed_days"),
                    "minimum_profile_records": data.get("quality", {}).get(
                        "minimum_profile_records"
                    ),
                    "spatial_basis": coverage.get("spatial_basis"),
                    "missing_profiles": "Unknown or withheld small groups, not zero trips",
                },
                "profile_notes": [
                    "Precomputed corridor/hour statistics; "
                    "medians and percentiles cannot be pooled.",
                    "Within-island corridors appear in both directions; do not add the two lists.",
                    "Pickup profiles can include unmatched dropoffs; corridor profiles cannot.",
                ],
            }

        if island_id != "island:1483":
            result["airport"] = {
                "status": "not_applicable",
                "reason": "No island-specific airport series is attributed to this island",
            }
        elif (airport_source := source("airport")) is None:
            result["airport"] = {"status": "unavailable", "reason": "Source snapshot unavailable"}
        else:
            data, metadata = airport_source
            coverage = data.get("coverage", {})
            result["airport"] = {
                **metadata,
                "status": "unattributed",
                "period": {
                    "from": coverage.get("firstPeriod"),
                    "through": coverage.get("lastPeriod"),
                },
                "reason": (
                    "MACL history has no named airport/route lookup; its volumes cannot be "
                    "attributed to Hulhulé. No island airport counts are inferred."
                ),
            }
        return result

    def _specs(self) -> dict[str, DatasetSpec]:
        result = {item.id: item for item in SPECS}
        path = self.public_dir / "policy-evidence" / "bundle.json"
        if path.is_file():
            data, _ = self._read(path)
            for layer in data.get("layers", []):
                identifier = "policy-layer-" + layer["id"]
                result[identifier] = DatasetSpec(
                    identifier,
                    layer.get("title", layer["id"]),
                    "policy-evidence/bundle.json",
                    "@layer:" + layer["id"],
                    "Spatial policy layers",
                    "; ".join(layer.get("limitations", []))
                    or "Source-published spatial policy layer",
                )
        return result

    def _path(self, spec: DatasetSpec) -> Path:
        return (
            self.runtime_dir / "cache" / "normalized" if spec.normalized else self.public_dir
        ) / spec.file

    def _extract(
        self,
        spec: DatasetSpec,
        data: Any,
        population_islands: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        if spec.path == "@vessel-islands":
            return [
                {key: value for key, value in island.items() if key not in {"daily", "hourly"}}
                for island in data.get("islands", [])
            ]
        if spec.path == "@passengers":
            return [
                {
                    "series_id": item["id"],
                    "name": item["name"],
                    "mode": item["mode"],
                    "geography": item["geography"],
                    "unit": item["unit"],
                    "source_url": item["sourceUrl"],
                    "qualification": item["qualification"],
                    "last_actual_month": item["lastActualMonth"],
                    **point,
                }
                for item in data.get("series", [])
                for point in item.get("points", [])
            ]
        if spec.path.startswith("@layer:"):
            layer = next(
                item for item in data.get("layers", []) if item["id"] == spec.path.split(":", 1)[1]
            )
            value = layer.get("features", [])
            if isinstance(value, dict):
                value = value.get("features", [])
        else:
            value = data
            for key in spec.path.split(".") if spec.path else []:
                value = value.get(key, []) if isinstance(value, dict) else []
        if isinstance(value, dict):
            if "features" in value:
                value = value["features"]
            else:
                value = [
                    {"record_key": key, **item}
                    if isinstance(item, dict)
                    else {"record_key": key, "value": item}
                    for key, item in value.items()
                ]
        if not isinstance(value, list):
            raise ValueError("Dataset collection is not a table")
        if population_islands is not None:
            value = copy.deepcopy(value)
            attach_population(value, population_islands)
        return [_feature_row(item) if isinstance(item, dict) else {"value": item} for item in value]

    def _columns(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        names = sorted({key for row in rows for key in row})
        result = []
        for name in names:
            values = [row[name] for row in rows if row.get(name) is not None]
            kinds = {
                "boolean" if isinstance(value, bool) else "number" if _number(value) else "string"
                for value in values
            }
            kind = next(iter(kinds)) if len(kinds) == 1 else "mixed" if kinds else "unknown"
            result.append(
                {
                    "name": name,
                    "type": kind,
                    "nullable": len(values) < len(rows),
                    "missing_count": len(rows) - len(values),
                    "distinct_count": len({str(value) for value in values}),
                    "examples": list(dict.fromkeys(str(value) for value in values))[:3],
                }
            )
        return result

    def _load(self, dataset_id: str) -> tuple[DatasetSpec, list[dict[str, Any]], dict[str, Any]]:
        spec = self._specs().get(dataset_id)
        if spec is None:
            raise KeyError(f"Dataset not found: {dataset_id}")
        path = self._path(spec)
        if not path.is_file():
            raise FileNotFoundError(f"Source snapshot is unavailable for {spec.title}")
        imported = (
            PassengerSourceVersions(self.runtime_dir / "metadata" / "passenger-sources").active()
            if spec.id == "passenger-monthly"
            else None
        )
        if imported:
            data = imported["source"]
            receipt = {
                "artifact": "metadata/passenger-sources/" + imported["versionId"] + ".json",
                "sha256": imported["sourceSha256"],
                "data_status": "user_reviewed_import",
                "importReview": imported["review"],
                "qualification": imported["qualification"],
            }
        else:
            data, receipt = self._read(path, spec.normalized)
        population_islands = None
        fingerprint = receipt["sha256"]
        if spec.id == "national-population":
            islands_path = self.runtime_dir / "cache" / "normalized" / "islands.geojson"
            if islands_path.is_file():
                islands, island_receipt = self._read(islands_path, normalized=True)
                population_islands = islands.get("features", [])
                # Census rows also depend on the island identity reconciliation.
                # Retain the primary source hash and expose the joining input separately.
                receipt = {**receipt, "dependencies": [island_receipt]}
                fingerprint += ":" + island_receipt["sha256"]
        cached = self._collections.get(dataset_id)
        if cached and cached[0] == fingerprint:
            rows, columns = cached[1:]
        else:
            rows = self._extract(spec, data, population_islands)
            columns = self._columns(rows)
            self._collections[dataset_id] = (fingerprint, rows, columns)
        timestamps = {}
        sources = []
        if isinstance(data, dict):
            timestamps = {
                key: data[key]
                for key in (
                    "generatedAt",
                    "asOf",
                    "reviewedAt",
                    "referenceDate",
                    "sourceSnapshotUtc",
                )
                if key in data
            }
            sources = data.get("sources", [])
            if spec.path == "@passengers":
                sources = [
                    {"id": key, **item}
                    for key, item in data.get("audit", {}).get("sources", {}).items()
                ]
            if spec.path.startswith("@layer:"):
                layer = next(
                    item for item in data["layers"] if item["id"] == spec.path.split(":", 1)[1]
                )
                ids = set(layer.get("sourceIds", []))
                sources = [item for item in sources if item.get("id") in ids]
        metadata = {
            "id": spec.id,
            "title": spec.title,
            "category": spec.category,
            "row_count": len(rows),
            "columns": columns,
            "qualification": spec.qualification,
            "transformVersion": (
                "census-atoll-locality-v2"
                if spec.id == "national-population"
                else data.get("transformVersion")
                if isinstance(data, dict)
                else None
            ),
            "provenance": {"receipt": receipt, "timestamps": timestamps, "sources": sources},
        }
        return spec, rows, metadata

    def catalogue(self) -> dict[str, Any]:
        items = []
        for spec in self._specs().values():
            try:
                _, _, metadata = self._load(spec.id)
                items.append({**metadata, "status": "available"})
            except FileNotFoundError:
                items.append(
                    {
                        "id": spec.id,
                        "title": spec.title,
                        "category": spec.category,
                        "row_count": None,
                        "columns": [],
                        "status": "unavailable",
                        "qualification": "Source snapshot is not installed",
                    }
                )
        return {
            "items": items,
            "total": len(items),
            "available": sum(item["status"] == "available" for item in items),
            "qualification": (
                "Collections preserve their own units, geography, grain and snapshot dates. "
                "They are not automatically joined or summed across incompatible scopes."
            ),
        }

    def schema(self, dataset_id: str) -> dict[str, Any]:
        return self._load(dataset_id)[2]

    def _validate_columns(self, metadata: dict[str, Any], names: list[str]) -> None:
        known = {item["name"] for item in metadata["columns"]}
        if unknown := set(names) - known:
            raise ValueError("Unknown columns: " + ", ".join(sorted(unknown)))

    def _matches(self, row: dict[str, Any], rule: DatasetFilter) -> bool:
        current, value = row.get(rule.column), rule.value
        if rule.op == "missing":
            return (current is None or current == "") == (value is not False)
        if rule.op == "eq":
            return (
                type(current) is type(value)
                and current == value
                or (_number(current) and _number(value) and current == value)
            )
        if rule.op == "ne":
            return not self._matches(row, DatasetFilter(column=rule.column, value=value))
        if rule.op == "contains":
            return current is not None and str(value).casefold() in str(current).casefold()
        if rule.op == "in":
            return any(
                self._matches(row, DatasetFilter(column=rule.column, value=item)) for item in value
            )
        if not _number(current):
            return False
        return {
            "gte": current >= value,
            "lte": current <= value,
            "gt": current > value,
            "lt": current < value,
        }[rule.op]

    def _filtered(
        self, rows: list[dict[str, Any]], metadata: dict[str, Any], query: DatasetQuery
    ) -> list[dict[str, Any]]:
        self._validate_columns(metadata, [item.column for item in query.filters])
        needle = (query.q or "").casefold().strip()
        return [
            row
            for row in rows
            if (
                not needle
                or any(
                    needle in str(value).casefold() for value in row.values() if value is not None
                )
            )
            and all(self._matches(row, rule) for rule in query.filters)
        ]

    def query(self, dataset_id: str, query: DatasetQuery) -> dict[str, Any]:
        _, rows, metadata = self._load(dataset_id)
        self._validate_columns(
            metadata, ([query.sort] if query.sort else []) + (query.columns or [])
        )
        filtered = self._ordered(self._filtered(rows, metadata, query), query)
        page = filtered[query.offset : query.offset + query.limit]
        if query.columns:
            page = [{key: row.get(key) for key in query.columns} for row in page]
        return {
            "dataset": metadata,
            "items": page,
            "total": len(filtered),
            "limit": query.limit,
            "offset": query.offset,
            "query": query.model_dump(),
        }

    def _ordered(self, filtered: list[dict[str, Any]], query: DatasetQuery) -> list[dict[str, Any]]:
        """Share null-last ordering between paginated rows and complete exports."""
        if query.sort:
            present = [row for row in filtered if row.get(query.sort) is not None]
            missing = [row for row in filtered if row.get(query.sort) is None]
            present.sort(
                key=lambda row: (
                    (0, float(row[query.sort]))
                    if _number(row[query.sort])
                    else (1, str(row[query.sort]).casefold())
                ),
                reverse=query.descending,
            )
            filtered = present + missing
        return filtered

    def chart(self, dataset_id: str, request: ChartRequest) -> dict[str, Any]:
        _, rows, metadata = self._load(dataset_id)
        columns = [request.group_by] + ([request.series_by] if request.series_by else [])
        columns += [request.measure] if request.measure else []
        self._validate_columns(metadata, columns)
        query = DatasetQuery(q=request.q, filters=request.filters)
        filtered = self._filtered(rows, metadata, query)
        if request.aggregation != "count":
            column = next(item for item in metadata["columns"] if item["name"] == request.measure)
            if column["type"] not in {"number", "unknown"}:
                raise ValueError("Chart measure must be a numeric column")
            if dataset_id == "transport-monthly-context" and request.measure in {
                "value",
                "published_value",
            }:
                if len({row["category_id"] for row in filtered}) > 1 and not (
                    {"category_id", "category"}.intersection(columns)
                ):
                    raise ValueError(
                        "Overlapping transport categories require a filter or grouping"
                    )
                if request.measure == "published_value" and any(
                    row["value_status"].startswith("quarantined") for row in filtered
                ):
                    raise ValueError("Use value to keep quarantined transport cells unavailable")
            if dataset_id in {
                "constituency-population-context",
                "constituency-employment-context",
                "constituency-education-context",
            } and request.measure in {"value", "published_value"}:
                if len({row["metric"] for row in filtered}) > 1 and "metric" not in columns:
                    raise ValueError("Constituency values require a metric filter or grouping")
                if request.aggregation == "sum" and any(
                    row["unit"] != "people" for row in filtered
                ):
                    raise ValueError("Constituency rates and sex ratios cannot be summed")
                if "constituency" in columns and "constituency_key" not in columns:
                    name_keys: dict[str, set[str]] = defaultdict(set)
                    for row in filtered:
                        name_keys[row["constituency"]].add(row["constituency_key"])
                    if any(len(keys) > 1 for keys in name_keys.values()):
                        raise ValueError(
                            "Repeated constituency names require constituency_key grouping"
                        )
            if dataset_id == "island-employment-indicators":
                if request.aggregation == "sum":
                    raise ValueError("Published labour rates cannot be summed")
                for scope_column in ("population_scope", "sex"):
                    if len({row.get(scope_column) for row in filtered}) > 1 and (
                        scope_column not in columns
                    ):
                        raise ValueError(
                            "Labour rates require population_scope and sex filters or grouping"
                        )
            if dataset_id == "island-population-projections" and request.aggregation == "sum":
                if len({row["year"] for row in filtered}) > 1 and "year" not in columns:
                    raise ValueError("Projected population sums require a year filter or grouping")
            if dataset_id == "island-census-demographics" and request.aggregation == "sum":
                non_additive = ("percent", "ratio", "median_age", "_per_square_km")
                if any(token in (request.measure or "") for token in non_additive):
                    raise ValueError("Census rates, medians and densities cannot be summed")
            if dataset_id == "school-statistics-context" and request.measure == "value":
                for scope in ("table_id", "metric", "sex"):
                    if len({row.get(scope) for row in filtered}) > 1 and scope not in columns:
                        raise ValueError(
                            "School context requires table_id, metric and sex filters or grouping"
                        )
                if request.aggregation == "sum" and (
                    any(row.get("unit") in {"percent", "ratio"} for row in filtered)
                    or any(row.get("is_total") for row in filtered)
                    and len(filtered) > 1
                ):
                    raise ValueError(
                        "Published school rates and overlapping totals cannot be summed"
                    )
            if dataset_id == "hdc-landuse-plan-context" and request.measure == "value":
                if len({row["metric"] for row in filtered}) > 1 and "metric" not in columns:
                    raise ValueError("HDC planning values require a metric filter or grouping")
                if request.aggregation == "sum" and (
                    any(row["unit"] == "percent" for row in filtered)
                    or any(row["is_total"] for row in filtered)
                    and len(filtered) > 1
                ):
                    raise ValueError("HDC plan percentages and overlapping totals cannot be summed")
            if dataset_id == "igmh-utilisation-history" and request.aggregation == "sum":
                non_additive = {
                    "hospital_beds",
                    "average_duration_of_stay",
                    "average_occupancy_ratio",
                }
                if (
                    request.measure == "value"
                    and any(row["metric"] in non_additive for row in filtered)
                    and len({row["year"] for row in filtered}) > 1
                    and "year" not in columns
                ):
                    raise ValueError(
                        "IGMH beds, mean stay and occupancy cannot be summed across years"
                    )
            if dataset_id == "budget-programme-allocations" and request.aggregation == "sum":
                if len({row["year"] for row in filtered}) > 1 and "year" not in columns:
                    raise ValueError("Budget sums require one fiscal year or year grouping")
            if dataset_id == "mtcc-segment-accounts" and request.measure == "value":
                for scope in ("metric", "year"):
                    if len({row[scope] for row in filtered}) > 1 and scope not in columns:
                        raise ValueError(
                            "MTCC accounts require metric and year filters or grouping"
                        )
                if (
                    any(row["is_group_total"] for row in filtered)
                    and any(not row["is_group_total"] for row in filtered)
                    and "segment" not in columns
                    and "is_group_total" not in columns
                ):
                    raise ValueError("MTCC group totals overlap their business segments")
            if dataset_id == "mtcc-passenger-annual" and request.measure == "value":
                if len({row["series"] for row in filtered}) > 1 and "series" not in columns:
                    raise ValueError(
                        "Overlapping MTCC passenger series require a filter or grouping"
                    )
            if dataset_id == "hies-expenditure-context" and request.measure in {
                "value",
                "published_value",
            }:
                if request.aggregation == "sum":
                    raise ValueError("HIES means, medians and shares cannot be summed")
                for scope in ("section", "indicator", "geography"):
                    if len({row[scope] for row in filtered}) > 1 and scope not in columns:
                        raise ValueError(
                            "HIES estimates require section, indicator and geography "
                            "filters or grouping"
                        )
        # Mixed metric records must be scoped rather than adding MVR to people or years.
        for unit_column in ("unit", "units"):
            units = {str(row[unit_column]) for row in filtered if row.get(unit_column)}
            if request.aggregation != "count" and len(units) > 1 and unit_column not in columns:
                raise ValueError(
                    "Mixed units require a unit filter or unit grouping before aggregation"
                )
        groups: dict[tuple[str, str | None], list[dict[str, Any]]] = defaultdict(list)
        for row in filtered:
            group = (
                str(row.get(request.group_by))
                if row.get(request.group_by) is not None
                else "(missing)"
            )
            series = (
                (
                    str(row.get(request.series_by))
                    if row.get(request.series_by) is not None
                    else "(missing)"
                )
                if request.series_by
                else None
            )
            groups[group, series].append(row)
        items = []
        for (group, series), members in groups.items():
            values = [row[request.measure] for row in members if _number(row.get(request.measure))]
            if (
                dataset_id.startswith("datathon-taxi-")
                and request.measure
                in {"median_minutes", "p90_minutes", "median_km", "recorded_speed_kph"}
                and request.aggregation in {"sum", "mean"}
                and len(values) > 1
            ):
                raise ValueError(
                    "Taxi medians, percentiles and speeds cannot be pooled by summing or "
                    "averaging summaries; filter to one profile per group or use Mobility patterns"
                )
            if (
                dataset_id.startswith("datathon-vessel-")
                and request.measure == "tracked_devices"
                and request.aggregation == "sum"
                and len(values) > 1
            ):
                raise ValueError(
                    "Tracked devices can recur across dates and islands; their summary "
                    "counts cannot be summed into a unique fleet total"
                )
            if request.aggregation == "count":
                value: float | int | None = len(members)
            elif not values:
                value = None
            else:
                value = {"sum": sum, "mean": fmean, "min": min, "max": max}[request.aggregation](
                    values
                )
            items.append(
                {
                    "group": group,
                    "series": series,
                    "value": value,
                    "row_count": len(members),
                    "missing_measure_count": (
                        len(members) - len(values) if request.aggregation != "count" else 0
                    ),
                }
            )
        if request.sort == "value":
            present = [item for item in items if item["value"] is not None]
            absent = [item for item in items if item["value"] is None]
            present.sort(key=lambda item: item["value"], reverse=request.descending)
            items = present + absent
        else:
            items.sort(
                key=lambda item: (item["group"], item["series"] or ""), reverse=request.descending
            )
        return {
            "dataset": metadata,
            "definition": request.model_dump(),
            "items": items[: request.limit],
            "total_groups": len(items),
            "truncated": len(items) > request.limit,
            "matched_rows": len(filtered),
            "qualification": (
                "Aggregations use all filtered rows before the displayed group limit. "
                "Missing measures remain missing; count is record count, not population or riders."
            ),
        }

    def csv(self, dataset_id: str, query: DatasetQuery) -> str:
        _, rows, metadata = self._load(dataset_id)
        self._validate_columns(
            metadata, ([query.sort] if query.sort else []) + (query.columns or [])
        )
        names = query.columns or [item["name"] for item in metadata["columns"]]
        filtered = self._filtered(rows, metadata, query)
        if len(filtered) > 100000:
            raise ValueError("CSV export is limited to 100,000 filtered records; narrow the query")
        filtered = self._ordered(filtered, query)
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(names)
        for row in filtered:
            # Neutralize spreadsheet formula execution without altering the JSON API values.
            values = []
            for name in names:
                value = row.get(name)
                if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
                    value = "'" + value
                values.append(value)
            writer.writerow(values)
        return output.getvalue()

    def compare(self, request: ChartComparisonRequest) -> dict[str, Any]:
        """Align explicit aggregate plot keys; never infer joins from display names."""
        charts = [
            self.chart(source.dataset_id, source.query)
            for source in (request.primary, request.comparison)
        ]
        if any(chart["truncated"] for chart in charts):
            raise ValueError(
                "Comparison requires complete groups; filter or increase the group limit"
            )
        chart_keys = [{item["group"] for item in chart["items"]} for chart in charts]
        common = set.intersection(*chart_keys)
        keys = sorted(common if request.alignment == "common" else set.union(*chart_keys))
        if not keys:
            raise ValueError(
                "No shared keys at this scope; select another grouping or use union alignment"
            )
        patterns = {"calendar-month": r"\d{4}-(0[1-9]|1[0-2])", "calendar-year": r"\d{4}"}
        if request.key_domain in patterns and any(
            not re.fullmatch(patterns[request.key_domain], key) for key in keys
        ):
            raise ValueError("Plot keys do not match the declared calendar grain")
        if request.key_domain == "island-id" and any(
            source.query.group_by not in {"id", "island_id", "islandId", "properties.id"}
            for source in (request.primary, request.comparison)
        ):
            raise ValueError("Island alignment requires identifier columns, not display names")
        source_units = []
        for source in (request.primary, request.comparison):
            _, source_rows, metadata = self._load(source.dataset_id)
            filtered = self._filtered(
                source_rows, metadata, DatasetQuery(q=source.query.q, filters=source.query.filters)
            )
            units = {
                str(row[column])
                for row in filtered
                for column in ("unit", "units")
                if row.get(column)
            }
            if source.query.aggregation != "count" and len(units) > 1 and request.mode == "values":
                raise ValueError(
                    "Different units require indexed comparison; raw values cannot share an axis"
                )
            source_units.append(
                "record count"
                if source.query.aggregation == "count"
                else next(iter(units))
                if len(units) == 1
                else source.query.measure
            )
        if request.mode == "values" and source_units[0] != source_units[1]:
            raise ValueError(
                "Different units require indexed comparison; raw values cannot share an axis"
            )
        series_items: dict[str, dict[str, Any]] = {}
        for index, chart in enumerate(charts):
            source = (request.primary, request.comparison)[index]
            # User-facing labels are not unique identities. Retain the source
            # prefix even when both charts have the same custom label.
            label = f"{'A' if index == 0 else 'B'} · {source.label or chart['dataset']['title']}"
            for item in chart["items"]:
                name = f"{label} · {item['series'] or source.query.measure or source_units[index]}"
                series_items.setdefault(name, {})[item["group"]] = item
        base_key = None
        if request.mode == "indexed":
            base_key = next(
                (
                    key
                    for key in sorted(common)
                    if all(
                        key in values and _number(values[key]["value"]) and values[key]["value"] > 0
                        for values in series_items.values()
                    )
                ),
                None,
            )
            if base_key is None:
                raise ValueError(
                    "Indexed comparison needs a shared positive observation for every series"
                )
        rows = []
        for name, values in series_items.items():
            for key in keys:
                item = values.get(key)
                raw = item["value"] if item else None
                value = (
                    raw / values[base_key]["value"] * 100 if base_key and raw is not None else raw
                )
                rows.append(
                    {
                        "group": key,
                        "series": name,
                        "value": value,
                        "raw_value": raw,
                        "row_count": item["row_count"] if item else 0,
                        "missing_measure_count": item["missing_measure_count"] if item else 0,
                    }
                )
        return {
            "definition": request.model_dump(),
            "items": rows,
            "total_groups": len(keys),
            "matched_rows": sum(chart["matched_rows"] for chart in charts),
            "truncated": False,
            "mode": request.mode,
            "alignment": request.alignment,
            "base_key": base_key,
            "unit": "index (common base = 100)" if base_key else source_units[0],
            "datasets": [chart["dataset"] for chart in charts],
            "qualification": (
                "Explicit plot-key alignment retains each source scope and receipt. Equal keys do "
                "not establish matching populations, causal relationships or additive measures. "
                "Union alignment leaves absent observations missing; no interpolation is applied."
            ),
        }
