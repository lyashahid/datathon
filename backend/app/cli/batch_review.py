"""Prepare, validate, and merge batched facility reconciliation work.

The worker doing web research remains human/evidence-oriented. This module automates
repeatable mechanics: queue selection, strict result validation, live OSM checks,
canonical artifact merging, and optional rebuilds.
"""

from __future__ import annotations

import argparse
import difflib
import gzip
import hashlib
import http.client
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from shapely.geometry import Point, shape
    from shapely.strtree import STRtree
except ImportError:  # pragma: no cover - dependency is in project metadata
    Point = shape = STRtree = None

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
NORMALIZED = DATA / "cache" / "normalized"
REVIEW = DATA / "review"
BATCH_DIR = REVIEW / "batches"
OVERPASS_DIR = DATA / "cache" / "raw" / "osm" / "overpass"
NOMINATIM_DIR = DATA / "cache" / "raw" / "osm" / "nominatim"
OVERPASS_PROVIDERS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
OSM_ID_RE = re.compile(r"^osm:(node|way|relation):(\d+)$")
DECISIONS = {
    "reviewed_osm_match",
    "osm_provisional_review_required",
    "rejected_candidate",
    "unresolved",
    "island_context_only",
    "source_not_in_osm",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def official_url(facility: dict[str, Any]) -> str:
    attrs = facility.get("attributes") or {}
    if facility.get("category") == "school":
        ident = (
            attrs.get("school_id") or attrs.get("establishment_id") or facility["id"].split(":")[-1]
        )
        return f"https://www.moe.gov.mv/en/schools/{ident}"
    return "https://hems.health.gov.mv/establishments"


def known_review_ids() -> set[str]:
    known: set[str] = set()
    for path in REVIEW.glob("online-facility-review-batch-*.json"):
        payload = read_json(path, {})
        for batch in payload.get("batches", []):
            known.update(batch.get("facility_ids", []))
        known.update(payload.get("facility_ids", []))
    for path in REVIEW.glob("batches/*.queue.json"):
        payload = read_json(path, {})
        if payload.get("status") in {"completed", "superseded"}:
            continue
        for job in payload.get("jobs", []):
            known.update(job.get("facility_ids", []))
    for name in ("online-facility-evidence.json", "online-provisional-facility-mappings.json"):
        for row in (read_json(REVIEW / name, {}) or {}).get("records", []):
            if row.get("facility_id"):
                known.add(row["facility_id"])
    return known


def load_unresolved() -> list[dict[str, Any]]:
    ledger = read_json(REVIEW / "facility-reconciliation-ledger.json", {})
    return [row for row in ledger.get("records", []) if not row.get("osm_object_id")]


def make_packet(facility: dict[str, Any]) -> dict[str, Any]:
    context = facility.get("location_context") or {}
    attrs = facility.get("attributes") or {}
    return {
        "facility_id": facility["id"],
        "official_name": facility.get("name"),
        "category": facility.get("category"),
        "official_source_url": official_url(facility),
        "official_island": context.get("island_name"),
        "official_atoll": context.get("proposed_atoll"),
        "official_island_id": facility.get("island_id"),
        "official_attributes": {
            key: attrs.get(key)
            for key in (
                "address",
                "island",
                "island_text",
                "owner",
                "operator",
                "status",
                "facility_level",
            )
            if attrs.get(key) is not None
        },
        "current_status": facility.get("match_status"),
    }


def prepare(args: argparse.Namespace) -> int:
    facilities = read_json(NORMALIZED / "facilities.json", [])
    unresolved_ids = {x["facility_id"] for x in load_unresolved()}
    known = known_review_ids()
    candidates = [f for f in facilities if f["id"] in unresolved_ids and f["id"] not in known]
    priority = {name: index for index, name in enumerate(args.categories)}
    candidates.sort(key=lambda f: (priority.get(f.get("category"), len(priority)), f["id"]))
    selected = candidates[: args.batch_size * args.batches]
    batch_id = args.batch_id or datetime.now().strftime("batch-%Y%m%d-%H%M%S")
    queue = {
        "version": "facility-review-queue-v1",
        "created_at": utc_now(),
        "batch_id": batch_id,
        "batch_size": args.batch_size,
        "known_review_count": len(known),
        "available_unresolved_count": len(candidates),
        "jobs": [],
    }
    for index in range(0, len(selected), args.batch_size):
        job_records = [make_packet(f) for f in selected[index : index + args.batch_size]]
        job_id = f"{batch_id}-{index // args.batch_size + 1:02d}"
        prompt = build_prompt(job_id, job_records)
        prompt_path = BATCH_DIR / f"{job_id}.prompt.md"
        prompt_path.parent.mkdir(parents=True, exist_ok=True)
        prompt_path.write_text(prompt, encoding="utf-8")
        queue["jobs"].append(
            {
                "job_id": job_id,
                "facility_ids": [x["facility_id"] for x in job_records],
                "records": job_records,
                "prompt": str(prompt_path),
            }
        )
    output = BATCH_DIR / f"{batch_id}.queue.json"
    write_json(output, queue)
    print(
        json.dumps(
            {
                "queue": str(output),
                "jobs": len(queue["jobs"]),
                "records": len(selected),
                "remaining_unqueued": len(candidates) - len(selected),
            },
            indent=2,
        )
    )
    return 0


def build_prompt(job_id: str, records: list[dict[str, Any]]) -> str:
    return f"""# Facility reconciliation worker packet: {job_id}

Return JSON only with this shape:

```json
{{
  "job_id": "{job_id}",
  "records": [
    {{
      "facility_id": "facility:...",
    "decision": "reviewed_osm_match|osm_provisional_review_required|rejected_candidate|unresolved|"
      "island_context_only|source_not_in_osm",
      "confidence": "high|medium-high|medium|low",
      "official_source_url": "https://...",
      "discovery_urls": ["https://..."],
      "osm_candidates": [
        {{
          "osm_object_id": "osm:node:123",
          "name": "...",
          "tags": {{}},
          "coordinates": [73.5, 4.1],
          "island": "...",
          "osm_url": "https://www.openstreetmap.org/node/123",
          "status": "live"
        }}
      ],
      "evidence_note": "...",
      "follow_up": "..."
    }}
  ],
  "summary": "..."
}}
```

Rules: official sources have priority; verify promoted OSM IDs live; require island agreement;
 do not map generic buildings, resorts, pharmacies, roads, island polygons, or nearby unrelated
 facilities; keep weak candidates provisional; never invent geometry; return every input facility
 exactly once.

## Input records

{json.dumps(records, ensure_ascii=False, indent=2)}
"""


def normalize_name(value: Any) -> str:
    normalized = re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()
    return re.sub(r"\bcentre\b", "center", normalized)


def parse_osm_id(value: str) -> tuple[str, str] | None:
    match = OSM_ID_RE.match(str(value or ""))
    return (match.group(1), match.group(2)) if match else None


def geometry_bounds(geometry: dict[str, Any]) -> tuple[float, float, float, float] | None:
    points: list[tuple[float, float]] = []

    def visit(value: Any) -> None:
        if (
            isinstance(value, list)
            and len(value) >= 2
            and all(isinstance(item, (int, float)) for item in value[:2])
        ):
            points.append((float(value[0]), float(value[1])))
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(geometry.get("coordinates"))
    if not points:
        return None
    lons, lats = zip(*points)
    return min(lons), min(lats), max(lons), max(lats)


def island_bboxes() -> dict[str, tuple[float, float, float, float]]:
    payload = read_json(NORMALIZED / "islands.geojson", {"features": []})
    result = {}
    for feature in payload.get("features", []):
        props = feature.get("properties") or {}
        island_id = props.get("id")
        bounds = geometry_bounds(feature.get("geometry") or {})
        if island_id and bounds:
            result[island_id] = bounds
            result[
                f"name:{normalize_name(props.get('name'))}|{normalize_name(props.get('atoll'))}"
            ] = bounds
    return result


def overpass_query_for_bbox(bounds: tuple[float, float, float, float]) -> str:
    min_lon, min_lat, max_lon, max_lat = bounds
    bbox = f"{min_lat:.7f},{min_lon:.7f},{max_lat:.7f},{max_lon:.7f}"
    return (
        "[out:json][timeout:30];("
        f'nwr["amenity"~"^(hospital|clinic|doctors|school|pharmacy)$"]({bbox});'
        f'nwr["healthcare"]({bbox});'
        f'nwr["office"="educational_institution"]({bbox});'
        f'nwr["building"~"^(hospital|clinic|school)$"]({bbox});'
        ");out center tags;"
    )


def cached_overpass(query: str, ttl_seconds: int = 86400) -> dict[str, Any]:
    canonical = " ".join(query.split())
    query_hash = hashlib.sha256(canonical.encode()).hexdigest()
    data_path = OVERPASS_DIR / f"{query_hash}.json.gz"
    meta_path = OVERPASS_DIR / f"{query_hash}.meta.json"
    if data_path.exists() and meta_path.exists():
        meta = read_json(meta_path, {})
        if time.time() - data_path.stat().st_mtime < ttl_seconds:
            with gzip.open(data_path, "rt", encoding="utf-8") as handle:
                return {
                    "query_hash": query_hash,
                    "cached": True,
                    "metadata": meta,
                    "data": json.load(handle),
                }
    OVERPASS_DIR.mkdir(parents=True, exist_ok=True)
    last_error = None
    for provider in OVERPASS_PROVIDERS:
        request = urllib.request.Request(
            provider,
            data=canonical.encode(),
            headers={
                "User-Agent": "MobilitySandboxMV/0.1 (public OSM validation)",
                "Accept": "application/json",
                "Content-Type": "text/plain; charset=utf-8",
            },
            method="POST",
        )
        for attempt in range(2):
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    raw = response.read()
                    payload = json.loads(raw)
                    metadata = {
                        "provider": provider,
                        "query_sha256": query_hash,
                        "retrieved_at": utc_now(),
                        "http_status": response.status,
                        "content_encoding": response.headers.get("Content-Encoding"),
                        "response_sha256": hashlib.sha256(raw).hexdigest(),
                        "expires_at": datetime.fromtimestamp(
                            time.time() + ttl_seconds, timezone.utc
                        ).isoformat(),
                    }
                    with gzip.open(data_path, "wt", encoding="utf-8") as handle:
                        json.dump(payload, handle, ensure_ascii=False)
                    write_json(meta_path, metadata)
                    return {
                        "query_hash": query_hash,
                        "cached": False,
                        "metadata": metadata,
                        "data": payload,
                    }
            except (
                urllib.error.HTTPError,
                urllib.error.URLError,
                http.client.RemoteDisconnected,
                ConnectionResetError,
                TimeoutError,
                ValueError,
                OSError,
            ) as exc:
                last_error = str(exc)
                if isinstance(exc, urllib.error.HTTPError) and exc.code == 400:
                    break
                if attempt == 0:
                    time.sleep(1.5)
    return {
        "query_hash": query_hash,
        "cached": False,
        "metadata": {"error": last_error},
        "data": {"elements": []},
    }


def nominatim_search(
    row: dict[str, Any],
    bounds: tuple[float, float, float, float],
    last_request_at: float,
) -> tuple[dict[str, Any], float]:
    wait = 1.0 - (time.monotonic() - last_request_at)
    if wait > 0:
        time.sleep(wait)
    min_lon, min_lat, max_lon, max_lat = bounds
    query = ", ".join(
        value
        for value in (
            row.get("official_name"),
            row.get("official_island"),
            row.get("official_atoll"),
            "Maldives",
        )
        if value
    )
    params = {
        "q": query,
        "format": "jsonv2",
        "addressdetails": "1",
        "namedetails": "1",
        "limit": "10",
        "viewbox": f"{min_lon:.7f},{max_lat:.7f},{max_lon:.7f},{min_lat:.7f}",
        "bounded": "1",
    }
    canonical = urllib.parse.urlencode(sorted(params.items()))
    query_hash = hashlib.sha256(canonical.encode()).hexdigest()
    data_path = NOMINATIM_DIR / f"{query_hash}.json"
    meta_path = NOMINATIM_DIR / f"{query_hash}.meta.json"
    if data_path.exists() and meta_path.exists():
        return {
            "query_hash": query_hash,
            "cached": True,
            "query": params,
            "metadata": read_json(meta_path, {}),
            "data": read_json(data_path, []),
        }, time.monotonic()
    NOMINATIM_DIR.mkdir(parents=True, exist_ok=True)
    url = "https://nominatim.openstreetmap.org/search?" + canonical
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "MobilitySandboxMV/1.0 (public OSM search)",
            "Accept": "application/json",
        },
    )
    metadata: dict[str, Any] = {
        "provider": "https://nominatim.openstreetmap.org/search",
        "query_sha256": query_hash,
        "retrieved_at": utc_now(),
        "url": url,
    }
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            payload = json.loads(raw)
            metadata.update(
                {
                    "http_status": response.status,
                    "response_sha256": hashlib.sha256(raw).hexdigest(),
                }
            )
            write_json(data_path, payload)
            write_json(meta_path, metadata)
            return {
                "query_hash": query_hash,
                "cached": False,
                "query": params,
                "metadata": metadata,
                "data": payload,
            }, time.monotonic()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
        metadata.update({"http_status": getattr(exc, "code", None), "error": str(exc)})
        return {
            "query_hash": query_hash,
            "cached": False,
            "query": params,
            "metadata": metadata,
            "data": [],
        }, time.monotonic()


