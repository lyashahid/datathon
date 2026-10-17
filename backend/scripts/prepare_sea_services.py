"""Prepare directional ferry timetables from the official RTL public schedule PDFs.

Run from the repository root with the backend Python environment. --download
captures the operator's current five zone PDFs, without a login or booking.
Original responses/PDFs stay in ignored data/raw; checksummed source receipts and
the normalized data/public/sea-services.json are the shipped application model.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/sea-source-research"
OUTPUT = ROOT / "data/public/sea-services.json"
RECEIPTS = ROOT / "data/public/sea-service-source-receipts.json"
TERMINALS = ROOT / "data/public/policy-evidence/ferry-terminals.json"
CAPITAL_CALENDARS = ROOT / "data/public/policy-evidence/service-calendars.json"
CAPITAL_VESSELS = ROOT / "data/public/archive/operations/rtl-vessels.json"
CAPITAL_VESSEL_RECEIPTS = ROOT / "data/public/operations/source-manifest.json"
BASE = "https://bo.rtl.mv:4455/maldives/api/booking"
ZONES = ("101", "102", "104", "105", "106")
WEEKDAYS = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}
ROW = re.compile(r"^\s*(.+?)\s+(\d{2}:\d{2}\s*[AP]M)\s+(.+?)\s+(\d{2}:\d{2}\s*[AP]M)\s*$")
ROUTE = re.compile(r"\( Route (.*?) \)")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalized_name(name: str) -> str:
    """Punctuation/space normalization only; never fuzzy-match duplicate island names."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def minutes(value: str) -> int:
    parsed = datetime.strptime(value.strip(), "%I:%M %p")
    return parsed.hour * 60 + parsed.minute


def decode_pdf(response: bytes) -> bytes:
    """The operator embeds the PDF in two base64 layers in a JSON content field."""
    content = json.loads(response)["content"]
    for _ in range(2):
        content = base64.b64decode(content, validate=True)
        if content.startswith(b"%PDF-"):
            return content
    raise ValueError("The operator response does not contain a supported PDF")


def read_sailings(pages: list[str], zone: str) -> list[dict[str, Any]]:
    """Read each sailing's rows and its *following* calendar, across page breaks.

    Arrival and departure come from the two explicit headed columns. Lines are
    never paired across different sailings. A missing calendar or a non-contiguous
    stop chain fails preparation rather than inventing timing or a transfer.
    """
    result: list[dict[str, Any]] = []
    route: str | None = None
    rows: list[dict[str, Any]] = []
    weekdays: list[int] | None = None
    source_pages: set[int] = set()
    for page_number, text in enumerate(pages, start=1):
        lines = text.splitlines()
        for line_number, line in enumerate(lines):
            match = ROUTE.search(line)
            if match:
                if rows:
                    raise ValueError(f"Unterminated sailing before route {match.group(1)}")
                route = match.group(1).strip()
            match = ROW.match(line)
            if match:
                origin, departure, destination, arrival = match.groups()
                # Two long island names wrap below an atoll prefix in the PDF.
                # Read their own column positions, not the opposite column.
                next_line = lines[line_number + 1] if line_number + 1 < len(lines) else ""
                if re.fullmatch(r"[A-Za-z]+\.", origin.strip()):
                    continuation = next_line[max(0, match.start(1) - 3) : match.start(2)].strip()
                    if not continuation or " " in continuation:
                        raise ValueError(f"Unresolved wrapped origin: {line}")
                    origin += continuation
                if re.fullmatch(r"[A-Za-z]+\.", destination.strip()):
                    continuation = next_line[match.start(3) - 3 : match.start(4)].strip()
                    if not continuation or " " in continuation:
                        raise ValueError(f"Unresolved wrapped destination: {line}")
                    destination += continuation
                dep, arr = minutes(departure), minutes(arrival)
                if arr <= dep:
                    raise ValueError(f"Non-positive or overnight sailing needs review: {line}")
                if rows and (
                    normalized_name(rows[-1]["destination"]) != normalized_name(origin)
                    or rows[-1]["arrival_minutes"] > dep
                ):
                    raise ValueError(f"Discontinuous sailing on route {route}: {line}")
                rows.append(
                    {
                        "origin": origin.strip(),
                        "destination": destination.strip(),
                        "departure_minutes": dep,
                        "arrival_minutes": arr,
                    }
                )
                source_pages.add(page_number)
            elif re.search(r"\d{2}:\d{2}\s*[AP]M", line):
                raise ValueError(f"Unparsed timing row on page {page_number}: {line}")
            if "OPERATING DAYS:" in line:
                labels = [part.strip() for part in line.split("OPERATING DAYS:")[1].split(",")]
                weekdays = sorted(WEEKDAYS[label] for label in labels)
            if "EFFECTIVE FROM:" in line:
                effective = (
                    datetime.strptime(line.split("EFFECTIVE FROM:")[1].strip(), "%d %B %Y")
                    .date()
                    .isoformat()
                )
                if not route or not rows or weekdays is None:
                    raise ValueError(
                        f"Incomplete sailing/calendar in zone {zone} page {page_number}"
                    )
                source_pages.add(page_number)
                result.append(
                    {
                        "zone": zone,
                        "route_code": route,
                        "days": weekdays,
                        "valid_from": effective,
                        "rows": rows,
                        "source_pages": sorted(source_pages),
                    }
                )
                rows, weekdays, source_pages = [], None, set()
    if rows:
        raise ValueError(f"Missing final calendar in zone {zone}")
    return result


