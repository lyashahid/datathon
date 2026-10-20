"""Domestic route facts do not become timetables or live aircraft assignments."""

import copy
import json
import math
from datetime import date
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.air import get_air_network, router
from app.data.computed_cache import ComputedCache
from app.planning.air_network import AirNetworkService, airport_catalogue, build_air_network

DAY = date(2026, 10, 20)


def evidence():
    features = [
        {
            "id": f"osm:{code}",
            "category": "aerodrome",
            "name": name,
            "island_id": island,
            "tags": {"iata": code, "icao": f"VR{code[:2]}"},
            "geometry": {"type": "Point", "coordinates": coordinate},
        }
        for code, name, island, coordinate in [
            ("MLE", "Velana", "island:1483", [73.529, 4.192]),
            ("MUM", "Muli", None, [73.583, 2.911]),
        ]
    ]
    bundle = {
        "retrieved_at": "2026-10-20T00:00:00Z",
        "sources": [
            {"id": "airline", "url": "https://maldivian.aero/corporate/business-services.html"}
        ],
        "routes": [
            {
                "id": "mle-mum",
                "operator": "Maldivian",
                "from_iata": "MLE",
                "to_iata": "MUM",
                "source_ids": ["airline"],
                "evidence": "published_route",
                "bidirectional": False,
                "published_schedule": {
                    "published_at": "2025-12-31",
                    "description": (
                        "Two outbound flights were announced; current timetable unconfirmed."
                    ),
                },
            }
        ],
    }
    return bundle, features


def test_published_connection_preserves_real_airport_geometry_and_unknowns():
    bundle, features = evidence()
    result = build_air_network(bundle, airport_catalogue(features), DAY)
    [route] = result["routes"]
    [feature] = result["map_features"]["features"]
    coordinates = route["geometry"]["coordinates"]
    assert [coordinates[0], coordinates[-1]] == [[73.529, 4.192], [73.583, 2.911]]
    assert route["geometry"] == route["legs"][0]["geometry"] == feature["geometry"]
    assert route["to_island_id"] is None  # Airport location does not imply an island join.
    assert route["geometry_basis"] == "schematic_airport_connection"
    assert route["schedule"]["departures_per_day"] is None
    assert route["schedule"]["departures_per_week"] is None
    assert route["published_schedule"]["published_at"] == "2025-12-31"
    assert route["pressure"]["level"] == "unknown"
    assert route["pressure"]["load_factor"] is None
    assert route["live_linkage"]["flight_ids"] == []
    assert feature["properties"]["kind"] == "air_route"
    assert feature["properties"]["connection_role"] == "hub"
    assert feature["properties"]["route_id"] == route["id"]
    assert feature["id"] == "air-route:mle-mum"
    assert route["itinerary_iata"] == ["MLE", "MUM"]
    assert route["bidirectional"] is False
    assert result["coverage"]["directed_leg_count"] == 1


def test_schematic_arcs_are_curved_bounded_and_identical_for_reversed_connections():
    bundle, features = evidence()
    airports = airport_catalogue(features)
    first = build_air_network(bundle, airports, DAY)
    coordinates = first["routes"][0]["geometry"]["coordinates"]
    assert first == build_air_network(bundle, airports, DAY)
    assert len(coordinates) > 2
    assert all(start != end for start, end in zip(coordinates, coordinates[1:]))
    # Check the shape in local metres rather than comparing longitude and latitude units.
    start, end = coordinates[0], coordinates[-1]
    longitude_scale = math.cos(math.radians((start[1] + end[1]) / 2))
    dx, dy = (end[0] - start[0]) * longitude_scale, end[1] - start[1]
    squared_length = dx * dx + dy * dy
    progress = []
    bends = []
    for longitude, latitude in coordinates:
        x, y = (longitude - start[0]) * longitude_scale, latitude - start[1]
        progress.append((x * dx + y * dy) / squared_length)
        bends.append(abs(dx * y - dy * x) / squared_length)
    assert progress == sorted(progress)
    assert 0.05 < max(bends) <= 0.14

    bundle["routes"][0].update({"from_iata": "MUM", "to_iata": "MLE"})
    reversed_coordinates = build_air_network(bundle, airports, DAY)["routes"][0]["geometry"][
        "coordinates"
    ]
    assert reversed_coordinates == list(reversed(coordinates))


def test_published_return_direction_is_explicit_and_does_not_duplicate_the_line():
    bundle, features = evidence()
    bundle["routes"][0]["bidirectional"] = True
    result = build_air_network(bundle, airport_catalogue(features), DAY)
    assert len(result["routes"]) == len(result["map_features"]["features"]) == 1
    assert result["routes"][0]["legs"][0]["bidirectional"] is True
    assert result["map_features"]["features"][0]["properties"]["bidirectional"] is True
    assert result["coverage"]["directed_leg_count"] == 2
    assert result["routes"][0]["schedule"]["departures_per_day"] is None


