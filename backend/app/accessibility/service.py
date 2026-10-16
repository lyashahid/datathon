"""Explainable accessibility scoring over normalized static artifacts."""

from __future__ import annotations

import hashlib
import json
import math
from copy import deepcopy
from pathlib import Path
from typing import Any

from app.accessibility.assessment import ASSESSMENT_VERSION, island_assessment
from app.accessibility.config import DEFAULT_ACCESSIBILITY_CONFIG, AccessibilityConfig
from app.accessibility.evidence import scored_facilities
from app.analytics.sources import public_data_directory
from app.data.cache import FileCache
from app.data.computed_cache import ComputedCache, model_code_version
from app.data.national_transport import (
    CAPITAL_ISLAND_IDS,
    NATIONAL_TRANSPORT_ARTIFACT,
    merge_national_boarding_points,
    national_transport_path,
)
from app.data.population import POPULATION_TRANSFORM_VERSION, attach_population, population_summary
from app.routing.engine import RoutingRepository


class AccessibilityService:
    def __init__(
        self,
        data_dir: Path,
        routing: RoutingRepository,
        *,
        computed_cache: ComputedCache | None = None,
        public_dir: Path | None = None,
    ) -> None:
        self.cache = FileCache(data_dir / "cache")
        self.routing = routing
        self.public_dir = public_dir or public_data_directory()
        self.islands: dict[str, dict[str, Any]] = {}
        self.facilities: list[dict[str, Any]] = []
        self.transport: list[dict[str, Any]] = []
        self.anchors: list[dict[str, Any]] = []
        self.population: list[dict[str, Any]] = []
        self.source_fingerprint: dict[str, str] = {}
        self._default_artifact: dict[str, Any] | None = None
        self._default_by_id: dict[str, dict[str, Any]] = {}
        self.computed_cache = computed_cache
        self._loaded = False
        self._captured_fingerprint: str | None = None

    def reload(self) -> None:
        self._default_artifact = None
        self._default_by_id = {}
        self.source_fingerprint = {}
        for relative in (
            "normalized/islands.geojson",
            "normalized/population.json",
            "normalized/facilities.json",
            "normalized/transport.json",
            "derived/demand-anchors.json",
            "graphs/land.json",
            "graphs/marine.json",
        ):
            path = self.cache.path(relative)
            if path.exists():
                with path.open("rb") as content:
                    self.source_fingerprint[relative] = hashlib.file_digest(
                        content, "sha256"
                    ).hexdigest()
        island_data = self._read_json("normalized/islands.geojson", {"features": []})
        self.islands = {
            feature["properties"]["id"]: feature
            for feature in island_data.get("features", [])
            if feature.get("properties", {}).get("id")
        }
        self.facilities = self._read_json("normalized/facilities.json", [])
        self.population = self._read_json("normalized/population.json", [])
        attach_population(self.population, list(self.islands.values()))
        transport_data = self._read_json("normalized/transport.json", {"features": []})
        self.transport = transport_data.get("features", [])
        transport_path = national_transport_path(self.public_dir)
        if transport_path.is_file():
            content = transport_path.read_bytes()
            self.source_fingerprint[f"public/{NATIONAL_TRANSPORT_ARTIFACT}"] = hashlib.sha256(
                content
            ).hexdigest()
            self.transport = merge_national_boarding_points(self.transport, json.loads(content))
        demand_data = self._read_json("derived/demand-anchors.json", {"anchors": []})
        self.anchors = demand_data.get("anchors", [])
        captured = self.cache.path("derived/accessibility-default.json")
        self._captured_fingerprint = (
            hashlib.sha256(captured.read_bytes()).hexdigest() if captured.exists() else None
        )
        self._loaded = True

    def config(self) -> dict[str, Any]:
        return DEFAULT_ACCESSIBILITY_CONFIG.model_dump(mode="json")

    def default_artifact(self) -> dict[str, Any]:
        """Reuse only scores calculated from this source snapshot and census mapping."""
        if self._default_artifact is None:
            if self.computed_cache is not None and self._loaded:
                self._default_artifact = self.computed_cache.get_or_compute(
                    "accessibility-default",
                    [
                        model_code_version(),
                        self.source_fingerprint,
                        self._captured_fingerprint,
                        self.config(),
                        POPULATION_TRANSFORM_VERSION,
                    ],
                    self._build_default_artifact,
                )
            else:
                self._default_artifact = self._build_default_artifact()
            self._default_by_id = {
                row["island_id"]: row for row in self._default_artifact["scores"]
            }
        return self._default_artifact

    def _build_default_artifact(self) -> dict[str, Any]:
        captured = self._read_json("derived/accessibility-default.json", {})
        valid = (
            captured.get("population_transform_version") == POPULATION_TRANSFORM_VERSION
            and captured.get("source_fingerprint")
            in (
                self.source_fingerprint,
                # Boarding-point additions change transport evidence; existing health/education
                # route results are still valid against their unchanged captured input files.
                {
                    key: value
                    for key, value in self.source_fingerprint.items()
                    if key != f"public/{NATIONAL_TRANSPORT_ARTIFACT}"
                },
            )
            and captured.get("config") == self.config()
            and isinstance(captured.get("scores"), list)
            and len(captured["scores"]) == len(self.islands)
            and {row.get("island_id") for row in captured["scores"]} == set(self.islands)
            and all(
                isinstance(row.get("population"), dict)
                and {"health", "education"}.issubset(row.get("domains", {}))
                for row in captured["scores"]
            )
        )
        if valid:
            # Frozen route results remain valid. Refresh transport evidence and
            # human explanations in memory; never rewrite the source snapshot.
            results = [
                self._build_result(
                    row["island_id"],
                    DEFAULT_ACCESSIBILITY_CONFIG,
                    row["population"],
                    row["domains"]["health"],
                    row["domains"]["education"],
                )
                for row in captured["scores"]
            ]
            result = self._national_artifact(results, DEFAULT_ACCESSIBILITY_CONFIG)
        else:
            result = self.score_national()
        return result

    def score_island(
        self, island_id: str, config: AccessibilityConfig | None = None
    ) -> dict[str, Any] | None:
        if island_id not in self.islands:
            return None
        policy = config or DEFAULT_ACCESSIBILITY_CONFIG
        if self._loaded and policy == DEFAULT_ACCESSIBILITY_CONFIG and self._default_by_id:
            # Same immutable source snapshot and default policy: island profiles
            # reuse validated national results instead of rerouting each click.
            return deepcopy(self._default_by_id[island_id])
        island_facilities = [item for item in self.facilities if item.get("island_id") == island_id]
        island_anchors = [item for item in self.anchors if item.get("island_id") == island_id]
        if not island_anchors:
            island_anchors = self._centroid_anchor(island_id)
        population = self._population_profile(island_id, policy)
        health = self._score_domain(
            island_id,
            island_anchors,
            island_facilities,
            policy.health_quality_weights,
            policy,
            "health",
            population,
        )
        education = self._score_domain(
            island_id,
            island_anchors,
            island_facilities,
            policy.education_quality_weights,
            policy,
            "education",
            population,
        )
        return self._build_result(island_id, policy, population, health, education)

    def _build_result(
        self,
        island_id: str,
        policy: AccessibilityConfig,
        population: dict[str, Any],
        health: dict[str, Any],
        education: dict[str, Any],
    ) -> dict[str, Any]:
        transport = self._score_transport(island_id, policy, population)
        domain_weights = self._population_weighted_domain_weights(policy, population)
        overall = (
            domain_weights["health"] * health["score"]
            + domain_weights["education"] * education["score"]
            + domain_weights["transport"] * transport["score"]
        )
        missing_data = sorted(
            set(
                health["missing_data"]
                + education["missing_data"]
                + transport["missing_data"]
                + (["resident_population"] if population["total"] is None else [])
            )
        )
        result = {
            "island_id": island_id,
            "score": round(overall, 2),
            "config": policy.model_dump(mode="json"),
            "population": population,
            "domain_weights": domain_weights,
            "domains": {
                "health": health,
                "education": education,
                "transport": transport,
            },
            "missing_data": missing_data,
            "confidence": round(max(0.0, 1.0 - 0.15 * len(missing_data)), 3),
            "explanation": self._explanation(health, education, transport, missing_data),
        }
        result["assessment"] = island_assessment(
            result,
            policy,
            [item for item in self.facilities if item.get("island_id") == island_id],
        )
        return result

    def score_national(self, config: AccessibilityConfig | None = None) -> dict[str, Any]:
        policy = config or DEFAULT_ACCESSIBILITY_CONFIG
        scores = [self.score_island(island_id, policy) for island_id in sorted(self.islands)]
        results = [score for score in scores if score is not None]
        return self._national_artifact(results, policy)

    def _national_artifact(
        self, results: list[dict[str, Any]], policy: AccessibilityConfig
    ) -> dict[str, Any]:
        values = [float(score["score"]) for score in results]
        return {
            "version": "accessibility-v1",
            "assessment_version": ASSESSMENT_VERSION,
            "population_transform_version": POPULATION_TRANSFORM_VERSION,
            "source_fingerprint": self.source_fingerprint,
            "config": policy.model_dump(mode="json"),
            "scores": results,
            "summary": {
                "island_count": len(results),
                "average_score": round(sum(values) / len(values), 2) if values else 0.0,
                "zero_score_count": sum(value == 0 for value in values),
                "missing_data_score_count": sum(bool(score["missing_data"]) for score in results),
                "limited_evidence_island_count": sum(
                    score["assessment"]["coverage"]["status"] == "limited" for score in results
                ),
                "population_available_island_count": sum(
                    score["assessment"]["coverage"]["population_available"] for score in results
                ),
            },
        }

    def _score_domain(
        self,
        island_id: str,
        anchors: list[dict[str, Any]],
        facilities: list[dict[str, Any]],
        quality_weights: dict[str, float],
        policy: AccessibilityConfig,
        domain: str,
        population: dict[str, Any],
    ) -> dict[str, Any]:
        candidates = scored_facilities(facilities, quality_weights)
        missing_data: list[str] = []
        if not candidates:
            missing_data.append("no_geocoded_facility")
            demand = _population_demand(domain, population)
            density_factor = _density_factor(domain, population, policy)
            if demand is not None:
                missing_data.append("population_demand_without_mapped_facility")
            if population.get("total", 0) and not population.get("density_data_available"):
                missing_data.append("population_density")
            elif density_factor < 1.0:
                missing_data.append("population_density_pressure")
            return {
                "score": 0.0,
                "base_score": 0.0,
                "best_facility_type": None,
                "best_distance_m": None,
                "distance_method": None,
                "population_demand": demand,
                "population_pressure_factor": 1.0,
                "density_factor": density_factor,
                "missing_data": missing_data,
            }
        scores: list[float] = []
        best_candidate: tuple[float, dict[str, Any], float, str] | None = None
        for anchor in anchors:
            anchor_coordinates = anchor.get("geometry", {}).get("coordinates")
            if not anchor_coordinates:
                continue
            distances = []
            for facility in candidates:
                coordinates = facility.get("geometry", {}).get("coordinates")
                if coordinates:
                    distances.append((_distance_m(anchor_coordinates, coordinates), facility))
            distances.sort(key=lambda item: item[0])
            anchor_best = 0.0
            anchor_best_data: tuple[float, dict[str, Any], str] | None = None
            for direct_distance, facility in distances[: policy.max_route_candidates_per_anchor]:
                distance, method = self._travel_distance(
                    island_id,
                    anchor_coordinates,
                    facility["geometry"]["coordinates"],
                    direct_distance,
                )
                score = quality_weights[facility["category"]] * _distance_score(distance, policy)
                if score > anchor_best:
                    anchor_best = score
                    anchor_best_data = (distance, facility, method)
            scores.append(anchor_best)
            if anchor_best_data and (best_candidate is None or anchor_best > best_candidate[0]):
                best_candidate = (
                    anchor_best,
                    anchor_best_data[1],
                    anchor_best_data[0],
                    anchor_best_data[2],
                )
        if not scores:
            missing_data.append("no_geocoded_demand_anchor")
        if any(
            facility.get("geometry_quality") == "island_context_only" for facility in facilities
        ):
            missing_data.append("some_facilities_have_island_context_only_geometry")
        pressure_factor = _population_pressure_factor(domain, population, len(candidates))
        density_factor = _density_factor(domain, population, policy)
        base_score = 100 * (sum(scores) / len(scores) if scores else 0.0)
        adjusted_score = base_score * pressure_factor * density_factor
        if pressure_factor < 1.0:
            missing_data.append("population_pressure")
        if population.get("total", 0) and not population.get("density_data_available"):
            missing_data.append("population_density")
        elif density_factor < 1.0:
            missing_data.append("population_density_pressure")
        return {
            "score": round(adjusted_score, 2),
            "base_score": round(base_score, 2),
            "best_facility_type": best_candidate[1]["category"] if best_candidate else None,
            "best_distance_m": round(best_candidate[2], 2) if best_candidate else None,
            "distance_method": best_candidate[3] if best_candidate else None,
            "population_demand": _population_demand(domain, population),
            "population_pressure_factor": round(pressure_factor, 3),
            "density_factor": round(density_factor, 3),
            "missing_data": missing_data,
        }

    def _travel_distance(
        self,
        island_id: str,
        start: list[float],
        end: list[float],
        direct_distance: float,
    ) -> tuple[float, str]:
        route = self.routing.route_land(start, end, "walk", island_id)
        if route.get("status") == "ok":
            return float(route["distance_m"]), "land_graph"
        return direct_distance, "straight_line_fallback"

    def _score_transport(
        self,
        island_id: str,
        policy: AccessibilityConfig,
        population: dict[str, Any],
    ) -> dict[str, Any]:
        counts = self._transport_evidence(island_id)
        airport = bool(counts["airport_count"])
        bus = bool(counts["bus_stop_count"])
        ferry = bool(counts["marine_terminal_count"])
        ferry_provisional = ferry and not policy.include_unverified_marine
        ferry_score = 1.0 if ferry and policy.include_unverified_marine else 0.0
        values = {
            "airport": 1.0 if airport else 0.0,
            "bus": 1.0 if bus else 0.0,
            "ferry": ferry_score,
        }
        missing_data = []
        if not airport:
            missing_data.append("no_airport")
        if not bus:
            missing_data.append("no_osm_bus_feature")
        if not ferry:
            missing_data.append("no_osm_marine_feature")
        elif ferry_provisional:
            missing_data.append("ferry_service_unverified")
        base_score = sum(policy.transport_weights[key] * values[key] for key in values) * 100
        density_factor = _density_factor("transport", population, policy)
        if population.get("total", 0) and not population.get("density_data_available"):
            missing_data.append("population_density")
        elif density_factor < 1.0:
            missing_data.append("population_density_pressure")
        return {
            "score": round(base_score * density_factor, 2),
            "base_score": round(base_score, 2),
            "density_factor": round(density_factor, 3),
            "components": values,
            "mapped_counts": counts,
            "population_demand": population.get("total", 0),
            "missing_data": missing_data,
            "ferry_access": (
                "provisional" if ferry_provisional else ("available" if ferry else "none")
            ),
        }

    def _transport_evidence(self, island_id: str) -> dict[str, int]:
        def is_bus(item: dict[str, Any]) -> bool:
            tags = item.get("tags") or {}
            return (
                item.get("category") in {"bus_stop", "bus_station"}
                or tags.get("bus") in {"yes", "designated"}
                or tags.get("highway") == "bus_stop"
                or tags.get("amenity") == "bus_station"
            )

        marine = [
            item
            for item in self.routing.marine.get("nodes", [])
            if item.get("island_id") == island_id
            and item.get("category") in {"ferry_terminal", "pier"}
        ]
        if island_id not in CAPITAL_ISLAND_IDS:
            known_ids = {item.get("id") for item in marine}
            for item in self.transport:
                if item.get("island_id") != island_id or item.get("id") in known_ids:
                    continue
                tags = item.get("tags") or {}
                if item.get("category") in {"ferry_terminal", "pier"} or (
                    tags.get("amenity") == "ferry_terminal" or tags.get("ferry") == "yes"
                ):
                    marine.append(item)
                    known_ids.add(item.get("id"))
        return {
            "airport_count": sum(
                item.get("category") == "airport"
                for item in self.facilities
                if item.get("island_id") == island_id
            ),
            "bus_stop_count": sum(
                is_bus(item) for item in self.transport if item.get("island_id") == island_id
            ),
            "marine_terminal_count": len(marine),
        }

    def _population_profile(
        self, island_id: str, policy: AccessibilityConfig | None = None
    ) -> dict[str, Any]:
        records = [item for item in self.population if item.get("island_id") == island_id]
        profile = population_summary(records)
        return {
            **profile,
            **self._density_profile(
                island_id,
                profile["total"],
                (policy or DEFAULT_ACCESSIBILITY_CONFIG).density_reference_persons_per_km2,
            ),
        }

    def _density_profile(
        self, island_id: str, population_total: int | None, density_reference: float
    ) -> dict[str, Any]:
        properties = self.islands.get(island_id, {}).get("properties", {})
        area_ha = _number(properties.get("area_ha"))
        area_km2 = area_ha / 100 if area_ha is not None and area_ha > 0 else None
        density = population_total / area_km2 if area_km2 and population_total is not None else None
        pressure_score = (
            min(100.0, density / density_reference * 100) if density is not None else None
        )
        return {
            "area_ha": area_ha,
            "area_km2": area_km2,
            "density_persons_per_km2": density,
            "density_pressure_score": pressure_score,
            "density_data_available": density is not None,
        }

    @staticmethod
    def _population_weighted_domain_weights(
        policy: AccessibilityConfig, population: dict[str, Any]
    ) -> dict[str, float]:
        if not population.get("demographic_breakdown") or not population.get("total"):
            return {
                "health": policy.health_weight,
                "education": policy.education_weight,
                "transport": policy.transport_weight,
            }
        total = float(population["total"])
        priorities = {
            "health": 1.0 + (population["early_childhood"] + population["older_adult"]) / total,
            "education": 1.0 + population["school_age"] / total,
            "transport": 1.0 + min(1.0, population["working_age"] / total),
        }
        raw = {
            "health": policy.health_weight * priorities["health"],
            "education": policy.education_weight * priorities["education"],
            "transport": policy.transport_weight * priorities["transport"],
        }
        divisor = sum(raw.values()) or 1.0
        return {key: value / divisor for key, value in raw.items()}

    def _centroid_anchor(self, island_id: str) -> list[dict[str, Any]]:
        centroid = self.islands[island_id].get("properties", {}).get("centroid")
        if not centroid:
            return []
        return [{"geometry": {"coordinates": centroid}, "weight": 1.0}]

    @staticmethod
    def _explanation(
        health: dict[str, Any],
        education: dict[str, Any],
        transport: dict[str, Any],
        missing_data: list[str],
    ) -> list[str]:
        explanation = [
            (
                "Health score reflects the best available facility quality and walking "
                f"distance: {health['score']:.2f}/100."
            ),
            (
                "Education score reflects school coverage and walking "
                f"distance: {education['score']:.2f}/100."
            ),
            (
                "Transport score combines airport, bus, and ferry components: "
                f"{transport['score']:.2f}/100."
            ),
        ]
        if "population_pressure" in missing_data:
            explanation.append(
                "population_pressure: service availability is adjusted for age-specific demand."
            )
        if "population_density_pressure" in missing_data:
            explanation.append(
                "population_density_pressure: accessibility is reduced for crowding "
                "based on residents per square kilometre."
            )
        if "resident_population" in missing_data:
            explanation.append(
                "Resident population is unknown; this score does not estimate resident access "
                "or account for population pressure."
            )
        if (
            not explanation[-1].startswith(("population_pressure", "population_density_pressure"))
            and missing_data
        ):
            explanation.append(
                "Unmapped or unverified services earn no points; this is not proof of no access."
            )
        return explanation

    def _read_json(self, relative_path: str, default: Any) -> Any:
        try:
            return self.cache.read_json(relative_path)
        except FileNotFoundError:
            return default


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except TypeError, ValueError:
        return None


