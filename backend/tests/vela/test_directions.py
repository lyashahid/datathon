"""Offline source-shaped fixtures; no captured Google responses or network calls."""

import asyncio
import itertools
import json
import re
from urllib.parse import parse_qs, urlsplit

import pytest

from vendor.vela_api.common import ApiError
from vendor.vela_api.directions import (
    _DEFAULT_TEMPLATE,
    DirectionsService,
    _direct_children,
    build_directions_pb,
    parse_directions,
)

A = {"latitude": 38.5, "longitude": -121.7}
B = {"latitude": 38.6, "longitude": -121.5}
STOP = {"latitude": 38.8, "longitude": -121.8}


def summary(distance=1000, typical=600, traffic=720, label="via Elm St"):
    value = [None] * 12
    value[1] = label
    value[2] = [distance, "1 km"]
    value[3] = [typical, "10 min"]
    value[7] = [
        None,
        None,
        None,
        [None, None, [None, None, 38.5, -121.7], [None, None, 38.6, -121.5]],
    ]
    value[10] = (
        [[traffic, "12 min"], None, None, None, [550, 800, "usually"]]
        if traffic is not None
        else None
    )
    return value


def root(routes=None, geometries=None):
    inner = [None] * 8
    inner[1] = [[summary()]] if routes is None else routes
    inner[7] = geometries
    return [inner]


def geometry():
    # First coordinate is absolute E7; subsequent coordinates are deltas.
    return [[385000000, 2500, -5000], [-1217000000, 5000, -2000]]


def outer_block(pb):
    match = re.search(r"!6m(\d+)!1m5!18b1", pb)
    assert match
    start = match.start() + len("!6m") + len(match[1])
    children = _direct_children(pb, start, int(match[1]))
    assert children is not None
    return match, children, pb[match.start() : children[-1][3]]


def test_routes_keep_index_aligned_e7_deltas_and_traffic():
    routes = [[summary()], [summary(1200, 650, None, "via Oak St")]]
    second_geometry = [[386000000, 1000], [-1216000000, -1000]]
    parsed = parse_directions(root(routes, [geometry(), second_geometry]))
    assert len(parsed) == 2
    assert parsed[0]["source"] == "google_consumer"
    assert parsed[0]["distance_meters"] == 1000
    assert parsed[0]["typical_seconds"] == 600
    assert parsed[0]["traffic_seconds"] == 720
    assert parsed[0]["typical_low_seconds"] == 550
    assert parsed[0]["typical_high_seconds"] == 800
    assert parsed[0]["geometry"] == {
        "type": "LineString",
        "coordinates": [
            [-121.7, 38.5],
            [-121.6995, 38.50025],
            [-121.6997, 38.49975],
        ],
    }
    assert parsed[1]["geometry"]["coordinates"] == [[-121.6, 38.6], [-121.6001, 38.6001]]
    assert parsed[1]["traffic_seconds"] is None
    assert parsed[0]["start"] == A
    assert parsed[0]["end"] == B
    assert parsed[0]["steps"] == []
    assert parsed[0]["guidance_available"] is False
    json.dumps(parsed, allow_nan=False)


@pytest.mark.parametrize(
    "bad_geometry",
    [
        None,
        [[], []],
        [[385000000], [-1217000000]],
        [[385000000, 0], [-1217000000]],
        [[385000000, "oops"], [-1217000000, 0]],
        [[385000000, 0.5], [-1217000000, 0]],
        [[385000000, True], [-1217000000, 0]],
        [[910000000, 0], [-1217000000, 0]],
    ],
)
def test_missing_or_invalid_geometry_is_not_replaced_by_a_straight_line(bad_geometry):
    parsed = parse_directions(root(geometries=[bad_geometry]))[0]
    assert parsed["geometry"] is None
    assert parsed["geometry_available"] is False
    assert parsed["start"] == A


