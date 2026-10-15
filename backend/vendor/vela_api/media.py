"""Ports of Vela's native photo/review RPC and Street View metadata parsers.

These consumer endpoints are not official Google APIs. Native review responses
can be limited even when Google marks a page as the end of the list. No browser
DOM extraction or Android/Cronet session behavior is implemented here.
"""

from __future__ import annotations

import json
import math
import re
import secrets
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .common import ApiError, at, number, parse_json

_BATCH_URL = "https://www.google.com/maps/_/MapsWizUi/data/batchexecute"
_SV_URL = "https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/SingleImageSearch"
_MAPS_REFERER = "https://www.google.com/maps/"
_RPC_CONTEXT = "CAE="
_PHOTOS_PROTO = (
    '[2,null,["{FID}",null,null,null,null,null,null,null,0],null,'
    "[null,[1200,1000],[null,{COUNT},null,null,1],null,null,null,"
    "[[[1,0,3],[2,1,2],[2,0,3],[8,0,3],[10,0,3],[10,1,2],[10,0,4],[9,1,2]],1],null,0],"
    "null,null,null,null,null,null,null,null,null,null,[null,1,null,1]]"
)
_REVIEW_PROTO = (
    '[[["{FID}"],null,null,null,null,[null,null,null,[[1],[3]]]],[10,"{TOKEN}"],null,null,'
    "[null,null,null,null,null,null,81],null,null,[null,1,1,null,1,null,1,null,null,null,null,[1,1,null,[[1]]]],null,null,"
    "[3,1,null,null,null,[2]],null,[1]]"
)
_SV_BODY = (
    '[["apiv3",null,null,null,"US",null,null,null,null,null,[[0]]],[[null,null,{LAT},{LNG}],{RADIUS}],'
    '[null,["en","US"],null,null,null,null,null,null,[2],null,[[[2,1,2]]]],[[1,2,3,4,8,6]]]'
)
_PANO_URL = (
    "https://www.google.com/maps/photometa/v1?authuser=0&hl=en&gl=us&pb="
    "!1m4!1smaps_sv.tactile!11m2!2m1!1b1!2m2!1sen!2sus!3m3!1m2!1e2!2s{PANOID}"
    "!4m57!1e1!1e2!1e3!1e4!1e5!1e6!1e8!1e12!2m1!1e1!4m1!1i48!5m1!1e1!5m1!1e2!6m1!1e1!6m1!1e2"
    "!9m36!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e3!2b1!3e2!1m3!1e3!2b0!3e3!1m3!1e8!2b0!3e3"
    "!1m3!1e1!2b0!3e3!1m3!1e4!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e3"
)
_PANO_ID = re.compile(r"[A-Za-z0-9_-]{20,25}\Z")
_BATCH_START = re.compile(r'\[\s*\[\s*"wrb\.fr"')
_SIZE_SUFFIX = re.compile(r"=w\d+-h\d+.*$")
_MONTHS = (
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
)


def _parse_error(message: str) -> ApiError:
    return ApiError("upstream_parse_error", message, status_code=502)


def _text(value):
    return value if isinstance(value, str) else None


def _integer(value):
    # Kotlin JsonPrimitive.intOrNull/toIntOrNull rejects booleans and 2.0.
    if isinstance(value, bool):
        return None
    if isinstance(value, int) or (
        isinstance(value, str) and re.fullmatch(r"[+-]?\d+", value, flags=re.ASCII)
    ):
        n = int(value)
        return n if -(2**31) <= n < 2**31 else None
    return None


def _batch_payload(body: str, rpc_id: str) -> list:
    """Decode a framed data row, then its JSON-string payload, not whole-body JSON."""
    decoder = json.JSONDecoder()
    for match in _BATCH_START.finditer(body):
        try:
            rows, _ = decoder.raw_decode(body[match.start() :])
        except ValueError, TypeError:
            continue
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, list) or at(row, 0) != "wrb.fr" or at(row, 1) != rpc_id:
                continue
            payload_text = at(row, 2)
            if not isinstance(payload_text, str):
                raise _parse_error(f"{rpc_id} data row is missing its JSON-string payload")
            try:
                payload = json.loads(payload_text)
            except (ValueError, TypeError) as exc:
                raise _parse_error(f"{rpc_id} payload is malformed JSON") from exc
            if not isinstance(payload, list):
                raise _parse_error(f"{rpc_id} payload is not a positional array")
            return payload
    raise _parse_error(f"Expected {rpc_id} batchexecute data row was not found")


