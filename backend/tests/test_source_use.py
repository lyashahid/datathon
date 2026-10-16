"""Retained source evidence has a concrete use and matches the shipped models."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_source_inventory_has_no_unresolved_unused_or_corrupt_captures():
    inventory = json.loads((ROOT / "data/public/source-use.json").read_text("utf-8"))
    assert inventory["summary"]["unusedSourceIds"] == []
    assert inventory["summary"]["checksumMismatches"] == []
    assert len({source["id"] for source in inventory["sources"]}) == len(inventory["sources"])
    for source in inventory["sources"]:
        assert source["uses"], source["id"]
        for use in source["uses"]:
            assert (ROOT / use["artifact"]).is_file(), (source["id"], use)
            assert use["field"] and use["description"] and use["role"]


def test_source_inventory_receipts_match_shipped_model_bytes():
    inventory = json.loads((ROOT / "data/public/source-use.json").read_text("utf-8"))
    for artifact in inventory["modelArtifacts"]:
        path = ROOT / artifact["path"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == artifact["sha256"], str(path)
