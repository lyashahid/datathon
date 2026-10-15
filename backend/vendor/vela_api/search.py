# ruff: noqa: E501
"""Source-derived Google Maps search adapter.

Ported from Vela commit 3c8fc207: SearchPb.kt, SearchParser.kt and
SuggestParser.kt (GPL-3.0). This serves one calibrated request, not Vela's
Android fan-out, JavaScript transforms, WebView enrichment or UI cache policy.
"""

from __future__ import annotations

import json
import math
import random
import re
from urllib.parse import parse_qsl, urlsplit, urlunsplit

from .common import ApiError, at, number, parse_json, string

# Calibration.DEFAULT_PATHS fills keys absent from the shipped v26 snapshot.
_PATHS = {
    "results": [64],
    "single": [0, 1, 0, 14],
    "atThisPlace": [0, 1, 0, 14, 68],
    "similar": [2, 11, 0],
    "name": [1, 11],
    "lat": [1, 9, 2],
    "lng": [1, 9, 3],
    "address": [1, 39],
    "addressComponents": [1, 2],
    "category": [1, 13, 0],
    "rating": [1, 4, 7],
    "reviewCount": [1, 4, 8],
    "priceText": [1, 4, 2],
    "fuelPrice": [1, 88, 0],
    "placeType": [1, 88, 1],
    "countryCode": [1, 88, 2, 1],
    "website": [1, 7, 0],
    "actionLabel": [1, 75, 0, 0, 5, 0],
    "actionUrl": [1, 75, 0, 0, 5, 1, 2, 0],
    "phone": [1, 178, 0, 0],
    "featureId": [1, 10],
    "placeId": [1, 78],
    "photos": [1, 72, 0],
    "featuredReview": [1, 142, 1, 0, 1, 0, 0],
    "about": [1, 100, 1],
    "updates": [1, 122, 1],
    "editorialSummary": [1, 32, 1, 1],
    "ownerDescription": [1, 154, 0, 0],
    "openStatus": [1, 203, 1, 8, 0],
    "statusRich": [1, 203, 1, 4, 0],
    "status118": [1, 118, 0, 3, 1, 4, 0],
    "hours203": [1, 203, 0],
    "hours118": [1, 118, 0, 3, 0],
    "departments": [1, 118],
    "closedFlag": [1, 23],
    "popularTimes": [1, 84],
    "alsoSearched": [0, 1, 0, 14, 99, 0, 0, 1],
}
_SUGGEST_PATHS = {
    "rows": [0, 1],
    "title": [0, 0],
    "primary": [1, 0],
    "secondary": [2, 0],
    "lat": [11, 2],
    "lng": [11, 3],
    "lat2": [13, 0, 3, 2],
    "lng2": [13, 0, 3, 3],
    "featureId": [13, 0, 0],
}
_SUGGEST_PB = (
    "!2i5!4m12!1m3!1d{SPAN}!2d{LNG}!3d{LAT}!2m3!1f0!2f0!3f0"
    "!3m2!1i{W}!2i{H}!4f13.1!7i20!10b1!12m6!1m2!18b1!30b1"
    "!2m2!1i203!2i100!19m4!1m3!1i1!2i1!3i1!20m1!1e1"
)
_CLOSED = {
    "en": ["Closed", "Opens", "Opening", "Temporarily", "Permanently"],
    "fr": ["Fermé", "Ouvre", "Définitivement"],
    "de": ["Geschlossen", "Öffnet", "Vorübergehend", "Dauerhaft"],
    "es": ["Cerrado", "Abre"],
    "it": ["Chiuso", "Apre"],
    "pt": ["Fechado", "Abre"],
    "nl": ["Gesloten", "Opent", "Tijdelijk", "Definitief"],
    "ru": ["Закрыто", "Откроется", "Временно"],
    "pl": ["Zamknięte", "Otwarcie", "Tymczasowo"],
    "sv": ["Stängt", "Öppnar", "Tillfälligt"],
    "uk": ["Зачинено", "Відчиниться", "Тимчасово"],
    "hu": ["Zárva", "Nyitás", "Hamarosan zár", "Végleg bezárt", "Ideiglenesen zárva"],
    "ro": ["Închis", "Deschide", "Se deschide"],
    "zh": [
        "已打烊",
        "已歇業",
        "开始营业",
        "開始營業",
        "尚未营业",
        "尚未營業",
        "暂停营业",
        "暫停營業",
        "永久停业",
        "永久歇業",
        "休息中",
    ],
    "ja": ["営業時間外", "営業開始", "臨時休業", "閉業", "休業"],
    "iw": ["סגור", "נפתח", "ייפתח", "המקום סגור"],
    "he": ["סגור", "נפתח", "ייפתח", "המקום סגור"],
}
_OPEN = {
    "en": ["Open", "Closes", "Closing"],
    "fr": ["Ouvert", "Ferme"],
    "de": ["Geöffnet", "Schließt"],
    "es": ["Abierto", "Cierra"],
    "it": ["Aperto", "Chiude"],
    "pt": ["Aberto", "Fecha"],
    "nl": ["Geopend", "Open", "Sluit"],
    "ru": ["Открыто", "Закроется", "Закрывается"],
    "pl": ["Otwarte", "Zamknięcie"],
    "sv": ["Öppet", "Stänger"],
    "uk": ["Відчинено", "Зачиняється"],
    "hu": ["Nyitva", "Zárás", "Hamarosan nyit"],
    "ro": ["Deschis", "Închide", "Se închide"],
    "zh": ["营业中", "營業中", "打烊", "營業至", "营业至"],
    "ja": ["営業中", "営業終了", "まもなく営業終了"],
    "iw": ["פתוח", "נסגר", "המקום פתוח"],
    "he": ["פתוח", "נסגר", "המקום פתוח"],
}
_TEMP_CLOSED = [
    "Temporarily",
    "temporairement",
    "Vorübergehend",
    "temporalmente",
    "temporaneamente",
    "temporariamente",
    "Tijdelijk",
    "Временно",
    "Tymczasowo",
    "Tillfälligt",
    "Тимчасово",
    "זמנית",
    "temporar",
]
_SV_THUMB = re.compile(
    r'streetviewpixels-pa\.googleapis\.com/v1/thumbnail\?panoid=([A-Za-z0-9_-]{20,25})[^"\\]*?yaw=([0-9.]+)'
)
_FEATURE_ID = re.compile(r"^0x[0-9a-f]+:0x[0-9a-f]+$")