def resolved_stop(name: str, terminals: dict[str, dict[str, Any]]) -> dict[str, Any]:
    terminal = terminals.get(normalized_name(name))
    if terminal is None:
        raise ValueError(f"No exact atoll-qualified terminal catalogue match for {name}")
    return {
        "name": name,
        "island_id": terminal["national_island_id"],
        "terminal_id": terminal["id"],
    }


def normalize(
    sailings: list[dict[str, Any]], terminal_rows: list[dict[str, Any]], observed_until: str
) -> list[dict[str, Any]]:
    terminals: dict[str, dict[str, Any]] = {}
    for terminal in terminal_rows:
        key = normalized_name(terminal["name"])
        if key in terminals:
            raise ValueError(f"Ambiguous terminal name: {terminal['name']}")
        terminals[key] = terminal
    groups: dict[str, dict[str, Any]] = {}
    for sailing in sailings:
        rows = sailing["rows"]
        stops = [resolved_stop(rows[0]["origin"], terminals)]
        stops.extend(resolved_stop(row["destination"], terminals) for row in rows)
        # Keep each directional sequence and effective-day group distinct.
        key_data = [
            sailing["zone"],
            sailing["route_code"],
            [stop["terminal_id"] for stop in stops],
            sailing["valid_from"],
            sailing["days"],
        ]
        key = sha256(json.dumps(key_data).encode())[:12]
        group = groups.setdefault(
            key,
            {
                "id": f"rtl:sea:{sailing['zone']}:{sailing['route_code']}:{key}",
                "route_code": sailing["route_code"],
                "name": f"{stops[0]['name']} → {stops[-1]['name']}",
                "operator": "RTL / MTCC",
                "zone": sailing["zone"],
                "source_ids": [f"rtl-zone-{sailing['zone']}-timetable"],
                "terminal_source_id": "rtl-terminal-catalog",
                "valid_from": sailing["valid_from"],
                "valid_until": None,
                "published_valid_until": None,
                "current_as_of": observed_until,
                "status": "current",
                "timing_status": "complete_timetable",
                "directional": True,
                "stops": stops,
                "sailings": [],
                "qualifications": [
                    "Published timetable snapshot; actual sailing operation is unconfirmed.",
                    "No published expiry; current-as-of records retrieval, not an end date.",
                    "Future journeys project published recurrence; recheck with the operator.",
                    "Holidays, cancellations, capacity and vessel assignment are unknown.",
                    "Lines between stops show connections, not navigable tracks.",
                ],
            },
        )
        calls = []
        for index, stop in enumerate(stops):
            calls.append(
                {
                    **stop,
                    "arrival_minutes": rows[index - 1]["arrival_minutes"] if index else None,
                    "departure_minutes": rows[index]["departure_minutes"]
                    if index < len(rows)
                    else None,
                }
            )
        trip_key = sha256(json.dumps(calls, sort_keys=True).encode())[:12]
        trip_identity = [
            (call["terminal_id"], call["arrival_minutes"], call["departure_minutes"])
            for call in calls
        ]
        if any(trip["id"].endswith(trip_key) for trip in group["sailings"]):
            raise ValueError(f"Duplicate timetable sailing in {group['id']}")
        group["sailings"].append(
            {
                "id": f"{group['id']}:sailing:{trip_key}",
                "equivalence_key": (
                    f"rtl:{sailing['route_code']}:{sha256(json.dumps(trip_identity).encode())[:20]}"
                ),
                "days": sailing["days"],
                "calls": calls,
                "source_pages": sailing["source_pages"],
            }
        )
    # An identical sailing may be printed again with a different effective-day
    # calendar. Retain both source calendars, but expose physical-trip identity
    # so consumers count one departure on overlapping dates, not two vessels.
    equivalent: dict[str, list[dict[str, Any]]] = {}
    for route in groups.values():
        for sailing in route["sailings"]:
            equivalent.setdefault(sailing["equivalence_key"], []).append(route)
    for routes in equivalent.values():
        if len(routes) < 2:
            continue
        for route in routes:
            route["equivalent_publications"] = sorted(
                other["id"] for other in routes if other["id"] != route["id"]
            )
            route["qualifications"].append(
                "Identical sailing is printed with overlapping calendars; "
                "count equivalent departures once on a service date."
            )
    return sorted(groups.values(), key=lambda row: row["id"])