def query_osm(args: argparse.Namespace) -> int:
    queue = read_json(Path(args.queue), {})
    wanted = {
        row["facility_id"]: row
        for job in queue.get("jobs", [])
        if not args.job or job["job_id"] == args.job
        for row in job.get("records", [])
    }
    boxes = island_bboxes()
    island_keys: dict[str, list[str]] = {}
    for facility_id, row in wanted.items():
        island_id = row.get("official_island_id")
        key = island_id or (
            f"name:{normalize_name(row.get('official_island'))}|"
            f"{normalize_name(row.get('official_atoll'))}"
        )
        island_keys.setdefault(key, []).append(facility_id)
    output = BATCH_DIR / f"{args.job or queue.get('batch_id', 'queue')}.osm-query.json"
    existing = read_json(output, {})
    results_by_island = {
        item.get("island_key"): item
        for item in existing.get("results", [])
        if item.get("island_key")
    }
    results = []
    last_nominatim_request = 0.0
    for island_key, facility_ids in sorted(island_keys.items()):
        if (
            island_key in results_by_island
            and set(results_by_island[island_key].get("facility_ids", [])) == set(facility_ids)
            and "overpass" in results_by_island[island_key]
            and "nominatim" in results_by_island[island_key]
        ):
            results.append(results_by_island[island_key])
            continue
        bounds = boxes.get(island_key)
        if not bounds:
            continue
        query = overpass_query_for_bbox(bounds)
        response = cached_overpass(query)
        nominatim_results = {}
        for facility_id in facility_ids:
            nominatim_results[facility_id], last_nominatim_request = nominatim_search(
                wanted[facility_id], bounds, last_nominatim_request
            )
        results.append(
            {
                "island_key": island_key,
                "facility_ids": facility_ids,
                "query": query,
                "overpass": response,
                "nominatim": nominatim_results,
            }
        )
        write_json(
            output,
            {
                "version": "facility-osm-query-v1",
                "queried_at": utc_now(),
                "record_count": len(wanted),
                "island_query_count": len(results),
                "results": results,
            },
        )
    write_json(
        output,
        {
            "version": "facility-osm-query-v1",
            "queried_at": utc_now(),
            "record_count": len(wanted),
            "island_query_count": len(results),
            "results": results,
        },
    )
    print(
        json.dumps(
            {
                "output": str(output),
                "records": len(wanted),
                "island_queries": len(results),
                "overpass_cached": sum(x["overpass"].get("cached", False) for x in results),
                "nominatim_searches": sum(len(x["nominatim"]) for x in results),
                "nominatim_cached": sum(
                    result.get("cached", False)
                    for island in results
                    for result in island["nominatim"].values()
                ),
            },
            indent=2,
        )
    )
    return 0