def _density_factor(domain: str, population: dict[str, Any], policy: AccessibilityConfig) -> float:
    density = population.get("density_persons_per_km2")
    if density is None:
        return 1.0
    pressure = min(1.0, max(0.0, density / policy.density_reference_persons_per_km2))
    impact = policy.density_domain_impacts.get(domain, 0.0)
    return max(0.4, 1.0 - impact * pressure)


def _population_demand(domain: str, population: dict[str, Any]) -> int | None:
    if not population.get("demographic_breakdown"):
        return population.get("total") if domain == "transport" else None
    if domain == "education":
        return population.get("school_age")
    if domain == "health":
        return (population.get("early_childhood") or 0) + (population.get("older_adult") or 0)
    return population.get("total")


def _population_pressure_factor(
    domain: str, population: dict[str, Any], facility_count: int
) -> float:
    if not population.get("demographic_breakdown") or facility_count <= 0:
        return 1.0
    if domain == "education":
        demand = population.get("school_age") or 0
        target_per_facility = 300
    elif domain == "health":
        demand = (population.get("early_childhood") or 0) + (population.get("older_adult") or 0)
        target_per_facility = 500
    else:
        return 1.0
    capacity = facility_count * target_per_facility
    if demand <= capacity or demand <= 0:
        return 1.0
    return max(0.25, capacity / demand)


def _distance_score(distance: float, policy: AccessibilityConfig) -> float:
    for band in policy.distance_bands:
        if distance <= band.max_distance_m:
            return band.score
    return 0.0


def _distance_m(first: list[float], second: list[float]) -> float:
    radius = 6_371_000
    lat_1 = math.radians(first[1])
    lat_2 = math.radians(second[1])
    delta_lat = math.radians(second[1] - first[1])
    delta_lon = math.radians(second[0] - first[0])
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat_1) * math.cos(lat_2) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * radius * math.atan2(math.sqrt(value), math.sqrt(1 - value))