def acquire() -> list[dict[str, Any]]:
    import httpx

    RAW.mkdir(parents=True, exist_ok=True)
    sources = []
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        for zone in ZONES:
            url = f"{BASE}/v2/ferryTrip/allSchedules/{zone}"
            response = client.get(url)
            response.raise_for_status()
            pdf = decode_pdf(response.content)
            response_path = RAW / f"rtl-zone{zone}-schedules.json"
            pdf_path = RAW / f"rtl-zone{zone}-schedules.pdf"
            response_path.write_bytes(response.content)
            pdf_path.write_bytes(pdf)
            sources.append(
                {
                    "id": f"rtl-zone-{zone}-timetable",
                    "title": f"RTL Zone {int(zone) - 100} published ferry schedules",
                    "url": url,
                    "publisher": "RTL / MTCC",
                    "retrieved_at": datetime.now(timezone.utc).isoformat(),
                    "sha256": sha256(response.content),
                    "pdf_sha256": sha256(pdf),
                    "bytes": len(pdf),
                    "raw_path": response_path.relative_to(ROOT).as_posix(),
                    "pdf_path": pdf_path.relative_to(ROOT).as_posix(),
                    "license_status": "Public operator data; explicit reuse licence not stated.",
                }
            )
    RECEIPTS.write_text(json.dumps({"sources": sources}, indent=2) + "\n", encoding="utf8")
    return sources