def element_coordinates(element: dict[str, Any]) -> list[float] | None:
    if element.get("type") == "node" and element.get("lon") is not None:
        return [float(element["lon"]), float(element["lat"])]
    center = element.get("center") or {}
    if center.get("lon") is not None and center.get("lat") is not None:
        return [float(center["lon"]), float(center["lat"])]
    return None


def element_candidate(element: dict[str, Any], island: str) -> dict[str, Any] | None:
    coordinates = element_coordinates(element)
    if not coordinates:
        return None
    tags = element.get("tags") or {}
    object_id = f"osm:{element.get('type')}:{element.get('id')}"
    name = tags.get("name") or tags.get("name:en") or tags.get("alt_name")
    return {
        "osm_object_id": object_id,
        "osm_url": f"https://www.openstreetmap.org/{element.get('type')}/{element.get('id')}",
        "name": name or "",
        "island": island,
        "coordinates": coordinates,
        "tags": tags,
        "status": "discovered_overpass",
    }


def candidate_name_score(official_name: str, candidate_name: str) -> tuple[float, bool]:
    official = normalize_name(official_name)
    candidate = normalize_name(candidate_name)
    if not official or not candidate:
        return 0.0, False
    candidate_tokens = set(candidate.split())
    generic_name_words = {
        "center",
        "centre",
        "clinic",
        "doctor",
        "doctors",
        "health",
        "healthcare",
        "hospital",
        "kindergarten",
        "medical",
        "pharmacy",
        "post",
        "preschool",
        "school",
    }
    if candidate_tokens and candidate_tokens <= generic_name_words:
        return difflib.SequenceMatcher(None, official, candidate).ratio(), False
    if official == candidate:
        return 1.0, True
    if official in candidate or candidate in official:
        return 0.92, True
    official_tokens = set(official.split())
    category_words = {
        "health",
        "center",
        "school",
        "hospital",
        "clinic",
        "doctor",
        "education",
        "atoll",
    }
    specific_overlap = (official_tokens - category_words) & (candidate_tokens - category_words)
    ratio = difflib.SequenceMatcher(None, official, candidate).ratio()
    return ratio, bool(specific_overlap)


