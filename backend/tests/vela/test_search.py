"""Synthetic positional fixtures: no network, private data or raw live captures."""

import copy
import json
import math

import pytest

from vendor.vela_api.common import ApiError
from vendor.vela_api.config import load_calibration
from vendor.vela_api.search import SearchService


def set_path(tree, indexes, value):
    current = tree
    for index in indexes[:-1]:
        current.extend([None] * max(0, index + 1 - len(current)))
        if current[index] is None:
            current[index] = []
        current = current[index]
    final = indexes[-1]
    current.extend([None] * max(0, final + 1 - len(current)))
    current[final] = value
    return tree


def entry(
    name="Example Cafe", fid="0x123:0x456", pid="ChIJExample", latitude=37.7749, longitude=-122.4194
):
    result = [None, []]
    for path, value in [
        ([1, 11], name),
        ([1, 10], fid),
        ([1, 78], pid),
        ([1, 9, 2], latitude),
        ([1, 9, 3], longitude),
    ]:
        set_path(result, path, value)
    return result


def listed(*entries):
    return set_path([], [64], list(entries))


def focused(place):
    return set_path([], [0, 1, 0, 14], place[1])


class FakeClient:
    def __init__(self, *bodies):
        self.bodies = list(bodies)
        self.requests = []

    async def get_text(self, url, params=None, headers=None):
        self.requests.append({"url": url, "params": params, "headers": headers})
        if not self.bodies:
            raise AssertionError("Unexpected upstream request")
        return self.bodies.pop(0)


@pytest.fixture
def calibration():
    return load_calibration()


def service(calibration, *roots):
    client = FakeClient(
        *(root if isinstance(root, str) else ")]}'\n" + json.dumps(root) for root in roots)
    )
    return SearchService(client, calibration), client


@pytest.mark.asyncio
async def test_search_builds_full_calibrated_payload_and_normalizes_ids(calibration):
    place = entry()
    set_path(place, [1, 39], "Example Cafe, 1 Market Street")
    maps, client = service(calibration, listed(place))
    result = await maps.search(" coffee! ", 37.7749, -122.4194, language="fr", region="FR")
    request = client.requests[0]
    assert request["url"] == "https://www.google.com/search"
    assert request["params"]["tbm"] == "map"
    assert request["params"]["authuser"] == "0"
    assert request["params"]["hl"] == "fr"
    assert request["params"]["gl"] == "fr"
    assert request["params"]["q"] == "coffee!"
    assert request["params"]["pb"].startswith("!1scoffee!4m8")
    assert "!2d-122.4194!3d37.7749" in request["params"]["pb"]
    assert "{QUERY}" not in request["params"]["pb"]
    assert result["places"][0]["id"] == "0x123:0x456"
    assert result["places"][0]["place_id"] == "ChIJExample"
    assert result["places"][0]["address"] == "1 Market Street"
    assert result["places"][0]["location"] == {"latitude": 37.7749, "longitude": -122.4194}
    assert result["completeness"] == "unknown"
    assert result["focused_single"] is False
    assert result["focus"] is None
    assert result["next_offset"] is None


@pytest.mark.asyncio
async def test_full_page_has_only_a_continuation_hint(calibration):
    entries = [entry(name=f"Cafe {i}", fid=f"0x123:0x{i:x}") for i in range(20)]
    maps, client = service(calibration, listed(*entries))
    result = await maps.search("coffee", 37.7749, -122.4194, offset=40)
    assert len(result["places"]) == 20
    assert result["next_offset"] == 60
    assert "!7i20!8i40" in client.requests[0]["params"]["pb"]
    assert result["completeness"] == "unknown"


@pytest.mark.asyncio
async def test_span_is_floored_and_unknown_status_language_falls_back(calibration):
    maps, client = service(calibration, [])
    result = await maps.search("coffee", 37.0, -122.0, span_meters=3, language="ko")
    import re

    span = float(re.search(r"!1d([0-9.]+)", client.requests[0]["params"]["pb"]).group(1))
    assert 998 <= span <= 1002
    assert client.requests[0]["params"]["hl"] == "en"
    assert result["places"] == []


@pytest.mark.asyncio
async def test_focused_search_keeps_original_focus_even_if_branch_ranks_first(calibration):
    primary = entry(name="Example Cafe", latitude=37.7759)
    branch = entry(name="Example Cafe North", fid="0x123:0x789", latitude=37.7749)
    root = focused(primary)
    set_path(root, [0, 1, 0, 14, 99, 0, 0, 1], [branch])
    maps, _ = service(calibration, root)
    result = await maps.search("Example Cafe", 37.7749, -122.4194)
    assert result["focused_single"] is True
    assert result["focus"]["id"] == primary[1][10]
    assert len(result["places"]) == 2
    assert result["places"][0]["id"] == branch[1][10]
    assert result["stripped_focus"] is False
    assert result["next_offset"] is None


