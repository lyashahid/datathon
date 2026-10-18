"""Retained source evidence has a concrete use and matches the shipped models."""

import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class SourceInventoryTests(unittest.TestCase):
    def test_source_inventory_has_no_unresolved_unused_or_corrupt_captures(self):
        inventory = json.loads((ROOT / "data/public/source-use.json").read_text("utf-8"))
        self.assertEqual(inventory["summary"]["unusedSourceIds"], [])
        self.assertEqual(inventory["summary"]["checksumMismatches"], [])
        self.assertEqual(
            len({source["id"] for source in inventory["sources"]}), len(inventory["sources"])
        )
        for source in inventory["sources"]:
            self.assertTrue(source["uses"], source["id"])
            for use in source["uses"]:
                self.assertTrue((ROOT / use["artifact"]).is_file(), (source["id"], use))
                self.assertTrue(use["field"] and use["description"] and use["role"])

    def test_source_inventory_receipts_match_shipped_model_bytes(self):
        inventory = json.loads((ROOT / "data/public/source-use.json").read_text("utf-8"))
        for artifact in inventory["modelArtifacts"]:
            path = ROOT / artifact["path"]
            with self.subTest(path=artifact["path"]):
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), artifact["sha256"])
