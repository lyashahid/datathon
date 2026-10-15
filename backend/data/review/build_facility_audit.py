import json
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

root = Path("D:/datathon/backend")
data = root / "data"
review = data / "review"
fac = json.loads((data / "cache/normalized/facilities.json").read_text(encoding="utf-8"))
osm_features = json.loads((data / "cache/normalized/transport.json").read_text(encoding="utf-8"))[
    "features"
]
live = json.loads((review / "mapped-osm-live-verification.json").read_text(encoding="utf-8"))
rej = json.loads((review / "facility-osm-rejections.json").read_text(encoding="utf-8"))["records"]
osm = {x["id"]: x for x in osm_features}
live_rows = live.get("results", live if isinstance(live, list) else [])
live_by = {x.get("osm_object_id"): x for x in live_rows}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def tokens(s):
    ignored = {
        "the",
        "and",
        "atoll",
        "island",
        "health",
        "centre",
        "center",
        "clinic",
        "school",
        "hospital",
        "medical",
    }
    return {x for x in norm(s).split() if len(x) > 1 and x not in ignored}


def name_overlap(a, b):
    ta, tb = tokens(a), tokens(b)
    return len(ta & tb) / max(1, min(len(ta), len(tb))) if ta and tb else 0.0


def category_ok(f, o):
    category = (f.get("category") or "").lower()
    osm_category = (o or {}).get("category", "").lower()
    if category == "airport":
        return osm_category in {"aerodrome", "helipad", "terminal"}
    if category == "school":
        return osm_category == "school"
    if category in {"hospital", "health centre", "health center", "clinic"}:
        return osm_category in {"hospital", "clinic", "government"}
    return True


def in_bounds(o):
    try:
        lon, lat = o["geometry"]["coordinates"][:2]
        return 72.5 <= lon <= 74.8 and -0.9 <= lat <= 7.5
    except Exception:
        return False


db = review / "facility-audit.sqlite"
con = sqlite3.connect(db)
con.executescript("""
DROP TABLE IF EXISTS facilities;
DROP TABLE IF EXISTS osm;
DROP TABLE IF EXISTS live;
DROP TABLE IF EXISTS rejections;
CREATE TABLE facilities(id TEXT PRIMARY KEY,name TEXT,category TEXT,status TEXT,osm_id TEXT,
    island_id TEXT,source TEXT,attrs_json TEXT);
CREATE TABLE osm(id TEXT PRIMARY KEY,name TEXT,category TEXT,island_id TEXT,lon REAL,
    lat REAL,tags_json TEXT);
CREATE TABLE live(osm_id TEXT PRIMARY KEY,http_status INTEGER,status TEXT,tags_json TEXT);
CREATE TABLE rejections(facility_id TEXT,osm_id TEXT,reason TEXT,PRIMARY KEY(facility_id,osm_id));
""")
for f in fac:
    con.execute(
        "INSERT INTO facilities VALUES (?,?,?,?,?,?,?,?)",
        (
            f["id"],
            f.get("name"),
            f.get("category"),
            f.get("match_status"),
            f.get("osm_object_id"),
            f.get("island_id"),
            f.get("source"),
            json.dumps(f.get("attributes", {}), ensure_ascii=False),
        ),
    )
for o in osm_features:
    try:
        lon, lat = o.get("geometry", {}).get("coordinates", [None, None])[:2]
    except Exception:
        lon = lat = None
    con.execute(
        "INSERT INTO osm VALUES (?,?,?,?,?,?,?)",
        (
            o["id"],
            o.get("name"),
            o.get("category"),
            o.get("island_id"),
            lon,
            lat,
            json.dumps(o.get("tags", {}), ensure_ascii=False),
        ),
    )
for x in live_rows:
    element = x.get("element") or {}
    con.execute(
        "INSERT INTO live VALUES (?,?,?,?)",
        (
            x.get("osm_object_id"),
            x.get("http_status"),
            x.get("status"),
            json.dumps(element.get("tags", {}), ensure_ascii=False),
        ),
    )
for r in rej:
    con.execute(
        "INSERT INTO rejections VALUES (?,?,?)", (r["facility_id"], r["osm_object_id"], r["reason"])
    )
con.executescript(
    "CREATE INDEX idx_fac_osm ON facilities(osm_id); "
    "CREATE INDEX idx_fac_status ON facilities(status); "
    "CREATE INDEX idx_osm_island ON osm(island_id);"
)
con.commit()

by_osm = defaultdict(list)
for f in fac:
    if f.get("osm_object_id"):
        by_osm[f["osm_object_id"]].append(f)

