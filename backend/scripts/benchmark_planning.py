"""Measure exact shipped-data impact evaluation and optionally compare a Git revision.

Run from the repository root with backend/.venv/Scripts/python.exe
backend/scripts/benchmark_planning.py --reference-ref <prior-commit>.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import platform
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path
from time import perf_counter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.planning.models import PlanningRequest  # noqa: E402
from app.planning.repository import PlanningRepository  # noqa: E402
from app.planning.service import PlanningService  # noqa: E402


def reference_service(ref: str, directory: Path):
    """Load only trusted local Git source into isolated module names."""
    for name in ("routing", "service"):
        source = subprocess.check_output(
            ["git", "show", f"{ref}:backend/app/planning/{name}.py"],
            cwd=ROOT,
            text=True,
            encoding="utf8",
        )
        if name == "service":
            source = source.replace(
                "from app.planning.routing import", "from _reference_routing import"
            )
        path = directory / f"{name}.py"
        path.write_text(source, encoding="utf8")
        spec = importlib.util.spec_from_file_location(f"_reference_{name}", path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    return module.PlanningService


def timed(service, request, iterations):
    samples = []
    result = None
    for _ in range(iterations):
        start = perf_counter()
        result = service.evaluate(request)
        samples.append(round((perf_counter() - start) * 1000, 2))
    return result, samples


def assert_equivalent(reference, actual):
    """Allow alternate equal-cost graph geometry, never changed access outcomes."""
    for field in ("summary", "travel_time_bands", "island_summaries", "economics", "coverage"):
        assert actual[field] == reference[field], f"Changed {field}"
    assert len(actual["origins"]) == len(reference["origins"])
    for old, new in zip(reference["origins"], actual["origins"], strict=True):
        for field in ("origin_id", "population", "gained_access", "lost_access", "delta_minutes"):
            assert old[field] == new[field], (old["origin_id"], field, old[field], new[field])
        for side in ("before", "after"):
            for field in ("status", "minutes", "arrival_minutes", "destination_id"):
                assert old[side][field] == new[side][field], (old["origin_id"], side, field)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-ref")
    parser.add_argument("--iterations", type=int, default=3, choices=range(1, 11))
    parser.add_argument(
        "--output", type=Path, default=ROOT / "artifacts/qa/planning-performance.json"
    )
    args = parser.parse_args()
    repository = PlanningRepository(ROOT / "data/public")
    current = PlanningService(repository)
    report = {
        "python": platform.python_version(),
        "reference_ref": args.reference_ref,
        "source_receipts": repository.receipts,
        "method": "In-process elapsed time; first evaluation plus repeat medians. "
        "HTTP transfer, rendering and debounce excluded. No mocked data or approximate routing.",
        "cases": [],
    }
    with tempfile.TemporaryDirectory(prefix="planning-reference-") as scratch:
        previous = (
            reference_service(args.reference_ref, Path(scratch))(repository)
            if args.reference_ref
            else None
        )
        for island_id in ("island:1443", "island:1442"):
            origin = next(
                item
                for item in repository.baseline["origins"]
                if item["islandId"] == repository.planning_id(island_id)
            )
            for operation in (None, "add_stop", "add_school"):
                request = PlanningRequest.model_validate(
                    {
                        "island_id": island_id,
                        "assumptions": {
                            "goal": "education" if operation == "add_school" else "healthcare"
                        },
                        "operations": [
                            {"type": operation, "coordinates": [origin["lon"], origin["lat"]]}
                        ]
                        if operation
                        else [],
                    }
                )
                reference, before = (
                    timed(previous, request, args.iterations) if previous else (None, [])
                )
                actual, after = timed(current, request, args.iterations + 1)
                if reference:
                    assert_equivalent(reference, actual)
                start = perf_counter()
                quote = current.quote(request)
                quote_ms = round((perf_counter() - start) * 1000, 2)
                assert quote["economics"] == actual["economics"]
                compact_request = request.model_copy(
                    update={
                        "assumptions": request.assumptions.model_copy(
                            update={"include_journey_geometry": False, "include_world": False}
                        )
                    }
                )
                compact, compact_samples = timed(current, compact_request, args.iterations)
                assert_equivalent(actual, compact)
                row = {
                    "island_id": island_id,
                    "operation": operation or "baseline",
                    "origins": len(actual["origins"]),
                    "reference_samples_ms": before,
                    "reference_median_ms": statistics.median(before) if before else None,
                    "first_evaluation_ms": after[0],
                    "repeat_samples_ms": after[1:],
                    "repeat_median_ms": statistics.median(after[1:]),
                    "quote_ms": quote_ms,
                    "compact_repeat_median_ms": statistics.median(compact_samples),
                    "response_bytes": len(json.dumps(actual, separators=(",", ":")).encode()),
                    "compact_response_bytes": len(
                        json.dumps(compact, separators=(",", ":")).encode()
                    ),
                    "exact_access_and_financial_outcomes_match": bool(reference),
                }
                report["cases"].append(row)
                print(json.dumps(row), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"Saved {args.output}")


if __name__ == "__main__":
    main()
