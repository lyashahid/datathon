"""Guard the official timetable ingestion against plausible but false journeys."""

from __future__ import annotations

import base64
import importlib.util
import json
from collections import defaultdict
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "prepare_sea_services", ROOT / "backend/scripts/prepare_sea_services.py"
)
assert SPEC and SPEC.loader
prepare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare)


def test_explicit_paired_rows_preserve_layover_and_calendar_across_pages():
    pages = [
        """( Route Z6R2 )
   Gn.Fuvahmulah              07:00 AM    S.Hulhumeedhoo             08:00 AM
   S.Hulhumeedhoo             08:05 AM    S.Feydhoo                  08:25 AM
""",
        """OPERATING DAYS: SUN,MON,TUE,WED,THU,SAT
EFFECTIVE FROM: 01 October 2026
   S.Feydhoo                  10:00 AM    S.Hulhumeedhoo             10:20 AM
   S.Hulhumeedhoo             10:25 AM    Gn.Fuvahmulah              11:25 AM
OPERATING DAYS: SUN,MON,TUE,WED,THU,SAT
EFFECTIVE FROM: 01 October 2026
""",
    ]
    sailings = prepare.read_sailings(pages, "106")
    assert len(sailings) == 2
    assert sailings[0]["days"] == [0, 1, 2, 3, 5, 6]  # Friday is not added.
    assert sailings[0]["source_pages"] == [1, 2]
    assert sailings[0]["rows"][0]["arrival_minutes"] == 480
    assert sailings[0]["rows"][1]["departure_minutes"] == 485
    assert sailings[1]["rows"][0]["origin"] == "S.Feydhoo"


def test_wrapped_names_are_read_from_their_own_pdf_column():
    pages = [
        """( Route Z5R6 )
   Gdh.Vaadhoo                   06:20 AM      Gdh.                         06:40 AM
                                              Faresmaathoda
   Gdh.                          06:45 AM      Gdh.Fiyori                   07:00 AM
   Faresmaathoda
OPERATING DAYS: SAT
EFFECTIVE FROM: 01 May 2026
"""
    ]
    sailing = prepare.read_sailings(pages, "105")[0]
    assert sailing["rows"][0]["destination"] == "Gdh.Faresmaathoda"
    assert sailing["rows"][1]["origin"] == "Gdh.Faresmaathoda"
    assert sailing["days"] == [5]


@pytest.mark.parametrize(
    "body",
    [
        "A.One   09:00 AM   A.Two   08:00 AM",  # inverted time
        "A.One   07:00 AM   A.Two   08:00 AM\nA.Three   08:05 AM   A.Four   09:00 AM",
        "A.One   07:00 AM   A.Two   08:00 AM\nA.Two   07:55 AM   A.Four   09:00 AM",
        "A.One   07:00 AM",  # a single departure is not a paired arrival
    ],
)
def test_broken_rows_do_not_become_timed_routes(body):
    with pytest.raises(ValueError):
        prepare.read_sailings(
            [f"( Route X )\n{body}\nOPERATING DAYS: MON\nEFFECTIVE FROM: 01 May 2026"],
            "101",
        )


def test_missing_calendar_is_not_assumed_daily():
    with pytest.raises(ValueError, match="calendar"):
        prepare.read_sailings(["( Route X )\nA.One   07:00 AM   A.Two   08:00 AM"], "101")


def test_name_matching_keeps_atoll_prefix_and_rejects_unknown_terminal():
    terminals = {
        "lHithadhoo".lower(): {
            "national_island_id": "island:697",
            "id": "rtl:terminal:150",
        }
    }
    assert prepare.resolved_stop("L. Hithadhoo", terminals)["island_id"] == "island:697"
    with pytest.raises(ValueError, match="No exact"):
        prepare.resolved_stop("S.Hithadhoo", terminals)


def test_base64_wrapper_requires_actual_pdf():
    pdf = b"%PDF-1.4\nexample"
    content = base64.b64encode(base64.b64encode(pdf)).decode()
    assert prepare.decode_pdf(json.dumps({"content": content}).encode()) == pdf
    with pytest.raises(ValueError):
        prepare.decode_pdf(b'{"content":"bm90LXBkZg=="}')


def test_shipped_data_has_complete_calls_and_safe_hithadhoo_gap():
    bundle = json.loads((ROOT / "data/public/sea-services.json").read_text(encoding="utf8"))
    terminals = json.loads(
        (ROOT / "data/public/policy-evidence/ferry-terminals.json").read_text(encoding="utf8")
    )["terminals"]
    terminal_islands = {row["id"]: row["national_island_id"] for row in terminals}
    ids = set()
    for route in bundle["routes"]:
        assert route["id"] not in ids
        ids.add(route["id"])
        assert route["directional"] is True
        if route["status"] != "current":
            assert not route["sailings"]
            continue
        assert route["valid_from"] <= route["current_as_of"] <= bundle["current_as_of"]
        assert route["valid_until"] is None
        assert route["published_valid_until"] is None
        if route["timing_status"] != "complete_timetable":
            assert route["timing_status"] == "departure_only" and not route["sailings"]
            continue
        for sailing in route["sailings"]:
            assert sailing["days"] and 4 not in sailing["days"]
            calls = sailing["calls"]
            assert calls[0]["arrival_minutes"] is None
            assert calls[-1]["departure_minutes"] is None
            assert len(calls) >= 2
            for index, call in enumerate(calls):
                assert terminal_islands[call["terminal_id"]] == call["island_id"]
                if index:
                    assert calls[index - 1]["departure_minutes"] < call["arrival_minutes"]
                if 0 < index < len(calls) - 1:
                    assert call["arrival_minutes"] <= call["departure_minutes"]
    hithadhoo = [
        row
        for row in bundle["routes"]
        if any(stop["island_id"] == "island:1152" for stop in row["stops"])
    ]
    assert len(hithadhoo) == 2
    assert all(row["status"] == "historical" and not row["sailings"] for row in hithadhoo)
    assert all(stop["terminal_id"] is None for row in hithadhoo for stop in row["stops"])
    laamu_hithadhoo = [
        row
        for row in bundle["routes"]
        if any(stop["island_id"] == "island:697" for stop in row["stops"])
    ]
    assert len(laamu_hithadhoo) == 2
    assert all(row["route_code"] == "Z4R17" for row in laamu_hithadhoo)
    assert all(row["status"] == "current" and row["sailings"] for row in laamu_hithadhoo)
    assert all(
        stop["name"] == "L.Hithadhoo" and stop["terminal_id"] == "rtl:terminal:150"
        for row in laamu_hithadhoo
        for stop in row["stops"]
        if stop["island_id"] == "island:697"
    )


