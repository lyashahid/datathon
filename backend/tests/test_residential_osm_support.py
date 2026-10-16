"""Residential relation geometry is used with source holes and island clipping."""

import pytest
from shapely.geometry import Point, box, mapping

from scripts.prepare_national_origins import ResidentialSupport


@pytest.mark.parametrize(
    ("relation_tag", "collection"),
    [("landuse", "areas"), ("building", "buildings")],
)
def test_relation_support_assembles_split_outer_and_preserves_holes(
    tmp_path, relation_tag, collection
):
    # The two outer members are open ways; neither can be used as a polygon alone.
    # A separate closed house checks that the area callback does not double count it.
    path = tmp_path / "residential.osm"
    coordinates = [
        (73, 0), (73.01, 0), (73.01, 0.01), (73, 0.01),
        (73.002, 0.002), (73.004, 0.002), (73.004, 0.004), (73.002, 0.004),
        (73.006, 0.006), (73.008, 0.006), (73.008, 0.008), (73.006, 0.008),
    ]
    nodes = "".join(
        f'<node id="{index}" lon="{lon}" lat="{lat}"/>'
        for index, (lon, lat) in enumerate(coordinates, 1)
    )
    relation_value = "residential" if relation_tag == "landuse" else "house"
    path.write_text(
        '<osm version="0.6">' + nodes
        + '<way id="1"><nd ref="1"/><nd ref="2"/><nd ref="3"/></way>'
        + '<way id="2"><nd ref="3"/><nd ref="4"/><nd ref="1"/></way>'
        + '<way id="3"><nd ref="5"/><nd ref="6"/><nd ref="7"/>'
        + '<nd ref="8"/><nd ref="5"/></way>'
        + '<way id="4"><nd ref="9"/><nd ref="10"/><nd ref="11"/>'
        + '<nd ref="12"/><nd ref="9"/><tag k="building" v="house"/></way>'
        + '<relation id="100"><member type="way" ref="1" role="outer"/>'
        + '<member type="way" ref="2" role="outer"/>'
        + '<member type="way" ref="3" role="inner"/>'
        + '<tag k="type" v="multipolygon"/>'
        + f'<tag k="{relation_tag}" v="{relation_value}"/></relation></osm>',
        encoding="utf-8",
    )
    land = box(73.001, 0.001, 73.009, 0.009)
    support = ResidentialSupport(
        [{"properties": {"id": "test"}, "geometry": mapping(land)}]
    )
    support.apply_file(str(path), locations=True, idx="flex_mem")
    polygons = getattr(support, collection)["test"]
    expected = land.difference(box(73.002, 0.002, 73.004, 0.004))
    relation = next(polygon for polygon in polygons if polygon.area > 0.00001)
    assert relation.symmetric_difference(expected).area == pytest.approx(0, abs=1e-12)
    assert not relation.covers(Point(73.003, 0.003))
    assert all(land.covers(polygon) for polygon in polygons)
    expected_building_count = 1 if relation_tag == "landuse" else 2
    assert len(support.buildings["test"]) == expected_building_count
    assert len(support.areas["test"]) == (1 if relation_tag == "landuse" else 0)