def test_published_stopover_draws_only_ordered_legs_and_keeps_stops_in_the_catalogue():
    bundle, features = evidence()
    features.append(
        {
            **copy.deepcopy(features[1]),
            "id": "osm:GAN",
            "name": "Gan",
            "tags": {"iata": "GAN"},
            "geometry": {"type": "Point", "coordinates": [73.156, -0.694]},
        }
    )
    bundle["routes"][0].update({"to_iata": "GAN", "via_iata": ["MUM"]})
    result = build_air_network(bundle, airport_catalogue(features), DAY)
    [route] = result["routes"]
    lines = result["map_features"]["features"]
    assert route["itinerary_iata"] == ["MLE", "MUM", "GAN"]
    first_leg, second_leg = [line["geometry"]["coordinates"] for line in lines]
    assert route["geometry"]["coordinates"] == first_leg + second_leg[1:]
    assert [first_leg[0], first_leg[-1], second_leg[-1]] == [
        [73.529, 4.192],
        [73.583, 2.911],
        [73.156, -0.694],
    ]
    assert route["geometry"]["coordinates"].count([73.583, 2.911]) == 1
    assert [leg["connection_role"] for leg in route["legs"]] == ["hub", "regional"]
    assert [line["properties"]["connection_role"] for line in lines] == ["hub", "regional"]
    assert [line["geometry"] for line in lines] == [leg["geometry"] for leg in route["legs"]]
    assert [feature["id"] for feature in lines] == [
        "air-route:mle-mum:leg:1",
        "air-route:mle-mum:leg:2",
    ]
    assert [(line["properties"]["from_iata"], line["properties"]["to_iata"]) for line in lines] == [
        ("MLE", "MUM"),
        ("MUM", "GAN"),
    ]
    assert all(line["properties"]["route_id"] == route["id"] for line in lines)
    assert {airport["iata"] for airport in result["airports"]} == {"MLE", "MUM", "GAN"}
    assert result["coverage"]["mapped_routes"] == 1
    assert result["coverage"]["mapped_legs"] == 2

    # Missing destination coordinates preserve the known first leg, never MLE–GAN.
    result = build_air_network(bundle, airport_catalogue(features[:2]), DAY)
    assert result["routes"][0]["geometry"] is None
    assert len(result["map_features"]["features"]) == 1
    assert result["coverage"]["mapped_routes"] == 0
    assert result["coverage"]["mapped_legs"] == result["coverage"]["unmapped_legs"] == 1


def test_invalid_stops_or_conflicting_duplicate_directions_cannot_change_route_evidence():
    bundle, features = evidence()
    conflicting = {**copy.deepcopy(bundle["routes"][0]), "bidirectional": True}
    invalid = {**copy.deepcopy(bundle["routes"][0]), "id": "bad", "via_iata": ["not-an-iata"]}
    bundle["routes"].extend([conflicting, invalid])
    result = build_air_network(bundle, airport_catalogue(features), DAY)
    assert len(result["routes"]) == 1
    assert result["routes"][0]["bidirectional"] is False
    assert result["coverage"]["rejected_records"] == 2


def test_missing_airport_never_uses_island_centroid_and_duplicate_route_is_not_drawn_twice():
    bundle, features = evidence()
    bundle["routes"].append(copy.deepcopy(bundle["routes"][0]))
    features[1]["geometry"]["coordinates"] = [float("nan"), 2.9]
    features[1]["centroid"] = [73.58, 2.9]
    result = build_air_network(bundle, airport_catalogue(features), DAY)
    assert len(result["routes"]) == 1
    assert result["routes"][0]["geometry"] is None
    assert result["coverage"]["unmapped_routes"] == 1
    assert result["map_features"]["features"] == []


def test_unsourced_or_unsafe_source_records_cannot_create_routes():
    bundle, features = evidence()
    bundle["sources"][0]["url"] = "javascript:alert(1)"
    result = build_air_network(bundle, airport_catalogue(features), DAY)
    assert result["routes"] == []
    assert result["coverage"]["rejected_records"] == 1


def test_disk_restart_reuse_and_source_or_coordinate_changes_invalidate(tmp_path, monkeypatch):
    bundle, features = evidence()
    path = tmp_path / "domestic-air-services.json"
    path.write_text(json.dumps(bundle), encoding="utf-8")
    repository = SimpleNamespace(transport={"features": features})
    cache = ComputedCache(tmp_path / "runtime")
    first = AirNetworkService(repository, tmp_path, cache=cache).network(DAY)
    restarted = AirNetworkService(repository, tmp_path, cache=ComputedCache(tmp_path / "runtime"))
    import app.planning.air_network as module

    original = module.build_air_network
    monkeypatch.setattr(
        module,
        "build_air_network",
        lambda *_: (_ for _ in ()).throw(AssertionError("disk hit expected")),
    )
    assert restarted.network(DAY) == first
    monkeypatch.setattr(module, "build_air_network", original)
    bundle["routes"][0]["qualification"] = "New source qualification."
    path.write_text(json.dumps(bundle), encoding="utf-8")
    assert restarted.network(DAY)["routes"][0]["qualification"] == "New source qualification."
    features[1]["geometry"]["coordinates"] = [73.58, 2.91]
    assert restarted.network(DAY)["routes"][0]["geometry"]["coordinates"][-1] == [73.58, 2.91]


def test_air_network_api_validates_date_and_keeps_provider_reads_outside_snapshot(tmp_path):
    bundle, features = evidence()
    (tmp_path / "domestic-air-services.json").write_text(json.dumps(bundle), encoding="utf-8")
    service = AirNetworkService(SimpleNamespace(transport={"features": features}), tmp_path)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_air_network] = lambda: service
    with TestClient(app) as client:
        response = client.get("/api/v1/planning/air-network?date=2026-10-20")
        assert response.status_code == 200
        assert response.json()["service_date"] == "2026-10-20"
        assert response.json()["coverage"]["mapped_routes"] == 1
        assert client.get("/api/v1/planning/air-network?date=invalid").status_code == 422
