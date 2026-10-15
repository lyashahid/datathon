"""Proposed map paths use actual directed roads or explicitly assumed ferry corridors."""

import copy
import json
from pathlib import Path

import pytest

from app.planning.models import JourneyRequest, PlanningRequest
from app.planning.repository import PlanningRepository
from app.planning.routing import WalkingNetwork, transit_geometry
from app.planning.service import PlanningService
from app.planning.world import apply_operations, validate_service


@pytest.fixture
def planning(tmp_path):
    nodes = [
        {"id": "a", "lon": 73.5, "lat": 4.17, "islandId": "male"},
        {"id": "bend", "lon": 73.501, "lat": 4.171, "islandId": "male"},
        {"id": "b", "lon": 73.502, "lat": 4.17, "islandId": "male"},
        {"id": "c", "lon": 73.48, "lat": 4.17, "islandId": "vilimale"},
    ]
    edges = [
        {
            "id": f"edge:{first['id']}-{second['id']}",
            "from": first["id"],
            "to": second["id"],
            "distanceM": 1000,
            "walkAllowed": True,
            "driveAllowed": True,
            "oneway": True,
            "geometry": [[first["lon"], first["lat"]], [second["lon"], second["lat"]]],
        }
        for first, second in zip(nodes[:2], nodes[1:3])
    ]
    stops = [dict(node, id=f"stop:{node['id']}") for node in (nodes[0], nodes[2], nodes[3])]
    baseline = {
        "version": "geometry-fixture",
        "referenceDate": "2026-10-10",
        "islands": [{"id": "male"}, {"id": "vilimale"}],
        "network": {"nodes": nodes, "edges": edges},
        "transit": {"stops": stops, "patterns": []},
        "origins": [dict(nodes[0], id="origin:a", population2026=100)],
        "facilities": [
            dict(
                node,
                id=f"hospital:{node['id']}",
                kind="hospital",
                name="Hospital",
                operatingStatus="open",
                verification="official",
                careScope="general",
            )
            for node in (nodes[2], nodes[3])
        ],
    }
    (tmp_path / "planning-baseline.json").write_text(json.dumps(baseline), encoding="utf8")
    return PlanningService(PlanningRepository(tmp_path))


def proposal(mode="bus", start="stop:a", end="stop:b"):
    return {
        "id": "proposal:service",
        "routeId": "proposal:route",
        "name": "Proposed service",
        "mode": mode,
        "stopIds": [start, end],
        "distanceM": 2000,
        "calendar": {"includedDates": ["2026-10-10"]},
        "timing": {
            "kind": "frequency",
            "segmentMinutes": [8],
            "windows": [{"startMinutes": 480, "endMinutes": 600, "headwayMinutes": 10}],
        },
    }


def add_service(pattern):
    return {"type": "add_service", "service": pattern}


def test_added_bus_uses_bent_directed_road_and_returns_path_provenance(planning):
    original = copy.deepcopy(planning.repository.baseline)
    request = JourneyRequest(
        origin_id="origin:a",
        destination_id="hospital:b",
        assumptions={"departure_minutes": 470},
        operations=[add_service(proposal())],
    )
    result = planning.journey(request)
    leg = next(leg for leg in result["outward"]["path"] if leg["mode"] == "bus")
    assert leg["geometry"] == [[73.5, 4.17], [73.501, 4.171], [73.502, 4.17]]
    assert leg["geometry_source"] == "osm_network_shortest_path"
    assert "running times remain assumptions" in leg["geometry_warning"]
    assert leg["minutes"] == 8
    assert leg["wait_minutes"] == 10
    assert planning.repository.baseline == original


def test_drive_snap_ignores_nearest_pedestrian_node_and_other_island(planning):
    network = planning.repository.baseline["network"]
    foot = {"id": "foot", "lon": 73.5, "lat": 4.17001, "islandId": "male"}
    network["nodes"].append(foot)
    point = dict(foot, id="stop:foot")
    assert WalkingNetwork(network).snap(point, 100)[0] == "foot"
    assert WalkingNetwork(network, drive=True).snap(point, 100)[0] == "a"
    assert WalkingNetwork(network, drive=True).snap(dict(point, islandId="vilimale"), 100) is None


def test_reverse_oneway_bus_has_no_invented_straight_route(planning):
    world, warnings = apply_operations(
        planning.repository,
        PlanningRequest(operations=[add_service(proposal(start="stop:b", end="stop:a"))]),
    )
    pattern = world["patterns"][0]
    geometry, source, warning = transit_geometry(pattern, 0, 1)
    assert geometry == []
    assert source == "unavailable"
    assert "No directed driving route" in warning
    assert any("unverified assumption" in text for text in warnings)
    assert pattern["timing"]["segmentMinutes"] == [8]


