"""Immutable reviewed passenger vintages; supplied source snapshots stay untouched."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from app.forecasting.engine import month_index, validate_series

VERSION_PATTERN = re.compile(r"^[a-f0-9]{32}$")
DISCLAIMER = (
    "User-reviewed imported publication snapshot. Validation checks the contract and "
    "historical differences; it does not independently verify the publication contents."
)


def digest(source: dict[str, Any]) -> str:
    content = json.dumps(source, sort_keys=True, ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(content.encode()).hexdigest()


def validate_import(
    source: dict[str, Any], baseline: dict[str, Any], now: datetime
) -> list[dict[str, Any]]:
    if len(json.dumps(source, allow_nan=False).encode()) > 2_000_000:
        raise ValueError("Passenger source exceeds the 2 MB limit")
    if not isinstance(source.get("series"), list) or not 1 <= len(source["series"]) <= 20:
        raise ValueError("Source requires 1–20 monthly series")
    audit = source.get("audit", {})
    if not isinstance(audit, dict) or not all(isinstance(item, dict) for item in source["series"]):
        raise ValueError("Audit and passenger categories must be objects")
    publication = audit.get("publishedAt", "")
    try:
        published = datetime.strptime(publication, "%Y-%m-%d").date()
        checked = datetime.fromisoformat(source["asOf"].replace("Z", "+00:00"))
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise ValueError("Publication date and timezone-aware asOf are required") from error
    if checked.tzinfo is None or checked > now or published > now.date():
        raise ValueError("Future or timezone-naive source evidence is not admissible")
    if checked.date() < published:
        raise ValueError("Source asOf cannot precede the publication date")
    if publication < baseline.get("audit", {}).get("publishedAt", ""):
        raise ValueError("An older publication cannot replace the active passenger vintage")
    authorities = {"statisticsmaldives.gov.mv", "www.statisticsmaldives.gov.mv"}
    sources = audit.get("sources", {})
    if not isinstance(sources, dict) or not sources:
        raise ValueError("Official publication URLs and SHA-256 source receipts are required")
    for receipt in sources.values():
        if not isinstance(receipt, dict):
            raise ValueError("Publication receipts must be objects")
        address = urlparse(str(receipt.get("url", "")))
        if address.scheme != "https" or address.hostname not in authorities:
            raise ValueError("Passenger publication URLs must use the official MBS HTTPS domain")
        if not re.fullmatch(r"[a-f0-9]{64}", str(receipt.get("sha256", ""))):
            raise ValueError("Every publication receipt needs a SHA-256 checksum")
    existing = {item["id"]: item for item in baseline["series"]}
    identifiers = [item.get("id") for item in source["series"]]
    if (
        not all(isinstance(identifier, str) for identifier in identifiers)
        or len(set(identifiers)) != len(identifiers)
        or set(identifiers) != set(existing)
    ):
        raise ValueError("Imported category IDs must match the active categories exactly")
    differences = []
    for series in source["series"]:
        previous = existing[series["id"]]
        if any(
            series.get(key) != previous.get(key) for key in ("name", "mode", "unit", "geography")
        ):
            raise ValueError("Category names, mode, unit and geography must remain comparable")
        points = validate_series(series)
        if not 18 <= len(points) <= 600:
            raise ValueError("Each imported category needs 18–600 continuous observed months")
        if month_index(points[-1]["month"]) > month_index(publication[:7]):
            raise ValueError("Observations cannot occur after their publication month")
        url = urlparse(str(series.get("sourceUrl", "")))
        if url.scheme != "https" or url.hostname not in authorities:
            raise ValueError("Every passenger category requires its official publication URL")
        old = {point["month"]: point["value"] for point in previous["points"]}
        current = {point["month"]: point["value"] for point in points}
        if not set(old).issubset(current):
            raise ValueError("An imported source cannot remove previously observed months")
        revisions = [
            {"month": key, "previous": value, "incoming": current[key]}
            for key, value in old.items()
            if current[key] != value
        ]
        added = [{"month": key, "value": value} for key, value in current.items() if key not in old]
        repeated = [
            point["month"]
            for index, point in enumerate(points)
            if index and point["month"] not in old and point["value"] == points[index - 1]["value"]
        ]
        differences.append(
            {
                "seriesId": series["id"],
                "name": series["name"],
                "revisionCount": len(revisions),
                "revisions": revisions,
                "addedMonths": added,
                "identicalPreviousMonthFlags": repeated,
                "firstMonth": points[0]["month"],
                "lastMonth": points[-1]["month"],
            }
        )
    return differences


class PassengerSourceVersions:
    def __init__(self, directory: Path):
        self.directory = directory

    def active(self) -> dict[str, Any] | None:
        pointer = self.directory / "active.json"
        if not pointer.exists():
            return None
        identifier = json.loads(pointer.read_text(encoding="utf-8"))["versionId"]
        version = self.get(identifier)
        if not version.get("review"):
            raise ValueError("Active passenger source has not been reviewed")
        return version

    def get(self, identifier: str) -> dict[str, Any]:
        if not VERSION_PATTERN.fullmatch(identifier):
            raise KeyError("Passenger source version not found")
        path = self.directory / f"{identifier}.json"
        if not path.exists():
            raise KeyError("Passenger source version not found")
        version = json.loads(path.read_text(encoding="utf-8"))
        if digest(version["source"]) != version["sourceSha256"]:
            raise ValueError("Passenger source version integrity check failed")
        return version

    def stage(self, source: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        differences = validate_import(source, baseline, now)
        source_hash = digest(source)
        baseline_hash = digest({key: value for key, value in baseline.items() if key != "receipt"})
        identifier = hashlib.sha256((source_hash + baseline_hash).encode()).hexdigest()[:32]
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self.directory / f"{identifier}.json"
        if path.exists():
            return self.get(identifier)
        version = {
            "versionId": identifier,
            "stagedAt": now.isoformat(),
            "sourceSha256": source_hash,
            "previousSourceSha256": baseline_hash,
            "source": source,
            "differences": differences,
            "review": None,
            "qualification": DISCLAIMER,
        }
        path.write_text(
            json.dumps(version, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8"
        )
        return version

    def accept(
        self, identifier: str, baseline: dict[str, Any], review_note: str, accept_revisions: bool
    ) -> dict[str, Any]:
        version = self.get(identifier)
        current_hash = digest({key: value for key, value in baseline.items() if key != "receipt"})
        active = self.active()
        if active and active["versionId"] == identifier:
            return active
        if version["previousSourceSha256"] != current_hash:
            raise ValueError(
                "The active source changed; stage the import again against its current vintage"
            )
        validate_import(version["source"], baseline, datetime.now(timezone.utc))
        if any(item["revisionCount"] for item in version["differences"]) and not accept_revisions:
            raise ValueError("Historical revisions require explicit acceptance")
        if len(review_note.strip()) < 20:
            raise ValueError("Record a meaningful review note before accepting this vintage")
        if not version["review"]:
            version["review"] = {
                "acceptedAt": datetime.now(timezone.utc).isoformat(),
                "note": review_note.strip(),
                "historicalRevisionsAccepted": accept_revisions,
            }
            (self.directory / f"{identifier}.json").write_text(
                json.dumps(version, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8"
            )
        temporary = self.directory / "active.tmp.json"
        temporary.write_text(json.dumps({"versionId": identifier}), encoding="utf-8")
        temporary.replace(self.directory / "active.json")
        return version

    def summaries(self) -> list[dict[str, Any]]:
        return (
            [
                {key: value for key, value in self.get(path.stem).items() if key != "source"}
                for path in sorted(self.directory.glob("*.json"), reverse=True)
                if VERSION_PATTERN.fullmatch(path.stem)
            ]
            if self.directory.exists()
            else []
        )