def auto_category_compatible(category: str, tags: dict[str, Any], candidate_name: str) -> bool:
    if category_compatible(category, tags):
        return True
    normalized_category = category.lower().replace("_", " ")
    if normalized_category in {"health center", "health centre"}:
        return tags.get("healthcare") == "yes" and bool(candidate_name)
    if normalized_category == "school":
        return tags.get("office") == "educational_institution" and bool(candidate_name)
    return False


def deterministic_candidate_score(
    facility: dict[str, Any], candidate: dict[str, Any]
) -> tuple[float, bool]:
    category = facility.get("category", "")
    tags = candidate.get("tags") or {}
    compatible = auto_category_compatible(category, tags, candidate.get("name", ""))
    name_score, specific_overlap = candidate_name_score(
        facility.get("official_name", ""), candidate.get("name", "")
    )
    score = name_score * 6.0
    score += 3.0 if compatible else -5.0
    score += 1.0 if candidate.get("name") else 0.0
    return score, compatible and specific_overlap and name_score >= 0.78


def auto_review(args: argparse.Namespace) -> int:
    queue = read_json(Path(args.queue), {})
    query_path = Path(args.query) if args.query else BATCH_DIR / f"{args.job}.osm-query.json"
    query_payload = read_json(query_path, {})
    by_facility: dict[str, list[dict[str, Any]]] = {}
    for island_result in query_payload.get("results", []):
        elements = (
            (island_result.get("overpass") or island_result).get("data", {}).get("elements", [])
        )
        for facility_id in island_result.get("facility_ids", []):
            row = next(
                (
                    record
                    for job in queue.get("jobs", [])
                    for record in job.get("records", [])
                    if record.get("facility_id") == facility_id
                ),
                {},
            )
            by_facility.setdefault(facility_id, []).extend(
                candidate
                for element in elements
                if (candidate := element_candidate(element, row.get("official_island", "")))
            )
    records = []
    for job in queue.get("jobs", []):
        if args.job and job.get("job_id") != args.job:
            continue
        for facility in job.get("records", []):
            candidates = by_facility.get(facility["facility_id"], [])
            compatible_candidates = [
                candidate
                for candidate in candidates
                if auto_category_compatible(
                    facility.get("category", ""),
                    candidate.get("tags") or {},
                    candidate.get("name", ""),
                )
            ]
            scored = sorted(
                (
                    (*deterministic_candidate_score(facility, candidate), candidate)
                    for candidate in compatible_candidates
                ),
                key=lambda item: item[0],
                reverse=True,
            )
            strong = [item for item in scored if item[1]]
            selected = None
            decision = "island_context_only"
            if strong and (len(strong) == 1 or strong[0][0] - strong[1][0] >= 1.0):
                selected = strong[0][2]
                decision = "reviewed_osm_match"
            elif scored:
                decision = "osm_provisional_review_required"
            output_candidates = [selected] if selected else [item[2] for item in scored]
            records.append(
                {
                    "facility_id": facility["facility_id"],
                    "official_name": facility.get("official_name"),
                    "category": facility.get("category"),
                    "official_source_url": facility.get("official_source_url"),
                    "confidence": "high" if selected else "low",
                    "decision": decision,
                    "osm_candidates": output_candidates,
                    "evidence_note": (
                        "Deterministic bounded-OSM pass: candidate matched official name, "
                        "compatible category, and the official island bbox. Live OSM API "
                        "validation is required before merge."
                        if selected
                        else (
                            "Deterministic bounded-OSM pass found no uniquely promotable "
                            "candidate; AI/manual review remains optional."
                        )
                    ),
                    "follow_up": "Live-validate and merge if all checks pass."
                    if selected
                    else "Review candidates or retain unresolved.",
                }
            )
    output = Path(args.output)
    write_json(
        output,
        {
            "job_id": args.job or queue.get("batch_id"),
            "records": records,
            "summary": "deterministic local review",
        },
    )
    print(
        json.dumps(
            {
                "output": str(output),
                "records": len(records),
                "auto_candidates": sum(r["decision"] == "reviewed_osm_match" for r in records),
                "provisional_or_unresolved": sum(
                    r["decision"] != "reviewed_osm_match" for r in records
                ),
            },
            indent=2,
        )
    )
    return 0


