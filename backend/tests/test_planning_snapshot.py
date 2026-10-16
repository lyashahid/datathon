"""The national baseline fingerprint is constant-time until source content changes."""

import copy
import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.data.computed_cache import digest
from app.planning.repository import PlanningRepository
from app.planning.snapshot import ContentSnapshot


def test_fingerprint_encodes_once_and_tracks_nested_changes(monkeypatch):
    calls = []

    def measured(value):
        calls.append(True)
        return digest(value)

    monkeypatch.setattr("app.planning.snapshot.digest", measured)
    snapshot = ContentSnapshot({"version": "v1", "origins": [{"population": 12}]})
    first = snapshot.fingerprint()
    assert first == digest(snapshot.value)
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert list(pool.map(lambda _: snapshot.fingerprint(), range(20))) == [first] * 20
    assert len(calls) == 1
    snapshot.value["origins"][0]["population"] += 1
    assert snapshot.fingerprint() != first
    assert snapshot.fingerprint() == digest(snapshot.value)
    assert len(calls) == 2


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update({"new": {"items": [1]}}),
        lambda d: d.setdefault("new", []),
        lambda d: d.pop("version"),
        lambda d: d.popitem(),
        lambda d: d.clear(),
        lambda d: d.__ior__({"version": "v2"}),
        lambda d: d.__delitem__("version"),
        lambda d: d["items"].append({"v": 4}),
        lambda d: d["items"].extend([{"v": 4}]),
        lambda d: d["items"].insert(0, {"v": 4}),
        lambda d: d["items"].pop(),
        lambda d: d["items"].remove({"v": 1}),
        lambda d: d["items"].clear(),
        lambda d: d["items"].reverse(),
        lambda d: d["items"].sort(key=lambda item: -item["v"]),
        lambda d: d["items"].__setitem__(0, {"v": 4}),
        lambda d: d["items"].__setitem__(slice(0, 1), [{"v": 4}]),
        lambda d: d["items"].__delitem__(0),
        lambda d: d["items"].__iadd__([{"v": 4}]),
        lambda d: d["items"].__imul__(2),
    ],
)
def test_container_mutations_invalidate_fingerprint(mutate):
    snapshot = ContentSnapshot({"version": "v1", "items": [{"v": 1}, {"v": 2}]})
    first = snapshot.fingerprint()
    mutate(snapshot.value)
    assert snapshot.fingerprint() == digest(snapshot.value)
    assert snapshot.fingerprint() != first


def test_inserted_children_are_tracked_and_copies_are_independent():
    snapshot = ContentSnapshot({"items": []})
    snapshot.value["items"].append({"nested": [1]})
    first = snapshot.fingerprint()
    snapshot.value["items"][0]["nested"][0] = 2
    second = snapshot.fingerprint()
    assert second != first
    overlay = copy.deepcopy(snapshot.value)
    assert type(overlay) is dict and type(overlay["items"]) is list
    overlay["items"][0]["nested"].append(3)
    assert snapshot.fingerprint() == second
    assert json.loads(json.dumps(snapshot.value)) == {"items": [{"nested": [2]}]}


def test_repository_replacement_and_version_updates_change_content_identity(tmp_path):
    repository = PlanningRepository(tmp_path)
    repository.baseline = {"version": "v1", "items": []}
    first = repository.baseline_fingerprint()
    repository.baseline["version"] = "v2"
    second = repository.baseline_fingerprint()
    assert second != first
    repository.baseline = {"version": "v1", "items": []}
    assert repository.baseline_fingerprint() == first