@pytest.mark.asyncio
async def test_address_snaps_to_business_at_that_address(calibration):
    address_node = entry(name="1 Market Street", fid=None, pid=None)
    cafe = entry()
    root = focused(address_node)
    set_path(root, [0, 1, 0, 14, 68], [[cafe[1]]])
    maps, _ = service(calibration, root)
    result = await maps.search("1 Market Street", 37.7749, -122.4194)
    assert result["focus"]["name"] == "Example Cafe"
    assert result["focus"]["id"] == cafe[1][10]


@pytest.mark.asyncio
async def test_place_id_fallback_and_missing_optional_fields(calibration):
    maps, _ = service(calibration, listed(entry(fid=None)))
    place = (await maps.search("coffee", 37.7749, -122.4194))["places"][0]
    assert place["id"] == "ChIJExample"
    assert place["feature_id"] is None
    assert place["rating"] is None
    assert place["open_now"] is None
    assert place["hours"] == []
    assert place["popular_times"] is None


@pytest.mark.asyncio
async def test_main_status_pairs_with_main_hours_and_ignores_numeric_style_codes(calibration):
    place = entry()
    set_path(place, [1, 203, 1, 4, 0], "Opens at 9 AM")
    set_path(place, [1, 203, 1, 4, 1, 0, 1], 6)  # a style marker, NOT open=true
    set_path(place, [1, 118, 0, 0], "Example Cafe Pharmacy")
    set_path(place, [1, 118, 0, 3, 1, 4, 0], "Open 24 hours")
    set_path(
        place,
        [1, 203, 0],
        [["Monday", None, None, [["9 AM–12 PM"], ["1–5 PM"]], None, None, [None, "Holiday"]]],
    )
    set_path(place, [1, 118, 0, 3, 0], [["Monday", None, None, [["24 hours"]]]])
    maps, _ = service(calibration, listed(place))
    found = (await maps.search("cafe", 37.7749, -122.4194))["places"][0]
    assert found["status_text"] == "Opens at 9 AM"
    assert found["open_now"] is False
    assert found["hours"] == ["Monday: 9 AM–12 PM, 1–5 PM · Holiday"]
    assert found["departments"][0]["name"] == "Pharmacy"
    assert found["departments"][0]["open_now"] is True


@pytest.mark.asyncio
async def test_rich_fields_photos_popular_times_and_safety_gates(calibration):
    place = entry()
    set_path(place, [1, 4, 2], "$20–30")
    set_path(place, [1, 4, 7], 4.6)
    set_path(place, [1, 4, 8], 219)
    set_path(place, [1, 23], 1)
    set_path(place, [1, 88, 0], "Diesel fuel")
    set_path(place, [1, 88, 1], "SearchResult.TYPE_GAS_STATION")
    set_path(place, [1, 88, 2, 1], "gb")
    set_path(place, [1, 75, 0, 0, 5, 0], "Book")
    set_path(place, [1, 75, 0, 0, 5, 1, 2, 0], "javascript:bad()")
    photo = set_path([], [6, 0], "https://lh5.googleusercontent.com/p/fixture=w600-h400-extra")
    set_path(place, [1, 72, 0], [photo, copy.deepcopy(photo)])
    set_path(
        place,
        [1, 100, 1],
        [[None, "Accessibility", [["wheelchair_accessible_entrance", "Accessible entrance"]]]],
    )
    set_path(place, [1, 84], [[[1, [[9, 25], [10, 40]]]]])
    set_path(place, [1, 32, 1, 1], "A local cafe")
    set_path(place, [1, 154, 0, 0], "From the owner")
    maps, _ = service(calibration, listed(place))
    found = (await maps.search("cafe", 37.7749, -122.4194))["places"][0]
    assert found["rating"] == 4.6
    assert found["review_count"] == 219
    assert found["price_level"] == 3
    assert found["fuel_price"] is None
    assert found["country_code"] == "GB"
    assert found["action_url"] is None
    assert found["permanently_closed"] is True
    assert found["photo_urls"] == ["https://lh5.googleusercontent.com/p/fixture=w500-h350"]
    assert found["wheelchair_accessible"] is True
    assert found["popular_times"] == {
        "days": [
            {
                "day_of_week": 1,
                "hours": [{"hour": 9, "occupancy": 25}, {"hour": 10, "occupancy": 40}],
            }
        ]
    }
    assert found["editorial_summary"] == "A local cafe"


