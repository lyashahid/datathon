"""Only exact official route endpoints enter the capital terminal catalogue."""

import json
from pathlib import Path
from types import SimpleNamespace

from app.planning.transport import terminal_catalogue

ROOT = Path(__file__).resolve().parents[2]


def test_shipped_capital_ports_reach_runtime_with_distinct_terminal_namespace():
    repository = SimpleNamespace(
        islands_by_id={identity: {} for identity in ("island:1443", "island:1382", "island:1456")},
        transport={"features": []},
    )
    terminals = terminal_catalogue(
        repository, SimpleNamespace(marine={"nodes": []}), ROOT / "data/public"
    )
    assert set(terminals) == {f"rtl:vessel-terminal:{number}" for number in (1, 2, 3)}
    maafannu = terminals["rtl:vessel-terminal:1"]
    assert maafannu["island_id"] == "island:1443"
    assert maafannu["coordinates"] == [73.50165235035352, 4.171891971552377]
    assert maafannu["source"].endswith("/vessel/routedetails")
    assert maafannu["evidence"] == "official_terminal_catalogue"
    assert terminals["rtl:vessel-terminal:3"]["island_id"] == "island:1382"
    assert "rtl:terminal:1" not in terminals


def test_unknown_island_and_missing_official_source_do_not_create_capital_ports(tmp_path):
    snapshot = json.loads((ROOT / "data/public/sea-services.json").read_text(encoding="utf8"))
    snapshot["sources"] = []
    (tmp_path / "sea-services.json").write_text(json.dumps(snapshot), encoding="utf8")
    repository = SimpleNamespace(islands_by_id={"island:1443": {}}, transport={"features": []})
    assert terminal_catalogue(repository, SimpleNamespace(marine={"nodes": []}), tmp_path) == {}
