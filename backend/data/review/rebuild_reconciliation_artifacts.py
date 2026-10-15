import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

root = Path("D:/datathon/backend")
data = root / "data"
review = data / "review"
facilities = json.loads((data / "cache/normalized/facilities.json").read_text(encoding="utf-8"))
audit = json.loads((review / "facility-mapping-audit.json").read_text(encoding="utf-8"))
rows = {r["facility_id"]: r for r in audit["rows"]}
now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def source_for(f):
    attrs = f.get("attributes") or {}
    if f.get("category") == "school":
        ident = attrs.get("school_id") or attrs.get("establishment_id") or f["id"].split(":")[-1]
        return {
            "url": f"https://www.moe.gov.mv/en/schools/{ident}",
            "kind": "official_ministry_of_education_record",
        }
    return {
        "url": "https://hems.health.gov.mv/establishments",
        "kind": "official_ministry_of_health_hems_record",
    }


def decision(status, mapped):
    if mapped:
        if status == "osm_provisional_review_required":
            return "mapped_record_provisional_review_required"
        return "mapped_record_live_verified"
    if status == "island_context_only":
        return "unresolved_island_context_only"
    if status == "source_not_in_osm":
        return "unresolved_source_not_found_current_osm"
    if status == "osm_match_review_required":
        return "unresolved_competing_candidates"
    return "unresolved"


records = []
for f in facilities:
    row = rows[f["id"]]
    mapped = bool(f.get("osm_object_id"))
    flags = row["flags"]
    checks = {
        "live_object_exists": mapped and "live_verification_missing" not in flags,
        "category_compatible": "category_incompatible" not in flags,
        "same_island_as_normalized_mapping": "island_mismatch" not in flags,
        "name_or_identifier_label_match": "weak_name_overlap" not in flags,
        "local_geometry_available": mapped and bool(row.get("osm_id")),
        "geometry_within_maldives": "geometry_outside_maldives_bounds" not in flags,
    }
    follow = "none"
    if "duplicate_osm_claim" in flags:
        follow = "review_shared_osm_object_claims"
    elif f.get("match_status") == "osm_provisional_review_required":
        follow = "retain_provisional_and_exclude_from_deterministic_scoring"
    elif not mapped:
        follow = (
            "obtain_official_coordinates_or_facility_level_osm_identity; do_not_invent_geometry"
        )
    record = {
        "facility_id": f["id"],
        "official_name": f.get("name"),
        "category": f.get("category"),
        "source": source_for(f),
        "current_match_status": f.get("match_status"),
        "island_id": f.get("island_id"),
        "island_context": f.get("location_context"),
        "reviewed_at": now,
        "decision": decision(f.get("match_status"), mapped),
        "osm_object_id": f.get("osm_object_id"),
        "verification_result": "audit_passed"
        if mapped and not flags
        else (";".join(flags) if flags else None),
        "checks": checks,
        "follow_up": follow,
        "audit_flags": flags,
    }
    records.append(record)
counts = Counter(r["decision"] for r in records)
ledger = {
    "version": "facility-reconciliation-ledger-v2",
    "generated_at": now,
    "scope": {
        "official_source_facilities": len(records),
        "mapped_facilities": sum(bool(r.get("osm_object_id")) for r in records),
        "unique_mapped_osm_objects": len(
            {r["osm_object_id"] for r in records if r.get("osm_object_id")}
        ),
    },
    "facility_count": len(records),
    "records": records,
    "decision_counts": dict(counts),
}
(review / "facility-reconciliation-ledger.json").write_text(
    json.dumps(ledger, ensure_ascii=False, indent=2), encoding="utf-8"
)
unresolved = [r for r in records if not r.get("osm_object_id")]
for ext in ("json", "md", "csv"):
    p = review / f"unresolved-{len(unresolved)}-records.{ext}"
    if ext == "json":
        p.write_text(
            json.dumps(
                {
                    "version": "unresolved-facilities-v2",
                    "generated_at": now,
                    "record_count": len(unresolved),
                    "records": unresolved,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    elif ext == "md":
        lines = [f"# Unresolved Facilities ({len(unresolved)})", "", f"Generated: {now}", ""]
        for r in unresolved:
            lines.append(f"- `{r['facility_id']}` {r['official_name']} — {r['decision']}")
        p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    else:
        with p.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(
                fh,
                fieldnames=[
                    "facility_id",
                    "official_name",
                    "category",
                    "current_match_status",
                    "decision",
                    "island_id",
                ],
            )
            w.writeheader()
            for r in unresolved:
                w.writerow({k: r.get(k) for k in w.fieldnames})
print(
    json.dumps(
        {
            "facilities": len(records),
            "mapped": sum(bool(r.get("osm_object_id")) for r in records),
            "unresolved": len(unresolved),
            "decision_counts": dict(counts),
        },
        indent=2,
    )
)
