"""Portable Google consumer directions adapter derived from Vela's Kotlin core.

This module ports DirectionsPb and the positional portions of DirectionsParser.
It does not implement Vela's Android WebView, open routers, offline routing, or
navigation engine. Supplied step text has no verified maneuver coordinates.
"""

from __future__ import annotations

import math
import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .common import ApiError, at, number, parse_json, string

_MODES = {"driving": 0, "bicycling": 1, "walking": 2}
_AVOID = {"tolls", "highways", "ferries"}
_DEST_GROUP = "!1m4!3m2!3d{DLAT}!4d{DLNG}!6e2"
_ORIGIN_GROUP = "!1m4!3m2!3d{OLAT}!4d{OLNG}!6e2"
_AVOID_BLOCK = re.compile(r"!6m(\d+)(!1m5!18b1!30b1!31m1!1b1!34e1!2m)(\d+)")
_TOKEN = re.compile(r"!(\d+)([a-zA-Z])([^!]*)")
_VIEW = re.compile(r"(!3m12!1m3!1d)[0-9.]+(!2d)-?[0-9.]+(!3d)-?[0-9.]+")
_ENDPOINT = "https://www.google.com/maps/preview/directions?authuser=0&hl=en&gl=us"
_DEFAULT_TEMPLATE = (
    "!1m4!3m2!3d{OLAT}!4d{OLNG}!6e2!1m4!3m2!3d{DLAT}!4d{DLNG}!6e2"
    "!3m12!1m3!1d24960.741896132306!2d-121.7527808!3d38.554674999999996"
    "!2m3!1f0.0!2f0.0!3f0.0!3m2!1i1024!2i768!4f13.1"
    "!6m56!1m5!18b1!30b1!31m1!1b1!34e1!2m4!5m1!6e2!20e3!39b1"
    "!6m27!32i1!49b1!63m0!66b1!85b1!114b1!149b1!206b1!209b1!212b1"
    "!216b1!222b1!223b1!232b1!234b1!235b1!244b1!246b1!250b1!253b1"
    "!260b1!266b1!270b1!273b1!279b1!281b1!291m0!10b1!12b1!13b1!14b1"
    "!16b1!17m1!3e1!20m5!1e{MODE}!2e3!5e2!6b1!14b1!46m1!1b0!96b1!99b1"
    "!15i10142!20m28!1m6!1m2!1i0!2i0!2m2!1i530!2i768"
    "!1m6!1m2!1i974!2i0!2m2!1i1024!2i768!1m6!1m2!1i0!2i0!2m2!1i1024!2i20"
    "!1m6!1m2!1i0!2i748!2m2!1i1024!2i768!27b1!40i783!47m2!8b1!10e2"
)
_PATHS = {
    "routes": [0, 1],
    "geometries": [0, 7],
    "summary": [0],
    "legs": [1],
    "legSummary": [0],
    "distance": [2, 0],
    "typical": [3, 0],
    "traffic": [10, 0, 0],
    "typicalLow": [10, 4, 0],
    "typicalHigh": [10, 4, 1],
    "start": [7, 3, 2],
    "end": [7, 3, 3],
    "summaryText": [1],
    "spans": [3, 5, 0],
}


