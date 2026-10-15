"""Exercise the populated local API without refreshing deterministic source data.

Run with the API already listening: uv run python -m scripts.verify_backend
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from time import perf_counter

import httpx

from app.config.settings import Settings
from app.data.validation import REQUIRED_ARTIFACTS, CacheValidator


def main() -> None:
    data_dir = Settings().data_dir
    cache = data_dir / "cache"

    def read(relative_path: str):
        return json.loads((cache / relative_path).read_text(encoding="utf-8"))

    def checksums():
        return {
            name: hashlib.sha256((cache / name).read_bytes()).hexdigest()
            for name in REQUIRED_ARTIFACTS
        }

    before = checksums()
    land = read("graphs/land.json")
    marine = read("graphs/marine.json")
    air = read("graphs/air.json")
    transport = read("normalized/transport.json")
    island_id = "island:1443"  # Malé in the supplied OneMap cache.
    graph = land["islands"][island_id]
    nodes = {node["id"]: node for node in graph["nodes"]}
    edge = next(edge for edge in graph["edges"] if edge["permissions"].get("walk"))
    start, end = nodes[edge["from_id"]]["coordinates"], nodes[edge["to_id"]]["coordinates"]
    ferry_edge = marine["edges"][0]
    bus = next(item for item in transport["features"] if item["category"] == "bus_stop")
    cases = []
    report = {"generated_at": datetime.now(UTC).isoformat(), "base_url": "http://127.0.0.1:8000"}

    with httpx.Client(base_url=report["base_url"], timeout=60) as client:

        def request(method, path, payload=None, expected=200, label=None):
            started = perf_counter()
            response = client.request(method, path, json=payload)
            case = {
                "label": label or path,
                "method": method,
                "path": path,
                "status": response.status_code,
                "expected_status": expected,
                "duration_seconds": round(perf_counter() - started, 3),
                "response_bytes": len(response.content),
            }
            cases.append(case)
            assert response.status_code == expected, (case, response.text[:2000])
            if "text/event-stream" in response.headers.get("content-type", ""):
                assert "event: provider_status" in response.text
                return response.text
            result = response.json()
            if expected >= 400:
                assert "error" in result, result
            return result

        request("GET", "/health")
        schema = request("GET", "/openapi.json")
        report["api_path_count"] = len(schema["paths"])
        national = request("GET", "/api/v1/national/summary")
        assert national["island_count"] == 1561
        assert national["accessibility_status"] == "calculated"
        report["national_summary"] = national
        islands = request("GET", "/api/v1/islands?limit=1000")
        assert islands["total"] == 1561 and len(islands["items"]) == 1000
        page = request("GET", "/api/v1/islands?limit=1000&offset=1000")
        assert len(page["items"]) == 561
        request("GET", "/api/v1/islands?q=Hithadhoo&atoll=Addu&limit=5")
        detail = request("GET", f"/api/v1/islands/{island_id}")
        profile = request("GET", f"/api/v1/islands/{island_id}/profile")
        assert detail["name"] == "Malé"
        assert profile["accessibility"]
        report["sample_profile"] = {
            "name": detail["name"],
            "population": profile["population"],
            "data_quality": profile["data_quality"],
            "accessibility_score": profile["accessibility"]["score"],
        }
        populated_profile = request("GET", "/api/v1/islands/island:1334/profile")
        assert populated_profile["population"]["total"] == 9177
        report["sample_populated_profile"] = populated_profile["population"]
        for layer in ["all", "islands", "infrastructure", "transport"]:
            geojson = request("GET", f"/api/v1/map/features?layer={layer}&island_id={island_id}")
            assert geojson["type"] == "FeatureCollection"
            assert len(geojson["features"]) == geojson["summary"]["feature_count"]
        all_map = request("GET", "/api/v1/map/features?layer=all")
        report["map_summary"] = all_map["summary"]
        request("GET", "/api/v1/map/features?layer=infrastructure&include_unlocated=true")
        request("GET", "/api/v1/accessibility/summary")
        score = request("POST", "/api/v1/accessibility/score", {"island_id": island_id})
        assert 0 <= score["score"] <= 100
        route = request("POST", "/api/v1/routing/land", {
            "island_id": island_id, "start": start, "end": end, "mode": "walk",
        })
        assert route["status"] == "ok" and route["distance_m"] > 0
        report["sample_land_route"] = {key: route[key] for key in ["distance_m", "mode"]}
        for mode in ["bicycle", "car", "taxi", "bus"]:
            permitted = next(
                (item for item in graph["edges"] if item["permissions"].get(mode)), None,
            )
            if permitted:
                routed = request("POST", "/api/v1/routing/land", {
                    "island_id": island_id, "mode": mode,
                    "start": nodes[permitted["from_id"]]["coordinates"],
                    "end": nodes[permitted["to_id"]]["coordinates"],
                }, label=f"land-routing:{mode}")
                assert routed["status"] == "ok"
        ferry_payload = {
            "start_node_id": ferry_edge["from_id"], "end_node_id": ferry_edge["to_id"],
        }
        verified = request("POST", "/api/v1/routing/marine", ferry_payload)
        assert verified["status"] == "unreachable"
        candidate = request("POST", "/api/v1/routing/marine", {
            **ferry_payload, "include_unverified": True,
        })
        assert candidate["status"] == "ok"
        report["marine_verified_status"] = verified
        report["marine_candidate_distance_m"] = candidate["distance_m"]

        def scenario(operation, index):
            return {"id": f"verify-{index}", "name": operation["type"], "operations": [operation]}

        operations = [
            {"type": "add_bus_stop", "coordinates": start, "island_id": island_id},
            {"type": "move_bus_stop", "target_id": bus["id"], "coordinates": start},
            {"type": "remove_bus_stop", "target_id": bus["id"]},
            {"type": "add_ferry_terminal", "coordinates": start, "island_id": island_id},
            {"type": "move_ferry_terminal", "target_id": marine["nodes"][0]["id"],
             "coordinates": start},
            {"type": "disable_ferry_terminal", "target_id": marine["nodes"][0]["id"]},
            {"type": "add_ferry_route", "from_node_id": ferry_edge["from_id"],
             "to_node_id": ferry_edge["to_id"]},
            {"type": "remove_ferry_route", "target_id": ferry_edge["id"]},
            {"type": "change_ferry_route", "target_id": ferry_edge["id"],
             "from_node_id": ferry_edge["from_id"], "to_node_id": ferry_edge["to_id"]},
            {"type": "add_parking", "coordinates": start, "island_id": island_id},
            {"type": "add_park_and_ride", "coordinates": start, "island_id": island_id},
            {"type": "add_mobility_hub", "coordinates": start, "island_id": island_id},
            {"type": "road_closure", "target_id": edge["id"]},
            {"type": "pedestrian_connection", "island_id": island_id,
             "from_node_id": edge["from_id"], "to_node_id": edge["to_id"]},
            {"type": "airport_access_improvement", "from_node_id": air["nodes"][0]["id"],
             "to_node_id": air["nodes"][1]["id"]},
            {"type": "weather_disruption", "disabled_modes": ["walk", "marine"]},
        ]
        for index, operation in enumerate(operations):
            result = request("POST", "/api/v1/simulation/run", {
                "island_id": island_id, "scenario": scenario(operation, index),
            }, label=f"simulation:{operation['type']}")
            assert len(result["operations_applied"]) == 1 and not result["warnings"], result
        result = request("POST", "/api/v1/simulation/compare", {
            "island_id": island_id,
            "first": scenario(operations[12], 12),
            "second": {"id": "baseline", "name": "Baseline"},
        })
        assert result["delta"]["first_vs_second_land_edges"] == -1
        baseline = request("POST", "/api/v1/simulation/run", {
            "island_id": island_id, "scenario": {"id": "baseline", "name": "Baseline"},
        })
        assert baseline["baseline"] == baseline["effective_world"]

        recommendation_counts = {}
        for kind in ["underserved_island", "bus_stop", "ferry_terminal", "ferry_route",
                     "parking", "mobility_hub", "pedestrian", "airport_access"]:
            payload = {"type": kind, "limit": 2, "config": {"max_candidates": 2}}
            result = request("POST", "/api/v1/recommendations", payload,
                             label=f"recommendations:{kind}")
            recommendation_counts[kind] = result["summary"]["returned_count"]
            for item in result["recommendations"]:
                assert item["planning_screening_disclaimer"] and item["simulation"]
            if kind == "bus_stop":
                again = request("POST", "/api/v1/recommendations", payload,
                                label="recommendations:deterministic_repeat")
                assert result == again
        report["recommendation_counts"] = recommendation_counts
        request("GET", "/api/v1/live/status")
        live = request("GET", "/api/v1/live/snapshot?include_fallback=false")
        report["live_sample"] = {
            "location_count": len(live["locations"]),
            "coverage": live["coverage"], "providers": live["providers"],
        }
        assert live["deterministic_data_affected"] is False
        selected_vessel = request(
            "GET", "/api/v1/live/snapshot?include_fallback=false&followme_vessel_ids=18157",
        )
        report["followme_selected_sample"] = next(
            item for item in selected_vessel["providers"] if item["provider"] == "followme"
        )
        request("GET", "/api/v1/live/stream?once=true&include_fallback=false")

        for path in [f"/api/v1/islands/island:missing{suffix}" for suffix in ["", "/profile"]]:
            request("GET", path, expected=404)
        request("GET", "/api/v1/map/features?island_id=island:missing", expected=404)
        request("POST", "/api/v1/accessibility/score", {"island_id": "island:missing"}, 404)
        request("POST", "/api/v1/recommendations", {
            "type": "bus_stop", "island_id": "island:missing",
        }, 404)
        request("POST", "/api/v1/simulation/run", {
            "island_id": "island:missing", "scenario": {"id": "x", "name": "X"},
        }, 404)
        request("GET", "/api/v1/islands?limit=0", expected=422)
        request("GET", "/api/v1/map/features?layer=bad", expected=422)
        request("POST", "/api/v1/simulation/run", {
            "scenario": {"id": "bad", "name": "Bad", "operations": [{"type": "add_bus_stop"}]},
        }, 422)
        request("POST", "/api/v1/recommendations", {
            "type": "bus_stop", "config": {"benefit_weight": 0.1, "confidence_weight": 0.1},
        }, 422)
        request("GET", "/api/v1/live/snapshot?bbox=bad", expected=422)
        request("GET", "/api/v1/live/stream?followme_vessel_ids=-1", expected=422)

    report["cases"] = cases
    report["passed_request_count"] = len(cases)
    report["deterministic_artifacts_unchanged"] = before == checksums()
    report["cache_validation"] = CacheValidator(data_dir).validate()
    assert report["deterministic_artifacts_unchanged"]
    assert report["cache_validation"]["status"] == "ok"
    output = data_dir / "metadata" / "integration-report.json"
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"passed_requests": len(cases), "report": str(output)}, indent=2))


if __name__ == "__main__":
    main()