def _posted_date(entry) -> str | None:
    year, month = _integer(at(entry, 21, 6, 8, 0)), _integer(at(entry, 21, 6, 8, 1))
    return (
        f"{_MONTHS[month - 1]} {year}"
        if year is not None and month is not None and 1 <= month <= 12
        else None
    )


def _find_pano_id(value):
    if isinstance(value, str) and _PANO_ID.fullmatch(value):
        return value
    if isinstance(value, list):
        for child in value:
            found = _find_pano_id(child)
            if found:
                return found
    return None


def _distance_bearing(lat, lng, other_lat, other_lng):
    a, b = math.radians(lat), math.radians(other_lat)
    dlat, dlng = b - a, math.radians(other_lng - lng)
    h = math.sin(dlat / 2) ** 2 + math.cos(a) * math.cos(b) * math.sin(dlng / 2) ** 2
    h = max(0.0, min(1.0, h))
    distance = 2 * 6_371_000 * math.atan2(math.sqrt(h), math.sqrt(1 - h))
    bearing = (
        math.degrees(
            math.atan2(
                math.sin(dlng) * math.cos(b),
                math.cos(a) * math.sin(b) - math.sin(a) * math.cos(b) * math.cos(dlng),
            )
        )
        + 360
    ) % 360
    return distance, bearing


def _parse_panorama(body: str, fallback_lat: float = 0.0, fallback_lng: float = 0.0) -> dict:
    raw = body.strip()
    if not raw.startswith(("[", ")]}'")):
        # Legacy JSONP support for captured fixtures; the service calls the new POST.
        start, end = raw.find("("), raw.rfind(")")
        if 0 <= start < end:
            raw = raw[start + 1 : end].strip()
    try:
        root = parse_json(raw)
    except ApiError:
        raise
    except (ValueError, TypeError) as exc:
        raise _parse_error("Street View metadata is malformed JSON") from exc
    if not isinstance(root, list):
        raise _parse_error("Street View metadata is not a positional array")
    status = at(root, 0, 0)
    if status == 5:
        reason = _text(at(root, 0, 2)) or "No Street View imagery was returned"
        if "decommission" in reason.lower():
            raise ApiError("upstream_unavailable", reason, status_code=502)
        raise ApiError("no_results", reason, status_code=404)
    node = at(root, 1)
    if not _PANO_ID.fullmatch(_text(at(node, 1, 1)) or ""):
        node = at(root, 1, 0)
    pano_id = _text(at(node, 1, 1))
    pano_id = pano_id if pano_id and _PANO_ID.fullmatch(pano_id) else _find_pano_id(node)
    if not pano_id:
        if status == 0 and len(root) > 1 and root[1] in (None, []):
            raise ApiError("no_results", "No Street View imagery was returned", status_code=404)
        raise _parse_error("Street View metadata does not contain a recognizable panorama node")
    raw_tile_size = at(node, 2, 3, 1)
    if not isinstance(raw_tile_size, list) or not raw_tile_size or len(raw_tile_size) > 2:
        raise _parse_error("Street View metadata is missing its tile-size array")
    tile_sides = [_integer(side) for side in raw_tile_size if side is not None]
    if not tile_sides or any(side is None or side <= 0 for side in tile_sides):
        raise _parse_error("Street View metadata contains an invalid tile size")
    if len(set(tile_sides)) != 1:
        # The public API exposes a single square tile size for both grid axes.
        raise _parse_error("Street View metadata contains unsupported rectangular tiles")
    tile_size = tile_sides[0]
    levels = at(node, 2, 3, 0)
    if not isinstance(levels, list) or not levels:
        raise _parse_error("Street View metadata is missing its zoom-level dimensions")
    dimensions = []
    for index, level in enumerate(levels):
        height, width = _integer(at(level, 0, 0)), _integer(at(level, 0, 1))
        if width is None or height is None or width <= 0 or height <= 0:
            # Dropping a malformed level would move every subsequent zoom index.
            raise _parse_error(f"Street View metadata contains invalid dimensions at zoom {index}")
        dimensions.append({"width": width, "height": height})
    position = at(node, 5, 0, 1)
    lat, lng = number(at(position, 0, 2), fallback_lat), number(at(position, 0, 3), fallback_lng)
    year, month = _integer(at(node, 6, 7, 0)), _integer(at(node, 6, 7, 1))
    graph = at(node, 5, 0, 3, 0)
    graph = graph if isinstance(graph, list) else []
    history = []
    if year is not None and month is not None:
        history.append({"pano_id": pano_id, "year": year, "month": month})
    history_rows = at(node, 5, 0, 8)
    for entry in history_rows if isinstance(history_rows, list) else []:
        index, hy, hm = _integer(at(entry, 0)), _integer(at(entry, 1, 0)), _integer(at(entry, 1, 1))
        hid = (
            _text(at(graph, index, 0, 1)) if index is not None and 0 <= index < len(graph) else None
        )
        if hid and _PANO_ID.fullmatch(hid) and hy is not None and hm is not None:
            history.append({"pano_id": hid, "year": hy, "month": hm})
    unique_history = {}
    for entry in history:
        unique_history.setdefault(entry["pano_id"], entry)
    history = sorted(
        unique_history.values(),
        key=lambda entry: entry["year"] * 100 + entry["month"],
        reverse=True,
    )
    candidates = []
    for entry in graph:
        hid = _text(at(entry, 0, 1))
        la, ln = number(at(entry, 2, 0, 2)), number(at(entry, 2, 0, 3))
        if not hid or not _PANO_ID.fullmatch(hid) or hid == pano_id or la is None or ln is None:
            continue
        distance, bearing = _distance_bearing(lat, lng, la, ln)
        if 4 <= distance <= 45:
            candidates.append(
                {
                    "pano_id": hid,
                    "latitude": la,
                    "longitude": ln,
                    "bearing_degrees": bearing,
                    "distance_meters": distance,
                }
            )
    neighbors = []
    for link in sorted(candidates, key=lambda link: link["distance_meters"]):
        if all(
            abs((link["bearing_degrees"] - other["bearing_degrees"] + 540) % 360 - 180) >= 30
            for other in neighbors
        ):
            neighbors.append(link)
    neighbors.sort(key=lambda link: link["bearing_degrees"])
    return {
        "pano_id": pano_id,
        "latitude": lat,
        "longitude": lng,
        "heading_degrees": number(at(position, 2, 0), 0.0),
        "tile_size": tile_size,
        "max_zoom": len(dimensions),
        "level_dimensions": dimensions,
        "address_label": _text(at(node, 3, 2, 0, 0)),
        "copyright": _text(at(node, 4, 0, 0, 0, 0)),
        "capture_year": year,
        "capture_month": month,
        "neighbors": neighbors,
        "history": history,
    }