def test_only_supplied_steps_are_extracted_without_invented_locations():
    markup = (
        "<step maneuver='DEPART' meters='20'>Head east</step>"
        '<step maneuver="TURN" meters="120">Use the right 2 lanes to '
        '<turn side="RIGHT" type="SLIGHT">turn slightly right</turn> onto '
        "<roadlist><road>Elm &amp; Oak St</road></roadlist></step>"
        "<step maneuver='ARRIVE'>Arrive at destination</step>"
    )
    route = [summary(), [None, [markup]], None, "ordinary text"]
    parsed = parse_directions(root([route], [geometry()]))[0]
    assert parsed["guidance_available"] is True
    assert len(parsed["steps"]) == 3
    assert parsed["steps"][1] == {
        "instruction": "Turn slightly right onto Elm & Oak St",
        "distance_meters": 120,
        "maneuver": "TURN",
        "turn_side": "RIGHT",
        "turn_type": "SLIGHT",
        "road_names": ["Elm & Oak St"],
        "lane_hint": "Use the right 2 lanes",
    }
    assert parsed["steps"][2]["distance_meters"] is None
    assert all("location" not in step for step in parsed["steps"])


def test_empty_and_unclosed_step_markup_does_not_claim_guidance():
    route = [summary(), ["<step maneuver='TURN'></step>", "<step maneuver='TURN'>unfinished"]]
    parsed = parse_directions(root([route]))[0]
    assert parsed["steps"] == []
    assert not parsed["guidance_available"]


def test_leg_times_must_tile_the_trip_and_congestion_spans_are_filtered():
    spans = [None] * 6
    spans[5] = [[[2, 700, 80], [1, 100, 50], [0, 0, 500], [1, 200, 0], ["x", 300, 20]]]
    route = [summary(), [[summary(400, 200, 300)], [summary(600, 400, 420)]], None, spans]
    parsed = parse_directions(root([route]))[0]
    assert parsed["leg_times"] == [
        {"distance_meters": 400, "typical_seconds": 200, "traffic_seconds": 300},
        {"distance_meters": 600, "typical_seconds": 400, "traffic_seconds": 420},
    ]
    assert parsed["traffic_spans"] == [
        {"level": 1, "start_meters": 100, "length_meters": 50},
        {"level": 2, "start_meters": 700, "length_meters": 80},
    ]
    route[1] = [[summary(400)], [summary(900)]]
    assert parse_directions(root([route]))[0]["leg_times"] == []
    route[1] = [[summary(1000)]]
    assert parse_directions(root([route]))[0]["leg_times"] == []


def test_calibrated_path_override_follows_moved_traffic_field():
    value = summary(traffic=None)
    value[11] = [999]
    response = root([[value]])
    assert parse_directions(response)[0]["traffic_seconds"] is None
    assert parse_directions(response, {"traffic": [11, 0]})[0]["traffic_seconds"] == 999


@pytest.mark.parametrize(
    "response", [None, {}, [], [[None]], root([[None]]), root([[summary(distance="broken")]])]
)
def test_missing_or_drifted_route_shape_raises_parser_drift(response):
    with pytest.raises(ApiError) as error:
        parse_directions(response)
    assert error.value.code == "parser_drift"
    assert error.value.status_code == 502


def test_valid_empty_route_array_is_no_routes():
    with pytest.raises(ApiError) as error:
        parse_directions(root([]))
    assert error.value.code == "no_routes"
    assert error.value.status_code == 404


def test_bad_alternate_does_not_shift_geometry_alignment():
    good = [summary()]
    parsed = parse_directions(root([[None], good], [None, geometry()]))
    assert len(parsed) == 1
    assert parsed[0]["geometry"]["coordinates"][0] == [-121.7, 38.5]


@pytest.mark.parametrize("mode,code", [("driving", 0), ("bicycling", 1), ("walking", 2)])
def test_pb_modes_use_the_captured_route_options_group(mode, code):
    pb = build_directions_pb(A, B, mode)
    assert f"!20m5!1e{code}!2e3!5e2!6b1!14b1" in pb
    assert "{" not in pb
    assert "!3m12!1m3!1d" in pb
    assert "!2d-121.6!3d38.55" in pb