def _str(value):
    result = string(value)
    return result if isinstance(result, str) and result.strip() else None


def _int(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"[+-]?\d+", value):
        return int(value)
    return None


def _list(value):
    return value if isinstance(value, list) else []


def _distance(lat1, lng1, lat2, lng2):
    a, b = math.radians(lat1), math.radians(lat2)
    h = (
        math.sin((b - a) / 2) ** 2
        + math.cos(a) * math.cos(b) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    )
    return 6_371_000.0 * 2 * math.asin(math.sqrt(min(1.0, max(0.0, h))))


def _valid_location(lat, lng):
    return (
        lat is not None
        and lng is not None
        and math.isfinite(lat)
        and math.isfinite(lng)
        and -90 <= lat <= 90
        and -180 <= lng <= 180
    )


def _name_key(text):
    return "".join(c for c in text.lower() if c.isalnum())


def _strip_name_prefix(address, name):
    if not address or not address.lower().startswith(name.lower()):
        return address
    rest = address[len(name) :]
    if rest and rest[0].isalnum():
        return address
    after = rest.lstrip(" \u00a0")
    if after and not after[0].isdigit() and after[0] not in ",·–-":
        return address
    return after.lstrip(",·-– \u00a0") or address


def _hours(days):
    result = []
    for day in _list(days):
        name = _str(at(day, 0))
        ranges = [_str(at(part, 0)) for part in _list(at(day, 3))]
        ranges = [part for part in ranges if part]
        if name and ranges:
            note = _str(at(day, 6, 1))
            result.append(f"{name}: {', '.join(ranges)}" + (f" · {note}" if note else ""))
    return result


