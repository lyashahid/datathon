"""Bounded official-source checks; reviewed timetable snapshots never replace baselines."""

from __future__ import annotations

import asyncio
import hashlib
import heapq
import json
import re
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from bs4 import BeautifulSoup

from app.data_updates.models import NationalJourney, ScheduleAccept, ScheduleSnapshot

MVT = ZoneInfo("Indian/Maldives")
_LOCK = threading.RLock()
MONTHS = {
    name.casefold(): index
    for index, name in enumerate(
        (
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ),
        start=1,
    )
}


def _write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def _read(path: Path, fallback: Any) -> Any:
    return json.loads(path.read_text("utf-8")) if path.exists() else fallback


class DataUpdateService:
    def __init__(self, public_dir: Path, data_dir: Path, repository: Any) -> None:
        self.public_dir = public_dir
        self.runtime = data_dir / "runtime" / "source-updates"
        self.repository = repository
        self.calendars = _read(public_dir / "policy-evidence/service-calendars.json", {})
        self.sources = [
            {
                "id": "mbs-monthly-index",
                "title": "Official passenger release index",
                "url": "https://statisticsmaldives.gov.mv/monthly-statistics/",
                "kind": "release_index",
                "bundled_reference_month": "2026-06",
            }
        ]
        self.sources.extend(
            {
                "id": item["id"],
                "title": item["title"],
                "url": item["url"],
                "kind": "calendar",
                "bundled_sha256": item["checksum"],
                "reference_period": item["referencePeriod"],
            }
            for item in self.calendars.get("sources", [])
        )
        self.sources.extend(
            [
                {
                    "id": "rtl-bus-catalog",
                    "title": "RTL bus route snapshot",
                    "url": "https://bo.rtl.mv:4455/maldives/api/booking/v2/bus/routedetails",
                    "kind": "remaining_departures",
                },
                {
                    "id": "rtl-ferry-catalog",
                    "title": "RTL ferry route snapshot",
                    "url": "https://bo.rtl.mv:4455/maldives/api/booking/v1/vessel/routedetails",
                    "kind": "departure_catalog",
                },
            ]
        )
        self._checking = asyncio.Lock()

    def status(self) -> dict[str, Any]:
        return {
            "sources": self.sources,
            "latest_check": _read(self.runtime / "latest-check.json", None),
            "policy": (
                "Checks retain raw receipts; reviewed imports are separate from bundled baselines."
            ),
            "schedules": self.catalogue(),
        }

    async def check(self) -> dict[str, Any]:
        async with self._checking:
            previous = _read(self.runtime / "latest-check.json", None)
            if (
                previous
                and (
                    datetime.now(UTC) - datetime.fromisoformat(previous["checked_at"])
                ).total_seconds()
                < 600
            ):
                return {**previous, "cached": True}
            async with httpx.AsyncClient(
                timeout=12,
                follow_redirects=False,
                headers={"User-Agent": "MobilitySandboxMV source-check/1"},
            ) as client:
                items = await asyncio.gather(
                    *(self._check_one(client, spec) for spec in self.sources)
                )
            result = {
                "checked_at": datetime.now(UTC).isoformat(),
                "items": items,
                "cached": False,
                "applied_to_baseline": False,
                "qualification": (
                    "A retrieved departure list is not a recurring calendar or arrival observation."
                ),
            }
            with _LOCK:
                _write(self.runtime / "latest-check.json", result)
            return result

    async def _check_one(self, client: httpx.AsyncClient, spec: dict[str, Any]) -> dict[str, Any]:
        receipt = {**spec, "retrieved_at": datetime.now(UTC).isoformat()}
        try:
            async with client.stream("GET", spec["url"]) as response:
                receipt["http_status"] = response.status_code
                response.raise_for_status()
                content = bytearray()
                async for part in response.aiter_bytes():
                    content.extend(part)
                    if len(content) > 8_000_000:
                        raise ValueError("Publisher response exceeds the 8 MB source-check bound.")
            digest = hashlib.sha256(content).hexdigest()
            receipt.update(sha256=digest, bytes=len(content), status="retrieved_review_required")
            if spec["kind"] == "release_index":
                text = BeautifulSoup(bytes(content), "html.parser").get_text(" ", strip=True)
                matches = re.findall(
                    r"Maldives in Figures\s*[-–—]?\s*([A-Za-z]+)\s+(20\d{2})", text
                )
                dates = sorted(
                    {
                        f"{year}-{MONTHS[month.casefold()]:02}"
                        for month, year in matches
                        if month.casefold() in MONTHS
                    }
                )
                latest = dates[-1] if dates else None
                receipt.update(
                    latest_published_month=latest,
                    status="no_new_release"
                    if latest == spec["bundled_reference_month"]
                    else "new_release_review_required"
                    if latest
                    else "parser_review_required",
                )
            elif spec.get("bundled_sha256") == digest:
                receipt["status"] = "unchanged_document"
            with _LOCK:
                path = self.runtime / "receipts" / f"{digest}.bin"
                path.parent.mkdir(parents=True, exist_ok=True)
                if not path.exists():
                    path.write_bytes(content)
            return receipt
        except (httpx.HTTPError, ValueError) as error:
            return {
                **receipt,
                "status": "unavailable",
                "reason": type(error).__name__,
                "qualification": (
                    "Publisher could not be checked; bundled snapshot remains available."
                ),
            }

    def stage(self, body: ScheduleSnapshot) -> dict[str, Any]:
        unknown = {
            identity
            for item in body.services
            for identity in (item.from_island_id, item.to_island_id)
            if identity not in self.repository.islands_by_id
        }
        if unknown:
            raise ValueError("Unknown OneMap island IDs: " + ", ".join(sorted(unknown)))
        payload = body.model_dump(mode="json")
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        record = {
            "id": digest,
            "sha256": digest,
            "created_at": datetime.now(UTC).isoformat(),
            "snapshot": payload,
            "accepted": False,
            "qualification": (
                "Schema-checked user transcription; not independently publisher-verified."
            ),
        }
        with _LOCK:
            path = self.runtime / "schedules" / f"{digest}.json"
            if path.exists():
                record = _read(path, {})
            else:
                _write(path, record)
        return {**record, "review": self._review(record)}

    def _review(self, record: dict[str, Any]) -> dict[str, Any]:
        items = record["snapshot"]["services"]
        active = self._active()
        existing = {item["id"]: item for item in active}
        return {
            "services": len(items),
            "islands": len(
                {
                    island
                    for item in items
                    for island in (item["from_island_id"], item["to_island_id"])
                }
            ),
            "assumed_runtimes": sum(item["timing_basis"] == "assumed_runtime" for item in items),
            "replaces_service_ids": [item["id"] for item in items if item["id"] in existing],
            "missing_data": [
                (
                    "Terminal walking times, real cancellations, occupancy and resident "
                    "origins are not inferred."
                )
            ],
        }

    def accept(self, snapshot_id: str, body: ScheduleAccept) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{64}", snapshot_id):
            raise KeyError("Unknown schedule snapshot.")
        with _LOCK:
            path = self.runtime / "schedules" / f"{snapshot_id}.json"
            record = _read(path, None)
            if record is None:
                raise KeyError("Unknown schedule snapshot.")
            if record["accepted"]:
                return record
            record.update(
                accepted=True,
                accepted_at=datetime.now(UTC).isoformat(),
                review_note=body.review_note,
            )
            _write(path, record)
        return record

    def _records(self) -> list[dict[str, Any]]:
        records = []
        for path in sorted((self.runtime / "schedules").glob("*.json")):
            record = _read(path, {})
            payload = ScheduleSnapshot.model_validate(record.get("snapshot")).model_dump(
                mode="json"
            )
            digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
            if record.get("sha256") != digest or path.stem != digest:
                raise ValueError("A stored timetable receipt failed its integrity check.")
            records.append(record)
        return records

    def _active(self) -> list[dict[str, Any]]:
        services: dict[str, dict[str, Any]] = {}
        records = sorted(
            (record for record in self._records() if record.get("accepted")),
            key=lambda record: record["accepted_at"],
        )
        for record in records:
            for item in record["snapshot"]["services"]:
                services[item["id"]] = {
                    **item,
                    "snapshot_id": record["id"],
                    "source": record["snapshot"]["sources"][item["source_index"]],
                }
        return list(services.values())

    def catalogue(self) -> dict[str, Any]:
        records = self._records()
        services = self._active()
        for item in services:
            item["from_name"] = self.repository.islands_by_id[item["from_island_id"]][
                "properties"
            ].get("name")
            item["to_name"] = self.repository.islands_by_id[item["to_island_id"]]["properties"].get(
                "name"
            )
        return {
            "services": services,
            "total": len(services),
            "snapshots": [
                {
                    key: record.get(key)
                    for key in ("id", "created_at", "accepted", "accepted_at", "review_note")
                }
                | {"title": record["snapshot"]["title"], "review": self._review(record)}
                for record in records
            ],
            "published_calendars": self.calendars.get("calendars", []),
            "sources": self.calendars.get("sources", []),
            "qualification": (
                "Official departure-only calendars remain visible but cannot yield a "
                "journey arrival without a runtime."
            ),
        }

    def journey(self, query: NationalJourney) -> dict[str, Any]:
        if any(
            identity not in self.repository.islands_by_id
            for identity in (query.from_island_id, query.to_island_id)
        ):
            raise ValueError("Choose known OneMap islands.")
        if query.from_island_id == query.to_island_id:
            raise ValueError("Choose different islands for the national timetable planner.")
        start = query.departure_at.astimezone(MVT)
        deadline = start + timedelta(hours=query.max_hours)
        links: dict[str, list[dict[str, Any]]] = {}
        for service in self._active():
            if service["timing_basis"] == "assumed_runtime" and not query.include_assumed_runtimes:
                continue
            links.setdefault(service["from_island_id"], []).append(service)
        queue: list[tuple[datetime, int, str, list[dict[str, Any]]]] = [
            (start, 0, query.from_island_id, [])
        ]
        best: dict[tuple[str, int], datetime] = {(query.from_island_id, 0): start}
        serial = 0
        while queue:
            current, _, island, legs = heapq.heappop(queue)
            if island == query.to_island_id:
                return {
                    "status": "found",
                    "departure_at": start.isoformat(),
                    "arrival_at": current.isoformat(),
                    "elapsed_minutes": (current - start).total_seconds() / 60,
                    "legs": legs,
                    "transfer_assumption_minutes": query.transfer_minutes,
                    "includes_assumptions": any(
                        leg["timing_basis"] == "assumed_runtime" for leg in legs
                    ),
                    "qualification": (
                        "Reviewed timetable itinerary; not live dispatch, door-to-door travel or "
                        "resident accessibility."
                    ),
                }
            if len(legs) >= query.max_transfers + 1:
                continue
            ready = current + timedelta(minutes=query.transfer_minutes if legs else 0)
            for service in links.get(island, []):
                for offset in range((deadline.date() - ready.date()).days + 1):
                    day = ready.date() + timedelta(days=offset)
                    if (
                        day.isoformat() < service["effective_from"]
                        or day.isoformat() > service["effective_until"]
                    ):
                        continue
                    if day.isoweekday() not in service["weekdays"]:
                        continue
                    dep = datetime.combine(
                        day, datetime.strptime(service["departure"], "%H:%M:%S").time(), MVT
                    )
                    if dep < ready or dep > deadline:
                        continue
                    if service["timing_basis"] == "published_arrival":
                        arrival = datetime.combine(
                            day + timedelta(days=service["arrival_day_offset"]),
                            datetime.strptime(service["arrival"], "%H:%M:%S").time(),
                            MVT,
                        )
                    else:
                        arrival = dep + timedelta(minutes=service["runtime_minutes"])
                    if arrival > deadline:
                        continue
                    key = (service["to_island_id"], len(legs) + 1)
                    if key in best and best[key] <= arrival:
                        break
                    best[key] = arrival
                    serial += 1
                    leg = {
                        **service,
                        "departure_at": dep.isoformat(),
                        "arrival_at": arrival.isoformat(),
                        "waiting_minutes": (dep - current).total_seconds() / 60,
                    }
                    heapq.heappush(queue, (arrival, serial, service["to_island_id"], legs + [leg]))
                    break
        return {
            "status": "no_verified_itinerary",
            "legs": [],
            "qualification": (
                "No accepted dated services connect these islands within the selected "
                "window. This does not prove no service operates."
            ),
            "include_assumed_runtimes": query.include_assumed_runtimes,
        }