def test_republished_calendars_share_physical_sailing_identity():
    bundle = json.loads((ROOT / "data/public/sea-services.json").read_text(encoding="utf8"))
    equivalents = defaultdict(list)
    for route in bundle["routes"]:
        for sailing in route["sailings"]:
            equivalents[sailing["equivalence_key"]].append((route, sailing))
    duplicates = [rows for rows in equivalents.values() if len(rows) > 1]
    assert len(duplicates) == 2
    for rows in duplicates:
        assert all(route["route_code"] == "Z4R8A" for route, _ in rows)
        assert rows[0][1]["calls"] == rows[1][1]["calls"]
        assert rows[0][1]["days"] != rows[1][1]["days"]
        assert rows[0][0]["valid_from"] != rows[1][0]["valid_from"]
        assert rows[1][0]["id"] in rows[0][0]["equivalent_publications"]


def test_capital_departures_are_directional_evidence_without_invented_arrivals():
    routes, sources = prepare.capital_calendar_routes()
    assert len(routes) == 8 and len(sources) == 5
    by_id = {route["id"]: route for route in routes}
    outward = by_id["mtcc:sea:thilafushi:outward"]
    inbound = by_id["mtcc:sea:thilafushi:return"]
    assert [stop["island_id"] for stop in outward["stops"]] == ["island:1443", "island:1456"]
    assert inbound["stops"] == list(reversed(outward["stops"]))
    assert outward["published_departures"][0]["departure_minutes"][0] == 435
    assert inbound["published_departures"][0]["departure_minutes"][0] == 465
    assert not any(route["sailings"] for route in routes)
    assert [stop["terminal_id"] for stop in outward["stops"]] == [
        "rtl:vessel-terminal:1", "rtl:vessel-terminal:2"
    ]
    assert all(
        stop["terminal_id"] is None
        for route in routes
        if route["calendar_id"] in {"mtcc-calendar:gulhifalhu", "mtcc-calendar:hulhumale"}
        for stop in route["stops"]
    )
    assert by_id["mtcc:sea:gulhifalhu:outward"]["stops"][-1]["island_id"] is None
    assert by_id["mtcc:sea:hulhumale:outward"]["status"] == "historical"
    assert by_id["mtcc:sea:hulhumale:outward"]["valid_from"] is None
    assert by_id["mtcc:sea:gulhifalhu:outward"]["published_departures"][1]["no_scheduled_service"]


def test_capital_terminals_preserve_exact_official_route_endpoint_ids_and_coordinates():
    terminals, source = prepare.capital_terminal_catalogue()
    by_id = {terminal["id"]: terminal for terminal in terminals}
    assert set(by_id) == {f"rtl:vessel-terminal:{number}" for number in (1, 2, 3)}
    assert by_id["rtl:vessel-terminal:1"]["coordinates"] == [
        73.50165235035352, 4.171891971552377
    ]
    assert by_id["rtl:vessel-terminal:1"]["route_codes"] == ["MVML", "MTHL"]
    assert by_id["rtl:vessel-terminal:2"]["national_island_id"] == "island:1456"
    assert by_id["rtl:vessel-terminal:3"]["national_island_id"] == "island:1382"
    assert source["sha256"] == prepare.sha256(prepare.CAPITAL_VESSELS.read_bytes())
    assert source["url"].endswith("/vessel/routedetails")
    routes, _ = prepare.capital_calendar_routes()
    for route in routes:
        if route["calendar_id"] in {"mtcc-calendar:vilimale", "mtcc-calendar:thilafushi"}:
            assert source["id"] in route["source_ids"]
            assert route["terminal_source_id"] == source["id"]
        assert not route["sailings"]


def test_capital_terminal_catalogue_requires_unchanged_source_receipt(tmp_path, monkeypatch):
    changed = tmp_path / "changed-vessels.json"
    changed.write_text("[]", encoding="utf8")
    monkeypatch.setattr(prepare, "CAPITAL_VESSELS", changed)
    with pytest.raises(ValueError, match="official source receipt"):
        prepare.capital_terminal_catalogue()


def test_frequency_and_gap_windows_are_preserved_without_generating_departures():
    routes, _ = prepare.capital_calendar_routes()
    route = next(row for row in routes if row["id"] == "mtcc:sea:vilimale:outward")
    assert route["published_departures"] == []
    midnight = next(
        row
        for row in route["frequency_windows"]
        if row["label"] == "Sunday–Thursday" and row["start_minutes"] == 480
    )
    assert midnight["end_minutes"] == 1440 and midnight["headway_minutes"] == 10
    assert route["no_service_windows"][0]["days"] == [4]
    gap = route["unknown_windows"][0]
    assert gap["start_minutes"] == 1040 and gap["end_minutes"] == 1050
    assert gap["includes_public_holidays"] is True
