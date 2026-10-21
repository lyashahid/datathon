"""Rebuild the source-to-model inventory without changing any input evidence.

Run from any directory with the backend Python environment. Source references in
data fields are distinguished from catalogue membership and failed acquisitions.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "data/public"

REGISTRIES = (
    "source-manifest.json",
    "policy-evidence/sources.json",
    "operations/source-manifest.json",
    "context/source-manifest.json",
    "delivery-evidence/references.json",
)
MODELS = {
    "datathon/airport.json": "MACL historical event-hour and monthly airport activity",
    "datathon/taxis.json": "Avas Ride historical trip profiles and coarse island corridors",
    "datathon/vessels.json": "FollowMe historical recorded device and near-island presence",
    "planning-baseline.json": "Existing Greater Malé planning inputs and source qualifications",
    "island-context.json": "186-island census, employment, projections and definitions",
    "national-population-origins.json": "186 additional island resident allocations",
    "national-planning-infrastructure.json": "National walking, facilities and route catalogues",
    "school-context.json": "Published 2023/24 school-locality grade counts and quantitative tables",
    "hdc-plan-context.json": "Dated HDC plan areas, capacity, land-use and housing panels",
    "constituency-context.json": "Census constituency cells without matched boundaries",
    "institution-context.json": "IGMH published annual institutional utilization",
    "official-finance-context.json": "Published Special Budget, MTCC and HIES aggregate cells",
    "government-health-license-context.json": "Government license history at 31 December 2024",
    "transport-context.json": "19 monthly transport categories with missingness/quarantine",
    "policy-evidence/bundle.json": "HDC spatial context and published policy observations",
    "policy-evidence/service-calendars.json": "Published ferry day types and frequency windows",
    "policy-evidence/ferry-terminals.json": "Operator terminal identity and coordinates",
    "operations/bundle.json": "CAP alerts, terminals, service gaps and imagery catalogue",
    "context/agency-context.json": "Published MPL port tables and CAA aviation aggregates",
    "context/followme-source.json": "Bounded public vessel capture coverage and provenance",
    "delivery-evidence/references.json": "Tariff bands and historical energy reference",
    "prediction-source.json": "Aggregate transport history and cross-publication forecast audit",
    "healthcare-location-audit.json": "Healthcare identity, operation and location review",
    "facility-operation-review.json": "Mapped education institution operation desk review",
    "education-location-audit.json": "School identity, exclusions and coordinate review",
    "transit-stop-audit.json": "Operator stop identity and planning-timing coverage review",
    "transit-operation-review.json": "Captured operator catalogue and unresolved diversion review",
}
SKIP_FIELDS = {
    "sources",
    "sourceReceipts",
    "identityReceipt",
    "identity_source",
    "sourceIds",
    "sourceSnapshotUtc",
    "generatedAt",
    "version",
    "schemaVersion",
}


def read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def references(value: Any):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "sources":
                continue
            if key in {"sourceId", "source_id", "catalogueComparisonSourceId"}:
                if isinstance(item, str):
                    yield item
            elif key.lower().endswith("sourceids") and isinstance(item, list):
                yield from (entry for entry in item if isinstance(entry, str))
            else:
                yield from references(item)
    elif isinstance(value, list):
        for item in value:
            yield from references(item)


def prepare(root: Path = ROOT) -> dict[str, Any]:
    public = root / "data/public"
    sources: dict[str, dict[str, Any]] = {}
    inputs: dict[str, dict[str, Any]] = {}
    artifacts = []

    def register(record: dict[str, Any], registry: str) -> None:
        source_id = record["id"]
        source = sources.setdefault(
            source_id,
            {
                "id": source_id,
                "title": record.get("title", source_id),
                "urls": [],
                "registries": [],
                "captures": [],
                "uses": [],
            },
        )
        url = record.get("url") or record.get("sourceUrl")
        if url and url not in source["urls"]:
            source["urls"].append(url)
        if registry not in source["registries"]:
            source["registries"].append(registry)
        receipt = record.get("receipt", {})
        path = (
            record.get("rawPath")
            or record.get("archivePath")
            or record.get("path")
            or receipt.get("path")
        )
        if not path and record.get("file"):
            prefix = (
                "data/public/archive/operations/"
                if registry.startswith("operations/")
                else "data/raw/"
            )
            path = prefix + record["file"]
        checksum = (
            record.get("sha256")
            or record.get("checksum")
            or record.get("archive_sha256")
            or receipt.get("sha256")
        )
        if path or checksum or record.get("status"):
            capture = {
                "path": path,
                "expectedSha256": checksum,
                "status": record.get("status", "captured"),
                "capturedAt": record.get("retrievedAt")
                or record.get("fetchedAt")
                or record.get("captured_at")
                or record.get("checkedAt"),
            }
            # Remote archive/member receipts deliberately have no local path.
            # Keep their identities and checksums without inventing a capture file.
            if not path:
                for key in ("archiveMember", "bytes", "url"):
                    if record.get(key) is not None:
                        capture[key] = record[key]
            if path:
                input_path = root / path
                capture["existsLocally"] = input_path.is_file()
                if input_path.is_file():
                    if path not in inputs:
                        inputs[path] = {
                            "path": path,
                            "sha256": digest(input_path),
                            "bytes": input_path.stat().st_size,
                        }
                    capture["actualSha256"] = inputs[path]["sha256"]
                    capture["checksumMatches"] = (
                        checksum == capture["actualSha256"] if checksum else None
                    )
            if capture not in source["captures"]:
                source["captures"].append(capture)

    def use(
        source_id: str,
        artifact: str,
        field: str,
        role: str,
        description: str,
        count: int | None = None,
    ):
        if source_id not in sources:
            sources[source_id] = {
                "id": source_id,
                "title": source_id,
                "urls": [],
                "registries": [],
                "captures": [],
                "uses": [],
            }
        entry = {
            "artifact": "data/public/" + artifact,
            "field": field,
            "role": role,
            "description": description,
        }
        if count is not None:
            entry["sourceReferences"] = count
        if entry not in sources[source_id]["uses"]:
            sources[source_id]["uses"].append(entry)

    for registry in REGISTRIES:
        for record in read(public / registry)["sources"]:
            register(record, registry)
    for name in MODELS:
        document = read(public / name)
        if isinstance(document, dict):
            for record in document.get("sources", []):
                register(record, name)
                for member, checksum in record.get("member_sha256", {}).items():
                    register(
                        {
                            "id": record["id"],
                            "title": record.get("title", record["id"]),
                            "url": record.get("url"),
                            "archiveMember": member,
                            "sha256": checksum,
                        },
                        name,
                    )
            for receipt in document.get("sourceReceipts", []):
                path = receipt.get("path")
                if not path:
                    # Some source formats describe downloaded archive bytes and
                    # members, rather than files retained in this checkout.
                    records = document.get("sources", [])
                    matching = [
                        record
                        for record in records
                        if receipt.get("source_id", receipt.get("sourceId")) == record["id"]
                        or (receipt.get("url") and receipt["url"] == record.get("url"))
                    ]
                    if len(matching) == 1 or len(records) == 1:
                        source = matching[0] if len(matching) == 1 else records[0]
                        register(
                            {
                                **receipt,
                                "id": source["id"],
                                "title": source.get("title", source["id"]),
                            },
                            name,
                        )
                    continue
                if (root / path).is_file() and path not in inputs:
                    inputs[path] = {
                        "path": path,
                        "sha256": digest(root / path),
                        "bytes": (root / path).stat().st_size,
                    }
                if path in inputs:
                    inputs[path].setdefault("modelConsumers", []).append("data/public/" + name)
            role = (
                "bounded_snapshot_context"
                if name.startswith("datathon/")
                else "audit_evidence"
                if "audit" in name or "review" in name
                else "model_input"
            )
            for field, value in document.items():
                if field in SKIP_FIELDS:
                    continue
                for source_id, count in Counter(references(value)).items():
                    use(source_id, name, field, role, MODELS[name], count)
            artifacts.append(
                {
                    "path": "data/public/" + name,
                    "sha256": digest(public / name),
                    "purpose": MODELS[name],
                    "version": document.get("version") or document.get("transformVersion"),
                    "coverage": document.get("coverage"),
                    "collections": {
                        key: len(value)
                        for key, value in document.items()
                        if isinstance(value, list) and key != "sources"
                    },
                }
            )

    # Input receipts also document transformations whose rows intentionally omit a
    # repeated source ID (hierarchy nodes, polygon allocations and definitions).
    explicit = {
        "osm-geofabrik-national-graph": [
            (
                "national-population-origins.json",
                "islands/origins",
                "model_input",
                (
                    "Cached graph-source residential building and land-use evidence "
                    "constrain screened allocation fallbacks"
                ),
            ),
            (
                "national-planning-infrastructure.json",
                "network",
                "model_input",
                "Walking graph tags use its receipt-matched OSM extract; no surveyed entrances",
            ),
        ],
        "onemap-islands": [
            (
                "national-population-origins.json",
                "islands/origins",
                "model_input",
                "Captured official island polygons constrain allocation boundaries and identities",
            ),
        ],
        "worldpop2026": [
            (
                "national-population-origins.json",
                "origins",
                "model_input",
                (
                    "Screened raster weights normalized to official island resident "
                    "projections; unsuitable weights use disclosed fallbacks"
                ),
            )
        ],
        "mbs-island-projections": [
            (
                "national-population-origins.json",
                "islands/origins",
                "model_input",
                "2026 and 2030 official whole-island totals conserved by resident allocations",
            )
        ],
        "mbs-population-definitions": [
            (
                "island-context.json",
                "definitions",
                "definition",
                "Resident scope, nationality and population indicator definitions",
            )
        ],
        "mbs-employment-definitions": [
            (
                "island-context.json",
                "definitions",
                "definition",
                "Labour indicator denominators and working-age definitions",
            )
        ],
        "budget2026": [
            (
                "official-finance-context.json",
                "budgetProgrammeHierarchy/budgetAllocations",
                "model_input",
                (
                    "All 1,156 captured Special Budget hierarchy nodes and 420 terminal"
                    " lines for five fiscal years; parent totals not added twice"
                ),
            )
        ],
        "mbs-hies-expenditure-methods-2019": [
            (
                "official-finance-context.json",
                "hiesExpenditure",
                "definition",
                (
                    "Survey expenditure scope, prices and exclusions qualify the 2019 "
                    "aggregate estimates"
                ),
            )
        ],
        "osm-geofabrik-metadata": [
            (
                "planning-baseline.json",
                "sources",
                "acquisition_provenance",
                (
                    "Geofabrik extract catalogue identifies the Maldives PBF download, "
                    "not additional road observations"
                ),
            )
        ],
        "rtl-home": [
            (
                "planning-baseline.json",
                "transit",
                "acquisition_provenance",
                (
                    "Official operator website entry used to discover its public client"
                    " and route endpoints"
                ),
            )
        ],
        "rtl-public-client": [
            (
                "planning-baseline.json",
                "transit",
                "acquisition_provenance",
                (
                    "Public website JavaScript documents the unauthenticated route, map"
                    " and road-shape request formats"
                ),
            )
        ],
        "mtcc-downloads": [
            (
                "policy-evidence/service-calendars.json",
                "calendars",
                "acquisition_provenance",
                (
                    "Operator download catalogue identifies the four separately "
                    "captured ferry calendar PDFs"
                ),
            )
        ],
        "yearbook2025": [
            (
                "planning-baseline.json",
                "demographics",
                "acquisition_provenance",
                (
                    "Official yearbook catalogue identifies Table 3.3, used for the "
                    "Greater Malé population context"
                ),
            )
        ],
        "rtl-bus-maps": [
            (
                "planning-baseline.json",
                "transit",
                "source_validation",
                (
                    "Captured operator map catalogue provides route-map geometry "
                    "context; not a recurring timetable"
                ),
            )
        ],
        "health-registry-hospitals3": [
            (
                "healthcare-location-audit.json",
                "sources",
                "audit_search_receipt",
                (
                    "Third official hospital-directory page retained with the paginated"
                    " directory lookup; absence does not establish closure"
                ),
            )
        ],
        "facility-aasandha-medica": [
            (
                "healthcare-location-audit.json",
                "facilities",
                "audit_search_receipt",
                (
                    "Medica provider-list first-page capture is retained alongside page"
                    " two and operator evidence for identity reconciliation"
                ),
            )
        ],
        "mbs-yearbook-2026": [
            (
                "context/agency-context.json",
                "layers.flights",
                "acquisition_provenance",
                (
                    "Official yearbook download catalogue identifies aviation Tables "
                    "11.10, 11.13 and 11.18"
                ),
            )
        ],
        "maavehi-road-map": [
            (
                "operations/bundle.json",
                "gaps/roadEvents",
                "empty_acquisition",
                (
                    "The captured empty municipal endpoint explains unavailable "
                    "road-event coverage; it is not evidence that roads are clear"
                ),
            )
        ],
        "rtl-bus-service-check": [
            (
                "operations/bundle.json",
                "serviceEvidence",
                "coverage_audit",
                (
                    "Captured route/departure response establishes remaining-snapshot "
                    "coverage and missing recurring bus calendars"
                ),
            )
        ],
        "rtl-vessel-service-check": [
            (
                "operations/bundle.json",
                "serviceEvidence",
                "coverage_audit",
                (
                    "Captured vessel response establishes catalogue coverage and "
                    "missing paired arrivals/travel times"
                ),
            )
        ],
    }
    for source_id, entries in explicit.items():
        for artifact, field, role, description in entries:
            use(source_id, artifact, field, role, description)
    for source_id, artifact, field, description in [
        (
            "rtl-public-bus-snapshot",
            "policy-evidence/bundle.json",
            "gaps",
            "Dated remaining-departure capture supports the missing-calendar coverage gap",
        ),
        (
            "rtl-public-vessel-catalog",
            "policy-evidence/service-calendars.json",
            "limitations",
            "Dated vessel catalogue preserves terminal identity and unpaired-departure evidence",
        ),
    ]:
        use(source_id, artifact, field, "coverage_audit", description)
    use(
        "rtl-loaded-planning-snapshot",
        "transit-operation-review.json",
        "departureCoverage",
        "audit_evidence",
        "Records the retained planning snapshot date and its limited timing window",
    )
    use(
        "mtcc-temporary-diversion-primary",
        "transit-operation-review.json",
        "operationalCautions",
        "failed_retrieval_reference",
        "The linked primary notice returned 403; the secondary diversion remains unresolved",
    )
    # Same ferry publication has an original planning capture and a separately
    # hashed policy-calendar capture. Keep both acquisition receipts identifiable.
    for route, year in [
        ("vilimale", "2026"),
        ("hulhumale", "2024"),
        ("thilafushi", "2026"),
        ("gulhifalhu", "2026"),
    ]:
        use(
            f"mtcc-{route}{year}",
            "planning-baseline.json",
            "transit",
            "source_validation",
            (
                "Original operator ferry-calendar capture retained to reproduce "
                "baseline frequency/service assumptions"
            ),
        )
    for source_id in list(sources):
        if source_id.startswith("mms-cap-") and source_id != "mms-cap-feed":
            use(
                source_id,
                "operations/bundle.json",
                "weatherAlerts",
                "model_input",
                (
                    "Individual CAP message supplies warning geometry, severity and "
                    "validity for the captured RSS feed"
                ),
            )
        if source_id.startswith("mbs-2026-") and source_id.endswith("-pdf"):
            use(
                source_id,
                "context/agency-context.json",
                "layers.flights",
                "source_validation",
                (
                    "Published PDF companion preserves headings, units and footnotes "
                    "for the matching aviation workbook"
                ),
            )

    audit = read(public / "prediction-source.json")["audit"]
    for source_id, record in audit["sources"].items():
        register(
            {"id": source_id, **record, "title": "MBS monthly publication " + source_id},
            "prediction-source.json#audit.sources",
        )
        use(
            source_id,
            "prediction-source.json",
            "audit",
            "audit_evidence",
            (
                "Pinned publication vintage supports history revisions, repeated "
                "bus-month quarantine and definition checks"
            ),
        )
    followme = read(public / "context/followme-source.json")
    followme_dir = root / "data/public/archive/context/followme"
    followme_paths = {
        digest(path): path.relative_to(root).as_posix()
        for path in followme_dir.iterdir()
        if path.is_file() and path.suffix in {".html", ".json"}
    }
    for record in followme["provenance"]:
        register(
            {
                **record,
                "path": followme_paths.get(record["sha256"]),
                "url": followme["sourceUrl"],
            },
            "context/followme-source.json",
        )
        use(
            record["id"],
            "context/followme-source.json",
            "coverage/provenance",
            "bounded_snapshot_context",
            (
                "Owner-selected public vessel directory or one-shot position receipt; "
                "no continuous fleet coverage or transit role inferred"
            ),
        )
    failure_ids = {
        row["source_id"]
        for row in read(public / "delivery-evidence/references.json")["retrieval_failures"]
    }
    for source_id in failure_ids:
        use(
            source_id,
            "delivery-evidence/references.json",
            "retrieval_failures/historical_energy",
            "failed_retrieval_reference",
            (
                "The methodology URL returned 404; manually transcribed historical "
                "energy context remains qualified and is not a current emissions factor"
            ),
        )

    unused = []
    for source_id, source in sources.items():
        if not source["uses"]:
            unused.append(source_id)
        source["usageStatus"] = "unused_requires_review" if not source["uses"] else "used"
        source["roles"] = sorted({entry["role"] for entry in source["uses"]})
    checksum_failures = [
        {"sourceId": source["id"], **capture}
        for source in sources.values()
        for capture in source["captures"]
        if capture.get("checksumMatches") is False
    ]
    output = {
        "schemaVersion": 1,
        "transformVersion": "source-use-inventory-v1",
        "method": (
            "Explicit source-ID references in data fields plus reviewed "
            "acquisition/definition/audit links; source-list membership alone is not "
            "model use."
        ),
        "reproduce": "backend/.venv/Scripts/python.exe backend/scripts/prepare_source_use.py",
        "sources": sorted(sources.values(), key=lambda item: item["id"]),
        "modelArtifacts": artifacts,
        "reproductionInputs": sorted(inputs.values(), key=lambda item: item["path"]),
        "summary": {
            "sourceIds": len(sources),
            "modelArtifacts": len(artifacts),
            "unusedSourceIds": sorted(unused),
            "checksumMismatches": checksum_failures,
            "roleCounts": dict(
                sorted(
                    Counter(role for source in sources.values() for role in source["roles"]).items()
                )
            ),
        },
        "retention": (
            "Original captures, definition/method documents, discovery catalogues, "
            "rejected matches and dated audit inputs are retained for reproduction. "
            "Datathon release archives are temporary review inputs rather than runtime "
            "dependencies; their pathless hash receipts identify remote bytes for reacquisition. "
            "Empty/failed attempts are explicitly marked and supply no invented "
            "observations."
        ),
        "limits": [
            (
                "This inventory describes the relevant quantitative project models and "
                "their acquisition/audit evidence; it does not claim every paragraph of"
                " every PDF was converted."
            ),
            (
                "Archive paths may be locally available but excluded from Git; receipts"
                " alone cannot recreate missing source bytes."
            ),
            (
                "Source IDs can have multiple dated captures. Paths and checksums "
                "preserve those distinctions."
            ),
            (
                "Island resident allocations do not imply complete walking, facility or"
                " scheduled public-transport coverage."
            ),
        ],
    }
    encoded = json.dumps(output, sort_keys=True, allow_nan=False).encode()
    output["version"] = "source-use-inventory-v1:" + hashlib.sha256(encoded).hexdigest()[:16]
    return output


if __name__ == "__main__":
    result = prepare()
    target = PUBLIC / "source-use.json"
    target.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    print(json.dumps(result["summary"], indent=2))
