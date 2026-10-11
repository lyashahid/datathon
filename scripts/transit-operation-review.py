"""Review public RTL stop identities without replacing the validated service snapshot.

python scripts/transit-operation-review.py --refresh
python scripts/transit-operation-review.py

The public endpoint returns remaining departures. This audit never promotes an
empty response to a closed stop, or a fresh late-night capture to a full timetable.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/transit-operation-review"
URL = "https://bo.rtl.mv:4455/maldives/api/booking/v2/bus/routedetails"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(refresh=False):
    RAW.mkdir(parents=True, exist_ok=True)
    capture_path = RAW / "rtl-routes-current.json"
    metadata_path = RAW / "rtl-routes-current-metadata.json"
    if refresh or not capture_path.exists() or not metadata_path.exists():
        # Validate the new capture before replacing the last validated local one.
        response = requests.get(URL, timeout=(20, 45), headers={"User-Agent": "MobilitySandboxMV/1.0 public stop operation review"})
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload.get("routeResponse"), list) or not payload["routeResponse"]:
            raise ValueError("RTL route response schema unavailable; preserve previous capture")
        metadata = dict(url=URL, publisher="MTCC / RTL", fetchedAt=datetime.now(timezone.utc).isoformat(), sha256=digest(response.content), bytes=len(response.content), contentType=response.headers.get("content-type"))
        capture_path.write_bytes(response.content)
        write_json(metadata_path, metadata)
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    capture = capture_path.read_bytes()
    if digest(capture) != metadata["sha256"]:
        raise ValueError("RTL audit capture checksum mismatch")
    payload = json.loads(capture)
    baseline_path = ROOT / "data/public/planning-baseline.json"
    baseline_bytes = baseline_path.read_bytes()
    baseline = json.loads(baseline_bytes)
    catalogue_audit = json.loads((ROOT / "data/public/transit-stop-audit.json").read_text(encoding="utf-8"))
    baseline_stops = {s["id"]: s for s in baseline["transit"]["stops"]}
    current_by_code = defaultdict(list)
    current_routes = []
    for route in payload["routeResponse"]:
        stops = sorted(route["busRouteStopList"], key=lambda s: s["order"])
        for stop in stops:
            current_by_code[str(stop["code"])].append((route, stop))
        timing_orders = [{t["order"] for t in s.get("timings", [])} for s in stops]
        common_orders = set.intersection(*timing_orders) if timing_orders else set()
        current_routes.append(dict(id="rtl:route:" + str(route["code"]), routeNumber=route["routeNumber"], name=route["name"], stopIds=["rtl:stop:" + str(s["code"]) for s in stops], stopCount=len(stops), stopsWithAnyReturnedTiming=sum(bool(s.get("timings")) for s in stops), rawCompleteTimingOrderCount=len(common_orders), qualification="Raw timing-order intersection only; not a recurring calendar, verified trajectory or substituted planning service."))
    pattern_ids = defaultdict(list)
    for pattern in baseline["transit"]["patterns"]:
        for sid in pattern["stopIds"]:
            pattern_ids[sid].append(pattern["id"])
    reviewed = []
    for stop in baseline_stops.values():
        code = stop["operatorCode"]
        memberships = current_by_code.get(code, [])
        points = sorted({(float(s["longitude"]), float(s["latitude"])) for _, s in memberships})
        coordinate_matches = bool(points) and all(list(p) == stop["coordinate"] for p in points)
        names = sorted({s["name"].strip() for _, s in memberships})
        loaded = bool(pattern_ids[stop["id"]])
        reviewed.append(dict(id=stop["id"], name=stop["name"], islandId=stop["islandId"], operatorCode=code, currentOperatorListed=bool(memberships), currentRouteIds=sorted({"rtl:route:" + str(r["code"]) for r, _ in memberships}), currentRouteNumbers=sorted({r["routeNumber"] for r, _ in memberships}), publishedCoordinateMatchesBaseline=coordinate_matches, currentNameMatchesBaseline=stop["name"] in names, loadedPlanningPatternIds=sorted(set(pattern_ids[stop["id"]])), loadedPlanningServiceAvailable=loaded, defaultMarkerEligible=bool(memberships) and loaded and coordinate_matches, physicalOperatingStatus="unverified", pickupAllowed=stop.get("pickupAllowed", True), reason="Operator-listed with a loaded dated service snapshot; physical boarding conditions are unverified." if loaded else "Operator-listed route membership exists, but this bundle has no complete departure timing. Hide from default service map; retain in optional catalogue."))
    baseline_codes = {s["operatorCode"] for s in baseline_stops.values()}
    islands = sorted({s["islandId"] for s in reviewed})
    by_island = [dict(islandId=island, operatorListedCodes=sum(s["islandId"] == island and s["currentOperatorListed"] for s in reviewed), codesWithLoadedPlanningService=sum(s["islandId"] == island and s["loadedPlanningServiceAvailable"] for s in reviewed), codesWithoutLoadedPlanningService=sum(s["islandId"] == island and not s["loadedPlanningServiceAvailable"] for s in reviewed)) for island in islands]
    reviewed_at = metadata["fetchedAt"]
    local_capture = datetime.fromisoformat(reviewed_at).astimezone(timezone(timedelta(hours=5))).isoformat()
    result = dict(schemaVersion=1, reviewedAt=reviewed_at, reviewedAtMaldivesLocal=local_capture, baselineVersion=baseline["version"], baselineSha256=digest(baseline_bytes), scope="Public-source identity and timing-coverage review; no field or telephone verification.", summary=dict(currentCatalogueRoutes=len(current_routes), currentRouteStopMembershipRecords=sum(r["stopCount"] for r in current_routes), currentUniqueOperatorStopCodes=len(current_by_code), baselineStopCodes=len(reviewed), addedOperatorCodes=sorted(set(current_by_code) - baseline_codes), removedOperatorCodes=sorted(baseline_codes - set(current_by_code)), changedPublishedCoordinateCodes=[s["operatorCode"] for s in reviewed if not s["publishedCoordinateMatchesBaseline"]], orphanCodes=[s["operatorCode"] for s in reviewed if not s["currentRouteIds"]], codesWithLoadedPlanningService=sum(s["loadedPlanningServiceAvailable"] for s in reviewed), codesWithoutLoadedPlanningService=sum(not s["loadedPlanningServiceAvailable"] for s in reviewed), physicalOpenVerifiedCodes=0, physicalClosedVerifiedCodes=0), byIsland=by_island, currentRoutes=current_routes, stops=reviewed, defaultHiddenStopIds=[s["id"] for s in reviewed if not s["defaultMarkerEligible"]], departureCoverage=dict(validatedSnapshotFetchedAt=baseline["transit"]["fetchedAt"], validatedSnapshotDate=baseline["transit"]["snapshotDate"], validatedRecordedWindowMinutes=baseline["transit"]["recordedDepartureWindowMinutes"], freshCaptureReplacesPlanningSnapshot=False, qualification="The earlier validated capture has 11 dated service patterns. Fresh late-evening timings are fewer and incomplete: absence from the remaining-departure response cannot establish non-operation. No full-day or recurring calendar is verified."), operationalCautions=catalogue_audit.get("operationalCautions", []), sources=[dict(id="rtl-transit-operation-review", url=URL, publisher="MTCC / RTL", referencePeriod="remaining departures at capture time", retrievedAt=reviewed_at, sha256=metadata["sha256"], rawPath="data/raw/transit-operation-review/rtl-routes-current.json", geographicCoverage="Greater Malé bus route catalogue", license="Public unauthenticated website endpoint; redistribution/feed reuse license not stated", transformationVersion="transit-operation-review-1"), dict(id="rtl-loaded-planning-snapshot", url=URL, publisher="MTCC / RTL", referencePeriod=baseline["transit"]["snapshotDate"], retrievedAt=baseline["transit"]["fetchedAt"], geographicCoverage="Greater Malé", qualification="Last validated remaining-departure snapshot; preserved rather than overwritten by the late-evening review."), dict(id="mtcc-temporary-diversion-primary", url="https://x.com/MTCCPlc/status/2102457648574812644", publisher="MTCC", checkedAt=reviewed_at, status="inaccessible", qualification="403 during fresh review. Secondary report retained as a caution, not confirmation of physical closure or an independently verified route path.")])
    result["version"] = "rtl-transit-operation-review-" + digest(json.dumps(result, sort_keys=True, ensure_ascii=False).encode())[:12]
    write_json(ROOT / "data/public/transit-operation-review.json", result)
    print(json.dumps(dict(version=result["version"], summary=result["summary"], byIsland=by_island), indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    main(parser.parse_args().refresh)
