"""Compare actual GeoJSON encoding paths without network or fixture substitution.

Run from backend: python -m scripts.benchmark_responses --output docs/response-benchmark.json
Results are local wall times, not deployment latency guarantees.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from statistics import median
from time import perf_counter

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.gzip import GZipMiddleware

from app.api.repository import NormalizedRepository
from app.api.routes.national import router
from app.config.settings import Settings


def benchmark(repetitions: int = 3) -> dict:
    repository = NormalizedRepository(Settings().data_dir)
    repository.reload()
    baseline = FastAPI()

    @baseline.get("/api/v1/map/features")
    def baseline_features():
        # Previous endpoint shape: FastAPI recursively calls jsonable_encoder.
        return repository.map_features()

    optimized = FastAPI()
    optimized.state.repository = repository
    optimized.include_router(router)
    optimized.add_middleware(GZipMiddleware, minimum_size=2048, compresslevel=5)
    measurements = {}
    expected_sha = None
    for name, app, encoding in (
        ("previous_dict_response", baseline, "identity"),
        ("explicit_json_response", optimized, "identity"),
        ("explicit_json_response_gzip", optimized, "gzip"),
    ):
        durations = []
        with TestClient(app) as client:
            # Exclude the first worker/thread initialization from every path.
            client.get("/api/v1/map/features", headers={"accept-encoding": encoding})
            for _ in range(repetitions):
                started = perf_counter()
                response = client.get("/api/v1/map/features", headers={"accept-encoding": encoding})
                durations.append(perf_counter() - started)
                response.raise_for_status()
                digest = hashlib.sha256(response.content).hexdigest()
                if expected_sha is None:
                    expected_sha = digest
                if digest != expected_sha:
                    raise AssertionError("GeoJSON content changed between response paths")
        measurements[name] = {
            "seconds": durations,
            "median_seconds": median(durations),
            "json_bytes": len(response.content),
            "wire_bytes": int(response.headers["content-length"]),
            "sha256": digest,
            "feature_count": response.json()["summary"]["feature_count"],
        }
    before = measurements["previous_dict_response"]
    after = measurements["explicit_json_response"]
    compressed = measurements["explicit_json_response_gzip"]
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "method": (
            "Same installed repository, same GeoJSON bytes, local TestClient, one warm-up "
            "plus repeated complete response reads. Baseline reproduces the previous dict "
            "return; optimized uses the current national router. HTTPX decompresses gzip "
            "before its content hash is checked."
        ),
        "repetitions": repetitions,
        "measurements": measurements,
        "encoding_speedup": before["median_seconds"] / after["median_seconds"],
        "wire_reduction_percent": (1 - compressed["wire_bytes"] / before["wire_bytes"]) * 100,
        "qualification": (
            "CPU/content comparisons on this machine, not external-provider or browser "
            "latency. The frontend proxy currently decompresses the backend response, "
            "so compression saves transfer on the backend hop or direct API calls."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 1 <= args.repetitions <= 20:
        parser.error("Use 1–20 repetitions")
    result = benchmark(args.repetitions)
    encoded = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    main()