def test_waypoints_are_repeated_top_level_groups_in_trip_order_and_fit_viewport():
    other = {"latitude": 38.7, "longitude": -121.6}
    pb = build_directions_pb(A, B, waypoints=[STOP, other])
    groups = [
        "!1m4!3m2!3d38.5!4d-121.7!6e2",
        "!1m4!3m2!3d38.8!4d-121.8!6e2",
        "!1m4!3m2!3d38.7!4d-121.6!6e2",
        "!1m4!3m2!3d38.6!4d-121.5!6e2",
    ]
    assert pb.startswith("".join(groups))
    assert "!2d-121.65!3d38.65" in pb
    assert outer_block(pb)[2].endswith("!96b1!99b1")


@pytest.mark.parametrize("tolls,highways,ferries", list(itertools.product([False, True], repeat=3)))
def test_avoid_flags_and_all_enclosing_counts(tolls, highways, ferries):
    avoid = (
        (["tolls"] if tolls else [])
        + (["highways"] if highways else [])
        + (["ferries"] if ferries else [])
    )
    pb = build_directions_pb(A, B, avoid=avoid)
    added = int(tolls) + int(highways)
    match, children, block = outer_block(pb)
    flags = ("!1b1" if highways else "") + ("!2b1" if tolls else "")
    assert int(match[1]) == 56 + added + int(ferries)
    assert f"!2m{4 + added}{flags}!5m1!6e2" in block
    assert [(c[0], c[1]) for c in children].count((7, "b")) == int(ferries)
    if ferries:
        assert "!291m0!7b1!10b1" in block
    assert block.endswith("!96b1!99b1")
    assert pb.split("!99b1", 1)[1] == _DEFAULT_TEMPLATE.split("!99b1", 1)[1]


@pytest.mark.parametrize("base_flag", ["0", "1"])
def test_existing_ferry_flag_is_rewritten_and_not_duplicated(base_flag):
    template = _DEFAULT_TEMPLATE.replace("!6m56!", "!6m57!").replace(
        "!291m0!10b1", f"!291m0!7b{base_flag}!10b1"
    )
    for avoid in ([], ["ferries"]):
        pb = build_directions_pb(A, B, avoid=avoid, template=template)
        assert "!6m57!1m5" in pb
        assert len(re.findall("!7b", outer_block(pb)[2])) == 1
        assert f"!291m0!7b{int(bool(avoid))}!10b1" in pb


def test_nested_seven_flag_is_not_mistaken_for_a_direct_ferry_flag():
    template = _DEFAULT_TEMPLATE.replace("!17m1!3e1", "!17m2!3e1!7b0").replace("!6m56!", "!6m57!")
    pb = build_directions_pb(A, B, avoid=["ferries"], template=template)
    assert "!17m2!3e1!7b0" in pb
    assert "!291m0!7b1!10b1" in pb
    assert outer_block(pb)[0][1] == "58"


@pytest.mark.parametrize(
    "kwargs,code",
    [
        ({"mode": "transit"}, "unsupported_mode"),
        ({"mode": "flying"}, "unsupported_mode"),
        ({"avoid": ["tunnels"]}, "invalid_argument"),
        ({"avoid": "tolls"}, "invalid_argument"),
        ({"avoid": [None]}, "invalid_argument"),
        ({"mode": "walking", "avoid": ["tolls"]}, "unsupported_option"),
        ({"waypoints": "bad"}, "invalid_argument"),
        ({"waypoints": [{"latitude": 91, "longitude": 0}]}, "invalid_argument"),
        ({"origin": {"latitude": float("nan"), "longitude": 0}}, "invalid_argument"),
    ],
)
def test_unsupported_and_invalid_arguments_are_explicit(kwargs, code):
    args = {"origin": A, "destination": B, **kwargs}
    with pytest.raises(ApiError) as error:
        build_directions_pb(**args)
    assert error.value.code == code
    assert error.value.status_code == 422


