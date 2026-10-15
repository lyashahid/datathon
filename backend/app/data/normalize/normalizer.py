"""Build the deterministic Phase 2 normalized national data model."""

from __future__ import annotations

import difflib
import json
import re
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import osmium
import pandas as pd
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from app.data.cache import FileCache
from app.data.normalize.geometry import parse_coordinate, point_geometry
from app.data.normalize.names import normalize_atoll_code, normalize_name
from app.data.population import attach_population
from app.data.providers.hems import _parse_records
from app.data.providers.html_utils import soup_for, table_records
from app.routing.builder import build_routing_artifacts

ATOLL_CODE_PROPOSALS = {
    "aa": "Alifu Alifu",
    "adh": "Alifu Dhaalu",
    "b": "Baa",
    "dh": "Dhaalu",
    "f": "Faafu",
    "ga": "Gaafu Alifu",
    "gdh": "Gaafu Dhaalu",
    "gn": "Gnaviyani",
    "ha": "Haa Alifu",
    "hdh": "Haa Dhaalu",
    "k": "Kaafu",
    "l": "Laamu",
    "lh": "Lhaviyani",
    "m": "Meemu",
    "n": "Noonu",
    "r": "Raa",
    "s": "Seenu",
    "sh": "Shaviyani",
    "th": "Thaa",
    "v": "Vaavu",
}