def _finite(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    value = number(value)
    return value if value is not None and math.isfinite(value) else None


def _coordinate(value: dict, label: str) -> dict[str, float]:
    if not isinstance(value, dict):
        raise ApiError("invalid_argument", f"{label} must contain latitude and longitude", 422)
    lat, lon = _finite(value.get("latitude")), _finite(value.get("longitude"))
    if lat is None or lon is None or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise ApiError(
            "invalid_argument",
            f"{label} requires finite latitude [-90,90] and longitude [-180,180]",
            422,
        )
    return {"latitude": lat, "longitude": lon}


def _direct_children(pb: str, start: int, count: int) -> list[tuple[int, str, int, int]] | None:
    """Return direct children; message values count ALL descendant tokens."""
    tokens = []
    for match in _TOKEN.finditer(pb, start):
        tokens.append(match)
        if len(tokens) == count:
            break
    if count <= 0 or len(tokens) != count:
        return None
    if tokens[0].start() != start or any(a.end() != b.start() for a, b in zip(tokens, tokens[1:])):
        return None
    out, index = [], 0
    while index < len(tokens):
        token = tokens[index]
        field, kind, value = token.groups()
        if kind == "m" and not value.isdigit():
            return None
        end_index = index + (int(value) if kind == "m" else 0)
        if end_index >= len(tokens):
            return None
        out.append((int(field), kind, token.start(), tokens[end_index].end()))
        index = end_index + 1
    return out


def _with_avoid(pb: str, avoid: set[str]) -> str:
    match = _AVOID_BLOCK.search(pb)
    if match is None:
        if avoid:
            raise ApiError(
                "calibration_invalid", "Directions template cannot represent avoid options", 500
            )
        return pb
    outer_count = int(match[1])
    body_start = match.start() + len("!6m") + len(match[1])
    children = _direct_children(pb, body_start, outer_count)
    if children is None:
        raise ApiError(
            "calibration_invalid", "Directions feature block has invalid protobuf counts", 500
        )
    flags = ("!1b1" if "highways" in avoid else "") + ("!2b1" if "tolls" in avoid else "")
    added = len(flags) // 4
    ferry = next((c for c in children if c[0] == 7 and c[1] == "b"), None)
    ferry_delta = 0
    if ferry:
        pb = pb[: ferry[2]] + ("!7b1" if "ferries" in avoid else "!7b0") + pb[ferry[3] :]
    elif "ferries" in avoid:
        insert_at = next((c[2] for c in children if c[0] > 7), children[-1][3])
        pb = pb[:insert_at] + "!7b1" + pb[insert_at:]
        ferry_delta = 1
    replacement = f"!6m{outer_count + added + ferry_delta}{match[2]}{int(match[3]) + added}{flags}"
    return pb[: match.start()] + replacement + pb[match.end() :]


def build_directions_pb(
    origin: dict,
    destination: dict,
    mode: str = "driving",
    waypoints: list[dict] | None = None,
    avoid: list[str] | None = None,
    template: str = _DEFAULT_TEMPLATE,
) -> str:
    """Build Vela's counted protobuf text, with ordered stops and driving avoids."""
    if mode not in _MODES:
        raise ApiError(
            "unsupported_mode",
            "Supported modes: driving, walking, bicycling; transit requires Android WebView",
            422,
        )
    if waypoints is not None and not isinstance(waypoints, list):
        raise ApiError("invalid_argument", "waypoints must be a list of coordinates", 422)
    if avoid is not None and (
        not isinstance(avoid, list) or any(not isinstance(a, str) for a in avoid)
    ):
        raise ApiError(
            "invalid_argument", "avoid must be a list of tolls, highways, or ferries", 422
        )
    avoid_set = set(avoid or [])
    if avoid_set - _AVOID:
        raise ApiError("invalid_argument", "avoid accepts only tolls, highways, ferries", 422)
    if avoid_set and mode != "driving":
        raise ApiError("unsupported_option", "Avoid options are supported only for driving", 422)
    points = [_coordinate(origin, "origin")]
    points += [_coordinate(p, f"waypoints[{i}]") for i, p in enumerate(waypoints or [])]
    points += [_coordinate(destination, "destination")]
    if not isinstance(template, str) or any(
        p not in template for p in ("{OLAT}", "{OLNG}", "{DLAT}", "{DLNG}", "{MODE}")
    ):
        raise ApiError(
            "calibration_invalid", "Directions template is missing required placeholders", 500
        )
    if len(points) > 2 and (_DEST_GROUP not in template or _ORIGIN_GROUP not in template):
        raise ApiError("calibration_invalid", "Directions template cannot represent waypoints", 500)
    # Like RequestShape.fitDirections, center the viewport around all trip points.
    # This portable adapter uses a deterministic margin rather than session jitter.
    south, north = min(p["latitude"] for p in points), max(p["latitude"] for p in points)
    west, east = min(p["longitude"] for p in points), max(p["longitude"] for p in points)
    lat, lon = (south + north) / 2, (west + east) / 2
    span = max((north - south) * 111320, (east - west) * 111320 * math.cos(math.radians(lat)))
    pb = _VIEW.sub(
        lambda m: f"{m[1]}{max(span * 1.35, 1500.0)}{m[2]}{lon}{m[3]}{lat}", template, count=1
    )
    pb = _with_avoid(pb, avoid_set)
    stops = "".join(f"!1m4!3m2!3d{p['latitude']}!4d{p['longitude']}!6e2" for p in points[1:-1])
    pb = pb.replace(_DEST_GROUP, stops + _DEST_GROUP, 1)
    replacements = {
        "{OLAT}": points[0]["latitude"],
        "{OLNG}": points[0]["longitude"],
        "{DLAT}": points[-1]["latitude"],
        "{DLNG}": points[-1]["longitude"],
        "{MODE}": _MODES[mode],
    }
    for key, value in replacements.items():
        pb = pb.replace(key, str(value))
    if re.search(r"\{[A-Z]+\}", pb):
        raise ApiError(
            "calibration_invalid", "Directions template contains unresolved placeholders", 500
        )
    return pb


def _paths(overrides: dict | None) -> dict[str, list[int]]:
    paths = {key: list(value) for key, value in _PATHS.items()}
    if overrides is None:
        return paths
    if not isinstance(overrides, dict):
        raise ApiError("calibration_invalid", "directionsPaths must be a dictionary", 500)
    for key, path in overrides.items():
        if key in paths:
            if not isinstance(path, list) or any(
                isinstance(i, bool) or not isinstance(i, int) or i < 0 for i in path
            ):
                raise ApiError("calibration_invalid", f"Invalid directions path: {key}", 500)
            paths[key] = path
    return paths


def _decode_geometry(node: Any) -> dict | None:
    latitudes, longitudes = at(node, 0), at(node, 1)
    if (
        not isinstance(latitudes, list)
        or not isinstance(longitudes, list)
        or len(latitudes) != len(longitudes)
        or len(latitudes) < 2
    ):
        return None
    latitude = longitude = 0
    coordinates = []
    for lat_delta, lon_delta in zip(latitudes, longitudes):
        lat_delta, lon_delta = _finite(lat_delta), _finite(lon_delta)
        if (
            lat_delta is None
            or lon_delta is None
            or not lat_delta.is_integer()
            or not lon_delta.is_integer()
        ):
            return None
        latitude += int(lat_delta)
        longitude += int(lon_delta)
        lat, lon = latitude / 1e7, longitude / 1e7
        if not -90 <= lat <= 90 or not -180 <= lon <= 180:
            return None
        coordinates.append([lon, lat])
    return {"type": "LineString", "coordinates": coordinates}


def _summary_coordinate(node: Any) -> dict | None:
    lat, lon = _finite(at(node, 2)), _finite(at(node, 3))
    if lat is None or lon is None or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        return None
    return {"latitude": lat, "longitude": lon}


class _Steps(HTMLParser):
    """Extract supplied markup without assigning guessed maneuver positions."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.steps: list[dict] = []
        self.current: dict | None = None
        self.text: list[str] = []
        self.road: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "step":
            self.current = {
                "instruction": "",
                "distance_meters": _finite(attrs.get("meters")),
                "maneuver": attrs.get("maneuver"),
                "turn_side": None,
                "turn_type": None,
                "road_names": [],
                "lane_hint": None,
            }
            self.text = []
        elif self.current is not None:
            self.text.append(" ")
            if tag == "turn":
                self.current["turn_side"] = attrs.get("side")
                self.current["turn_type"] = attrs.get("type")
            elif tag == "road":
                self.road = []

    def handle_data(self, data):
        if self.current is not None:
            self.text.append(data)
            if self.road is not None:
                self.road.append(data)

    def handle_endtag(self, tag):
        if self.current is None:
            return
        if tag == "road" and self.road is not None:
            road = " ".join("".join(self.road).split())
            if road:
                self.current["road_names"].append(road)
            self.road = None
        if tag == "step":
            instruction = " ".join("".join(self.text).split())
            if instruction:
                lane = re.match(r"^(Use (?:the .+? lanes?|any lane)) to ", instruction, re.I)
                if lane:
                    self.current["lane_hint"] = lane[1]
                    instruction = instruction[lane.end() :]
                self.current["instruction"] = instruction[:1].upper() + instruction[1:]
                self.steps.append(self.current)
            self.current, self.road = None, None
        else:
            self.text.append(" ")


def _collect_steps(route: Any) -> list[dict]:
    steps, pending = [], [route]
    while pending:
        node = pending.pop()
        if isinstance(node, list):
            pending.extend(reversed(node))
        elif isinstance(node, str) and re.search(r"<step\b", node, re.I):
            parser = _Steps()
            parser.feed(node)
            parser.close()
            steps.extend(parser.steps)
    return steps


def parse_directions(root: Any, paths: dict | None = None) -> list[dict]:
    """Normalize calibrated consumer route summaries and real E7 geometries.

    No straight-line fallback is substituted for missing geometry. Guidance means
    supplied text is present, not that turn positions or completeness are verified.
    """
    paths = _paths(paths)

    def read(node, key):
        return at(node, *paths[key])

    raw_routes = read(root, "routes")
    if not isinstance(raw_routes, list):
        raise ApiError(
            "parser_drift", "Google directions routes were not found at the calibrated path"
        )
    if not raw_routes:
        raise ApiError("no_routes", "Google returned an empty directions route list", 404)
    geometries = read(root, "geometries")
    parsed = []
    for index, route in enumerate(raw_routes):
        summary = read(route, "summary")
        distance, typical = _finite(read(summary, "distance")), _finite(read(summary, "typical"))
        if distance is None or typical is None or distance < 0 or typical < 0:
            continue
        steps = _collect_steps(route)
        geometry = _decode_geometry(at(geometries, index))
        leg_times = []
        raw_legs = read(route, "legs")
        if isinstance(raw_legs, list):
            for leg in raw_legs:
                leg_summary = read(leg, "legSummary")
                d, t = _finite(read(leg_summary, "distance")), _finite(read(leg_summary, "typical"))
                if d is not None and t is not None and d >= 0 and t >= 0:
                    leg_times.append(
                        {
                            "distance_meters": d,
                            "typical_seconds": t,
                            "traffic_seconds": _finite(read(leg_summary, "traffic")),
                        }
                    )
        if (
            len(leg_times) < 2
            or abs(sum(leg["distance_meters"] for leg in leg_times) - distance) > distance * 0.03
        ):
            leg_times = []
        spans = []
        raw_spans = read(route, "spans")
        if isinstance(raw_spans, list):
            for span in raw_spans:
                level, start, length = (
                    _finite(at(span, 0)),
                    _finite(at(span, 1)),
                    _finite(at(span, 2)),
                )
                if (
                    level is not None
                    and level >= 1
                    and level.is_integer()
                    and start is not None
                    and start >= 0
                    and length is not None
                    and length > 0
                ):
                    spans.append(
                        {"level": int(level), "start_meters": start, "length_meters": length}
                    )
        parsed.append(
            {
                "source": "google_consumer",
                "summary": string(read(summary, "summaryText")),
                "distance_meters": distance,
                "typical_seconds": typical,
                "traffic_seconds": _finite(read(summary, "traffic")),
                "typical_low_seconds": _finite(read(summary, "typicalLow")),
                "typical_high_seconds": _finite(read(summary, "typicalHigh")),
                "start": _summary_coordinate(read(summary, "start")),
                "end": _summary_coordinate(read(summary, "end")),
                "geometry": geometry,
                "geometry_available": geometry is not None,
                "steps": steps,
                "guidance_available": bool(steps),
                "leg_times": leg_times,
                "traffic_spans": sorted(spans, key=lambda s: s["start_meters"]),
            }
        )
    if not parsed:
        raise ApiError("parser_drift", "Google directions contained no parsable route summaries")
    return parsed


class DirectionsService:
    """Consumer HTTP directions only; accepts the shared Google transport client."""

    def __init__(self, client, calibration: dict):
        self.client = client
        self.calibration = calibration

    async def directions(
        self,
        origin: dict,
        destination: dict,
        mode: str = "driving",
        waypoints: list[dict] | None = None,
        avoid: list[str] | None = None,
        language: str = "en",
        region: str = "us",
    ) -> dict:
        if not isinstance(language, str) or not re.fullmatch(
            r"[A-Za-z][A-Za-z0-9_-]{0,34}", language
        ):
            raise ApiError("invalid_argument", "language must be a language code", 422)
        if not isinstance(region, str) or not re.fullmatch(r"[A-Za-z]{2}", region):
            raise ApiError("invalid_argument", "region must be a two-letter region code", 422)
        pb = build_directions_pb(
            origin,
            destination,
            mode,
            waypoints,
            avoid,
            self.calibration.get("directionsPb", _DEFAULT_TEMPLATE),
        )
        endpoint = self.calibration.get("directionsEndpoint", _ENDPOINT)
        if not isinstance(endpoint, str):
            raise ApiError("calibration_invalid", "directionsEndpoint must be a URL", 500)
        parts = urlsplit(endpoint)
        if (
            parts.scheme != "https"
            or parts.hostname not in {"google.com", "www.google.com"}
            or parts.username
            or parts.password
        ):
            raise ApiError(
                "calibration_invalid", "directionsEndpoint must use HTTPS on google.com", 500
            )
        query = [
            (k, v)
            for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k not in {"pb", "hl", "gl"}
        ]
        query += [("hl", language), ("gl", region.lower())]
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))
        body = await self.client.get_text(url, params={"pb": pb})
        try:
            root = parse_json(body)
        except ApiError:
            raise
        except (ValueError, TypeError) as exc:
            raise ApiError("parser_drift", "Google directions did not return JSON") from exc
        return {
            "routes": parse_directions(root, self.calibration.get("directionsPaths")),
            "mode": mode,
            "completeness": "unknown",
        }