def test_template_drift_cannot_silently_drop_requested_stops_or_avoid():
    template = "!3d{OLAT}!4d{OLNG}!3d{DLAT}!4d{DLNG}!1e{MODE}"
    for kwargs in ({"waypoints": [STOP]}, {"avoid": ["tolls"]}):
        with pytest.raises(ApiError) as error:
            build_directions_pb(A, B, template=template, **kwargs)
        assert error.value.code == "calibration_invalid"
    broken_counts = _DEFAULT_TEMPLATE.replace("!6m56!", "!6m5!")
    with pytest.raises(ApiError) as error:
        build_directions_pb(A, B, avoid=["tolls"], template=broken_counts)
    assert error.value.code == "calibration_invalid"


@pytest.mark.parametrize("paths", [{"traffic": "bad"}, {"routes": [-1]}, {"traffic": [True]}, []])
def test_invalid_calibration_paths_are_explicit(paths):
    with pytest.raises(ApiError) as error:
        parse_directions(root(), paths)
    assert error.value.code == "calibration_invalid"


class Client:
    def __init__(self, body):
        self.body = body
        self.calls = []

    async def get_text(self, url, params=None, headers=None):
        self.calls.append((url, params, headers))
        return self.body


def test_service_sends_get_with_locale_and_parses_xssi_without_network():
    client = Client(")]}'\n" + json.dumps(root(geometries=[geometry()])))
    service = DirectionsService(
        client,
        {
            "directionsEndpoint": "https://www.google.com/maps/preview/directions?authuser=0&hl=en&gl=us&pb=stale",
            "directionsPb": _DEFAULT_TEMPLATE,
        },
    )
    result = asyncio.run(service.directions(A, B, language="fr", region="CA"))
    assert result["mode"] == "driving"
    assert result["completeness"] == "unknown"
    assert len(result["routes"]) == 1
    assert len(client.calls) == 1
    url, params, _ = client.calls[0]
    assert parse_qs(urlsplit(url).query) == {"authuser": ["0"], "hl": ["fr"], "gl": ["ca"]}
    assert set(params) == {"pb"}
    assert "stale" not in url
    assert "!20m5!1e0" in params["pb"]


def test_service_preserves_transport_and_envelope_error_codes():
    service = DirectionsService(Client("<html>unexpected upstream page</html>"), {})
    with pytest.raises(ApiError) as error:
        asyncio.run(service.directions(A, B))
    assert error.value.code == "upstream_parse_error"
    assert error.value.status_code == 502
    upstream_error = ApiError("upstream_blocked", "blocked", 503)

    class FailingClient:
        async def get_text(self, *args, **kwargs):
            raise upstream_error

    with pytest.raises(ApiError) as error:
        asyncio.run(DirectionsService(FailingClient(), {}).directions(A, B))
    assert error.value is upstream_error


@pytest.mark.parametrize(
    "kwargs,code",
    [
        ({"mode": "transit"}, "unsupported_mode"),
        ({"language": "en\n"}, "invalid_argument"),
        ({"region": "usa"}, "invalid_argument"),
    ],
)
def test_service_rejects_unsupported_requests_before_transport(kwargs, code):
    client = Client("[]")
    with pytest.raises(ApiError) as error:
        asyncio.run(DirectionsService(client, {}).directions(A, B, **kwargs))
    assert error.value.code == code
    assert client.calls == []


def test_service_refuses_non_google_calibration_endpoint():
    client = Client("[]")
    with pytest.raises(ApiError) as error:
        asyncio.run(
            DirectionsService(
                client, {"directionsEndpoint": "https://example.com/directions"}
            ).directions(A, B)
        )
    assert error.value.code == "calibration_invalid"
    assert client.calls == []