class NationalNormalizer:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.cache = FileCache(data_dir / "cache")

    def run(self) -> dict[str, Any]:
        islands = self._normalize_islands()
        osm_features, osm_summary, osm_handler = self._normalize_osm(islands)
        population, population_proposal = self._normalize_population(islands)
        facilities = self._normalize_facilities(osm_features, islands)
        reviewed_overrides = self._load_reviewed_overrides()
        _apply_reviewed_overrides(facilities, osm_features, reviewed_overrides)
        match_candidates = _build_match_candidates(facilities, osm_features, islands)
        rejected_matches = self._load_rejected_matches()
        _apply_best_effort_matches(facilities, match_candidates, rejected_matches)
        _apply_provisional_matches(facilities, match_candidates, rejected_matches)
        _classify_unmatched_facilities(facilities, match_candidates)
        _attach_osm_match_metadata(facilities, match_candidates)
        facility_review = _build_facility_review(facilities, match_candidates, osm_features)
        routing_summary = build_routing_artifacts(
            self.cache, islands, facilities, osm_features, osm_handler
        )
        provenance = self._build_provenance(islands, population, facilities, osm_summary)
        summary = self._build_summary(islands, population, facilities, osm_summary)

        self.cache.write_json(
            "normalized/islands.geojson",
            {"type": "FeatureCollection", "features": islands},
            source="Mobility Sandbox normalized OneMap data",
            endpoint="local normalized output",
            parser_version="normalization-v1",
        )
        self.cache.write_json(
            "normalized/population.json",
            population,
            source="Mobility Sandbox normalized MBS P3/P5/P6 population data",
            endpoint="local normalized output",
            parser_version="normalization-v1",
        )
        self.cache.write_json(
            "normalized/population-atoll-mapping-proposal.json",
            population_proposal,
            source="Mobility Sandbox MBS matching proposal",
            endpoint="local review artifact",
            parser_version="normalization-v1",
        )
        self.cache.write_json(
            "normalized/facilities.json",
            facilities,
            source="Mobility Sandbox normalized official facility data",
            endpoint="local normalized output",
            parser_version="normalization-v1",
        )
        self.cache.write_json(
            "normalized/facility-match-candidates.json",
            match_candidates,
            source="Mobility Sandbox facility matching review candidates",
            endpoint="local review artifact",
            parser_version="normalization-v1",
        )
        self.cache.write_json(
            "normalized/facility-mapping-review.json",
            facility_review,
            source="Mobility Sandbox facility mapping review audit",
            endpoint="local review artifact",
            parser_version="normalization-v1",
        )
        self.cache.write_json(
            "normalized/transport.json",
            {"features": osm_features, "summary": osm_summary},
            source="Mobility Sandbox normalized OSM transport data",
            endpoint="local normalized output",
            parser_version="normalization-v1",
        )
        self.cache.write_json(
            "normalized/provenance.json",
            provenance,
            source="Mobility Sandbox normalized provenance",
            endpoint="local normalized output",
            parser_version="normalization-v1",
        )
        self.cache.write_json(
            "derived/national_summary.json",
            summary,
            source="Mobility Sandbox normalized national summary",
            endpoint="local derived output",
            parser_version="normalization-v1",
        )
        return {
            "islands": len(islands),
            "population_records": len(population),
            "population_mapping_proposals": len(population_proposal),
            "facilities": len(facilities),
            "osm_features": len(osm_features),
            "osm_summary": osm_summary,
            "routing_summary": routing_summary,
            "facility_match_summary": _facility_match_summary(facilities),
            "facility_candidate_count": len(match_candidates),
            "facility_review_summary": facility_review["summary"],
            "population_attached": sum(
                record.get("island_id") is not None for record in population
            ),
        }

    def _load_reviewed_overrides(self) -> list[dict[str, Any]]:
        path = self.data_dir / "review" / "facility-osm-overrides.json"
        if not path.exists():
            return []
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload.get("records", [])

    def _load_rejected_matches(self) -> set[tuple[str, str]]:
        path = self.data_dir / "review" / "facility-osm-rejections.json"
        if not path.exists():
            return set()
        payload = json.loads(path.read_text(encoding="utf-8"))
        return {
            (record["facility_id"], record["osm_object_id"])
            for record in payload.get("records", [])
            if record.get("facility_id") and record.get("osm_object_id")
        }

    def _normalize_islands(self) -> list[dict[str, Any]]:
        raw = self.cache.read_json("raw/onemap/islands.geojson")
        islands: list[dict[str, Any]] = []
        for feature in raw.get("features", []):
            properties = feature.get("properties", {})
            object_id = properties.get("OBJECTID")
            if object_id is None:
                continue
            longitude = parse_coordinate(properties.get("longitude"))
            latitude = parse_coordinate(properties.get("latitude"))
            islands.append(
                {
                    "type": "Feature",
                    "id": f"island:{object_id}",
                    "geometry": feature.get("geometry"),
                    "properties": {
                        "id": f"island:{object_id}",
                        "source": "OneMap",
                        "source_record_id": str(object_id),
                        "name": properties.get("islandName"),
                        "name_normalized": normalize_name(properties.get("islandName")),
                        "atoll": properties.get("atoll"),
                        "atoll_normalized": normalize_name(properties.get("atoll")),
                        "category": properties.get("category"),
                        "usage": properties.get("Usage"),
                        "area_ha": properties.get("Area_ha"),
                        "centroid": [longitude, latitude]
                        if longitude is not None and latitude is not None
                        else None,
                        "source_centroid_original": {
                            "longitude": properties.get("longitude"),
                            "latitude": properties.get("latitude"),
                        },
                        "geometry_quality": "official_exact",
                    },
                }
            )
        return islands

    def _normalize_population(
        self, islands: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        workbook_path = self.cache.path("raw/mbs/P3.xlsx")
        population: list[dict[str, Any]] = []
        proposal_by_code: dict[str, dict[str, Any]] = {}
        if workbook_path.exists():
            frame = pd.read_excel(workbook_path, header=None, engine="openpyxl")
            candidate = _find_p3_header(frame)
            if candidate is not None:
                for row in frame.iloc[candidate["header_row"] + 1 :].itertuples(
                    index=False, name=None
                ):
                    atoll_index = candidate["atoll_column"]
                    locality_index = candidate["island_column"]
                    population_index = candidate["population_2022_column"]
                    if max(atoll_index, locality_index, population_index) >= len(row):
                        continue
                    atoll_code = row[atoll_index]
                    locality = row[locality_index]
                    value = pd.to_numeric(row[population_index], errors="coerce")
                    if pd.isna(atoll_code) or pd.isna(locality) or pd.isna(value):
                        continue
                    code = str(atoll_code).strip()
                    locality_name = str(locality).strip()
                    normalized_code = normalize_atoll_code(code)
                    proposed_atoll = ATOLL_CODE_PROPOSALS.get(normalized_code)
                    record_id = (
                        f"population:mbs-p3:{normalized_code}:{normalize_name(locality_name)}"
                    )
                    population.append(
                        {
                            "id": record_id,
                            "source": "MBS Census 2022 P3",
                            "source_record_id": f"{code}:{locality_name}",
                            "atoll_code": code,
                            "locality": locality_name,
                            "locality_normalized": normalize_name(locality_name),
                            "year": 2022,
                            "population_basis": "resident_population",
                            "population": int(value),
                            "island_id": None,
                            "proposed_atoll": proposed_atoll,
                            "match_status": "awaiting_atoll_mapping_review",
                        }
                    )
                    proposal_by_code.setdefault(
                        normalized_code,
                        {
                            "atoll_code": code,
                            "proposed_atoll": proposed_atoll,
                            "basis": "explicit standard-code proposal; requires review",
                            "requires_review": True,
                        },
                    )

        p6_path = self.cache.path("raw/mbs/P6.xlsx")
        if p6_path.exists():
            frame = pd.read_excel(p6_path, header=None, engine="openpyxl")
            for row in _parse_p6_rows(frame):
                locality_normalized = normalize_name(row["locality"])
                record_id = (
                    f"population:mbs-p6:2022:{locality_normalized}:"
                    f"{normalize_name(row['age_group'])}:{row['sex']}:{row['nationality']}"
                )
                population.append(
                    {
                        "id": record_id,
                        "source": "MBS Census 2022 P6",
                        "source_record_id": f"{row['locality']}:{row['age_group']}",
                        "locality": row["locality"],
                        "locality_normalized": locality_normalized,
                        "year": 2022,
                        "population_basis": "resident_population",
                        "age_group": row["age_group"],
                        "sex": row["sex"],
                        "nationality": row["nationality"],
                        "population": row["population"],
                        "island_id": None,
                        "match_status": "awaiting_island_mapping",
                    }
                )

        p5_path = self.cache.path("raw/mbs/P5.xlsx")
        if p5_path.exists():
            frame = pd.read_excel(p5_path, header=None, engine="openpyxl")
            for row in _parse_p5_rows(frame):
                locality_normalized = normalize_name(row["locality"])
                population.append(
                    {
                        "id": (
                            f"population:mbs-p5:2022:{locality_normalized}:"
                            f"{row['sex']}:{row['nationality']}"
                        ),
                        "source": "MBS Census 2022 P5",
                        "source_record_id": f"{row['atoll']}:{row['locality']}",
                        "atoll": row["atoll"],
                        "locality": row["locality"],
                        "locality_normalized": locality_normalized,
                        "year": 2022,
                        "population_basis": "resident_population",
                        "sex": row["sex"],
                        "nationality": row["nationality"],
                        "population": row["population"],
                        "island_id": None,
                        "match_status": "awaiting_island_mapping",
                    }
                )
        _attach_population_islands(population, islands)
        return population, list(proposal_by_code.values())

    def _normalize_facilities(
        self, osm_features: list[dict[str, Any]], islands: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        facilities = self._normalize_health()
        facilities.extend(self._normalize_education())
        facilities.extend(self._normalize_caa())
        _attach_location_context(facilities, islands)
        _apply_source_identifier_matches(facilities, osm_features)
        _apply_exact_osm_matches(facilities, osm_features, islands)
        return facilities

    def _normalize_health(self) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        for path in sorted(self.cache.path("raw/health").glob("page_*.html")):
            records.extend(_parse_records(path.read_bytes()))
        facilities: list[dict[str, Any]] = []
        for record in records:
            level = record["facility_level"]
            category = (
                "hospital"
                if "hospital" in level.casefold()
                else ("health_center" if "health centre" in level.casefold() else "clinic")
            )
            facilities.append(
                _facility(
                    facility_id=f"facility:health:{record['establishment_id']}",
                    source="HEMS",
                    source_record_id=record["establishment_id"],
                    category=category,
                    name=record["name"],
                    attributes=record,
                )
            )
        return facilities

    def _normalize_education(self) -> list[dict[str, Any]]:
        facilities: list[dict[str, Any]] = []
        for path in sorted(self.cache.path("raw/education/schools").glob("*.html")):
            school_id = path.stem
            soup = soup_for(path.read_bytes())
            name = _education_name(soup)
            facilities.append(
                _facility(
                    facility_id=f"facility:school:{school_id}",
                    source="Ministry of Education",
                    source_record_id=school_id,
                    category="school",
                    name=name or f"School {school_id}",
                    attributes={
                        "detail_file": str(path),
                        "address": _education_address(soup),
                        "atoll_heading": _education_atoll_heading(soup),
                    },
                )
            )
        return facilities

    def _normalize_caa(self) -> list[dict[str, Any]]:
        path = self.cache.path("raw/caa/certification.html")
        records = table_records(soup_for(path.read_bytes()))
        facilities: list[dict[str, Any]] = []
        for index, record in enumerate(records):
            icao = record.get("location indicator", "").strip()
            source_id = icao or str(index)
            facilities.append(
                _facility(
                    facility_id=f"airport:{normalize_name(source_id)}",
                    source="CAA",
                    source_record_id=source_id,
                    category="airport",
                    name=record.get("aerodrome name", ""),
                    attributes=record,
                )
            )
        return facilities

    def _normalize_osm(
        self, islands: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], dict[str, Any], _SelectedOsmHandler]:
        path = self.cache.path("raw/osm/maldives-latest.osm.pbf")
        handler = _SelectedOsmHandler()
        handler.apply_file(str(path), locations=True)
        features: list[dict[str, Any]] = []
        assigned = 0
        island_ids, polygons, tree = _build_island_index(islands)
        for feature in handler.features:
            island_id = _find_island(feature.get("geometry"), island_ids, polygons, tree)
            if island_id:
                assigned += 1
            feature["island_id"] = island_id
            features.append(feature)

        online_features = self._load_online_osm_features(islands)
        existing_ids = {feature["id"] for feature in features}
        for feature in online_features:
            if feature["id"] in existing_ids:
                continue
            if feature.get("island_id"):
                assigned += 1
            features.append(feature)

        return (
            features,
            {
                "feature_count": len(features),
                "island_assigned_feature_count": assigned,
                "feature_categories": dict(
                    sorted(Counter(feature["category"] for feature in features).items())
                ),
                "route_relation_count": handler.route_relation_count,
                "online_review_feature_count": len(online_features),
            },
            handler,
        )

    def _load_online_osm_features(self, islands: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Load explicitly reviewed live OSM facility features absent from the PBF."""
        path = self.data_dir / "review" / "online-osm-features.json"
        if not path.exists():
            return []
        payload = json.loads(path.read_text(encoding="utf-8"))
        island_ids, polygons, tree = _build_island_index(islands)
        features: list[dict[str, Any]] = []
        for raw in payload.get("features", []):
            geometry = raw.get("geometry")
            if not geometry or not raw.get("id") or not raw.get("category"):
                raise ValueError("online OSM feature requires id, category, and geometry")
            feature = {
                "id": raw["id"],
                "source_id": raw.get("source_id", raw["id"].split(":")[-1]),
                "object_type": raw.get("object_type", raw["id"].split(":")[1]),
                "category": raw["category"],
                "name": raw.get("name"),
                "tags": raw.get("tags", {}),
                "geometry": geometry,
                "geometry_source": raw.get("geometry_source", "live OSM API"),
                "source": raw.get("source", "OpenStreetMap live review"),
            }
            feature["island_id"] = _find_island(geometry, island_ids, polygons, tree)
            features.append(feature)
        return features

    def _build_provenance(
        self,
        islands: list[dict[str, Any]],
        population: list[dict[str, Any]],
        facilities: list[dict[str, Any]],
        osm_summary: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "normalization_version": "normalization-v1",
            "islands": {"source": "OneMap", "count": len(islands)},
            "population": {"source": "MBS Census 2022 P3/P5/P6", "count": len(population)},
            "facilities": {"source_records": len(facilities)},
            "osm": osm_summary,
            "matching_policy": {
                "automatic_match": (
                    "official CAA ICAO identifier, or compatible exact normalized name "
                    "with a unique OSM candidate"
                ),
                "nearby_osm_duplicate_handling": (
                    "collapse node/way representations only when same-island and near-coincident"
                ),
                "low_confidence_fuzzy_match": "disabled; candidates are emitted for review",
                "population_attachment": (
                    "P5 island records attach by unique official island name; P3 and P6 "
                    "records remain explicitly unmatched or reviewable when no exact island exists"
                ),
                "lga_councilor_export": "supporting evidence only, not facility data",
            },
        }

    @staticmethod
    def _build_summary(
        islands: list[dict[str, Any]],
        population: list[dict[str, Any]],
        facilities: list[dict[str, Any]],
        osm_summary: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "island_count": len(islands),
            "population_record_count": len(population),
            "population_attached_count": sum(
                record.get("island_id") is not None for record in population
            ),
            "facility_count": len(facilities),
            "facility_categories": dict(
                sorted(Counter(item["category"] for item in facilities).items())
            ),
            "facility_match_status": _facility_match_summary(facilities),
            "osm": osm_summary,
            "accessibility_status": "not_calculated_in_phase_2",
        }


def _facility(
    *,
    facility_id: str,
    source: str,
    source_record_id: str,
    category: str,
    name: str,
    attributes: dict[str, Any],
) -> dict[str, Any]:
    return {
        "id": facility_id,
        "source": source,
        "source_record_id": source_record_id,
        "category": category,
        "name": name,
        "name_normalized": normalize_name(name),
        "island_id": None,
        "geometry": None,
        "geometry_quality": "unresolved",
        "geometry_source": None,
        "match_status": "unmatched",
        "location_context": {},
        "attributes": attributes,
    }


def _parse_p5_rows(frame: pd.DataFrame) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    atoll = ""
    for raw in frame.iloc[5:].itertuples(index=False, name=None):
        values = list(raw) + [None] * max(0, 11 - len(raw))
        island = values[1]
        if pd.isna(island) or str(island).strip().casefold() in {"republic", "atolls"}:
            continue
        island_name = str(island).strip()
        if not island_name or island_name.casefold() == "nan":
            continue
        if not pd.isna(values[0]):
            atoll = str(values[0]).strip()
        numeric = [pd.to_numeric(value, errors="coerce") for value in values[2:11]]
        if all(pd.isna(value) for value in numeric):
            continue
        groups = (("total", 2), ("Maldivian", 5), ("foreign", 8))
        for nationality, start in groups:
            for sex, offset in (("both", 0), ("female", 1), ("male", 2)):
                value = pd.to_numeric(values[start + offset], errors="coerce")
                if pd.isna(value):
                    continue
                rows.append(
                    {
                        "atoll": atoll,
                        "locality": island_name,
                        "sex": sex,
                        "nationality": nationality,
                        "population": int(value),
                    }
                )
    return rows


def _parse_p6_rows(frame: pd.DataFrame) -> list[dict[str, Any]]:
    header_row = None
    for index in range(min(len(frame), 20)):
        values = [str(value).strip().casefold() for value in frame.iloc[index].tolist()]
        if "age" in values and values.count("both sexes") >= 3:
            header_row = index
            break
    if header_row is None:
        return []

    rows: list[dict[str, Any]] = []
    locality = ""
    age_labels = {"all ages", "75 or older"}
    age_labels.update({f"{start}-{start + 4}" for start in range(0, 100, 5)})

    for raw in frame.iloc[header_row + 1 :].itertuples(index=False, name=None):
        if not raw:
            continue
        label = str(raw[0]).strip()
        if not label or label.casefold() == "nan":
            continue
        values = list(raw) + [None] * max(0, 10 - len(raw))
        numeric = [pd.to_numeric(value, errors="coerce") for value in values[1:10]]
        if label.casefold() not in age_labels or label.casefold() == "all ages":
            if all(pd.isna(value) for value in numeric):
                locality = label
            continue
        if not locality or all(pd.isna(value) for value in numeric):
            continue
        groups = (
            ("total", 1),
            ("maldivian", 4),
            ("foreign", 7),
        )
        for nationality, start in groups:
            for sex, offset in (("both", 0), ("male", 1), ("female", 2)):
                value = pd.to_numeric(values[start + offset], errors="coerce")
                if pd.isna(value):
                    continue
                rows.append(
                    {
                        "locality": locality,
                        "age_group": label,
                        "sex": sex,
                        "nationality": nationality,
                        "population": int(value),
                    }
                )
    return rows


def _attach_population_islands(
    population: list[dict[str, Any]], islands: list[dict[str, Any]]
) -> None:
    attach_population(population, islands)


def _find_p3_header(frame: pd.DataFrame) -> dict[str, int] | None:
    for row_index in range(min(len(frame), 30)):
        values = [str(value).strip().lower() for value in frame.iloc[row_index].tolist()]
        if "atoll" not in values or "locality" not in values or "2022" not in values:
            continue
        return {
            "header_row": row_index,
            "atoll_column": values.index("atoll"),
            "island_column": values.index("locality"),
            "population_2022_column": values.index("2022"),
        }
    return None


def _education_address(soup: Any) -> str:
    for element in soup.find_all("div"):
        classes = " ".join(element.get("class", []))
        if "mdi-map-marker" in classes:
            text = " ".join(element.get_text(" ", strip=True).split())
            if text:
                return text
    return ""


def _education_name(soup: Any) -> str:
    """Extract the title immediately following the school locality heading."""
    for heading in soup.find_all("h1"):
        heading_text = " ".join(heading.get_text(" ", strip=True).split())
        if "school introduction" in heading_text.casefold():
            continue
        for sibling in heading.find_all_next(["p", "h1"]):
            if sibling.name == "h1":
                break
            candidate = " ".join(sibling.get_text(" ", strip=True).split())
            if candidate and candidate.casefold() not in {
                "opened",
                "students",
                "teachers",
                "government staff",
            }:
                return candidate.split(" Opened :", 1)[0].strip()
    return ""


def _education_atoll_heading(soup: Any) -> str:
    for heading in soup.find_all("h1"):
        text = " ".join(heading.get_text(" ", strip=True).split())
        if "atoll" in text.casefold():
            return text
    return ""


def _extract_location_context(facility: dict[str, Any]) -> dict[str, Any]:
    name = facility.get("name", "")
    address = facility.get("attributes", {}).get("address", "")
    text = " | ".join(value for value in (name, address) if value)
    prefix_pattern = re.compile(
        r"(?<![A-Za-z])([A-Za-z]{1,3})"
        r"(?:\s*[,\.]\s*([A-Za-z]{1,3}))?"
        r"(?:\s*[,\.]\s*|\s+)"
        r"([A-Za-z][A-Za-z'’\- ]+?)"
        r"(?=\s+(?:health|hospital|clinic|medical|centre|center|school|\d{4,})|,|$)",
        re.IGNORECASE,
    )
    for match in prefix_pattern.finditer(text):
        code = (match.group(1) + (match.group(2) or "")).casefold()
        if code not in ATOLL_CODE_PROPOSALS:
            continue
        island_name = " ".join(match.group(3).replace("’", "'").split()).strip(" ,.")
        return {
            "atoll_code": code,
            "proposed_atoll": ATOLL_CODE_PROPOSALS[code],
            "island_name": island_name,
            "island_name_normalized": normalize_name(island_name),
            "status": "proposed_context_requires_review",
        }
    return {"status": "no_structured_island_context"}


def _attach_location_context(
    facilities: list[dict[str, Any]], islands: list[dict[str, Any]]
) -> None:
    by_name: dict[str, list[dict[str, Any]]] = {}
    for island in islands:
        properties = island["properties"]
        by_name.setdefault(properties["name_normalized"], []).append(properties)
    for facility in facilities:
        context = _extract_location_context(facility)
        island_name = context.get("island_name_normalized", "")
        matches = by_name.get(island_name, []) if island_name else []
        if not matches:
            matches, island_name = _find_named_island_context(facility, islands, context)
            if island_name:
                context["island_name"] = island_name
                context["island_name_normalized"] = normalize_name(island_name)
                context["status"] = "proposed_context_requires_review"
        if not matches:
            matches, island_name = _find_fuzzy_island_context(facility, islands, context)
            if island_name:
                context["island_name"] = island_name
                context["island_name_normalized"] = normalize_name(island_name)
                context["status"] = "fuzzy_island_context_requires_review"
        if context.get("proposed_atoll"):
            matches = [island for island in matches if _is_context_atoll_match(context, island)]
        context["candidate_island_ids"] = [island["id"] for island in matches]
        if len(matches) == 1:
            context["island_match_status"] = "unique_name_and_proposed_atoll_candidate"
        elif len(matches) > 1:
            context["island_match_status"] = "ambiguous_island_name_candidate"
        else:
            context["island_match_status"] = "no_island_candidate"
        facility["location_context"] = context


def _find_named_island_context(
    facility: dict[str, Any],
    islands: list[dict[str, Any]],
    context: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    """Find an official island name embedded in an establishment name/address."""
    values = [facility.get("name", ""), facility.get("attributes", {}).get("address", "")]
    text = normalize_name(" ".join(value for value in values if value))
    if not text:
        return [], ""
    atoll_names = {
        normalize_name(island["properties"].get("atoll")): island["properties"].get("atoll")
        for island in islands
        if island.get("properties", {}).get("atoll")
    }
    text_atolls = {
        original
        for normalized, original in atoll_names.items()
        if normalized and _contains_name(text, normalized)
    }
    proposed_atoll = context.get("proposed_atoll")
    if proposed_atoll:
        text_atolls.add(proposed_atoll)
    elif len(text_atolls) == 1:
        context["proposed_atoll"] = next(iter(text_atolls))
    matches: list[dict[str, Any]] = []
    for island in islands:
        properties = island.get("properties", {})
        island_name = properties.get("name")
        normalized_island_name = properties.get("name_normalized", "")
        if not island_name or len(normalized_island_name) < 4:
            continue
        if not _contains_name(text, normalized_island_name):
            continue
        if text_atolls and properties.get("atoll") not in text_atolls:
            continue
        matches.append(properties)
    if not matches:
        return [], ""
    longest_name = max(len(item.get("name_normalized", "")) for item in matches)
    matches = [item for item in matches if len(item.get("name_normalized", "")) == longest_name]
    return matches, matches[0].get("name", "")


def _contains_name(text: str, name: str) -> bool:
    return bool(re.search(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])", text))


def _find_fuzzy_island_context(
    facility: dict[str, Any],
    islands: list[dict[str, Any]],
    context: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    source_name = context.get("island_name_normalized")
    if not source_name:
        source_name = _core_name(facility.get("name"))
        if context.get("proposed_atoll"):
            source_name = source_name.replace(normalize_name(context["proposed_atoll"]), " ")
            source_name = " ".join(source_name.split())
    if len(source_name) < 5:
        return [], ""
    proposed_atoll = normalize_name(context.get("proposed_atoll"))
    candidates = []
    for island in islands:
        properties = island.get("properties", {})
        island_name = properties.get("name_normalized", "")
        if len(island_name) < 5:
            continue
        if proposed_atoll and not _is_context_atoll_match(context, properties):
            continue
        score = difflib.SequenceMatcher(None, source_name, island_name).ratio()
        candidates.append((score, properties))
    candidates.sort(key=lambda item: (-item[0], item[1].get("id", "")))
    if not candidates or candidates[0][0] < 0.82:
        return [], ""
    second_score = candidates[1][0] if len(candidates) > 1 else 0.0
    if candidates[0][0] - second_score < 0.08:
        return [], ""
    best = candidates[0][1]
    return [best], best.get("name", "")


def _is_context_atoll_match(context: dict[str, Any], island: dict[str, Any]) -> bool:
    if normalize_name(island.get("atoll")) == normalize_name(context.get("proposed_atoll")):
        return True
    return (
        context.get("atoll_code") == "k"
        and normalize_name(island.get("atoll")) == "mle"
        and island.get("name_normalized") in {"mal", "male", "hulhumal", "hulhumale"}
    )


def _core_name(value: str | None) -> str:
    text = normalize_name(value)
    for token in (
        "health centre",
        "health center",
        "hospital",
        "clinic",
        "medical centre",
        "medical center",
        "school",
        "closed",
        "branch",
    ):
        text = text.replace(token, " ")
    return " ".join(text.split())


def _build_match_candidates(
    facilities: list[dict[str, Any]],
    osm_features: list[dict[str, Any]],
    islands: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    island_names = {
        properties["id"]: properties.get("name")
        for island in islands
        if (properties := island.get("properties"))
    }
    candidates: list[dict[str, Any]] = []
    for facility in facilities:
        if facility["match_status"] != "unmatched":
            continue
        context = facility.get("location_context", {})
        allowed_islands = set(context.get("candidate_island_ids", []))
        pool = [
            feature
            for feature in osm_features
            if (not allowed_islands or feature.get("island_id") in allowed_islands)
            and _compatible_feature_category(facility["category"], feature["category"])
        ]
        scored = []
        for feature in pool:
            if not _osm_search_labels(feature):
                continue
            evidence = _name_match_evidence(facility, feature)
            score = evidence["name_score"]
            # A known island is useful evidence, but it is not sufficient by
            # itself to silently assign a generic hospital/clinic marker.
            threshold = 0.45 if allowed_islands else 0.55
            if score >= threshold or evidence["shared_tokens"]:
                scored.append(
                    {
                        "osm_object_id": feature["id"],
                        "name": feature.get("name"),
                        "matched_name": evidence["matched_name"],
                        "island_id": feature.get("island_id"),
                        "island_name": island_names.get(feature.get("island_id")),
                        "category": feature.get("category"),
                        "geometry": feature.get("geometry"),
                        "score": round(score, 4),
                        "name_score": round(score, 4),
                        "shared_tokens": evidence["shared_tokens"],
                        "same_island": bool(
                            allowed_islands and feature.get("island_id") in allowed_islands
                        ),
                        "category_relation": _category_relation(
                            facility["category"], feature["category"]
                        ),
                        "evidence_type": "name_and_island_evidence",
                    }
                )
        scored.sort(
            key=lambda item: (
                -int(bool(item["same_island"])),
                -len(item["shared_tokens"]),
                -item["score"],
                item["osm_object_id"],
            )
        )
        if not scored and len(allowed_islands) == 1:
            # Keep a unique island-scoped lead for human review even when its
            # OSM name is generic. Context alone never attaches geometry.
            island_features = [
                feature for feature in pool if feature.get("island_id") in allowed_islands
            ]
            if len(island_features) == 1:
                feature = island_features[0]
                scored.append(
                    {
                        "osm_object_id": feature["id"],
                        "name": feature.get("name"),
                        "matched_name": feature.get("name"),
                        "island_id": feature.get("island_id"),
                        "island_name": island_names.get(feature.get("island_id")),
                        "category": feature.get("category"),
                        "geometry": feature.get("geometry"),
                        "score": 0.0,
                        "name_score": 0.0,
                        "shared_tokens": [],
                        "same_island": True,
                        "category_relation": _category_relation(
                            facility["category"], feature["category"]
                        ),
                        "evidence_type": "unique_island_feature_without_name_evidence",
                    }
                )
        if scored:
            candidates.append(
                {
                    "facility_id": facility["id"],
                    "source": facility["source"],
                    "category": facility["category"],
                    "official_name": facility["name"],
                    "location_context": context,
                    "candidates": scored[:5],
                    "review_status": "requires_manual_review_before_acceptance",
                    "review_scope": "island_scoped" if allowed_islands else "national_name_search",
                }
            )
    return candidates


def _apply_reviewed_overrides(
    facilities: list[dict[str, Any]],
    osm_features: list[dict[str, Any]],
    overrides: list[dict[str, Any]],
) -> None:
    """Apply a small, auditable batch of manually reviewed obvious matches."""
    facilities_by_id = {facility["id"]: facility for facility in facilities}
    osm_by_id = {feature["id"]: feature for feature in osm_features}
    for override in overrides:
        facility = facilities_by_id.get(override.get("facility_id"))
        feature = osm_by_id.get(override.get("osm_object_id"))
        if facility is None or feature is None:
            raise ValueError(
                "reviewed facility override references a missing facility or OSM object"
            )
        if facility.get("match_status") not in {
            "unmatched",
            "osm_match_review_required",
            "island_context_only",
            "source_not_in_osm",
            "osm_provisional_review_required",
        }:
            if facility.get("osm_object_id") == feature.get("id"):
                # Adding a reviewed online feature can promote an exact match before
                # this override loop runs. Preserve the exact mapping and avoid
                # treating the redundant override as a conflict.
                continue
            raise ValueError(f"reviewed facility override is already accepted: {facility['id']}")
        if not _compatible_feature_category(
            facility.get("category", ""), feature.get("category", "")
        ):
            raise ValueError(
                f"reviewed facility override has incompatible categories: {facility['id']}"
            )
        evidence = _name_match_evidence(facility, feature)
        facility["geometry"] = feature.get("geometry")
        facility["geometry_source"] = "OpenStreetMap"
        facility["geometry_quality"] = "osm_reviewed"
        facility["match_status"] = "reviewed_osm_match"
        facility["match_reason"] = "manually_reviewed_obvious_name_and_place_match"
        facility["osm_object_id"] = feature["id"]
        facility["osm_match_score"] = round(evidence["name_score"], 4)
        if feature.get("island_id"):
            facility["island_id"] = feature["island_id"]
        facility["manual_match_review"] = {
            "reviewed": True,
            "review_note": override.get("review_note", ""),
            "matched_name": evidence["matched_name"],
            "shared_tokens": evidence["shared_tokens"],
        }


def _classify_unmatched_facilities(
    facilities: list[dict[str, Any]], match_candidates: list[dict[str, Any]]
) -> None:
    """Resolve every non-exact record into an explicit review or coverage state."""
    candidate_facility_ids = {item["facility_id"] for item in match_candidates}
    for facility in facilities:
        if facility["match_status"] != "unmatched":
            continue
        context = facility.get("location_context", {})
        island_ids = context.get("candidate_island_ids", [])
        if len(island_ids) == 1:
            facility["island_id"] = island_ids[0]
            facility["location_resolution"] = "official_island_context"
            facility["geometry_quality"] = "island_context_only"
            facility["geometry_source"] = "OneMap"
        if facility["id"] in candidate_facility_ids:
            facility["match_status"] = "osm_match_review_required"
            facility["match_reason"] = "name_candidate_requires_manual_review"
        elif len(island_ids) == 1:
            facility["match_status"] = "island_context_only"
            facility["match_reason"] = "official_island_found_but_no_defensible_osm_feature"
        else:
            facility["match_status"] = "source_not_in_osm"
            facility["match_reason"] = "no_defensible_osm_feature_or_island_context"


def _attach_osm_match_metadata(
    facilities: list[dict[str, Any]], match_candidates: list[dict[str, Any]]
) -> None:
    """Give every official record one explicit, map-safe OSM relationship."""

    candidates_by_facility = {item["facility_id"]: item for item in match_candidates}
    review_statuses = {
        "ambiguous_osm_name_match",
        "osm_match_review_required",
        "osm_provisional_review_required",
    }
    for facility in facilities:
        status = facility.get("match_status", "unmatched")
        review = candidates_by_facility.get(facility.get("id"), {})
        candidates = review.get("candidates", [])
        facility["osm_match"] = {
            "object_id": facility.get("osm_object_id"),
            "status": status,
            "score": facility.get("osm_match_score")
            or (1.0 if facility.get("osm_object_id") else None),
            "candidate_count": len(candidates),
            "review_required": status in review_statuses,
            "geometry_available": bool(facility.get("geometry")),
            "geometry_source": facility.get("geometry_source"),
            "provisional_duplicate": bool(facility.get("provisional_duplicate")),
        }


_MATCH_GENERIC_TOKENS = {
    "and",
    "atoll",
    "branch",
    "care",
    "center",
    "centre",
    "closed",
    "clinic",
    "facility",
    "family",
    "for",
    "health",
    "hospital",
    "island",
    "limited",
    "medical",
    "maldives",
    "mohamed",
    "memorial",
    "of",
    "post",
    "education",
    "primary",
    "high",
    "pvt",
    "regional",
    "resort",
    "school",
    "services",
    "service",
    "the",
}


def _osm_search_labels(feature: dict[str, Any]) -> list[str]:
    """Return OSM name fields that can preserve an alternate official spelling."""
    tags = feature.get("tags", {})
    values = [
        feature.get("name"),
        tags.get("alt_name"),
        tags.get("official_name"),
        tags.get("short_name"),
    ]
    return list(dict.fromkeys(value for value in values if value))


def _match_tokens(value: str | None) -> set[str]:
    return {
        token
        for token in normalize_name(value).split()
        if len(token) >= 4 and token not in _MATCH_GENERIC_TOKENS
    }


def _name_match_evidence(facility: dict[str, Any], feature: dict[str, Any]) -> dict[str, Any]:
    official_tokens = _match_tokens(facility.get("name"))
    best: tuple[float, str, set[str]] = (0.0, "", set())
    for label in _osm_search_labels(feature):
        candidate_tokens = _match_tokens(label)
        shared = official_tokens & candidate_tokens
        sequence = difflib.SequenceMatcher(
            None,
            _match_core_name(facility.get("name")),
            _match_core_name(label),
        ).ratio()
        # A shared distinctive token is stronger than raw character similarity
        # for transliterations such as Mathiveree/Mathiveri and names with
        # different government suffixes.
        token_score = (
            len(shared) / min(len(official_tokens), len(candidate_tokens))
            if official_tokens and candidate_tokens
            else 0.0
        )
        # One shared word such as Family, Mohamed, or Memorial is not enough
        # to turn a generic name into a perfect match. Let raw similarity
        # carry single-token matches; multiple distinctive tokens may
        # supplement transliteration differences.
        score = max(sequence, token_score) if len(shared) >= 2 else sequence
        if score > best[0]:
            best = (score, label, shared)
    return {
        "name_score": best[0],
        "matched_name": best[1],
        "shared_tokens": sorted(best[2]),
    }


def _match_core_name(value: str | None) -> str:
    """Prepare names for matching without weakening island-context parsing."""
    return " ".join(
        token
        for token in _core_name(value).split()
        if len(token) > 2 and token not in ATOLL_CODE_PROPOSALS and token not in {"medical", "post"}
    )


def _build_facility_review(
    facilities: list[dict[str, Any]],
    match_candidates: list[dict[str, Any]],
    osm_features: list[dict[str, Any]],
) -> dict[str, Any]:
    """Create a complete auditable decision record for every official facility."""

    candidates_by_id = {item["facility_id"]: item for item in match_candidates}
    decisions: list[dict[str, Any]] = []
    for facility in facilities:
        status = facility.get("match_status")
        candidate_review = candidates_by_id.get(facility.get("id"), {})
        candidates = candidate_review.get("candidates", [])
        context = facility.get("location_context", {})
        island_ids = set(context.get("candidate_island_ids", []))
        island_feature_count = sum(
            feature.get("island_id") in island_ids
            and _compatible_feature_category(
                facility.get("category", ""), feature.get("category", "")
            )
            for feature in osm_features
        )
        if status in {
            "exact_normalized_name",
            "exact_source_identifier",
            "reviewed_osm_match",
        }:
            decision = (
                "accepted_reviewed_match"
                if status == "reviewed_osm_match"
                else "accepted_exact_match"
            )
            review_required = False
        elif status == "osm_best_effort":
            decision = "accepted_best_effort"
            review_required = False
        elif status == "osm_provisional_review_required":
            decision = "provisional_match_review_required"
            review_required = True
        elif status in {"osm_match_review_required", "ambiguous_osm_name_match"}:
            decision = "not_approved_ambiguous_candidate"
            review_required = True
        else:
            decision = "not_approved_no_osm_match"
            review_required = False
        review_priority, review_action = _review_queue_action(
            facility, status, candidates, island_feature_count
        )
        facility["mapping_review"] = {
            "decision": decision,
            "review_required": review_required,
            "priority": review_priority,
            "action": review_action,
        }
        decisions.append(
            {
                "facility_id": facility.get("id"),
                "source": facility.get("source"),
                "source_record_id": facility.get("source_record_id"),
                "category": facility.get("category"),
                "official_name": facility.get("name"),
                "island_id": facility.get("island_id"),
                "decision": decision,
                "review_required": review_required,
                "review_priority": review_priority,
                "recommended_action": review_action,
                "evidence": {
                    "match_status": status,
                    "geometry_quality": facility.get("geometry_quality"),
                    "geometry_source": facility.get("geometry_source"),
                    "osm_object_id": facility.get("osm_object_id"),
                    "osm_match_score": facility.get("osm_match_score"),
                    "provisional_duplicate": facility.get("provisional_duplicate", False),
                    "provisional_duplicate_of": facility.get("provisional_duplicate_of"),
                    "location_context": facility.get("location_context"),
                    "island_compatible_osm_feature_count": island_feature_count,
                    "candidates": candidates,
                },
            }
        )
    return {
        "version": "facility-mapping-review-v2",
        "review_method": "conservative local OSM evidence audit",
        "reviewed_at": datetime.now(UTC).isoformat(),
        "records": decisions,
        "summary": dict(Counter(item["decision"] for item in decisions)),
        "queue_summary": {
            "priority": dict(Counter(item["review_priority"] for item in decisions)),
            "recommended_action": dict(Counter(item["recommended_action"] for item in decisions)),
        },
    }


def _review_queue_action(
    facility: dict[str, Any],
    status: str | None,
    candidates: list[dict[str, Any]],
    island_feature_count: int,
) -> tuple[str, str]:
    """Prioritize unresolved records without turning review evidence into a match."""
    if status in {
        "exact_normalized_name",
        "exact_source_identifier",
        "reviewed_osm_match",
        "osm_best_effort",
    }:
        return "complete", "no_action"
    if status == "osm_provisional_review_required":
        return "high", "validate_provisional_same_island_match"
    top = candidates[0] if candidates else {}
    same_island = bool(top.get("same_island"))
    if (
        status in {"osm_match_review_required", "ambiguous_osm_name_match"}
        and top.get("evidence_type") == "unique_island_feature_without_name_evidence"
    ):
        return "high", "confirm_single_compatible_osm_feature_on_island"
    strong_name = bool(
        (top.get("shared_tokens") and top.get("name_score", 0.0) >= 0.65)
        or top.get("name_score", top.get("score", 0.0)) >= 0.78
    )
    if status in {"osm_match_review_required", "ambiguous_osm_name_match"}:
        if same_island and strong_name:
            return "high", "confirm_same_island_name_candidate"
        return "medium", "review_competing_osm_candidates"
    if status == "island_context_only":
        if island_feature_count == 1:
            return "high", "confirm_single_compatible_osm_feature_on_island"
        if island_feature_count > 1:
            return "medium", "obtain_official_coordinate_to_select_osm_feature"
        return "low", "osm_coverage_gap_or_unlocated_feature"
    if facility.get("location_context", {}).get("candidate_island_ids"):
        return "medium", "search_osm_again_with_island_context"
    return "high", "recover_official_island_or_coordinates"


def _apply_best_effort_matches(
    facilities: list[dict[str, Any]],
    match_candidates: list[dict[str, Any]],
    rejected_matches: set[tuple[str, str]] | None = None,
) -> None:
    facilities_by_id = {facility["id"]: facility for facility in facilities}
    rejected_matches = rejected_matches or set()
    # Do not attach one generic OSM marker to several official records. Exact
    # matches reserve their object first; strong fuzzy matches then compete in
    # deterministic evidence order and weaker duplicates remain review-only.
    reserved_osm_ids = {
        facility.get("osm_object_id")
        for facility in facilities
        if facility.get("osm_object_id")
        and facility.get("match_status") in {"exact_normalized_name", "exact_source_identifier"}
    }
    ordered_reviews = sorted(
        match_candidates,
        key=lambda review: (
            -review["candidates"][0].get("name_score", review["candidates"][0].get("score", 0.0)),
            -len(review["candidates"][0].get("shared_tokens", [])),
            review["facility_id"],
        ),
    )
    for review in ordered_reviews:
        facility = facilities_by_id[review["facility_id"]]
        candidates = [
            candidate
            for candidate in review["candidates"]
            if candidate.get("osm_object_id") not in reserved_osm_ids
            and (review["facility_id"], candidate.get("osm_object_id")) not in rejected_matches
        ]
        if not candidates:
            continue
        top = candidates[0]
        second_score = candidates[1]["score"] if len(candidates) > 1 else 0.0
        top_score = top.get("name_score", top["score"])
        context = review["location_context"]
        unique_island = context.get("island_match_status") == (
            "unique_name_and_proposed_atoll_candidate"
        )
        same_island = top.get("island_id") in set(context.get("candidate_island_ids", []))
        relation = top.get("category_relation", "compatible")
        shared_tokens = top.get("shared_tokens", [])
        score_gap = top_score - second_score
        if (
            unique_island
            and same_island
            and top_score >= 0.78
            and (shared_tokens or top_score >= 0.86 or (relation == "exact" and top_score >= 0.78))
            and score_gap >= 0.05
            and relation != "incompatible"
        ):
            _accept_best_effort_match(facility, top)
            reserved_osm_ids.add(top["osm_object_id"])
            review["review_status"] = "best_effort_applied"
            continue
        if (
            not context.get("candidate_island_ids")
            and top.get("island_id")
            and top_score >= 0.95
            and score_gap >= 0.25
        ):
            _accept_best_effort_match(facility, top)
            reserved_osm_ids.add(top["osm_object_id"])
            review["review_status"] = "best_effort_applied"


def _apply_provisional_matches(
    facilities: list[dict[str, Any]],
    match_candidates: list[dict[str, Any]],
    rejected_matches: set[tuple[str, str]] | None = None,
) -> None:
    """Attach same-island leads for MVP maps while keeping them review-required."""
    facilities_by_id = {facility["id"]: facility for facility in facilities}
    rejected_matches = rejected_matches or set()
    provisional_owners: dict[str, str] = {
        facility["osm_object_id"]: facility["id"]
        for facility in facilities
        if facility.get("osm_object_id")
    }
    reviews = sorted(
        match_candidates,
        key=lambda review: (
            -int(bool(review["candidates"][0].get("same_island"))),
            -review["candidates"][0].get("name_score", 0.0),
            review["facility_id"],
        ),
    )
    for review in reviews:
        facility = facilities_by_id[review["facility_id"]]
        if facility.get("match_status") != "unmatched":
            continue
        candidates = [
            candidate
            for candidate in review["candidates"]
            if candidate.get("same_island")
            and (review["facility_id"], candidate.get("osm_object_id")) not in rejected_matches
        ]
        if not candidates:
            continue
        candidate = candidates[0]
        facility["geometry"] = candidate.get("geometry")
        facility["geometry_source"] = "OpenStreetMap"
        facility["geometry_quality"] = "osm_provisional"
        facility["match_status"] = "osm_provisional_review_required"
        facility["match_reason"] = "same_island_osm_candidate_requires_review"
        facility["osm_object_id"] = candidate["osm_object_id"]
        facility["osm_match_score"] = candidate.get("score", 0.0)
        if candidate.get("island_id"):
            facility["island_id"] = candidate["island_id"]
        owner = provisional_owners.get(candidate["osm_object_id"])
        if owner:
            facility["provisional_duplicate"] = True
            facility["provisional_duplicate_of"] = owner
        else:
            provisional_owners[candidate["osm_object_id"]] = facility["id"]
        review["review_status"] = "provisional_review_match_applied"


def _accept_best_effort_match(facility: dict[str, Any], candidate: dict[str, Any]) -> None:
    facility["geometry"] = candidate.get("geometry")
    facility["geometry_source"] = "OpenStreetMap"
    facility["geometry_quality"] = "osm_best_effort"
    facility["match_status"] = "osm_best_effort"
    facility["match_reason"] = "high_confidence_name_and_or_island_constrained_candidate"
    facility["osm_object_id"] = candidate["osm_object_id"]
    facility["osm_match_score"] = candidate["score"]
    if candidate.get("island_id"):
        facility["island_id"] = candidate["island_id"]


def _compatible_feature_category(facility_category: str, osm_category: str) -> bool:
    if facility_category == "school":
        return osm_category == "school"
    if facility_category in {"hospital", "health_center", "clinic"}:
        return osm_category in {"hospital", "clinic"}
    if facility_category == "airport":
        return osm_category in {"aerodrome", "terminal"}
    return False


def _category_relation(facility_category: str, osm_category: str) -> str:
    if facility_category == "school" and osm_category == "school":
        return "exact"
    if facility_category == osm_category:
        return "exact"
    if facility_category in {"hospital", "health_center", "clinic"} and osm_category in {
        "hospital",
        "clinic",
    }:
        return "healthcare_cross_category"
    if facility_category == "airport" and osm_category in {"aerodrome", "terminal"}:
        return "airport_cross_category"
    return "incompatible"


class _SelectedOsmHandler(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.features: list[dict[str, Any]] = []
        self.route_relation_count = 0
        self.road_ways: list[dict[str, Any]] = []
        self.demand_features: list[dict[str, Any]] = []
        self.ferry_ways: dict[str, list[list[float]]] = {}
        self.way_endpoints: dict[str, list[list[float]]] = {}
        self.ferry_relations: list[dict[str, Any]] = []

    def node(self, node: Any) -> None:
        tags = dict(node.tags)
        if tags.get("place") in {"city", "town", "village", "hamlet", "locality"}:
            self.demand_features.append(
                {
                    "id": f"osm:node:{node.id}",
                    "coordinates": [node.location.lon, node.location.lat]
                    if node.location is not None
                    else None,
                    "weight": 1.0,
                }
            )
        category = _osm_category(tags)
        if category is None or node.location is None:
            return
        self.features.append(
            {
                "id": f"osm:node:{node.id}",
                "source_id": str(node.id),
                "object_type": "node",
                "category": category,
                "name": tags.get("name"),
                "tags": tags,
                "geometry": point_geometry(node.location.lon, node.location.lat),
            }
        )

    def way(self, way: Any) -> None:
        tags = dict(way.tags)
        coordinates = _way_coordinates(way)
        if coordinates:
            self.way_endpoints[str(way.id)] = [coordinates[0], coordinates[-1]]
        if tags.get("highway") and len(coordinates) >= 2:
            self.road_ways.append(
                {
                    "id": str(way.id),
                    "tags": tags,
                    "points": [
                        {"id": str(node.ref), "coordinates": [node.lon, node.lat]}
                        for node in way.nodes
                        if node.location is not None
                    ],
                }
            )
        if tags.get("route") == "ferry" and coordinates:
            self.ferry_ways[str(way.id)] = coordinates
        if tags.get("landuse") == "residential" and coordinates:
            longitude = sum(point[0] for point in coordinates) / len(coordinates)
            latitude = sum(point[1] for point in coordinates) / len(coordinates)
            self.demand_features.append(
                {
                    "id": f"osm:way:{way.id}",
                    "coordinates": [longitude, latitude],
                    "weight": 1.0,
                }
            )
        category = _osm_category(tags)
        if category is None or not tags.get("name"):
            return
        if not coordinates:
            return
        longitude = sum(point[0] for point in coordinates) / len(coordinates)
        latitude = sum(point[1] for point in coordinates) / len(coordinates)
        self.features.append(
            {
                "id": f"osm:way:{way.id}",
                "source_id": str(way.id),
                "object_type": "way",
                "category": category,
                "name": tags.get("name"),
                "tags": tags,
                "geometry": point_geometry(longitude, latitude),
            }
        )

    def relation(self, relation: Any) -> None:
        tags = dict(relation.tags)
        if tags.get("route") in {"bus", "ferry"}:
            self.route_relation_count += 1
        if tags.get("route") == "ferry":
            points: list[list[float]] = []
            for member in relation.members:
                if member.type == "w":
                    points.extend(self.ferry_ways.get(str(member.ref), []))
                    points.extend(self.way_endpoints.get(str(member.ref), []))
            self.ferry_relations.append(
                {
                    "id": f"osm:relation:{relation.id}",
                    "name": tags.get("name"),
                    "points": points,
                }
            )


def _way_coordinates(way: Any) -> list[list[float]]:
    return [[node.lon, node.lat] for node in way.nodes if node.location is not None]


def _osm_category(tags: dict[str, str]) -> str | None:
    if tags.get("highway") == "bus_stop":
        return "bus_stop"
    if tags.get("public_transport") in {"platform", "stop_position", "station", "stop_area"}:
        return "public_transport"
    if tags.get("amenity") in {"bus_station", "ferry_terminal", "parking", "taxi"}:
        return tags["amenity"]
    if tags.get("man_made") == "pier":
        return "pier"
    if tags.get("aeroway") in {"aerodrome", "terminal", "helipad"}:
        return tags["aeroway"]
    if tags.get("amenity") in {"hospital", "clinic", "school"}:
        return tags["amenity"]
    if tags.get("office") == "government":
        return "government"
    return None


def _build_island_index(
    islands: list[dict[str, Any]],
) -> tuple[list[str], list[Any], STRtree]:
    island_ids: list[str] = []
    polygons: list[Any] = []
    for island in islands:
        island_geometry = island.get("geometry")
        island_id = island.get("properties", {}).get("id")
        if island_geometry and island_id:
            island_ids.append(island_id)
            polygons.append(shape(island_geometry))
    return island_ids, polygons, STRtree(polygons)


def _find_island(
    geometry: dict[str, Any] | None,
    island_ids: list[str],
    polygons: list[Any],
    tree: STRtree,
) -> str | None:
    if not geometry or geometry.get("type") != "Point":
        return None
    point = Point(geometry["coordinates"])
    for index in tree.query(point, predicate="intersects"):
        polygon = polygons[int(index)]
        if polygon.contains(point) or polygon.touches(point):
            return island_ids[int(index)]
    return None


def _apply_exact_osm_matches(
    facilities: list[dict[str, Any]],
    osm_features: list[dict[str, Any]],
    islands: list[dict[str, Any]],
) -> None:
    by_name: dict[str, list[dict[str, Any]]] = {}
    for feature in osm_features:
        name = normalize_name(feature.get("name"))
        if name:
            by_name.setdefault(name, []).append(feature)
    for facility in facilities:
        if facility["match_status"] != "unmatched":
            continue
        candidates = by_name.get(facility["name_normalized"], [])
        candidates = [
            candidate
            for candidate in candidates
            if _compatible_feature_category(facility["category"], candidate["category"])
        ]
        allowed_islands = set(facility.get("location_context", {}).get("candidate_island_ids", []))
        if len(allowed_islands) == 1:
            candidates = [
                candidate
                for candidate in candidates
                if candidate.get("island_id") in allowed_islands
            ]
        candidates = _collapse_nearby_osm_candidates(candidates)
        if len(candidates) != 1:
            if candidates:
                facility["match_status"] = "ambiguous_osm_name_match"
            continue
        candidate = candidates[0]
        facility["geometry"] = candidate["geometry"]
        facility["geometry_source"] = "OpenStreetMap"
        facility["geometry_quality"] = "osm_matched"
        facility["match_status"] = "exact_normalized_name"
        facility["osm_object_id"] = candidate["id"]
        if candidate.get("island_id"):
            facility["island_id"] = candidate["island_id"]


def _apply_source_identifier_matches(
    facilities: list[dict[str, Any]], osm_features: list[dict[str, Any]]
) -> None:
    """Use an official airport identifier where both sources publish it."""
    by_icao: dict[str, list[dict[str, Any]]] = {}
    for feature in osm_features:
        icao = normalize_name(feature.get("tags", {}).get("icao"))
        if icao:
            by_icao.setdefault(icao, []).append(feature)
    for facility in facilities:
        if facility["source"] != "CAA":
            continue
        icao = normalize_name(facility["source_record_id"])
        candidates = by_icao.get(icao, [])
        if len(candidates) != 1:
            continue
        _set_osm_match(facility, candidates[0], "exact_source_identifier")


def _set_osm_match(facility: dict[str, Any], feature: dict[str, Any], match_status: str) -> None:
    facility["geometry"] = feature["geometry"]
    facility["geometry_source"] = "OpenStreetMap"
    facility["geometry_quality"] = "osm_matched"
    facility["match_status"] = match_status
    facility["osm_object_id"] = feature["id"]
    if feature.get("island_id"):
        facility["island_id"] = feature["island_id"]


def _collapse_nearby_osm_candidates(
    candidates: list[dict[str, Any]], max_coordinate_delta: float = 0.0015
) -> list[dict[str, Any]]:
    """Collapse node/way duplicates while retaining separate nearby facilities."""
    retained: list[dict[str, Any]] = []
    for candidate in candidates:
        duplicate_index = next(
            (
                index
                for index, existing in enumerate(retained)
                if candidate.get("island_id")
                and candidate.get("island_id") == existing.get("island_id")
                and _coordinates_are_near(
                    candidate.get("geometry"),
                    existing.get("geometry"),
                    max_coordinate_delta,
                )
            ),
            None,
        )
        if duplicate_index is None:
            retained.append(candidate)
            continue
        existing = retained[duplicate_index]
        if existing.get("object_type") == "node" and candidate.get("object_type") == "way":
            retained[duplicate_index] = candidate
    return retained


def _coordinates_are_near(
    first: dict[str, Any] | None,
    second: dict[str, Any] | None,
    max_coordinate_delta: float,
) -> bool:
    if not first or not second:
        return False
    if first.get("type") != "Point" or second.get("type") != "Point":
        return False
    first_coordinates = first.get("coordinates", [])
    second_coordinates = second.get("coordinates", [])
    if len(first_coordinates) < 2 or len(second_coordinates) < 2:
        return False
    return all(
        abs(float(left) - float(right)) <= max_coordinate_delta
        for left, right in zip(first_coordinates[:2], second_coordinates[:2])
    )


def _facility_match_summary(facilities: list[dict[str, Any]]) -> dict[str, int]:
    return dict(sorted(Counter(facility["match_status"] for facility in facilities).items()))