def tile_url(pano_id: str, x: int, y: int, zoom: int) -> str:
    """Build a tile address; the API validates coordinates against pano metadata."""
    return "https://streetviewpixels-pa.googleapis.com/v1/tile?" + urlencode(
        {
            "cb_client": "maps_sv.tactile",
            "panoid": pano_id,
            "x": x,
            "y": y,
            "zoom": zoom,
            "nbt": 1,
            "fover": 2,
        }
    )


class MediaService:
    def __init__(self, client, calibration: dict):
        self.client = client
        self.calibration = calibration
        self._request_id = secrets.randbelow(90_000) + 10_000

    def _batch_request(self, rpc_id, inner, language, region):
        endpoint = (
            self.calibration.get("photosEndpoint", _BATCH_URL) if rpc_id == "hspqX" else _BATCH_URL
        )
        parts = urlsplit(endpoint)
        params = dict(parse_qsl(parts.query))
        params.update(
            {
                "rpcids": rpc_id,
                "source-path": "/maps",
                "hl": language,
                "gl": region,
                "_reqid": str(self._request_id),
                "rt": "c",
            }
        )
        self._request_id += 100_000
        headers = {
            "Referer": _MAPS_REFERER,
            "X-Same-Domain": "1",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        }
        context = self.calibration.get("rpcContext", _RPC_CONTEXT)
        if isinstance(context, str) and context.strip():
            headers["x-maps-diversion-context-bin"] = context
        outer = json.dumps(
            [[[rpc_id, inner, None, "generic"]]], ensure_ascii=False, separators=(",", ":")
        )
        return (
            urlunsplit((parts.scheme, parts.netloc, parts.path, "", "")),
            {"f.req": outer},
            params,
            headers,
        )

    async def photos(
        self, feature_id: str, token: str | None = None, language="en", region="us"
    ) -> dict:
        template = self.calibration.get("photosProto", _PHOTOS_PROTO)
        inner = (
            template.replace("{FID}", feature_id)
            .replace("{COUNT}", "50")
            .replace("[1200,1000]", "[1024,768]")
        )
        if token:
            try:
                proto = json.loads(inner)
                proto[4][2][2] = token
                inner = json.dumps(proto, ensure_ascii=False, separators=(",", ":"))
            except (ValueError, TypeError, IndexError) as exc:
                raise _parse_error(
                    "Configured photo proto no longer supports its pagination cursor"
                ) from exc
        url, data, params, headers = self._batch_request("hspqX", inner, language, region)
        payload = _batch_payload(
            await self.client.post_text(url, data=data, params=params, headers=headers), "hspqX"
        )
        if not payload or (payload[0] is not None and not isinstance(payload[0], list)):
            raise _parse_error("Photo payload is missing its photo-list array")
        raw_photos = payload[0] or []
        photos, seen, recognizable = [], set(), False
        for entry in raw_photos:
            url = _text(at(entry, 6, 0))
            if not url or not url.startswith("http"):
                continue
            recognizable = True
            if "googleusercontent" not in url:
                # Vela intentionally excludes Street View preview records here.
                continue
            url = _SIZE_SUFFIX.sub("=w1024-h768", url)
            if url not in seen:
                seen.add(url)
                photos.append({"url": url, "posted_text": _posted_date(entry), "category": None})
        if raw_photos and not recognizable:
            raise _parse_error("Photo payload contains no recognizable photo records")
        next_token = _text(at(payload, 5))
        return {
            "photos": photos,
            "next_token": next_token if next_token and next_token.strip() and photos else None,
            "completeness": "unknown",
        }

    async def reviews(
        self, feature_id: str, token: str | None = None, language="en", region="us"
    ) -> dict:
        token = "".join(
            c
            for c in token or ""
            if c in "-_=" or (ord(c) <= 0xFFFF and (c.isalpha() or c.isdecimal()))
        )
        inner = (
            self.calibration.get("reviewFeedProto", _REVIEW_PROTO)
            .replace("{FID}", feature_id)
            .replace("{TOKEN}", token)
        )
        url, data, params, headers = self._batch_request("qv9Egd", inner, language, region)
        payload = _batch_payload(
            await self.client.post_text(url, data=data, params=params, headers=headers), "qv9Egd"
        )
        if len(payload) < 3 or (payload[2] is not None and not isinstance(payload[2], list)):
            raise _parse_error("Review payload is missing its review-list array")
        end_value = at(payload, 5)
        end = end_value if isinstance(end_value, bool) else None
        raw_reviews = payload[2] or []
        reviews = []
        for entry in raw_reviews:
            row = at(entry, 0)
            who = at(row, 1, 4, 5)
            author, rating = _text(at(who, 0)), _integer(at(row, 2, 0, 0))
            if author is None or rating is None:
                continue
            images = at(row, 2, 2)
            images = images if isinstance(images, list) else []
            photos = [
                url
                for image in images
                if (url := _text(at(image, 1, 6, 0))) and url.startswith("http")
            ]
            text = _text(at(row, 2, 15, 0, 0))
            reviews.append(
                {
                    "author": author,
                    "author_photo": _text(at(who, 1)),
                    "rating": rating,
                    "relative_time": _text(at(row, 1, 6)),
                    "text": text if text and text.strip() else None,
                    "photos": photos,
                }
            )
        if raw_reviews and not reviews:
            raise _parse_error("Review payload contains no recognizable review records")
        next_token = _text(at(payload, 1))
        return {
            "reviews": reviews,
            "next_token": next_token
            if next_token and next_token.strip() and end is not True
            else None,
            "end": end,
            "completeness": "limited",
        }

    async def streetview(self, latitude: float, longitude: float, radius: int = 50) -> dict:
        body = (
            self.calibration.get("streetViewSearchBody", _SV_BODY)
            .replace("{LAT}", f"{latitude:.7f}")
            .replace("{LNG}", f"{longitude:.7f}")
            .replace("{RADIUS}", str(radius))
        )
        try:
            positional = json.loads(body)
        except (ValueError, TypeError) as exc:
            raise _parse_error("Configured Street View request proto is malformed") from exc
        raw = await self.client.post_text(
            _SV_URL,
            json_body=positional,
            headers={
                "Content-Type": "application/json+protobuf",
                "x-user-agent": "grpc-web-javascript/0.1",
                "Referer": _MAPS_REFERER,
            },
        )
        return _parse_panorama(raw, latitude, longitude)

    async def panorama(self, pano_id: str) -> dict:
        # Vela's v26 CalibrationStore does not parse a remote pano URL; use the
        # compiled default. The optional dict property supports an explicit port config.
        url = self.calibration.get("streetViewPanoUrl", _PANO_URL).replace("{PANOID}", pano_id)
        return _parse_panorama(await self.client.get_text(url, headers={"Referer": _MAPS_REFERER}))

    tile_url = staticmethod(tile_url)
