"""Precompute sea connection display corridors from the project's recorded ports.

Run with the backend Python environment from the repository root. No sources are
downloaded. Reuses prior results only when the full shoreline fingerprint and
exact terminal endpoint pair still match; --force recomputes every pair.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.data.national_transport import merge_national_boarding_points  # noqa: E402
from app.planning.transport import terminal_catalogue  # noqa: E402
from app.planning.water_corridor import (  # noqa: E402
    CORRIDOR_MODEL_VERSION,
    CORRIDOR_QUALIFICATION,
    CORRIDOR_SOURCE,
    WaterCorridorPlanner,
)

OUTPUT = ROOT / "data/public/sea-corridors.json"


def read(path: Path, default: Any = None) -> Any:
    return json.loads(path.read_text("utf8")) if path.exists() else default


def shoreline_fingerprint(islands: dict[str, Any]) -> str:
    geometry = {identity: feature["geometry"] for identity, feature in islands.items()}
    content = json.dumps(geometry, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(content).hexdigest()


def endpoint(item: dict[str, Any]) -> tuple[str, tuple[float, float]]:
    return item["island_id"], tuple(item["coordinates"])


def pair_key(first: dict[str, Any], second: dict[str, Any]) -> tuple:
    return tuple(sorted((endpoint(first), endpoint(second))))


def prepare(root: Path = ROOT, *, force: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
    started = time.perf_counter()
    public = root / "data/public"
    normalized = root / "backend/data/cache/normalized"
    features = read(normalized / "islands.geojson")["features"]
    islands = {item["properties"]["id"]: item for item in features}
    fingerprint = shoreline_fingerprint(islands)
    transport = read(normalized / "transport.json", {"features": []})
    transport["features"] = merge_national_boarding_points(
        transport["features"], read(public / "national-planning-infrastructure.json", {})
    )
    marine = read(root / "backend/data/cache/graphs/marine.json", {"nodes": []})
    catalogue = terminal_catalogue(
        SimpleNamespace(islands_by_id=islands, transport=transport),
        SimpleNamespace(marine=marine),
        public,
    )
    routes = read(public / "sea-services.json")["routes"]
    pairs = {}
    for route in routes:
        stops = route.get("stops", [])
        for first, second in zip(stops, stops[1:]):
            a, b = catalogue.get(first.get("terminal_id")), catalogue.get(second.get("terminal_id"))
            if (
                not a
                or not b
                or a["island_id"] != first.get("island_id")
                or b["island_id"] != second.get("island_id")
                or a["island_id"] == b["island_id"]
            ):
                continue
            key = pair_key(a, b)
            pairs[key] = (a, b) if endpoint(a) == key[0] else (b, a)
    prior = read(public / OUTPUT.name, {})
    cached = {}
    if (
        not force
        and prior.get("schema_version") == 1
        and (
            prior.get("shoreline_fingerprint") == fingerprint
            and prior.get("geometry_source") == CORRIDOR_SOURCE
            and prior.get("corridor_model_version") in {1, CORRIDOR_MODEL_VERSION}
        )
    ):
        cached = {
            pair_key(item["first"], item["second"]): item["corridor"]
            for item in prior.get("segments", [])
            if item["corridor"] is not None
            or prior["corridor_model_version"] == CORRIDOR_MODEL_VERSION
        }
    planner = WaterCorridorPlanner(islands)
    segments, reused = [], 0
    for key, (first, second) in sorted(pairs.items()):
        if key in cached:
            corridor = cached[key]
            reused += 1
        else:
            corridor = planner.corridor(first, second)
        segments.append(
            {
                "first": {"island_id": first["island_id"], "coordinates": first["coordinates"]},
                "second": {"island_id": second["island_id"], "coordinates": second["coordinates"]},
                "corridor": corridor,
            }
        )
    summary = {
        "source_routes": len(routes),
        "unique_terminal_pairs": len(segments),
        "available_corridors": sum(item["corridor"] is not None for item in segments),
        "unavailable_corridors": sum(item["corridor"] is None for item in segments),
    }
    artifact = {
        "schema_version": 1,
        "corridor_model_version": CORRIDOR_MODEL_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "geometry_source": CORRIDOR_SOURCE,
        "qualification": CORRIDOR_QUALIFICATION,
        "shoreline_fingerprint": fingerprint,
        "input_paths": {
            "shorelines": "backend/data/cache/normalized/islands.geojson",
            "services": "data/public/sea-services.json",
            "terminal_catalogue": "data/public/policy-evidence/ferry-terminals.json",
        },
        "summary": summary,
        "segments": segments,
    }
    profile = {
        **summary,
        "reused_corridors": reused,
        "computed_corridors": len(segments) - reused,
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    return artifact, profile


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    artifact, profile = prepare(force=args.force)
    OUTPUT.write_text(
        json.dumps(artifact, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n",
        encoding="utf8",
    )
    print(json.dumps(profile, indent=2))