def fetch_osm(object_id: str) -> dict[str, Any]:
    parsed = parse_osm_id(object_id)
    if not parsed:
        return {"osm_object_id": object_id, "status": "invalid_id"}
    kind, ident = parsed
    suffix = "/full.json" if kind in {"way", "relation"} else ".json"
    url = f"https://api.openstreetmap.org/api/0.6/{kind}/{ident}{suffix}"
    request = urllib.request.Request(
        url, headers={"User-Agent": "MaldivesMobilitySandbox/1.0 batch-review"}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
            return {
                "osm_object_id": object_id,
                "status": "ok",
                "http_status": response.status,
                "url": url,
                "payload": payload,
            }
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return {"osm_object_id": object_id, "status": "error", "url": url, "error": str(exc)}


def live_tags_and_coordinates(result: dict[str, Any]) -> tuple[dict[str, Any], list[float] | None]:
    elements = (result.get("payload") or {}).get("elements", [])
    if not elements:
        return {}, None
    tags: dict[str, Any] = {}
    points: list[list[float]] = []
    for element in elements:
        tags.update(element.get("tags") or {})
        if element.get("type") == "node" and element.get("lon") is not None:
            points.append([element["lon"], element["lat"]])
    if not points:
        return tags, None
    return tags, [sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)]