rows = []
for f in fac:
    oid = f.get("osm_object_id")
    o = osm.get(oid) if oid else None
    flags = []
    if oid and not o:
        flags.append("osm_feature_missing_from_normalized_cache")
    if oid and o and f.get("island_id") and o.get("island_id") and f["island_id"] != o["island_id"]:
        flags.append("island_mismatch")
    if oid and o and not in_bounds(o):
        flags.append("geometry_outside_maldives_bounds")
    if oid and oid not in live_by:
        flags.append("live_verification_missing")
    if oid and o and not category_ok(f, o):
        flags.append("category_incompatible")
    overlap = name_overlap(f.get("name"), (o or {}).get("name")) if oid and o else 0.0
    if (
        oid
        and o
        and overlap < 0.34
        and tokens(f.get("name"))
        and tokens((o or {}).get("name"))
        and f.get("match_status")
        in {"osm_best_effort", "osm_provisional_review_required", "reviewed_osm_match"}
    ):
        flags.append("weak_name_overlap")
    if oid and len(by_osm[oid]) > 1:
        flags.append("duplicate_osm_claim")
    rows.append(
        {
            "facility_id": f["id"],
            "facility_name": f.get("name"),
            "facility_category": f.get("category"),
            "status": f.get("match_status"),
            "osm_id": oid,
            "osm_name": (o or {}).get("name"),
            "osm_category": (o or {}).get("category"),
            "facility_island_id": f.get("island_id"),
            "osm_island_id": (o or {}).get("island_id"),
            "name_overlap": round(overlap, 3),
            "flags": flags,
        }
    )

rejection_checks = []
fac_by_id = {f["id"]: f for f in fac}
for r in rej:
    current = fac_by_id.get(r["facility_id"], {}).get("osm_object_id")
    rejection_checks.append(
        {**r, "detached": current != r["osm_object_id"], "current_osm_id": current}
    )

summary = Counter()
for row in rows:
    for flag in row["flags"]:
        summary[flag] += 1
report = {
    "version": "facility-mapping-audit-v2",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "scope": {
        "official_facilities": len(fac),
        "mapped_facilities": sum(bool(f.get("osm_object_id")) for f in fac),
        "unique_mapped_osm_objects": len(by_osm),
        "live_verification_rows": len(live_by),
        "rejection_rules": len(rej),
    },
    "summary": dict(summary),
    "status_counts": dict(Counter(f.get("match_status") for f in fac)),
    "duplicate_groups": [
        {
            "osm_id": oid,
            "osm_name": (osm.get(oid) or {}).get("name"),
            "osm_category": (osm.get(oid) or {}).get("category"),
            "facility_ids": [f["id"] for f in fs],
            "facility_names": [f["name"] for f in fs],
        }
        for oid, fs in by_osm.items()
        if len(fs) > 1
    ],
    "rejection_checks": rejection_checks,
    "rows": rows,
}
(review / "facility-mapping-audit.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
)

md = [
    "# Facility Mapping Audit",
    "",
    f"Generated: {report['generated_at']}",
    "",
    f"Scope: {len(fac)} official facilities; "
    f"{report['scope']['mapped_facilities']} mapped facilities; "
    f"{report['scope']['unique_mapped_osm_objects']} unique OSM objects.",
    "",
    "## Findings",
]
for key, value in summary.most_common():
    md.append(f"- **{key}**: {value}")
md += ["", "## Duplicate OSM claims"]
for group in report["duplicate_groups"]:
    pairs = "; ".join(f"{i} — {n}" for i, n in zip(group["facility_ids"], group["facility_names"]))
    md.append(f"- `{group['osm_id']}` {group['osm_name'] or '(unnamed)'}: {pairs}")
md += ["", "## Explicitly rejected false mappings detached by the normalizer"]
for row in rejection_checks:
    state = "DETACHED" if row["detached"] else "ERROR"
    md.append(f"- {state} `{row['facility_id']}` → `{row['osm_object_id']}`: {row['reason']}")
md += ["", "## Review-required mapped records"]
for row in rows:
    if (
        row["status"] in {"osm_provisional_review_required", "osm_match_review_required"}
        and row["osm_id"]
    ):
        md.append(
            f"- `{row['facility_id']}` {row['facility_name']} → `{row['osm_id']}` "
            f"{row['osm_name'] or '(unnamed)'} [{row['status']}]"
        )
(review / "facility-mapping-audit.md").write_text("\n".join(md) + "\n", encoding="utf-8")

print(
    json.dumps(
        {
            "db": str(db),
            "json": str(review / "facility-mapping-audit.json"),
            "md": str(review / "facility-mapping-audit.md"),
            "scope": report["scope"],
            "summary": dict(summary),
            "duplicate_groups": len(report["duplicate_groups"]),
            "rejections_detached": sum(x["detached"] for x in rejection_checks),
        },
        indent=2,
    )
)
