"""Integrity and structural validation for the prewarm artifact set."""

from __future__ import annotations

import hashlib
import math
from pathlib import Path
from typing import Any

from app.data.cache import FileCache

REQUIRED_ARTIFACTS = (
    "normalized/islands.geojson",
    "normalized/population.json",
    "normalized/facilities.json",
    "normalized/transport.json",
    "normalized/provenance.json",
    "normalized/facility-mapping-review.json",
    "derived/national_summary.json",
    "derived/demand-anchors.json",
    "derived/accessibility-default.json",
    "graphs/land.json",
    "graphs/marine.json",
    "graphs/air.json",
    "graphs/summary.json",
)


class CacheValidator:
    """Validate required cache files, checksums, and core artifact shapes."""

    def __init__(self, data_dir: Path) -> None:
        self.cache = FileCache(data_dir / "cache")

    def validate(self) -> dict[str, Any]:
        errors: list[str] = []
        warnings: list[str] = []
        checked_files = 0
        values: dict[str, Any] = {}
        for relative_path in REQUIRED_ARTIFACTS:
            try:
                path = self.cache.path(relative_path)
                value = self.cache.read_json(relative_path)
                metadata = self.cache.read_metadata(relative_path)
                checked_files += 1
                values[relative_path] = value
                self._validate_checksum(path, metadata, relative_path, errors)
            except FileNotFoundError:
                errors.append(f"missing required artifact: {relative_path}")
            except (ValueError, TypeError) as error:
                errors.append(f"invalid artifact {relative_path}: {error}")
            except Exception as error:
                errors.append(f"unreadable artifact {relative_path}: {type(error).__name__}")
        self._validate_shapes(values, errors, warnings)
        return {
            "status": "ok" if not errors else "error",
            "checked_files": checked_files,
            "required_file_count": len(REQUIRED_ARTIFACTS),
            "errors": errors,
            "warnings": warnings,
        }

    @staticmethod
    def _validate_checksum(
        path: Path,
        metadata: dict[str, Any],
        relative_path: str,
        errors: list[str],
    ) -> None:
        expected = metadata.get("sha256")
        if not expected:
            errors.append(f"missing checksum metadata: {relative_path}")
            return
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != expected:
            errors.append(f"checksum mismatch: {relative_path}")

    @staticmethod
    def _validate_shapes(
        values: dict[str, Any],
        errors: list[str],
        warnings: list[str],
    ) -> None:
        islands = values.get("normalized/islands.geojson")
        if islands is not None:
            features = islands.get("features") if isinstance(islands, dict) else None
            ids = [
                feature.get("properties", {}).get("id")
                for feature in features or []
                if isinstance(feature, dict)
            ]
            if not isinstance(features, list) or not ids or len(ids) != len(set(ids)):
                errors.append("islands artifact must contain unique feature IDs")
            CacheValidator._validate_feature_geometries(features or [], "islands", errors)

        facilities = values.get("normalized/facilities.json")
        if facilities is not None:
            if not isinstance(facilities, list):
                errors.append("facilities artifact must be a list")
            else:
                ids = [item.get("id") for item in facilities if isinstance(item, dict)]
                if len(ids) != len(set(ids)):
                    errors.append("facilities artifact contains duplicate IDs")
                CacheValidator._validate_feature_geometries(facilities, "facilities", errors)

        review = values.get("normalized/facility-mapping-review.json")
        if review is not None and not isinstance(review.get("records"), list):
            errors.append("facility mapping review must contain a records list")
        if isinstance(facilities, list) and isinstance(review, dict):
            review_records = review.get("records")
            facility_ids = {item.get("id") for item in facilities if isinstance(item, dict)}
            review_ids = {
                item.get("facility_id")
                for item in review_records or []
                if isinstance(item, dict)
            }
            if facility_ids != review_ids:
                errors.append("facility mapping review IDs do not match facilities")

        transport = values.get("normalized/transport.json")
        if transport is not None:
            features = transport.get("features")
            if not isinstance(features, list):
                errors.append("transport artifact must contain a features list")
            else:
                CacheValidator._validate_feature_geometries(features, "transport", errors)

        land = values.get("graphs/land.json")
        if land is not None and not isinstance(land.get("islands"), dict):
            errors.append("land graph must contain an islands object")

        marine = values.get("graphs/marine.json")
        if marine is not None and not isinstance(marine.get("edges"), list):
            errors.append("marine graph must contain an edges list")

        air = values.get("graphs/air.json")
        if air is not None and not isinstance(air.get("edges"), list):
            errors.append("air graph must contain an edges list")

        accessibility = values.get("derived/accessibility-default.json")
        if accessibility is not None:
            scores = accessibility.get("scores") if isinstance(accessibility, dict) else None
            summary = accessibility.get("summary", {}) if isinstance(accessibility, dict) else {}
            if not isinstance(scores, list) or summary.get("island_count") != len(scores):
                errors.append("accessibility artifact summary does not match scores")
            if accessibility.get("version") != "accessibility-v1":
                warnings.append("accessibility artifact version is not accessibility-v1")

    @staticmethod
    def _validate_feature_geometries(
        records: list[dict[str, Any]],
        artifact_name: str,
        errors: list[str],
    ) -> None:
        for index, record in enumerate(records):
            geometry = record.get("geometry") if isinstance(record, dict) else None
            if geometry is None:
                continue
            if not _valid_geometry(geometry):
                errors.append(f"malformed geometry in {artifact_name}[{index}]")


def _valid_geometry(geometry: Any) -> bool:
    if not isinstance(geometry, dict) or not geometry.get("type"):
        return False
    pairs = list(_coordinate_pairs(geometry.get("coordinates")))
    return bool(pairs) and all(
        math.isfinite(longitude)
        and math.isfinite(latitude)
        and -180 <= longitude <= 180
        and -90 <= latitude <= 90
        for longitude, latitude in pairs
    )


def _coordinate_pairs(value: Any):
    if isinstance(value, (list, tuple)):
        if len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
            yield float(value[0]), float(value[1])
        else:
            for child in value:
                yield from _coordinate_pairs(child)