def category_compatible(category: str, tags: dict[str, Any]) -> bool:
    category = category.lower().replace("_", " ")
    amenity = str(tags.get("amenity", "")).lower()
    healthcare = str(tags.get("healthcare", "")).lower()
    building = str(tags.get("building", "")).lower()
    if category == "school":
        return amenity == "school" or building == "school"
    if category in {"hospital", "health centre", "health center", "clinic"}:
        return (
            amenity in {"hospital", "clinic", "doctors"}
            or healthcare in {"hospital", "clinic", "doctor"}
            or building in {"hospital", "clinic"}
        )
    return True


def in_maldives(point: list[float] | None) -> bool:
    return bool(point and 72.5 <= point[0] <= 74.8 and -0.9 <= point[1] <= 7.5)


def validate(args: argparse.Namespace) -> int:
    payload = read_json(Path(args.input), {})
    records = payload.get("records", [])
    queue_context: dict[str, dict[str, Any]] = {}
    if args.queue:
        queue = read_json(Path(args.queue), {})
        queue_context = {
            row["facility_id"]: row
            for job in queue.get("jobs", [])
            for row in job.get("records", [])
        }
    if not isinstance(records, list):
        raise SystemExit("input.records must be a list")
    ids = [r.get("facility_id") for r in records]
    errors = []
    if len(ids) != len(set(ids)):
        errors.append("duplicate facility_id in worker result")
    live_ids = []
    selected_counts: dict[str, int] = {}
    for record in records:
        if record.get("decision") not in DECISIONS:
            errors.append(f"{record.get('facility_id')}: invalid decision")
        candidates = record.get("osm_candidates") or []
        if len(candidates) == 1 and candidates[0].get("osm_object_id"):
            object_id = candidates[0]["osm_object_id"]
            selected_counts[object_id] = selected_counts.get(object_id, 0) + 1
        for candidate in candidates:
            if candidate.get("osm_object_id"):
                live_ids.append(candidate["osm_object_id"])
    live = {}
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(fetch_osm, oid): oid for oid in sorted(set(live_ids))}
        for future in as_completed(futures):
            result = future.result()
            live[result["osm_object_id"]] = result
    validated = []
    for record in records:
        candidates = record.get("osm_candidates") or []
        selected = candidates[0] if len(candidates) == 1 else None
        result = live.get(selected.get("osm_object_id")) if selected else None
        tags, derived_point = live_tags_and_coordinates(result or {})
        point = selected.get("coordinates") if selected else None
        point = point or derived_point
        context = queue_context.get(record.get("facility_id"), {})
        official_island = normalize_name(context.get("official_island"))
        candidate_island = normalize_name((selected or {}).get("island"))
        checks = {
            "single_candidate": len(candidates) == 1,
            "live_object": bool(result and result.get("status") == "ok"),
            "maldives_bounds": in_maldives(point),
            "category_compatible": auto_category_compatible(
                record.get("category", ""),
                {**tags, **(selected or {}).get("tags", {})},
                (selected or {}).get("name", "") or tags.get("name", ""),
            ),
            "island_agreement": bool(
                official_island and candidate_island and official_island == candidate_island
            ),
            "unique_selected_object": not (
                selected
                and selected.get("osm_object_id")
                and selected_counts.get(selected["osm_object_id"], 0) > 1
            ),
        }
        decision = record.get("decision")
        approved = decision == "reviewed_osm_match" and all(checks.values())
        validated.append(
            {
                **record,
                "selected_candidate": selected,
                "live_verification": result,
                "derived_tags": tags,
                "derived_coordinates": point,
                "validation": {"checks": checks, "approved": approved},
            }
        )
    output = {
        "version": "facility-review-validated-v1",
        "validated_at": utc_now(),
        "job_id": payload.get("job_id"),
        "errors": errors,
        "records": validated,
    }
    write_json(Path(args.output), output)
    print(
        json.dumps(
            {
                "output": args.output,
                "records": len(records),
                "approved": sum(x["validation"]["approved"] for x in validated),
                "errors": errors,
            },
            indent=2,
        )
    )
    return 1 if errors else 0


