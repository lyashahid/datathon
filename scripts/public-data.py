"""Acquire, prepare and validate a source-backed Greater Male planning snapshot.

python scripts/public-data.py fetch
python scripts/public-data.py prepare
python scripts/public-data.py validate

Raw files are a reproducible local archive. Missing required inputs are errors;
optional unavailable sources remain visible gaps, never synthetic substitutes.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import importlib.util
from datetime import datetime, timezone

import requests

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PUBLIC = ROOT / "data" / "public"
MANIFEST = RAW / "source-manifest.json"
OUT = PUBLIC / "planning-baseline.json"
BOUNDS = (73.46, 4.155, 73.57, 4.275)
SOURCES = [
    dict(id="mbs-census2022-population", file="census2022-population.xlsx", url="https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/09/Island-Level-Indicator-Sheet-Population.xlsx", title="MBS Census 2022 island population indicators", referenceYear=2022, license="Public official download; explicit reuse license not stated", qualification="Administrative-island indicators exclude Malé; archived for national expansion, not used to invent Malé neighborhood demographics"),
    dict(id="mbs-census2022-employment", file="census2022-employment.xlsx", url="https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/10/Island-Level-Indicator-Sheet-Emp.xlsx", title="MBS Census 2022 island employment indicators", referenceYear=2022, license="Public official download; explicit reuse license not stated"),
    dict(id="mbs-population-definitions", file="population-definitions.xlsx", url="https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/09/Definitions-Population.xlsx", title="MBS Census population definitions", referenceYear=2022, license="Public official download; explicit reuse license not stated"),
    dict(id="mbs-employment-definitions", file="employment-definitions.xlsx", url="https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/09/Definitions-Employment.xlsx", title="MBS Census employment definitions", referenceYear=2022, license="Public official download; explicit reuse license not stated"),
    dict(id="mbs-island-projections", file="island-projections2022-2030.xlsx", url="https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2026/08/IslandLevelProjection_2022-2030.xlsx", title="MBS annual island population projections 2022–2030", referenceYear="2022–2030", license="Public official download; explicit reuse license not stated", required=True),
    dict(id="worldpop2026", file="worldpop2026.tif", url="https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2026/MDV/v1/100m/constrained/mdv_pop_2026_CN_100m_R2025A_v1.tif", title="WorldPop Maldives 2026 population R2025A v1 alpha", referenceYear=2026, license="CC BY 4.0", required=True),
    dict(id="osm-geofabrik", file="maldives-latest.osm.pbf", url="https://download.geofabrik.de/asia/maldives-latest.osm.pbf", title="OpenStreetMap Maldives Geofabrik snapshot", referenceYear=2026, license="ODbL 1.0; © OpenStreetMap contributors", required=True),
    dict(id="osm-geofabrik-metadata", file="geofabrik.html", url="https://download.geofabrik.de/asia/maldives.html", title="Geofabrik extract timestamp and metadata", referenceYear=2026, license="Public metadata"),
    dict(id="health-government2024", file="government-health-facilities2024.pdf", url="https://health.gov.mv/storage/uploads/Vw9rVzYv/lcyhn3xt.pdf", title="Ministry of Health government facilities as at 31 Dec 2024", referenceYear=2024, license="Public official download; explicit reuse license not stated"),
    dict(id="health-registry", file="health-registry.html", url="https://hems.health.gov.mv/establishments", title="Ministry of Health public establishment registry", referenceYear=2026, license="Public view; explicit reuse license not stated"),
    dict(id="education-schools", file="education-schools.html", url="https://www.moe.gov.mv/en/schools", title="Ministry of Education school directory", referenceYear=2025, license="Public view; explicit reuse license not stated"),
    dict(id="rtl-home", file="rtl-home.html", url="https://www.rtl.mv/", title="RTL official route and timetable portal", referenceYear=2026, license="Public view; no open feed license confirmed"),
    dict(id="mtcc-downloads", file="mtcc-downloads.html", url="https://mtcc.mv/downloads/", title="MTCC official downloads and transport timetables", referenceYear=2026, license="Public view; no open feed license confirmed"),
    dict(id="sto-fuel2026", file="sto-fuel2026.html", url="https://sto.mv/newsroom/news/22/fuel-price-revision-march-2026", title="STO fuel retail price revision effective 5 Mar 2026", referenceYear=2026, license="Public official announcement"),
    dict(id="stelco-tariff", file="stelco-tariff.html", url="https://stelco.com.mv/tariff-rates", title="STELCO published Malé electricity tariffs", referenceYear=2026, license="Public official table; dated surcharge notes require validation"),
    dict(id="mtcc-annual2025", file="mtcc-annual2025.pdf", url="https://informinvestor.cmda.gov.mv/storage/uploads/aMwLdVwr/okx5dksl.pdf", title="MTCC Annual Report 2025 public regulator disclosure", referenceYear=2025, license="Public disclosure; explicit reuse license not stated"),
    dict(id="yearbook2025", file="yearbook2025.html", url="https://statisticsmaldives.gov.mv/yearbook/2025/", title="MBS Statistical Yearbook 2025", referenceYear=2024, license="Public official tables; explicit reuse license not stated"),
    dict(id="budget2026", file="budget2026.html", url="https://budget.gov.mv/en/yearly-program-budget/8667", title="Government budget MTCC ferry subsidy programme", referenceYear=2026, license="Public official table; preserve actual/revised/approved labels"),
    dict(id="mbs-census2022-male-table", file="yearbook2025-table3.3.xlsx", url="https://statisticsmaldives.gov.mv/yearbook/2025/wp-content/uploads/sites/12/2026/02/3.3.xlsx", title="MBS Yearbook 2025 table 3.3 census resident population by Malé locality", referenceYear=2022, license="Public official table; explicit reuse license not stated", required=True),
    dict(id="mtcc-vilimale2026", file="vilimale-ferry2026.pdf", url="https://mtcc.mv/wp-content/uploads/2025/12/Vili-male-Ferry-Schedule-2026-V1.pdf", title="MTCC Vilimalé ferry schedule 2026 V1", referenceYear=2026, license="Public official timetable; explicit feed license not stated"),
    dict(id="mtcc-hulhumale2024", file="hulhumale-ferry2024.pdf", url="https://mtcc.mv/wp-content/uploads/2021/07/Hulhumale-Ferry-Schedule-16-4-2024.pdf", title="MTCC Hulhumalé ferry schedule effective 16 Apr 2024", referenceYear=2024, license="Public official timetable; current validity requires operator confirmation"),
    dict(id="mtcc-thilafushi2026", file="thilafushi-ferry2026.pdf", url="https://mtcc.mv/wp-content/uploads/2021/07/Thilafushi-Ferry-Schedule-2026-V2.pdf", title="MTCC Thilafushi ferry schedule 2026 V2", referenceYear=2026, license="Public official timetable; explicit feed license not stated"),
    dict(id="mtcc-gulhifalhu2026", file="gulhifalhu-ferry2026.pdf", url="https://mtcc.mv/wp-content/uploads/2021/07/Gulhifalhu-Ferry-Schedule-2026-V1.pdf", title="MTCC Gulhifalhu ferry schedule 2026 V1", referenceYear=2026, license="Public official timetable; explicit feed license not stated"),
    dict(id="rtl-public-client", file="rtl-public-client.js", url="https://www.rtl.mv/main-es2015.fe1f140b40447556b695.js", title="RTL public website client; inspect public route/timetable endpoints", referenceYear=2026, license="Public client used for reproducible endpoint discovery; do not redistribute code"),
    dict(id="rtl-bus-routes", file="rtl-bus-routes.json", url="https://bo.rtl.mv:4455/maldives/api/booking/v2/bus/routedetails", title="RTL public bus route, stop, fare and remaining-departure snapshot", referenceYear=2026, license="Unauthenticated public website endpoint; feed reuse license and calendar not stated", qualification="Endpoint discovered in official public website client. Remaining departures at retrieval; not a full recurring timetable."),
    dict(id="rtl-bus-maps", file="rtl-bus-maps.json", url="https://rtl.mv:7781/maldives/cms/CMSGetAllBusRouteMap", title="RTL public bus route map catalogue", referenceYear=2026, license="Unauthenticated public website endpoint; feed reuse license not stated"),
    dict(id="health-registry-hospitals", file="health-registry-hospitals.html", url="https://hems.health.gov.mv/establishments?search=Hospital", title="Ministry of Health public registry hospital name filter", referenceYear=2026, license="Public official registry view; explicit reuse license not stated"),
    dict(id="health-registry-hospitals2", file="health-registry-hospitals2.html", url="https://hems.health.gov.mv/establishments?search=Hospital&page=2", title="Ministry of Health public registry hospital filter page 2", referenceYear=2026, license="Public official registry view; explicit reuse license not stated"),
    dict(id="health-registry-hospitals3", file="health-registry-hospitals3.html", url="https://hems.health.gov.mv/establishments?search=Hospital&page=3", title="Ministry of Health public registry hospital filter page 3", referenceYear=2026, license="Public official registry view; explicit reuse license not stated"),
    dict(id="education-directory-audit", file="audits/education-directory-current.html", url="https://www.moe.gov.mv/en/schools", title="Ministry of Education school directory fresh location audit", referenceYear=2025, referencePeriod="2025-05-23", license="Public official directory; explicit reuse license not stated", qualification="Government-school directory; page displayed update23 May2025. Absence does not imply a private school or college is closed."),
    dict(id="education-fiyavathi-presidency", file="audits/fiyavathi-presidency2024.html", url="https://presidency.gov.mv/Press/Article/32384", title="President's Office Fiyavathi state care institution description", referenceYear=2024, referencePeriod="2024-12-07", license="Public official evidence; explicit reuse license not stated"),
    dict(id="education-stem-maaharaa", file="audits/stem-maaharaa2026.html", url="https://maaharaa.health.gov.mv/Public/Home/ListHealthCare", title="Ministry of Health registered facilities including Stem Center therapy service", referenceYear=2026, license="Public official registry; explicit reuse license not stated"),
]


def now():
    return datetime.now(timezone.utc).isoformat()


def save_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")


def fetch_one(source, refresh=False):
    record = dict(source)
    path = RAW / source["file"]
    try:
        previous = next((r for r in json.loads(MANIFEST.read_text(encoding="utf-8")).get("sources", []) if r["id"] == source["id"]), {}) if MANIFEST.exists() else {}
        if refresh or not path.exists() or not previous.get("fetchedAt"):
            response = requests.request(source.get("method", "GET"), source["url"], json=source.get("requestJson"), timeout=(20, 120), headers={"User-Agent": "MobilitySandboxMV/1.0 public data research"})
            response.raise_for_status()
            data = response.content
            if not data:
                raise ValueError("Empty response")
            if path.suffix in {".xlsx", ".pbf", ".tif", ".pdf"} and "text/html" in response.headers.get("Content-Type", ""):
                raise ValueError("HTML returned instead of requested data file")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            record.update(finalUrl=response.url, contentType=response.headers.get("Content-Type"), fetchedAt=now(), lastModified=response.headers.get("Last-Modified"))
        else:
            actual = hashlib.sha256(path.read_bytes()).hexdigest()
            if previous.get("sha256") and actual != previous["sha256"]:
                raise ValueError("Existing raw cache differs from recorded checksum; use --refresh to acquire a new trusted snapshot")
            record.update({k: previous[k] for k in ["fetchedAt", "finalUrl", "contentType", "lastModified"] if k in previous})
        data = path.read_bytes()
        if path.suffix == ".pdf" and not data.startswith(b"%PDF"):
            raise ValueError("Requested PDF has no PDF signature")
        if path.suffix == ".xlsx" and not data.startswith(b"PK"):
            raise ValueError("Requested XLSX has no ZIP signature")
        if path.suffix == ".tif" and data[:2] not in {b"II",b"MM"}:
            raise ValueError("Requested GeoTIFF has no TIFF signature")
        if path.suffix == ".json":
            payload = json.loads(data)
            if source["id"] == "rtl-bus-routes" and not isinstance(payload.get("routeResponse"),list):
                raise ValueError("Bus route response schema is unavailable")
            if source["id"].startswith("rtl-roadshape-") and payload.get("roadShape",{}).get("type") != "FeatureCollection":
                raise ValueError("Operator road shape schema is unavailable")
        record.update(status="downloaded", bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), rawPath="data/raw/" + source["file"], lastValidatedAt=now())
        print(f"OK {source['id']}: {len(data):,} bytes", flush=True)
    except Exception as exc:
        record.update(status="unavailable", error=f"{type(exc).__name__}: {exc}", lastAttemptedAt=now())
        print(f"UNAVAILABLE {source['id']}: {exc}", flush=True)
    return record


def fetch(refresh=False):
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / ".gitignore").write_text("*\n!.gitignore\n", encoding="utf-8")
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        records = list(pool.map(lambda s: fetch_one(s, refresh), SOURCES))
    discovered = []
    if (RAW / "rtl-bus-routes.json").exists():
        route_data = json.loads((RAW / "rtl-bus-routes.json").read_text(encoding="utf-8"))
        for route in route_data.get("routeResponse", []):
            discovered.append(dict(id="rtl-roadshape-"+str(route["code"]), file="rtl-roadshape-"+str(route["code"])+".json", url="https://bo.rtl.mv:4455/maldives/api/booking/v2/bus/roadshape", method="POST", requestJson=dict(routeCode=str(route["code"])), title="RTL operator public road geometry · "+route["routeNumber"], referenceYear=2026, license="Unauthenticated public website endpoint; reuse license and direction geometry semantics not stated", qualification="Read-only public website geometry lookup discovered in operator client; does not create bookings or accounts"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        records += list(pool.map(lambda s: fetch_one(s, refresh), discovered))
    save_json(MANIFEST, dict(generatedAt=now(), sources=records))
    save_json(PUBLIC / "source-manifest.json", dict(generatedAt=now(), sources=records))
    if any(r.get("required") and r["status"] != "downloaded" for r in records):
        raise RuntimeError("Required input unavailable; see source-manifest.json")


def haversine(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    v = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371000 * 2 * math.asin(min(1, math.sqrt(v)))


def in_bounds(lon, lat):
    return BOUNDS[0] <= lon <= BOUNDS[2] and BOUNDS[1] <= lat <= BOUNDS[3]


def audit_stops(refresh=False):
    """Compare the public operator catalogue without replacing departure data."""
    audit_dir = RAW / "audits"
    audit_dir.mkdir(parents=True, exist_ok=True)
    targets = [
        dict(id="rtl-bus-routes-audit", file="rtl-routes-current.json", url="https://bo.rtl.mv:4455/maldives/api/booking/v2/bus/routedetails", title="RTL stop catalogue fresh audit snapshot", license="Unauthenticated public operator endpoint; feed reuse license not stated"),
        dict(id="mtcc-westpark-notice-report", file="mtcc-westpark-notice-report.html", url="https://www.plus.mv/english/male-bus-routes-adjusted-as-boduthakurufaanu-magu-redevelopment-advances/", title="MV+ report linking the MTCC 22 September temporary diversion notice", license="Copyright MV+; raw local evidence only, do not redistribute article", referencePeriod="2026-09-23", qualification="Secondary report; linked primary social notice is inaccessible. Retained as a reported caution, not a verified stop closure."),
    ]
    for target in targets:
        path = audit_dir / target["file"]
        meta_path = audit_dir / (path.stem+"-metadata.json")
        previous = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        if not refresh and path.exists() and previous.get("sha256"):
            if hashlib.sha256(path.read_bytes()).hexdigest() != previous["sha256"]:
                raise ValueError(f"Stop audit cache checksum mismatch: {target['id']}")
            continue
        record = dict(target, file="audits/"+target["file"])
        try:
            response = requests.get(target["url"], timeout=(20, 45), headers={"User-Agent":"MobilitySandboxMV/1.0 public stop audit"})
            response.raise_for_status()
            if target["id"] == "rtl-bus-routes-audit" and not isinstance(response.json().get("routeResponse"), list):
                raise ValueError("Operator route catalogue schema unavailable")
            path.write_bytes(response.content)
            record.update(status="downloaded",fetchedAt=now(),sha256=hashlib.sha256(response.content).hexdigest(),bytes=len(response.content),rawPath="data/raw/"+record["file"],finalUrl=response.url,contentType=response.headers.get("Content-Type"))
        except Exception as exc:
            record.update(status="unavailable",lastAttemptedAt=now(),error=f"{type(exc).__name__}: {exc}")
            if target["id"] == "rtl-bus-routes-audit":
                save_json(meta_path, record)
                raise
        save_json(meta_path, record)
    module = load_prepare_module()
    baseline = json.loads(OUT.read_text(encoding="utf-8"))
    geoms = {i["id"]:module.shape(i["geometry"]) for i in baseline["islands"]}
    result = module.audit_transit_stops(baseline["transit"], baseline["network"], geoms, RAW, baseline["sources"])
    save_json(PUBLIC / "transit-stop-audit.json", result)
    print(json.dumps(result["summary"], ensure_ascii=False))


def prepare():
    # Implementation below is deliberately separate from acquisition.
    module = load_prepare_module()
    module.prepare_snapshot(ROOT, RAW, PUBLIC, MANIFEST, OUT, BOUNDS)


def validate():
    load_prepare_module().validate_snapshot(OUT)


def load_prepare_module():
    spec = importlib.util.spec_from_file_location("public_data_prepare", Path(__file__).with_name("public-data-prepare.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["fetch", "prepare", "validate", "all", "audit-stops"])
    parser.add_argument("--refresh", action="store_true", help="Fetch new source bytes instead of reusing verified raw cache")
    args = parser.parse_args()
    if args.command in {"fetch", "all"}:
        fetch(args.refresh)
    if args.command in {"prepare", "all"}:
        prepare()
    if args.command in {"validate", "all"}:
        validate()
    if args.command == "audit-stops":
        audit_stops(args.refresh)