@pytest.mark.asyncio
async def test_details_matches_requested_id_and_does_not_borrow_neighbor_data(calibration):
    neighbor = entry(name="Neighbor", fid="0xaaa:0xbbb")
    target = entry()
    set_path(neighbor, [1, 4, 7], 5.0)
    set_path(target, [1, 4, 7], 3.9)
    maps, client = service(calibration, listed(neighbor, target))
    result = await maps.details(
        "0x123:0x456", "Example Cafe", 37.7749, -122.4194, address="1 Market Street, San Francisco"
    )
    assert result["id"] == "0x123:0x456"
    assert result["rating"] == 3.9
    assert result["distance_meters"] is None
    assert result["completeness"] == "unknown"
    assert client.requests[0]["params"]["q"] == "Example Cafe 1 Market Street  San Francisco"


@pytest.mark.asyncio
async def test_details_accepts_real_google_place_id(calibration):
    maps, _ = service(calibration, focused(entry()))
    result = await maps.details("ChIJExample", "Example Cafe", 37.7749, -122.4194)
    assert result["place_id"] == "ChIJExample"
    assert result["id"] == "0x123:0x456"


@pytest.mark.asyncio
async def test_details_refuses_mismatch_instead_of_first_result(calibration):
    maps, _ = service(calibration, focused(entry(fid="0xaaa:0xbbb", pid="ChIJNeighbor")))
    with pytest.raises(ApiError) as caught:
        await maps.details("0x123:0x456", "Example Cafe", 37.7749, -122.4194)
    assert caught.value.code == "place_identity_not_found"
    assert caught.value.status_code == 404
    assert caught.value.details == {"requested_id": "0x123:0x456"}


@pytest.mark.asyncio
async def test_partial_calibration_override_reaches_focused_gate(calibration):
    calibration["paths"]["name"] = [1, 12]
    place = entry()
    set_path(place, [1, 11], None)
    set_path(place, [1, 12], "Recalibrated Cafe")
    maps, _ = service(calibration, focused(place))
    result = await maps.search("cafe", 37.7749, -122.4194)
    assert result["focus"]["name"] == "Recalibrated Cafe"


@pytest.mark.asyncio
@pytest.mark.parametrize("root", [{"error": "blocked"}, "<html>Consent</html>"])
async def test_non_array_or_non_json_is_a_parse_failure(calibration, root):
    maps, _ = service(calibration, json.dumps(root) if isinstance(root, dict) else root)
    with pytest.raises(ApiError):
        await maps.search("coffee", 37.7749, -122.4194)


@pytest.mark.asyncio
async def test_invalid_coordinates_are_dropped_without_fake_locations(calibration):
    maps, _ = service(calibration, listed(entry(latitude=181), entry(latitude=None), entry()))
    found = await maps.search("coffee", 37.7749, -122.4194)
    assert len(found["places"]) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"latitude": math.nan},
        {"longitude": 181},
        {"query": " "},
        {"offset": -1},
        {"span_meters": 0},
    ],
)
async def test_invalid_arguments_do_not_make_requests(calibration, overrides):
    maps, client = service(calibration)
    kwargs = {"query": "coffee", "latitude": 37.7749, "longitude": -122.4194, **overrides}
    with pytest.raises(ApiError) as caught:
        await maps.search(**kwargs)
    assert caught.value.status_code == 422
    assert client.requests == []


@pytest.mark.asyncio
async def test_suggest_reads_only_first_d_envelope_and_separates_query_rows(calibration):
    block = []
    set_path(block, [0, 0], "Example Cafe")
    set_path(block, [1, 0], "Example Cafe")
    set_path(block, [2, 0], "1 Market Street")
    set_path(block, [11, 2], 37.7749)
    set_path(block, [11, 3], -122.4194)
    set_path(block, [13, 0, 0], "0x123:0x456")
    query_block = [["coffee near me"], ["coffee near me"], ["See locations"]]
    inner = [["cof", [[None] * 22 + [block], [None] * 22 + [query_block]]]]
    body = (
        json.dumps({"c": 0, "d": ")]}'\n" + json.dumps(inner), "echo": "{quoted}"})
        + '/*""*/'
        + json.dumps({"c": 0, "d": "", "e": "ignored"})
    )
    maps, client = service(calibration, body, body)
    result = await maps.suggest("cof", 37.7749, -122.4194)
    assert result["queries"] == ["coffee near me"]
    assert result["places"][0]["id"] == "0x123:0x456"
    assert result["places"][0]["address"] == "1 Market Street"
    assert client.requests[0]["params"]["suggest"] == "p"
    assert client.requests[0]["params"]["ech"] == 1
    await maps.suggest("cof", 37.7749, -122.4194)
    assert client.requests[1]["params"]["ech"] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("body", ["[]", json.dumps({"c": 0, "d": ""})])
async def test_suggest_rejects_missing_envelope_instead_of_ordinary_list(calibration, body):
    maps, _ = service(calibration, body)
    with pytest.raises(ApiError) as caught:
        await maps.suggest("cof", 37.7749, -122.4194)
    assert caught.value.code == "upstream_shape_changed"