def refresh_live_verification() -> None:
    facilities = read_json(NORMALIZED / "facilities.json", [])
    object_ids = sorted({row["osm_object_id"] for row in facilities if row.get("osm_object_id")})
    with ThreadPoolExecutor(max_workers=8) as executor:
        fetched = list(executor.map(fetch_osm, object_ids))
    rows = []
    for result in fetched:
        elements = (result.get("payload") or {}).get("elements", [])
        rows.append(
            {
                "osm_object_id": result["osm_object_id"],
                "url": result.get("url"),
                "http_status": result.get("http_status"),
                "status": result.get("status"),
                "element": elements[0] if elements else None,
                "error": result.get("error"),
            }
        )
    write_json(
        REVIEW / "mapped-osm-live-verification.json",
        {
            "version": "mapped-osm-live-verification-v1",
            "refreshed_at": utc_now(),
            "object_count": len(rows),
            "results": rows,
        },
    )


def append_unique(records: list[dict[str, Any]], value: dict[str, Any], key: str) -> None:
    if not any(row.get(key) == value.get(key) for row in records):
        records.append(value)


def merge(args: argparse.Namespace) -> int:
    payload = read_json(Path(args.input), {})
    records = payload.get("records", [])
    approved = [r for r in records if r.get("validation", {}).get("approved")]
    if not args.apply:
        print(
            json.dumps(
                {
                    "apply_required": True,
                    "approved_records": [r.get("facility_id") for r in approved],
                },
                indent=2,
            )
        )
        return 0
    features = read_json(REVIEW / "online-osm-features.json", {"features": []})
    overrides = read_json(REVIEW / "facility-osm-overrides.json", {"records": []})
    evidence = read_json(REVIEW / "online-facility-evidence.json", {"records": []})
    provisional = read_json(REVIEW / "online-provisional-facility-mappings.json", {"records": []})
    for record in records:
        candidate = record.get("selected_candidate") or {}
        oid = candidate.get("osm_object_id")
        if record.get("validation", {}).get("approved"):
            tags = {**(candidate.get("tags") or {}), **(record.get("derived_tags") or {})}
            coords = record.get("derived_coordinates") or candidate.get("coordinates")
            kind, ident = parse_osm_id(oid) or (None, None)
            if record.get("category") == "school":
                feature_category = "school"
            elif record.get("category") in {"hospital", "health_center", "health centre"}:
                feature_category = "hospital"
            else:
                feature_category = "clinic"
            feature = {
                "id": oid,
                "source_id": ident,
                "object_type": kind,
                "category": feature_category,
                "name": candidate.get("name") or tags.get("name"),
                "tags": tags,
                "geometry": {"type": "Point", "coordinates": coords},
                "geometry_source": "live OSM API batch validator",
                "source": "OpenStreetMap live review",
            }
            append_unique(features["features"], feature, "id")
            append_unique(
                overrides["records"],
                {
                    "facility_id": record["facility_id"],
                    "osm_object_id": oid,
                    "review_note": record.get(
                        "evidence_note", "batch-reviewed and independently live-verified"
                    ),
                },
                "facility_id",
            )
            append_unique(
                evidence["records"],
                {
                    "facility_id": record["facility_id"],
                    "official_name": record.get("official_name"),
                    "category": record.get("category"),
                    "official_source": {
                        "url": record.get("official_source_url"),
                        "accessed_at": utc_now(),
                    },
                    "osm_object_id": oid,
                    "osm_source": {
                        "api_url": (record.get("live_verification") or {}).get("url"),
                        "browse_url": candidate.get("osm_url"),
                        "accessed_at": utc_now(),
                        "name": feature["name"],
                        **tags,
                    },
                    "geometry": feature["geometry"],
                    "decision": "reviewed_osm_match",
                    "confidence": record.get("confidence"),
                    "evidence_note": record.get("evidence_note"),
                },
                "facility_id",
            )
        elif record.get("decision") == "osm_provisional_review_required" and oid:
            append_unique(
                provisional["records"],
                {
                    "facility_id": record["facility_id"],
                    "official_name": record.get("official_name"),
                    "category": record.get("category"),
                    "decision": record.get("decision"),
                    "confidence": record.get("confidence"),
                    "official_sources": [{"url": record.get("official_source_url")}],
                    "osm_object": candidate,
                    "geometry_source": "batch worker candidate; independently fetched",
                    "evidence_note": record.get("evidence_note"),
                },
                "facility_id",
            )
    if not approved and not args.allow_empty:
        raise SystemExit("no validated promotions; use --allow-empty to write a no-op manifest")
    stamp = utc_now()
    for obj in (features, overrides, evidence, provisional):
        obj["reviewed_at"] = stamp
    write_json(REVIEW / "online-osm-features.json", features)
    write_json(REVIEW / "facility-osm-overrides.json", overrides)
    write_json(REVIEW / "online-facility-evidence.json", evidence)
    write_json(REVIEW / "online-provisional-facility-mappings.json", provisional)
    manifest = {
        "version": "online-facility-review-batch-v2",
        "reviewed_at": stamp,
        "batch_id": payload.get("job_id"),
        "facility_ids": [r.get("facility_id") for r in records],
        "confirmed_promotions": [r.get("facility_id") for r in approved],
        "provisional_candidates": [
            r.get("facility_id")
            for r in records
            if r.get("decision") == "osm_provisional_review_required"
        ],
    }
    write_json(
        REVIEW / f"online-facility-review-batch-{payload.get('job_id', 'manual')}.json", manifest
    )
    if args.rebuild:
        env = {
            **__import__("os").environ,
            "OPENBLAS_NUM_THREADS": "1",
            "OMP_NUM_THREADS": "1",
            "MKL_NUM_THREADS": "1",
        }
        commands = [
            [sys.executable, "-m", "app.cli", "prewarm", "--offline"],
            [sys.executable, "data/review/build_facility_audit.py"],
            [sys.executable, "data/review/rebuild_reconciliation_artifacts.py"],
        ]
        subprocess.run(commands[0], cwd=ROOT, env=env, check=True)
        refresh_live_verification()
        for command in commands[1:]:
            subprocess.run(command, cwd=ROOT, env=env, check=True)
    print(
        json.dumps(
            {
                "merged_confirmed": len(approved),
                "merged_provisional": sum(
                    r.get("decision") == "osm_provisional_review_required" for r in records
                ),
                "rebuild": args.rebuild,
            },
            indent=2,
        )
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="batch-review")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--batch-size", type=int, default=10)
    p.add_argument("--batches", type=int, default=4)
    p.add_argument("--batch-id")
    p.add_argument(
        "--categories",
        nargs="+",
        default=["health_center", "school", "hospital", "clinic", "airport"],
    )
    p.set_defaults(func=prepare)
    p = sub.add_parser("validate")
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--queue", help="queue JSON used to independently check official island context")
    p.set_defaults(func=validate)
    p = sub.add_parser(
        "query", help="discover facility-relevant OSM objects with bounded Overpass queries"
    )
    p.add_argument("--queue", required=True)
    p.add_argument("--job", help="query only one prepared job")
    p.set_defaults(func=query_osm)
    p = sub.add_parser(
        "auto-review", help="deterministic local OSM candidate pass; no AI agent required"
    )
    p.add_argument("--queue", required=True)
    p.add_argument("--job", required=True)
    p.add_argument("--query", help="bounded OSM query artifact; defaults to <job>.osm-query.json")
    p.add_argument("--output", required=True)
    p.set_defaults(func=auto_review)
    p = sub.add_parser("merge")
    p.add_argument("--input", required=True)
    p.add_argument("--apply", action="store_true")
    p.add_argument("--rebuild", action="store_true")
    p.add_argument("--allow-empty", action="store_true")
    p.set_defaults(func=merge)
    args = parser.parse_args(argv)
    return args.func(args)