class SearchService:
    """One-page source-derived search, identity-checked details and suggestions."""

    def __init__(self, client, calibration: dict):
        self.client = client
        self.calibration = calibration
        self.paths = dict(_PATHS)
        self.paths.update(calibration.get("paths") or {})
        self.suggest_paths = dict(_SUGGEST_PATHS)
        self.suggest_paths.update(calibration.get("suggestPaths") or {})
        self._ech = 0

    def _field(self, value, key):
        path = self.paths.get(key)
        if not isinstance(path, list) or not all(
            isinstance(i, int) and not isinstance(i, bool) and i >= 0 for i in path
        ):
            return None
        return at(value, *path)

    def _language(self, language):
        tag = language.replace("_", "-")
        base = tag.split("-")[0].lower()
        return (tag if base in _CLOSED else "en"), (base if base in _CLOSED else "en")

    def _open_now(self, status, language):
        if not status or not status.strip():
            return None
        status = status.strip()
        closed_table = self.calibration.get("statusClosedWords") or _CLOSED
        open_table = self.calibration.get("statusOpenWords") or _OPEN
        closed = closed_table.get(language, closed_table.get("en", _CLOSED["en"]))
        opened = open_table.get(language, open_table.get("en", _OPEN["en"]))
        if any(status.startswith(word) for word in closed):
            return False
        if any(status.startswith(word) for word in opened):
            return True
        return None

    def _place(self, entry, near, language):
        def field(key):
            return self._field(entry, key)

        name = _str(field("name"))
        lat, lng = number(field("lat")), number(field("lng"))
        if name is None or not _valid_location(lat, lng):
            return None
        components = [_str(v) for v in _list(field("addressComponents"))]
        address = (
            _str(field("address"))
            or ", ".join(c for c in components if c and c.lower() != name.lower())
            or None
        )
        rich, old = _str(field("statusRich")), _str(field("status118"))
        statuses = [rich, old, _str(field("openStatus"))]
        status = next((s for s in statuses if s is not None), None)
        prefer_old = rich is None and old is not None
        hours = _hours(field("hours118" if prefer_old else "hours203"))
        if not hours:
            hours = _hours(field("hours203" if prefer_old else "hours118"))
        price = _str(field("priceText"))
        digits = re.search(r"\d+", price) if price else None
        price_level = None
        if digits:
            lower = int(digits.group())
            price_level = 1 if lower < 10 else 2 if lower < 20 else 3 if lower < 35 else 4
        elif price and 1 <= price.count("$") <= 4:
            price_level = price.count("$")
        photos = []
        photo_values = [at(photo, 6, 0) for photo in _list(field("photos"))]
        photo_values.extend(at(photo, 1, 2, 0, 0) for photo in _list(at(entry, 1, 204, 0)))
        for value in photo_values:
            url = _str(value)
            if url and "googleusercontent" in url:
                url = re.sub(r"=w\d+-h\d+.*$", "=w500-h350", url)
                if url not in photos:
                    photos.append(url)
        about = []
        wheelchair = False
        for group in _list(field("about")):
            title = _str(at(group, 1))
            attributes = _list(at(group, 2))
            items = [_str(at(item, 1)) for item in attributes]
            items = [item for item in items if item]
            if title and items:
                about.append({"title": title, "items": items})
            if any(
                (_str(at(item, 0)) or "").endswith("wheelchair_accessible_entrance")
                for item in attributes
            ):
                wheelchair = True
        popular_days = []
        for day in _list(at(field("popularTimes"), 0)):
            dow = _int(at(day, 0))
            daily_hours = []
            for hour in _list(at(day, 1)):
                h, occupancy = _int(at(hour, 0)), _int(at(hour, 1))
                if h is not None and occupancy is not None:
                    daily_hours.append({"hour": h, "occupancy": occupancy})
            if dow is not None and daily_hours:
                popular_days.append({"day_of_week": dow, "hours": daily_hours})
        departments = []
        for dep in _list(field("departments")):
            raw_name = _str(at(dep, 0))
            if not raw_name:
                continue
            dep_name = raw_name
            if raw_name.lower().startswith(name.lower()) and len(raw_name) > len(name):
                dep_name = raw_name[len(name) :].strip() or raw_name
            dep_hours, dep_status = _hours(at(dep, 3, 0)), _str(at(dep, 3, 1, 4, 0))
            if dep_hours or dep_status:
                departments.append(
                    {
                        "name": dep_name,
                        "hours": dep_hours,
                        "status_text": dep_status,
                        "open_now": self._open_now(dep_status, language),
                    }
                )
        updates = []
        for update in _list(field("updates")):
            text = _str(at(update, 1, 0, 0, 0))
            if not text:
                continue
            url, image = _str(at(update, 4, 1)), _str(at(update, 5, 0, 0))
            updates.append(
                {
                    "text": text.strip(),
                    "posted_epoch_sec": _int(at(update, 2, 0)),
                    "url": url if url and url.startswith("http") else None,
                    "link_label": _str(at(update, 4, 2)),
                    "image_url": image if image and "googleusercontent" in image else None,
                }
            )
        updates.sort(key=lambda u: u["posted_epoch_sec"] or 0, reverse=True)
        feature_id, place_id = _str(field("featureId")), _str(field("placeId"))
        # Stable provider ids are intentionally exposed in place of Vela's volatile row hash.
        identifier = feature_id or place_id or f"search:{name}:{lat:.5f},{lng:.5f}"
        fuel = _str(field("fuelPrice"))
        fuel = fuel.strip() if fuel else None
        if fuel and (not any(c.isdigit() for c in fuel) or len(fuel) > 24):
            fuel = None
        place_type, country = _str(field("placeType")), _str(field("countryCode"))
        action_url, action_label = _str(field("actionUrl")), _str(field("actionLabel"))
        sv = _SV_THUMB.search(json.dumps(entry, ensure_ascii=False, separators=(",", ":")))
        featured = _str(field("featuredReview"))
        return {
            "id": identifier,
            "feature_id": feature_id,
            "place_id": place_id,
            "name": name,
            "location": {"latitude": lat, "longitude": lng},
            "category": _str(field("category")),
            "address": _strip_name_prefix(address, name),
            "rating": number(field("rating")),
            "review_count": _int(field("reviewCount")),
            "price_text": price,
            "price_level": price_level,
            "fuel_price": fuel,
            "fuel_price_at": None,
            "place_type": place_type
            if place_type and place_type.startswith("SearchResult.TYPE_") and len(place_type) <= 64
            else None,
            "country_code": country.upper()
            if country and len(country) == 2 and country.isalpha()
            else None,
            "phone": _str(field("phone")),
            "website": _str(field("website")),
            "action_url": action_url
            if action_url and action_url.lower().startswith("http")
            else None,
            "action_label": action_label.strip()
            if action_label and len(action_label.strip()) <= 30
            else None,
            "status_text": status,
            "open_now": self._open_now(status, language),
            "permanently_closed": _int(field("closedFlag")) == 1
            or any("permanently" in s.lower() for s in statuses if s),
            "temporarily_closed": any(
                word.lower() in s.lower() for word in _TEMP_CLOSED for s in statuses if s
            ),
            "hours": hours,
            "departments": departments,
            "photo_urls": photos[:12],
            "photo_dates": [],
            "photo_categories": [],
            "about": about,
            "updates": updates[:10],
            "featured_review": featured.strip().strip('"“”') or None if featured else None,
            "wheelchair_accessible": wheelchair,
            "editorial_summary": (_str(field("editorialSummary")) or "").strip() or None,
            "owner_description": (_str(field("ownerDescription")) or "").strip() or None,
            "popular_times": {"days": popular_days} if popular_days else None,
            "sv_pano_id": sv.group(1) if sv else None,
            "sv_yaw_deg": float(sv.group(2)) if sv else None,
            "distance_meters": _distance(*near, lat, lng) if near is not None else None,
            "similar_places": [],
            "rating_histogram": None,
            "saved_note": None,
            "pin_color": None,
            "pin_icon_url": None,
            "map_layer": None,
        }

    def _parse(self, query, root, near, language):
        if not isinstance(root, list):
            raise ApiError(
                "upstream_shape_changed", "Google search response is not a positional array"
            )
        main = self._field(root, "results")
        focused = not isinstance(main, list) or not main
        entries = main if isinstance(main, list) and main else None
        if entries is None:
            businesses = []
            for item in _list(self._field(root, "atThisPlace")):
                wrapped = [None, at(item, 0)]
                if _str(self._field(wrapped, "name")):
                    businesses.append(wrapped)
            entries = businesses or None
        if entries is None:
            wrapped = [None, self._field(root, "single")]
            if _str(self._field(wrapped, "name")):
                entries = [wrapped]
        if entries is None:
            candidates = [
                e for e in root if isinstance(e, list) and e and _str(self._field(e[0], "name"))
            ]
            entries = max(candidates, key=len) if candidates else []
        places = [p for e in entries if (p := self._place(e, near, language)) is not None]
        single = focused and len(places) == 1
        focus = places[0] if single else None
        if places:
            similar = []
            for entry in _list(self._field(root, "similar")):
                name = _str(at(entry, 1))
                lat, lng = number(at(entry, 2, 0, 2)), number(at(entry, 2, 0, 3))
                if name and _valid_location(lat, lng):
                    similar.append(
                        {
                            "name": name,
                            "location": {"latitude": lat, "longitude": lng},
                            "rating": number(at(entry, 2, 6)),
                            "feature_id": _str(at(entry, 0)),
                        }
                    )
            places[0]["similar_places"] = similar
        if single:
            q, focus_key = _name_key(query), _name_key(focus["name"])
            for entry in _list(self._field(root, "alsoSearched")):
                p = self._place(entry, near, language)
                if p is None:
                    continue
                n = _name_key(p["name"])
                branch = (
                    len(q) >= 3 and n and (q in n or (len(n) >= 4 and n in q) or n == focus_key)
                )
                loc, floc = p["location"], focus["location"]
                if (
                    branch
                    and (p["feature_id"] is None or p["feature_id"] != focus["feature_id"])
                    and _distance(
                        floc["latitude"], floc["longitude"], loc["latitude"], loc["longitude"]
                    )
                    > 30
                ):
                    places.append(p)
        if near is not None:
            places.sort(
                key=lambda p: (
                    int(p["distance_meters"] / 120),
                    -(p["review_count"] or 0),
                    p["distance_meters"],
                )
            )
        stripped = single and not isinstance(at(root, 0, 1, 0, 14, 99), list)
        return {
            "query": query,
            "places": places,
            "focused_single": single,
            "stripped_focus": stripped,
            "focus": focus,
        }

    def _search_pb(self, query, latitude, longitude, span_meters, offset):
        template = self.calibration.get("searchPb")
        if not isinstance(template, str) or not all(
            token in template for token in ("{QUERY}", "{LAT}", "{LNG}")
        ):
            raise ApiError(
                "calibration_invalid",
                "The search payload template is missing required placeholders",
            )
        pb = (
            template.replace("{QUERY}", query.replace("!", " ").strip())
            .replace("{LAT}", str(latitude))
            .replace("{LNG}", str(longitude))
        )
        span = max(1000.0, min(500000.0, span_meters))
        # RequestShape.span varies the number within +/-0.2%.
        pb = re.sub(
            r"!1d[0-9.]+", lambda _: f"!1d{span * (1 + random.uniform(-0.002, 0.002))}", pb, count=1
        )
        page = re.search(r"!7i(\d+)", pb)
        page_size = int(page.group(1)) if page else None
        if offset:
            if page_size is None or page_size <= 0:
                raise ApiError(
                    "calibration_invalid", "Cannot paginate without a calibrated page-size token"
                )
            pb = re.sub(r"!7i\d+", lambda match: match.group() + f"!8i{offset}", pb, count=1)
        return pb, page_size

    async def _get(self, key, default, parameters):
        endpoint = self.calibration.get(key) or default
        parts = urlsplit(endpoint)
        params = dict(parse_qsl(parts.query, keep_blank_values=True))
        params.update(parameters)
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
        return await self.client.get_text(url, params=params)

    def _validate(self, query, latitude, longitude, span_meters=25000, offset=0):
        if not isinstance(query, str) or not query.strip():
            raise ApiError("invalid_query", "A non-empty query/name is required", status_code=422)
        if not _valid_location(latitude, longitude):
            raise ApiError(
                "invalid_coordinates",
                "Latitude/longitude must be finite and within geographic bounds",
                status_code=422,
            )
        if (
            not math.isfinite(span_meters)
            or span_meters <= 0
            or isinstance(offset, bool)
            or not isinstance(offset, int)
            or offset < 0
        ):
            raise ApiError(
                "invalid_search_parameters",
                "span_meters must be positive and offset a non-negative integer",
                status_code=422,
            )

    async def search(
        self,
        query: str,
        latitude: float,
        longitude: float,
        span_meters: float = 25000,
        offset: int = 0,
        language: str = "en",
        region: str = "us",
    ) -> dict:
        self._validate(query, latitude, longitude, span_meters, offset)
        query = query.strip()
        hl, lang = self._language(language)
        pb, page_size = self._search_pb(query, latitude, longitude, span_meters, offset)
        raw = await self._get(
            "searchEndpoint",
            "https://www.google.com/search?tbm=map&authuser=0&hl=en&gl=us",
            {"q": query, "pb": pb, "hl": hl, "gl": region.lower()},
        )
        result = self._parse(query, parse_json(raw), (latitude, longitude), lang)
        # A continuation hint is not proof of complete search coverage.
        result["next_offset"] = (
            offset + page_size
            if page_size and not result["focused_single"] and len(result["places"]) >= page_size
            else None
        )
        result["completeness"] = "unknown"
        return result

    async def details(
        self,
        place_id: str,
        name: str,
        latitude: float,
        longitude: float,
        address: str | None = None,
        language: str = "en",
        region: str = "us",
    ) -> dict:
        self._validate(name, latitude, longitude)
        if not isinstance(place_id, str) or not place_id.strip():
            raise ApiError(
                "invalid_place_id", "A feature ID or Google place ID is required", status_code=422
            )
        query = f"{name} {(address or '').replace(',', ' ')}".strip()
        hl, lang = self._language(language)
        pb, _ = self._search_pb(query, latitude, longitude, 25000, 0)
        raw = await self._get(
            "searchEndpoint",
            "https://www.google.com/search?tbm=map&authuser=0&hl=en&gl=us",
            {"q": query, "pb": pb, "hl": hl, "gl": region.lower()},
        )
        # No proximity re-ranking; details retains focused response order.
        result = self._parse(query, parse_json(raw), None, lang)
        identifier = place_id.strip()
        matched = next(
            (p for p in result["places"] if identifier in (p["feature_id"], p["place_id"])), None
        )
        if matched is None:
            raise ApiError(
                "place_identity_not_found",
                "The focused query did not return the requested provider ID; no neighbor's fields were returned",
                status_code=404,
                details={"requested_id": identifier},
            )
        return {**matched, "completeness": "unknown"}

    async def suggest(
        self,
        query: str,
        latitude: float,
        longitude: float,
        span_meters: float = 20000,
        language: str = "en",
        region: str = "us",
    ) -> dict:
        self._validate(query, latitude, longitude, span_meters)
        hl, _ = self._language(language)
        pb = self.calibration.get("suggestPb") or _SUGGEST_PB
        substitutions = {
            "SPAN": str(max(2000.0, min(500000.0, span_meters))),
            "LAT": str(latitude),
            "LNG": str(longitude),
            "W": "1024",
            "H": "768",
        }
        for key, value in substitutions.items():
            pb = pb.replace("{" + key + "}", value)
        self._ech += 1
        raw = await self._get(
            "suggestEndpoint",
            "https://www.google.com/s?tbm=map&gs_ri=maps&suggest=p&authuser=0&hl=en&gl=us",
            {"q": query, "pb": pb, "tch": "1", "ech": self._ech, "hl": hl, "gl": region.lower()},
        )
        # Google emits a comment tail and may append a second object. Like Vela,
        # decode ONLY the first object; a bare array is not the /s envelope.
        try:
            start = raw.index("{")
            envelope, _ = json.JSONDecoder().raw_decode(raw, start)
            payload = envelope.get("d") if isinstance(envelope, dict) else None
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            raise ApiError(
                "upstream_shape_changed", "Autocomplete first-object envelope is missing"
            ) from error
        if not isinstance(payload, str) or not payload:
            raise ApiError("upstream_shape_changed", "Autocomplete envelope has no d payload")
        root = parse_json(payload)
        paths = self.suggest_paths
        places, queries = [], []
        for row in _list(at(root, *paths["rows"])):
            block = next(
                (
                    el
                    for el in _list(row)
                    if isinstance(el, list)
                    and isinstance(at(el, 0), list)
                    and isinstance(at(el, 0, 0), str)
                ),
                None,
            )
            if block is None:
                continue

            def field(key):
                return at(block, *paths[key])

            title = field("title")
            if not isinstance(title, str) or not title.strip():
                continue
            primary, secondary = field("primary"), field("secondary")
            primary = primary if isinstance(primary, str) and primary.strip() else title
            secondary = secondary if isinstance(secondary, str) and secondary.strip() else None
            lat, lng = number(field("lat")), number(field("lng"))
            if lat is None:
                lat = number(field("lat2"))
            if lng is None:
                lng = number(field("lng2"))
            if lat is None or lng is None:
                queries.append(title)
                continue
            if not _valid_location(lat, lng):
                continue
            fid = field("featureId")
            fid = fid if isinstance(fid, str) and _FEATURE_ID.fullmatch(fid) else None
            places.append(
                {
                    "id": fid or f"suggest:{lat:.5f},{lng:.5f}",
                    "feature_id": fid,
                    "place_id": None,
                    "name": primary,
                    "address": secondary if secondary != primary else None,
                    "location": {"latitude": lat, "longitude": lng},
                }
            )
        return {"query": query, "places": places, "queries": queries, "completeness": "unknown"}