def capital_terminal_catalogue() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Keep exact terminal identities from two explicitly identified RTL routes.

    The vessel endpoint uses its own numeric ID namespace. Published route codes,
    endpoint codes and names are checked together; nearby terminals, island
    centres and the unmatched Gulhifalhu endpoint are never substituted.
    """
    receipt = next(
        source
        for source in json.loads(CAPITAL_VESSEL_RECEIPTS.read_text(encoding="utf8"))["sources"]
        if source["id"] == "rtl-vessel-service-check"
    )
    content = CAPITAL_VESSELS.read_bytes()
    if sha256(content) != receipt["checksum"]:
        raise ValueError("Capital vessel catalogue differs from the official source receipt")
    source = {
        "id": receipt["id"],
        "title": receipt["title"],
        "url": receipt["url"],
        "publisher": receipt["publisher"],
        "retrieved_at": receipt["retrievedAt"],
        "sha256": receipt["checksum"],
        "bytes": len(content),
        "raw_path": CAPITAL_VESSELS.relative_to(ROOT).as_posix(),
        "reference_period": receipt["referencePeriod"],
        "license_status": receipt["licenseStatus"],
        "qualification": "Route-specific terminal identities only; no arrival times inferred.",
    }
    endpoints = {
        "MVML": (
            (1, "101", "Maafannu Ferry Terminal", "island:1443"),
            (3, "103", "Villingili Ferry Terminal", "island:1382"),
        ),
        "MTHL": (
            (1, "101", "Maafannu Ferry Terminal", "island:1443"),
            (2, "102", "Thilafushi Ferry Terminal", "island:1456"),
        ),
    }
    routes = json.loads(content)
    terminals: dict[str, dict[str, Any]] = {}
    for route_code, expected in endpoints.items():
        matched = [route for route in routes if route.get("routeNumber") == route_code]
        if len(matched) != 1 or len(matched[0].get("stopList", [])) != len(expected):
            raise ValueError(f"Capital route endpoint catalogue is ambiguous: {route_code}")
        route = matched[0]
        if (route.get("startStationCode"), route.get("endStationCode")) != (
            expected[0][1], expected[-1][1]
        ):
            raise ValueError(f"Capital route endpoint codes differ: {route_code}")
        for stop, (identity, code, name, island_id) in zip(
            route["stopList"], expected, strict=True
        ):
            if (stop.get("id"), stop.get("code"), stop.get("name")) != (identity, code, name):
                raise ValueError(f"Capital terminal identity differs: {route_code}/{code}")
            coordinates = [float(stop["longitude"]), float(stop["latitude"])]
            if not all(math.isfinite(value) for value in coordinates) or not (
                72 <= coordinates[0] <= 74 and -1 <= coordinates[1] <= 8
            ):
                raise ValueError(f"Capital terminal coordinates are invalid: {route_code}/{code}")
            terminal_id = f"rtl:vessel-terminal:{identity}"
            terminal = {
                "id": terminal_id,
                "source_terminal_id": identity,
                "source_code": code,
                "name": name,
                "coordinates": coordinates,
                "national_island_id": island_id,
                "source_id": source["id"],
                "evidence": "official_terminal_catalogue",
                "join_method": "explicit_official_route_endpoint",
                "route_codes": [route_code],
                "service_verified": False,
                "landing_permission_verified": False,
            }
            existing = terminals.get(terminal_id)
            if existing:
                if any(existing[key] != terminal[key] for key in terminal if key != "route_codes"):
                    raise ValueError(f"Conflicting official terminal identity: {terminal_id}")
                existing["route_codes"].append(route_code)
            else:
                terminals[terminal_id] = terminal
    return list(terminals.values()), source


def capital_calendar_routes() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Use existing official capital calendars without inventing crossing times.

    Opposite-direction departure columns are not departure/arrival pairs. The
    unresolved Gulhifalhu endpoint remains named evidence without a map location.
    """
    evidence = json.loads(CAPITAL_CALENDARS.read_text(encoding="utf8"))
    sources = [
        {
            "id": source["id"],
            "title": source["title"],
            "url": source["url"],
            "publisher": source["publisher"],
            "retrieved_at": source["retrievedAt"],
            "sha256": source["checksum"],
            "reference_period": source["referencePeriod"],
            "normalized_from": CAPITAL_CALENDARS.relative_to(ROOT).as_posix(),
            "license_status": source["licenseStatus"],
        }
        for source in evidence["sources"]
    ]
    sources_by_id = {source["id"]: source for source in sources}
    terminals, terminal_source = capital_terminal_catalogue()
    terminals_by_id = {terminal["id"]: terminal for terminal in terminals}
    route_ports = {
        "vilimale": ("rtl:vessel-terminal:1", "rtl:vessel-terminal:3"),
        "thilafushi": ("rtl:vessel-terminal:1", "rtl:vessel-terminal:2"),
    }
    sources.append(terminal_source)
    endpoints = {
        "vilimale": ("Vilimalé", "island:1382"),
        "thilafushi": ("Thilafushi", "island:1456"),
        "gulhifalhu": ("Gulhifalhu", None),
        "hulhumale": ("Hulhumalé", "island:1442"),
    }

    def clock(value: str) -> int:
        parsed = datetime.strptime(value, "%H:%M")
        return parsed.hour * 60 + parsed.minute

    routes = []
    for calendar in evidence["calendars"]:
        island_name, island_id = endpoints[calendar["route"]]
        source = sources_by_id[calendar["sourceId"]]
        historical = calendar["route"] == "hulhumale"
        for reverse in (False, True):
            stops = [
                {"name": "Malé", "island_id": "island:1443", "terminal_id": None},
                {"name": island_name, "island_id": island_id, "terminal_id": None},
            ]
            port_ids = route_ports.get(calendar["route"])
            if port_ids:
                for stop, terminal_id in zip(stops, port_ids, strict=True):
                    terminal = terminals_by_id[terminal_id]
                    if terminal["national_island_id"] != stop["island_id"]:
                        raise ValueError("Official capital route endpoint island differs")
                    stop["terminal_id"] = terminal_id
            if reverse:
                stops.reverse()
            route: dict[str, Any] = {
                "id": f"mtcc:sea:{calendar['route']}:{'return' if reverse else 'outward'}",
                "route_code": None,
                "calendar_id": calendar["id"],
                "name": f"{stops[0]['name']} → {stops[-1]['name']}",
                "operator": "MTCC",
                "source_ids": [source["id"], *([terminal_source["id"]] if port_ids else [])],
                "terminal_source_id": terminal_source["id"] if port_ids else None,
                "valid_from": calendar["effectiveFrom"],
                "valid_until": calendar["validUntil"],
                "published_valid_until": calendar["validUntil"],
                "current_as_of": None if historical else source["retrieved_at"][:10],
                "status": "historical" if historical else "current",
                "timing_status": "departure_only",
                "directional": True,
                "stops": stops,
                "sailings": [],
                "published_departures": [],
                "frequency_windows": [],
                "no_service_windows": [],
                "unknown_windows": [],
                "qualifications": [
                    *calendar["limitations"],
                    (
                        "Terminal coordinates and identities follow the official RTL route "
                        "catalogue; the calendar does not establish arrival times."
                        if port_ids
                        else "Landing terminal identity is unverified; "
                        "no terminal transfer is inferred."
                    ),
                    "Departure/frequency evidence does not establish arrival or journey duration.",
                    "Midnight clocks are retained; source service-day rollover is unverified.",
                ],
            }
            if island_id is None:
                route["qualifications"].append(
                    "Gulhifalhu has no identified polygon in the retained official catalogue; "
                    "the named endpoint is not assigned an invented island ID or map point."
                )
            for day_type in calendar["dayTypes"]:
                day_fields = {
                    "days": sorted(day - 1 for day in day_type["isoWeekdays"]),
                    "label": day_type["label"],
                    "includes_public_holidays": day_type["includesPublicHolidays"],
                }
                departures = day_type.get(
                    "departuresFromIsland" if reverse else "departuresFromMale"
                )
                if departures is not None:
                    route["published_departures"].append(
                        {
                            **day_fields,
                            "departure_minutes": [clock(value) for value in departures],
                            "no_scheduled_service": day_type.get("noScheduledService", False),
                        }
                    )
                for source_key, target_key in (
                    ("frequencyWindows", "frequency_windows"),
                    ("noServiceWindows", "no_service_windows"),
                    ("unknownWindows", "unknown_windows"),
                ):
                    for window in day_type.get(source_key, []):
                        start, end = clock(window["start"]), clock(window["end"])
                        # 08:00–00:00 ends at midnight, not before its start.
                        if end <= start:
                            end += 1440
                        normalized = {**day_fields, "start_minutes": start, "end_minutes": end}
                        if "headwayMinutes" in window:
                            normalized["headway_minutes"] = window["headwayMinutes"]
                        if "reason" in window:
                            normalized["reason"] = window["reason"]
                        route[target_key].append(normalized)
            routes.append(route)
    return routes, sources


