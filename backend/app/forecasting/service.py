"""Read audited passenger data and preserve immutable, integrity-checked forecast issues."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from typing import Any

from app.analytics.sources import file_receipt, read_json
from app.forecasting.analysis import EvidenceAnalysis
from app.forecasting.engine import (
    MODEL_VERSION,
    REVISION_QUALIFICATION,
    forecast_series,
    index_month,
    month_index,
    validate_series,
)
from app.forecasting.source_versions import PassengerSourceVersions

ISSUE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}_[a-f0-9]{24}$")
MALDIVES_TIME = timezone(timedelta(hours=5))


def canonical(value: Any, *, legacy: bool = False) -> str:
    """Canonical local receipts, with legacy ASCII-key locale order compatibility."""
    if isinstance(value, dict):
        keys = sorted(value, key=str.casefold if legacy else None)
        return (
            "{"
            + ",".join(
                json.dumps(key, ensure_ascii=False) + ":" + canonical(value[key], legacy=legacy)
                for key in keys
            )
            + "}"
        )
    if isinstance(value, list):
        return "[" + ",".join(canonical(item, legacy=legacy) for item in value) + "]"
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def content_hash(value: Any, *, legacy: bool = False) -> str:
    return hashlib.sha256(canonical(value, legacy=legacy).encode("utf-8")).hexdigest()


class ForecastService:
    def __init__(self, public_dir: Path, runtime_dir: Path):
        self.public_dir = Path(public_dir)
        self.runtime_dir = Path(runtime_dir) / "metadata" / "forecast-issues"
        self.source_versions = PassengerSourceVersions(
            Path(runtime_dir) / "metadata" / "passenger-sources"
        )
        self.evidence_analysis = EvidenceAnalysis(self.public_dir, Path(runtime_dir))
        self._lock = RLock()

    def source(self) -> dict[str, Any]:
        path = self.public_dir / "prediction-source.json"
        if not path.is_file():
            raise FileNotFoundError("Audited monthly passenger source is unavailable")
        imported = self.source_versions.active()
        source = imported["source"] if imported else read_json(path)
        if not isinstance(source, dict) or not isinstance(source.get("series"), list):
            raise ValueError("Invalid monthly passenger source structure")
        for series in source["series"]:
            validate_series(series)
        source = {**source}
        source["receipt"] = (
            {
                "artifact": "metadata/passenger-sources/" + imported["versionId"] + ".json",
                "sha256": imported["sourceSha256"],
                "data_status": "user_reviewed_import",
                "importReview": imported["review"],
                "qualification": imported["qualification"],
            }
            if imported
            else file_receipt(path, self.public_dir)
        )
        return source

    def analysis(self) -> dict[str, Any]:
        return self.evidence_analysis.report(self.source())

    def stage_source(self, source: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            staged = self.source_versions.stage(source, self.source())
            return {key: value for key, value in staged.items() if key != "source"}

    def accept_source(self, identifier: str, note: str, revisions: bool) -> dict[str, Any]:
        with self._lock:
            accepted = self.source_versions.accept(identifier, self.source(), note, revisions)
            return {key: value for key, value in accepted.items() if key != "source"}

    def source_history(self) -> dict[str, Any]:
        return {
            "activeReceipt": self.source()["receipt"],
            "versions": self.source_versions.summaries(),
        }

    def series(self) -> list[dict[str, Any]]:
        return [
            {**item, "observationCount": len(item["points"])} for item in self.source()["series"]
        ]

    def _provenance(self, source: dict[str, Any]) -> dict[str, Any]:
        audit = source.get("audit", {})
        return {
            "modelVersion": MODEL_VERSION,
            "transformVersion": audit.get("transformVersion"),
            "checkedAt": (
                source.get("asOf")
                if source["receipt"].get("data_status") == "user_reviewed_import"
                else audit.get("monthlyAuditAsOf", source.get("asOf"))
            ),
            "latestPublicationDate": audit.get("publishedAt"),
            "revisionQualification": REVISION_QUALIFICATION,
            "sources": [
                {
                    "id": key,
                    "url": item.get("url"),
                    "sha256": item.get("sha256"),
                    "publicationSheet": item.get("publication_sheet"),
                }
                for key, item in audit.get("sources", {}).items()
            ],
            "receipt": source["receipt"],
        }

    def bundle(
        self,
        target_month: str | None = None,
        series_ids: list[str] | None = None,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        now = now or datetime.now(timezone.utc)
        current_month = now.astimezone(MALDIVES_TIME).strftime("%Y-%m")
        target_month = target_month or index_month(month_index(current_month) + 1)
        target_index = month_index(target_month)
        source = self.source()
        known = {item["id"] for item in source["series"]}
        if series_ids and not set(series_ids).issubset(known):
            raise KeyError(
                "Unknown passenger series: " + ", ".join(sorted(set(series_ids) - known))
            )
        selected = [item for item in source["series"] if not series_ids or item["id"] in series_ids]
        kind = (
            "future"
            if target_index > month_index(current_month)
            else ("nowcast" if target_month == current_month else "retrospective-preview")
        )
        audit = source.get("audit", {})
        capture = audit.get("busCapture", {})
        return {
            "generatedAt": now.isoformat(),
            "sourceAsOf": source.get("asOf"),
            "sourceIds": source.get("sourceIds", []),
            "dataQualityNotes": source.get("dataQualityNotes", []),
            "target": {"month": target_month, "currentMonthMvt": current_month, "kind": kind},
            "monthly": [forecast_series(item, target_month) for item in selected],
            "provenance": self._provenance(source),
            "bus": {
                "status": "capture-evidence-only" if capture else "unavailable",
                "receipt": capture,
                "predictionAvailable": False,
                "qualification": (
                    "Position capture can verify changing coordinates. Aggregate monthly movement "
                    "history cannot train a vehicle arrival-time or stop-level demand model."
                ),
            },
        }

    def backtest(self, series_id: str, horizon: int) -> dict[str, Any]:
        source = self.source()
        series = next((item for item in source["series"] if item["id"] == series_id), None)
        if series is None:
            raise KeyError(f"Passenger series not found: {series_id}")
        target = index_month(month_index(series["lastActualMonth"]) + horizon)
        forecast = forecast_series(series, target)
        return {
            "seriesId": series_id,
            "horizonMonths": horizon,
            "status": forecast["status"],
            "model": forecast["model"],
            "evaluation": forecast["evaluation"],
            "selection": forecast.get("selection"),
            "benchmarks": forecast["benchmarks"],
            "items": forecast["backtest"],
            "empiricalRange": forecast["empiricalRange"],
            "modelCard": forecast["modelCard"],
            "diagnostics": forecast.get("diagnostics"),
            "calibration": forecast.get("calibration", []),
            "unavailableReason": forecast["unavailableReason"],
            "provenance": self._provenance(source),
        }

    def _verify_issue(self, issue: dict[str, Any]) -> dict[str, Any]:
        if not ISSUE_PATTERN.fullmatch(str(issue.get("id", ""))):
            raise ValueError("Invalid forecast issue identifier")
        content = {key: value for key, value in issue.items() if key != "integritySha256"}
        legacy = issue.get("integrityAlgorithm") != "python-canonical-v1"
        if issue.get("integritySha256") != content_hash(content, legacy=legacy):
            raise ValueError("Forecast issue integrity check failed")
        return issue

    def _issue_paths(self) -> list[Path]:
        by_name = {}
        for directory in (self.public_dir / "forecast-issues", self.runtime_dir):
            if directory.exists():
                for path in directory.glob("*.json"):
                    if ISSUE_PATTERN.fullmatch(path.stem):
                        by_name[path.name] = path
        return sorted(by_name.values(), key=lambda path: path.name, reverse=True)

    def _score(self, issue: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
        provenance = self._provenance(source)
        publication = provenance.get("latestPublicationDate", "") or ""
        later_publication = publication > issue["issuedAt"][:10]
        scores = []
        for forecast in issue.get("forecasts", []):
            series = next(
                (item for item in source["series"] if item["id"] == forecast["seriesId"]), None
            )
            actual = (
                next(
                    (
                        point["value"]
                        for point in series["points"]
                        if point["month"] == issue["target"]["month"]
                    ),
                    None,
                )
                if series
                else None
            )
            base = {
                "seriesId": forecast["seriesId"],
                "actual": None,
                "absoluteError": None,
                "benchmarkErrors": [],
                "rangeCovered": None,
            }
            if actual is None:
                scores.append(
                    {
                        **base,
                        "status": "pending",
                        "qualification": (
                            "Waiting for a checked official observation; "
                            "no prospective accuracy is claimed."
                        ),
                    }
                )
                continue
            matching = series and all(
                series.get(key) == forecast.get(key)
                for key in ("name", "mode", "unit", "geography")
            )
            if not later_publication or not matching or forecast.get("estimate") is None:
                scores.append(
                    {
                        **base,
                        "status": "ineligible",
                        "qualification": (
                            "Requires a later checked publication with matching "
                            "category, geography and unit."
                        ),
                    }
                )
                continue
            interval = forecast.get("empiricalRange")
            scores.append(
                {
                    **base,
                    "status": "later-vintage-score",
                    "actual": actual,
                    "absoluteError": abs(actual - forecast["estimate"]),
                    "benchmarkErrors": [
                        {"model": item["model"], "absoluteError": abs(actual - item["estimate"])}
                        for item in forecast.get("benchmarks", [])
                        if item.get("estimate") is not None
                    ],
                    "rangeCovered": interval["lower"] <= actual <= interval["upper"]
                    if interval
                    else None,
                    "qualification": (
                        "Frozen issue scored against a checked later vintage; "
                        "not first-release accuracy."
                    ),
                }
            )
        return {
            "issue": issue,
            "scores": scores,
            "integrityVerified": True,
            "scoredAgainst": {
                "sourceFingerprint": source["receipt"]["sha256"],
                "publicationDate": publication,
                "checkedAt": provenance.get("checkedAt"),
            },
        }

    def issues(self) -> list[dict[str, Any]]:
        source = self.source()
        return [
            self._score(self._verify_issue(read_json(path)), source) for path in self._issue_paths()
        ]

    def issue(self, issue_id: str) -> dict[str, Any]:
        if not ISSUE_PATTERN.fullmatch(issue_id):
            raise KeyError("Forecast issue not found")
        path = next((path for path in self._issue_paths() if path.stem == issue_id), None)
        if path is None:
            raise KeyError("Forecast issue not found")
        return self._score(self._verify_issue(read_json(path)), self.source())

    def issue_forecast(
        self,
        target_month: str,
        series_ids: list[str] | None = None,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        now = now or datetime.now(timezone.utc)
        bundle = self.bundle(target_month, series_ids, now)
        if bundle["target"]["kind"] == "retrospective-preview":
            raise ValueError("Past policy months cannot be issued as prospective forecasts")
        provenance = bundle["provenance"]
        sources = provenance["sources"]
        if not sources or any(
            not re.fullmatch(r"[a-f0-9]{64}", str(item.get("sha256"))) for item in sources
        ):
            raise ValueError("Complete checked source checksums are required before issuance")
        checked = datetime.fromisoformat(provenance["checkedAt"].replace("Z", "+00:00"))
        if checked > now or provenance["latestPublicationDate"] > now.date().isoformat():
            raise ValueError("Source evidence from the future cannot be used for issuance")
        if not all(
            item["status"] == "exploratory" and item["estimate"] is not None
            for item in bundle["monthly"]
        ):
            raise ValueError("Every selected series must have a supported forecast before issuance")
        source_fingerprint = provenance["receipt"]["sha256"]
        issue_date = now.astimezone(MALDIVES_TIME).date().isoformat()
        identity = content_hash(
            {
                "source": source_fingerprint,
                "model": MODEL_VERSION,
                "series": sorted(item["seriesId"] for item in bundle["monthly"]),
            }
        )[:24]
        issue_id = f"{issue_date}_{target_month}_{identity}"
        content = {
            "version": 2,
            "id": issue_id,
            "issuedAt": now.isoformat(),
            "issueDateMvt": issue_date,
            "target": bundle["target"],
            "sourceFingerprint": source_fingerprint,
            "sourceAsOf": bundle["sourceAsOf"],
            "provenance": provenance,
            "forecasts": bundle["monthly"],
            "integrityAlgorithm": "python-canonical-v1",
        }
        issue = {**content, "integritySha256": content_hash(content)}
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        path = self.runtime_dir / f"{issue_id}.json"
        with self._lock:
            try:
                with path.open("x", encoding="utf-8") as handle:
                    json.dump(issue, handle, ensure_ascii=False, indent=2, allow_nan=False)
                    handle.write("\n")
                created = True
            except FileExistsError:
                issue = self._verify_issue(read_json(path))
                created = False
        return {"created": created, **self._score(issue, self.source())}