def test_closure_blocks_proposed_bus_without_changing_source_graph(planning):
    world, warnings = apply_operations(
        planning.repository,
        PlanningRequest(
            operations=[
                add_service(proposal()),
                {
                    "type": "road_closure",
                    "target_id": "edge:a-bend",
                    "disabled_modes": ["bus"],
                },
            ]
        ),
    )
    assert world["patterns"][0]["enabled"] is False
    assert any("no transit benefit assumed" in text for text in warnings)
    assert planning.repository.baseline["network"]["edges"][0]["driveAllowed"] is True


def test_missing_edge_geometry_never_draws_a_partial_shortcut(planning):
    planning.repository.baseline["network"]["edges"][1].pop("geometry")
    world, _ = apply_operations(
        planning.repository,
        PlanningRequest(operations=[add_service(proposal())]),
    )
    pattern = world["patterns"][0]
    assert pattern["segmentGeometry"] == [[]]
    assert pattern["segmentGeometrySources"] == ["unavailable"]
    assert "complete mapped geometry" in pattern["segmentGeometryWarnings"][0]


def test_ferry_journey_has_explicitly_assumed_endpoint_corridor(planning):
    result = planning.journey(
        JourneyRequest(
            origin_id="origin:a",
            destination_id="hospital:c",
            assumptions={"departure_minutes": 470},
            operations=[add_service(proposal(mode="ferry", end="stop:c"))],
        )
    )
    leg = next(leg for leg in result["outward"]["path"] if leg["mode"] == "ferry")
    assert leg["geometry"] == [[73.5, 4.17], [73.48, 4.17]]
    assert leg["geometry_source"] == "assumed_endpoint_corridor"
    assert "not a charted navigation route" in leg["geometry_warning"]
    assert leg["provenance"] == "assumed"
    assert any("Planning corridor" in warning for warning in result["warnings"])


def test_supplied_shape_retained_and_client_cannot_claim_server_derivation(planning):
    shape = [[73.5, 4.17], [73.5004, 4.1695], [73.502, 4.17]]
    pattern = dict(
        proposal(), segmentGeometry=[shape], segmentGeometrySources=["osm_network_shortest_path"]
    )
    world, _ = apply_operations(
        planning.repository,
        PlanningRequest(operations=[add_service(pattern)]),
    )
    added = world["patterns"][0]
    assert added["segmentGeometry"] == [shape]
    assert added["segmentGeometrySources"] == ["source_service_geometry"]
    assert "not been independently verified" in added["segmentGeometryWarnings"][0]


def test_partial_multistop_geometry_returns_unavailable_instead_of_shortcut():
    pattern = {
        "segmentGeometry": [[[73.5, 4.17], [73.501, 4.171]], [], [[73.51, 4.17], [73.52, 4.17]]],
    }
    assert transit_geometry(pattern, 0, 3)[0:2] == ([], "unavailable")


@pytest.mark.parametrize(
    "geometry",
    [
        "bad",
        [[[181, 4], [73, 4]]],
        [[[73, 91], [73, 4]]],
        [[[True, 4], [73, 4]]],
        [[[73, 4]]],
        [[[73, 4], [73, 4, 0]]],
        [[], []],
    ],
)
def test_import_rejects_malformed_geometry(planning, geometry):
    with pytest.raises(ValueError, match="geometry|segment"):
        validate_service(
            dict(proposal(), segmentGeometry=geometry),
            planning.repository.baseline["transit"]["stops"],
        )


def test_real_rtl_proposed_bus_path_follows_supplied_osm_network():
    repository = PlanningRepository(Path(__file__).resolve().parents[2] / "data" / "public")
    original = copy.deepcopy(repository.baseline["transit"]["patterns"])
    pattern = proposal(start="rtl:stop:103", end="rtl:stop:109")
    world, _ = apply_operations(repository, PlanningRequest(operations=[add_service(pattern)]))
    added = world["patterns"][-1]
    geometry = added["segmentGeometry"][0]
    assert len(geometry) > 20
    assert added["segmentGeometrySources"] == ["osm_network_shortest_path"]
    # Every drawn point belongs to an actual drive-allowed edge, rather than an endpoint chord.
    road_points = {
        tuple(point)
        for edge in repository.baseline["network"]["edges"]
        if edge.get("driveAllowed")
        for point in edge.get("geometry", [])
    }
    assert all(tuple(point) in road_points for point in geometry)
    assert world["patterns"][:-1] == original
    assert repository.baseline["transit"]["patterns"] == original


def test_real_vilimale_proposed_ferry_path_is_qualified_corridor():
    repository = PlanningRepository(Path(__file__).resolve().parents[2] / "data" / "public")
    world, _ = apply_operations(
        repository,
        PlanningRequest(
            operations=[
                add_service(proposal(mode="ferry", start="rtl:stop:1301", end="rtl:stop:103"))
            ]
        ),
    )
    added = world["patterns"][-1]
    assert len(added["segmentGeometry"][0]) == 2
    assert added["segmentGeometrySources"] == ["assumed_endpoint_corridor"]
    assert "not a charted navigation route" in added["segmentGeometryWarnings"][0]