def prepare(download: bool = False) -> dict[str, Any]:
    from pypdf import PdfReader

    sources = acquire() if download else json.loads(RECEIPTS.read_text(encoding="utf8"))["sources"]
    sailings = []
    for source, zone in zip(sources, ZONES, strict=True):
        pdf = ROOT / source["pdf_path"]
        if sha256(pdf.read_bytes()) != source["pdf_sha256"]:
            raise ValueError(f"PDF checksum differs from the source receipt: {pdf}")
        reader = PdfReader(pdf)
        source["page_count"] = len(reader.pages)
        pages = [page.extract_text(extraction_mode="layout") for page in reader.pages]
        sailings.extend(read_sailings(pages, zone))
    observed_until = min(source["retrieved_at"][:10] for source in sources)
    terminals_data = json.loads(TERMINALS.read_text(encoding="utf8"))
    routes = normalize(sailings, terminals_data["terminals"], observed_until)
    # Metadata of this official document is indexed, but the direct publisher PDF
    # returned HTTP 403 during acquisition. Do not transcribe an older different
    # schedule or fill a landing location from the island centroid.
    historical_source = {
        "id": "mtcc-s610-route-2024",
        "title": "S610 S. Hulhumeedhoo – S. Hithadhoo speed ferry schedule",
        "url": "https://mtcc.mv/wp-content/uploads/2022/03/S610-Speed-Schedule-HMD-HTD-HMD.pdf",
        "publisher": "MTCC",
        "retrieved_at": "2026-10-17",
        "reference_period": "Effective 17 April 2024; current validity unconfirmed",
        "retrieval_method": "Official title/effective date indexed by search; PDF fetch HTTP 403",
        "sha256": None,
        "license_status": "Public operator publication; explicit reuse licence not stated.",
    }
    historical_topology_source = {
        "id": "mtcc-s610-directions-2022",
        "title": "S610 Hulhumeedhoo – Hithadhoo speed ferry schedule, both directions",
        "url": "https://mtcc.mv/wp-content/uploads/2022/03/Zone-6-Speed-Ferry-Schedules.pdf",
        "publisher": "MTCC",
        "retrieved_at": "2026-10-17",
        "reference_period": "Effective 1 November 2022; historical evidence only",
        "retrieval_method": "Official indexed document text has explicit outward and return rows",
        "sha256": None,
        "license_status": "Public operator publication; explicit reuse licence not stated.",
    }
    for origin, destination, suffix in [
        (
            {"name": "S.Hithadhoo", "island_id": "island:1152", "terminal_id": None},
            {"name": "S.Hulhumeedhoo", "island_id": "island:1559", "terminal_id": None},
            "outward",
        ),
        (
            {"name": "S.Hulhumeedhoo", "island_id": "island:1559", "terminal_id": None},
            {"name": "S.Hithadhoo", "island_id": "island:1152", "terminal_id": None},
            "return",
        ),
    ]:
        routes.append(
            {
                "id": f"mtcc:sea:S610:historical:{suffix}",
                "route_code": "S610",
                "name": f"{origin['name']} → {destination['name']}",
                "operator": "MTCC",
                "source_ids": [historical_source["id"], historical_topology_source["id"]],
                "valid_from": "2022-11-01",
                "valid_until": None,
                "published_valid_until": None,
                "current_as_of": None,
                "status": "historical",
                "timing_status": "route_only",
                "directional": True,
                "stops": [origin, destination],
                "sailings": [],
                "qualifications": [
                    "Historical route evidence; current operator confirmation is required.",
                    "Both directions are documented in 2022; a 2024 title confirms the corridor.",
                    "The RTL terminal catalogue does not identify S.Hithadhoo's landing place.",
                    "The 2024 rows are unverified; no times or sailing duration are inferred.",
                    "Excluded from current timed reachability and transfers.",
                ],
            }
        )
    capital_routes, capital_sources = capital_calendar_routes()
    routes.extend(capital_routes)
    summary = {
        "published_route_codes": len(
            {(row.get("zone"), row["route_code"]) for row in routes if row["route_code"]}
        ),
        "named_capital_services": len({route["calendar_id"] for route in capital_routes}),
        "directional_route_records": len(routes),
        "complete_timetable_records": sum(
            row["timing_status"] == "complete_timetable" for row in routes
        ),
        "departure_only_records": len(capital_routes),
        "sailings": len(sailings),
        "sailing_legs": sum(len(row["rows"]) for row in sailings),
        "islands_with_complete_timetables": len(
            {stop["island_id"] for route in routes if route["sailings"] for stop in route["stops"]}
        ),
        "islands_with_any_route_evidence": len(
            {
                stop["island_id"]
                for route in routes
                for stop in route["stops"]
                if stop["island_id"] is not None
            }
        ),
        "unmatched_named_endpoints": ["Gulhifalhu"],
        "by_zone": dict(Counter(row["zone"] for row in sailings)),
    }
    bundle = {
        "schema_version": 1,
        "weekday_convention": "monday_zero",
        "timezone": "Indian/Maldives",
        "generated_at": max(source["retrieved_at"] for source in sources),
        "observed_until": observed_until,
        "current_as_of": observed_until,
        "terminal_catalogue": {
            "path": TERMINALS.relative_to(ROOT).as_posix(),
            "sha256": sha256(TERMINALS.read_bytes()),
            "source_id": "rtl-terminal-catalog",
            "join_rule": "Exact atoll-qualified label after punctuation/space normalization",
        },
        "additional_terminals": capital_terminal_catalogue()[0],
        "sources": [*sources, historical_source, historical_topology_source, *capital_sources],
        "summary": summary,
        "routes": routes,
        "limitations": [
            "Coverage is five RTL zone schedules and four capital calendars, not every ferry.",
            "No operator expiry is published; current-as-of records the retrieval date.",
            "Future dates project recurrence; future operation and exceptions are unconfirmed.",
            "Sailing suitability, disruption, capacity and vessel assignment are unverified.",
            "No terminal is created, moved or assigned using an island centroid.",
        ],
    }
    OUTPUT.write_text(
        json.dumps(bundle, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n",
        encoding="utf8",
    )
    return bundle


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    print(json.dumps(prepare(args.download)["summary"], indent=2))
