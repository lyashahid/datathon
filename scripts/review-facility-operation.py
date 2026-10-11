"""Reproduce the 2026-10-10 desk review of mapped education facilities.

Default: prepare the public overlay from the archived, manually reviewed captures.
--validate: check the existing overlay without writing it.
--fetch: download candidate captures for a future review, preserving the reviewed
archive and public overlay. A fetch is not a new operating-status verification.
"""

from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
from html import unescape
import json
from pathlib import Path
import re
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/facility-operation-review"
OUTPUT = ROOT / "data/public/facility-operation-review.json"
REVIEW_DATE = "2026-10-10"
TRANSFORMATION_VERSION = "facility-operation-desk-review-v1"
MINISTRY = "Ministry of Education, Higher Education and Skills Development"
MQA = "Maldives Qualifications Authority"
HEALTH = "Ministry of Health, Family and Welfare"

# Source titles/publishers are reviewed metadata, not inferred from HTML footers.
SOURCE_DETAILS = {
    "moe-directory": ("School directory (live retrieval; directory update 23 May 2025)", MINISTRY, "https://www.moe.gov.mv/en/schools"),
    "kangaroo-contact": ("Kangaroo Kids Dream Campus contact address", "Kangaroo Kids International Preschool Maldives", "https://www.kangarookids.school/contact-us/"),
    "kangaroo-admissions": ("Kangaroo Kids admissions overview and preschool age groups", "Kangaroo Kids International Preschool Maldives", "https://www.kangarookids.school/admissions-overview/"),
    "brightway-contact-v2": ("Brightway International School contact address and office hours", "Brightway International School", "https://brightway.edu.mv/about-us/contact/"),
    "brightway-home": ("Brightway International School programmes", "Brightway International School", "https://brightway.edu.mv/"),
    "gis-contact": ("Ghiyasuddin International School contact address", "Ghiyasuddin International School", "https://gis.edu.mv/contact"),
    "gis-admissions": ("Ghiyasuddin International School admissions", "Ghiyasuddin International School", "https://www.gis.edu.mv/admissions"),
    "vihs-contact": ("Villa International High School contact address", "Villa International High School", "https://vihs.edupage.org/contact/"),
    "vihs-admissions": ("Villa International High School 2026 application information", "Villa International High School", "https://my.vihs.edu.mv/applicationform.php"),
    "kaamil-hearts-2026": ("Kaamil Didi Preschool school visit, 18 August 2026", "Tiny Hearts of Maldives", "https://www.tinyheartsofmaldives.org/resources/events/little-hearts-big-impact-kaamil-didi-preschool-champions-heart-health-and-giving"),
    "galolhu-mnu-2026": ("Galolhu School preschool student visit, 27 August 2026", "Maldives National University", "https://mnu.edu.mv/galolhu-school-preschool-students-enjoy-an-educational-visit-to-fhts/"),
    "galolhu-council-2025": ("Galolhu School library inauguration, 11 May 2025", "Malé City Council", "https://malecity.gov.mv/en/news/605"),
    "ilm-mqa": ("ILM Institute for Islamic Studies higher-education record", MQA, "https://mqa.gov.mv/en/higher-education-institutes/ilm-institute-for-islamic-studies"),
    "ilm-operator": ("ILM Institute programmes and current contact address", "ILM Institute for Islamic Studies", "https://www.ilm.edu.mv/about-us/"),
    "psm-arabiyya-relocation": ("Ministry announcement of Arabiyya temporary teaching site, 2023", "Public Service Media", "https://psmnews.mv/en/123957"),
    "psm-arabiyya-2026": ("President statement on new Arabiyya building teaching date, 2026", "Public Service Media", "https://cms.psmnews.mv/en/181929"),
    "fiyavathi-presidency": ("Fiyavathi state children's-care facility, 7 December 2024", "The President's Office", "https://presidency.gov.mv/Press/Article/32384"),
    "stem-maaharaa": ("Stem Center registration, older Maaharaa health-facility directory", HEALTH, "https://maaharaa.health.gov.mv/Public/Home/ListHealthCare"),
    "stem-hems": ("Stem Center live legal status (Closed)", HEALTH, "https://hems.health.gov.mv/establishments?search=Stem"),
    "european-hems": ("European Clinic Maldives live legal status (Closed)", HEALTH, "https://hems.health.gov.mv/establishments?search=European"),
    "polytechnic-mqa": ("Maldives Polytechnic current accredited-institution record", MQA, "https://mqa.gov.mv/en/higher-education-institutes/maldives-polytechnic"),
    "avid-mqa": ("Avid College current accredited-institution record", MQA, "https://mqa.gov.mv/en/higher-education-institutes/avid-college"),
    "private-colleges-mqa": ("Private colleges directory and campus addresses", MQA, "https://mqa.gov.mv/en/higher-education-institutes?type=private_college"),
    "universities-mqa": ("Public universities directory", MQA, "https://mqa.gov.mv/en/higher-education-institutes?type=public_university"),
    "ium-mqa": ("Islamic University of Maldives accredited-institution record", MQA, "https://mqa.gov.mv/en/higher-education-institutes/islamic-university-of-maldives"),
    "mnu-home": ("Maldives National University current contact and academic portals", "Maldives National University", "https://mnu.edu.mv/"),
    "mnu-cfos": ("MNU College of Fisheries and Ocean Sciences contact address", "Maldives National University", "https://mnu.edu.mv/cfos/"),
    "mnu-business": ("MNU Business School contact address", "Maldives National University", "https://mnu.edu.mv/mnubs/"),
    "mi-branches": ("MI College branch directory, Hulhumalé Lot 11310", "MI College", "https://micollege.edu.mv/index.php/Home/Branches"),
    "mi-hulhumale": ("MI College Hulhumalé campus on Reethigas Hingun", "MI College", "https://www.micollege.edu.mv/index.php/Home/Our_campus/fe5dbbcea5ce7e2988b8c69bcfdfde8904aabc1f"),
}

SCHOOL_PROFILES = {
    "osm:node:4866622621": (637, "Imaduddin School", "Rehendhi Hingun, Galolhu, Malé 20060", "general-school", "exact name"),
    "osm:node:13006103601": (647, "Huravee School", "HM LOT 11402 (N1 School), Reethigas Magu, Hulhumalé 23500", "general-school", "exact name"),
    "osm:node:14268489201": (653, "Shaheed Ali School", "N6-34, 20410 Berebedhima Hingun, Hulhumalé Phase 2", "general-school", "exact name"),
    "osm:way:508266761": (633, "Iskandhar School", "Chaandhanee Magu, Malé 20159", "general-school", "exact name"),
    "osm:way:697262511": (643, "Ghaazee School", "Boaganvilla Magu, Hulhumalé 23000", "general-school", "exact name"),
    "osm:way:1210924794": (646, "Rehendhi School", "Chabeylee Magu, Hulhumalé 23000", "general-school", "exact name"),
    "osm:way:1317921914": (635, "Kalaafaanu School", "Kalaafaanu Hingun, Malé 20065", "general-school", "exact name"),
    "osm:way:1317950376": (642, "Muhyiddin School", "Shamsuddheen Magu, Vilimalé", "general-school", "reviewed transliteration alias: mapped Muhiyyidin school; same Vilimalé campus"),
    "osm:way:1320069203": (640, "Dharumavantha School", "Rahdhebai Hingun, Malé 20078", "general-school", "exact name; current southern site, distinct from former northern building"),
    "osm:way:1323678631": (638, "Aminiya School", "Chaandhanee Magu, Malé 20159", "general-school", "exact name"),
    "osm:way:1547305510": (644, "Centre for Higher Secondary Education Hulhumale'", "Kurikeela Magu, Hulhumalé 23000", "higher-secondary-school", "reviewed abbreviation: CHSE Hulhumale; same Hulhumalé campus"),
}
for _, (profile_id, name, *_rest) in SCHOOL_PROFILES.items():
    SOURCE_DETAILS[f"moe-school-{profile_id}"] = (f"Official school profile: {name}", MINISTRY, f"https://www.moe.gov.mv/en/schools/{profile_id}")
SOURCE_DETAILS["moe-school-650"] = ("Official profile: Kaamil Didi Primary School (distinct from mapped preschool)", MINISTRY, "https://www.moe.gov.mv/en/schools/650")
SOURCE_DETAILS["moe-school-645"] = ("Official profile: Al Madhrasathul Arabiyyathul Islamiyya (address conflict)", MINISTRY, "https://www.moe.gov.mv/en/schools/645")


def source_ids(*keys: str) -> list[str]:
    return ["operation-" + key for key in keys]


def make_record(facility: dict, status: str, sources: list[str], note: str,
                *, eligible: bool = False, scope: str = "unverified",
                official_name: str | None = None, address: str | None = None,
                identity: str = "no-matched-primary-operating-evidence",
                position: str = "osm-position-not-independently-confirmed",
                evidence_date: str | None = None, **extras) -> dict:
    return dict(
        facilityId=facility["id"], mappedName=facility["name"], mappedKind=facility["kind"],
        islandId=facility["islandId"], operatingStatus=status,
        statusReviewedAt=REVIEW_DATE, statusSourceIds=sources, statusNote=note,
        verification="Primary institutional identity reviewed; OSM approximate site" if eligible else False,
        generalSchoolEligible=eligible, educationSuitability=scope,
        institutionStatus=identity, officialName=official_name,
        latestDatedEvidence=evidence_date,
        coordinateReview=dict(
            mappedCoordinate=facility.get("coordinate") or [facility["lon"], facility["lat"]],
            status=position, publishedAddress=address,
            independentPosition=None, inspectedEntrance=False,
            note="OSM point/building centroid retained. Published address corroborates campus context where available; it does not certify an entrance or exact route endpoint.",
        ), **extras,
    )


def decisions(education: list[dict]) -> list[dict]:
    records = []
    for facility in education:
        ident = facility["id"]
        if ident in SCHOOL_PROFILES:
            profile_id, name, address, scope, identity_match = SCHOOL_PROFILES[ident]
            records.append(make_record(facility, "open", source_ids(f"moe-school-{profile_id}", "moe-directory"),
                f"Current Ministry school profile lists {name} at {address}. Identity match: {identity_match}. The institution is current-listed; classroom operation today, admissions availability and opening hours were not inspected. No contradictory primary campus evidence was established in this review. Profile enrollment has no verified reporting period and is not imported.",
                eligible=True, scope=scope, official_name=name, address=address,
                identity="current-ministry-school-profile", position="published-campus-address-compatible-with-osm-approximation",
                officialProfileId=str(profile_id), identityMatch=identity_match))
        elif ident == "osm:node:7297096388":
            records.append(make_record(facility, "open", source_ids("kangaroo-contact", "kangaroo-admissions"),
                "Kangaroo Kids operator lists its Dream Campus at Lonuziyaaraiy Magu, Malé 20064 and preschool programmes for ages 18 months to 6 years. This is preschool access, not availability of every school level. Operator address supports the mapped campus context; its map link did not yield a independently verified entrance coordinate.",
                eligible=True, scope="preschool", official_name="Kangaroo Kids International Preschool Maldives", address="Dream Campus, Lonuziyaaraiy Magu, Malé 20064",
                identity="current-operator-programmes-and-contact", position="published-campus-address-compatible-with-osm-approximation"))
        elif ident == "osm:way:436189997":
            records.append(make_record(facility, "open", source_ids("brightway-contact-v2", "brightway-home"),
                "Brightway operator lists Fareedhiya Building, Reethigas Hingun, Hulhumalé and current nursery-through-IGCSE programmes. The campus street/island is compatible with the mapped building; no surveyed entrance is supplied. Published office hours are not classroom or admissions guarantees.",
                eligible=True, scope="general-school", official_name="Brightway International School", address="Fareedhiya Building, Reethigas Hingun, Hulhumalé",
                identity="current-operator-programmes-and-contact", position="published-campus-address-compatible-with-osm-approximation"))
        elif ident == "osm:way:1550190846":
            records.append(make_record(facility, "open", source_ids("gis-contact", "gis-admissions"),
                "Ghiyasuddin International School operator publishes its Malé campus at Ameenee Magu 20383 and current admissions information. The mapped campus context is compatible; enrollment places, classroom operation today and exact entrances were not inspected.",
                eligible=True, scope="general-school", official_name="Ghiyasuddin International School", address="Ameenee Magu, Malé 20383",
                identity="current-operator-admissions-and-contact", position="published-campus-address-compatible-with-osm-approximation"))
        elif ident == "osm:node:12196297366":
            records.append(make_record(facility, "open", source_ids("vihs-contact", "vihs-admissions"),
                "Villa International High School operator lists QI Campus on Rahdhebai Magu and a 2026 admissions application. The online form currently says admissions are closed, with a download/email alternative; it is evidence of an active institution, not a promise of an available place. High-school and college destinations at QI Campus are distinct services.",
                eligible=True, scope="higher-secondary-school", official_name="Villa International High School", address="QI Campus, Rahdhebai Magu, Machchangolhi, Malé",
                identity="operator-2026-admissions-and-contact", position="published-campus-address-compatible-with-osm-approximation", evidence_date="2026"))
        elif ident == "osm:node:13006103401":
            records.append(make_record(facility, "open", source_ids("kaamil-hearts-2026", "moe-school-650"),
                "Tiny Hearts of Maldives directly reports its 18 August 2026 school visit to Kaamil Didi Preschool. This positively establishes an active preschool institution. The Ministry's Kaamil Didi Primary School profile concerns a distinct adjacent primary institution; its pupils or primary-school address are not transferred to this preschool point. The OSM preschool campus position remains approximate and is not independently entrance-geocoded.",
                eligible=True, scope="preschool", official_name="Kaamil Didi Preschool", identity="primary-partner-observed-school-visit-2026",
                position="osm-preschool-campus-approximation-distinct-from-primary-school", evidence_date="2026-08-18"))
        elif ident == "osm:way:1548122368":
            records.append(make_record(facility, "open", source_ids("galolhu-mnu-2026", "galolhu-council-2025"),
                "MNU directly hosted Galolhu School preschool pupils on 27 August 2026. Malé City Council directly reports a 11 May 2025 event and inauguration of its on-site school library. These establish an active school institution; the OSM building position remains approximate. The reported 126 visiting pupils are not imported as school enrollment or capacity.",
                eligible=True, scope="preschool", official_name="Galolhu School", identity="primary-university-and-city-council-events", evidence_date="2026-08-27"))
        elif ident == "osm:node:11183603641":
            records.append(make_record(facility, "closed", source_ids("stem-hems", "stem-maaharaa"),
                "Current HEMS marks Stem Center Closed, registration HF-22-ALP/PVT/675, licence PVT-TSC-22-335-00. Older Maaharaa still lists the same registration at R-14-01 Hithigas Magu. Current explicit status takes precedence over that historical listing. It is a therapeutic-service clinic, not a general public school. Closure date and permanence are unpublished.",
                scope="therapeutic-service-not-general-school", official_name="Stem Center", address="R-14-01, Hithigas Magu, Hulhumalé",
                identity="current-HEMS-explicit-closed-registration", registryId="HF-22-ALP/PVT/675", conflictingSourceNote="Maaharaa registered-facility listing persists despite HEMS Closed status."))
        elif ident == "osm:way:1210925026":
            records.append(make_record(facility, "unverified", source_ids("fiyavathi-presidency"),
                "The President's Office describes Fiyavathi on 7 December 2024 as a state children's-care centre in Hulhumalé for children under 13. That establishes its identity and care purpose, not general public-school enrollment or separately verified 2026 operating status. Excluded from School access; no closure is inferred.",
                scope="state-children-care-not-general-school", official_name="Fiyavathi", identity="government-care-facility-confirmed-2024", evidence_date="2024-12-07"))
        elif ident == "osm:node:11185404548":
            records.append(make_record(facility, "unverified", source_ids("ilm-mqa", "ilm-operator"),
                "MQA and ILM's operator establish a current Islamic-studies higher-education/training institute. The operator lists Maafannu Madharusa, 2nd floor, Majeedhee Magu, Malé; the mapped point is in eastern Malé. This mapped campus has not been reconciled to that address. It is not a general public-school destination. Do not invent a replacement coordinate or infer institution closure.",
                scope="specialist-higher-education-not-general-school", official_name="ILM Institute for Islamic Studies", address="Maafannu Madharusa, 2nd floor, Majeedhee Magu, Malé",
                identity="current-primary-listed-institution-mapped-site-unreconciled", position="current-operator-address-conflicts-with-mapped-site"))
        elif ident == "osm:way:1207054212":
            records.append(make_record(facility, "unverified", source_ids("moe-school-645", "psm-arabiyya-relocation", "psm-arabiyya-2026"),
                "Arabiyya is a legitimate active institution, but the Ministry profile retains a Medhuziyaaraiy Magu address while PSM reports the Ministry's temporary teaching move to the former Dharumavantha building near Velaanaage in 2023. A 2026 presidential statement says teaching at the new building begins next academic year after completion. The mapped old point cannot safely represent current teaching access. Excluded pending a verified current campus coordinate; the institution is not labeled closed and the new building is not assumed open.",
                scope="general-school-location-unreconciled", official_name="Al Madhrasathul Arabiyyathul Islamiyya", address="Official profile: Medhuziyaaraiy Magu; temporary teaching site reported near Velaanaage",
                identity="current-primary-listed-institution-relocation-evidence", position="conflicting-directory-and-temporary-teaching-site", officialProfileId="645"))
        elif ident in {"osm:node:11183603546", "osm:way:1330634428"}:
            note = "Learnium is mapped as a training centre; no matched primary operator/government evidence of a current general public school at this point was established." if ident == "osm:node:11183603546" else "No matched primary Maldives operator/government evidence for Ajiyal International School at this mapped Hulhumalé point was established. Similarly named foreign schools are not evidence for this site."
            records.append(make_record(facility, "unverified", source_ids("moe-directory"), note + " Current Ministry directory retrieval is retained as a reviewed search scope. Absence from that directory is not proof of closure or nonexistence; excluded from default School access until supported.", scope="unverified-general-school"))
        elif facility["kind"] == "college":
            records.append(college_decision(facility))
        else:
            raise ValueError(f"New mapped education point requires manual review: {ident}")
    return records


def college_decision(facility: dict) -> dict:
    # These remain tertiary inventory; no college is admitted to the School goal.
    mapping = {
        "osm:node:5599539381": ("polytechnic-mqa", "Maldives Polytechnic", "Rehendhee Hingun, Galolhu, Malé 20364"),
        "osm:node:6294958141": ("avid-mqa", "Avid College", "Diamond Campus, Ameenee Goalhi, Malé"),
        "osm:node:8935561366": ("mnu-home", "The Maldives National University", "Rahdhebai Hingun, Machchangolhi, Malé 20371"),
        "osm:node:11185404556": ("ium-mqa", "Islamic University of Maldives", None),
        "osm:node:13907139818": ("mnu-cfos", "MNU College of Fisheries and Ocean Sciences", "Sosun Magu, Henveyru, Malé 20068"),
        "osm:way:1317793006": ("private-colleges-mqa", "Villa College", "QI Campus, Rahdhebai Hingun, Malé 20373"),
        "osm:way:1320052745": ("mnu-business", "MNU Business School", "Sosun Magu, Henveiru, Malé 20069"),
    }
    ident = facility["id"]
    if ident in mapping:
        key, name, address = mapping[ident]
        return make_record(facility, "open", source_ids(key),
            f"Current primary institutional/programme listing confirms {name}. This is tertiary education, retained only in the reviewed source inventory and excluded from the general School goal. Published campus context is approximate; an institutional listing is not inspection of a classroom, admissions availability or an entrance.",
            scope="tertiary-inventory-not-school-goal", official_name=name, address=address,
            identity="current-primary-institutional-listing", position="published-campus-context-approximate" if address else "institution-confirmed-osm-campus-position-not-independently-geocoded")
    if ident == "osm:node:11186258646":
        return make_record(facility, "unverified", source_ids("mi-branches", "mi-hulhumale"),
            "MI College's operator lists a current Hulhumalé branch at Lot 11310 on Reethigas Hingun. The mapped college point is farther south near Hulhumalé's southern residential area; this point has not been reconciled to the current operator's campus address. The institution is legitimate; its mapped site remains unverified. No replacement coordinate or closure is inferred. College inventory only, outside School access.",
            scope="tertiary-inventory-not-school-goal", official_name="MI College Hulhumalé Campus", address="Lot 11310, ground/first/second floor, Reethigas Hingun, Hulhumalé",
            identity="current-primary-listed-institution-mapped-site-unreconciled", position="current-operator-address-conflicts-with-mapped-site")
    if ident == "osm:node:11185404561":
        return make_record(facility, "unverified", source_ids("moe-directory", "private-colleges-mqa"),
            "No matched primary Maldives operator/accreditation evidence for Atelier Academy of the Creative Arts at this point was established. Reviewed directory coverage is limited and does not prove closure or nonexistence. The point remains unverified tertiary inventory and is excluded from School access.", scope="unverified-tertiary-inventory-not-school-goal")
    raise ValueError(f"New college requires manual review: {ident}")


def normalized_text(data: bytes) -> str:
    value = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", data.decode("utf-8", "replace"), flags=re.S | re.I)
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]*>", " ", value))).strip()


def check_reviewed_content(key: str, data: bytes) -> None:
    text = normalized_text(data)
    if len(text) < 250:
        raise ValueError(f"Empty/challenge source: {key}")
    if key in {"stem-hems", "european-hems"}:
        name = "Stem Center" if key == "stem-hems" else "European Clinic Maldives"
        registry = "HF-22-ALP/PVT/675" if key == "stem-hems" else "HF-16/ALP/PVT/455"
        # Restrict Closed to the exact row, not the directory's aggregate badge.
        row = re.search(re.escape(name) + r"\s+Closed.{0,250}" + re.escape(registry), text)
        if not row:
            raise ValueError(f"Reviewed explicit Closed status changed or absent: {key}; manual review required")
    if key.startswith("moe-school-"):
        profile_id = int(key.rsplit("-", 1)[1])
        name = next((row[1] for row in SCHOOL_PROFILES.values() if row[0] == profile_id), None)
        if name and name.casefold() not in text.casefold():
            raise ValueError(f"Reviewed school identity missing: {key}")


def reviewed_sources(required: set[str]) -> list[dict]:
    manifest = json.loads((RAW / "capture-manifest.json").read_text(encoding="utf-8"))
    indexed = {row["id"]: row for row in manifest}
    result = []
    for ident in sorted(required):
        key = ident.removeprefix("operation-")
        row = indexed.get(ident)
        if not row or row.get("status") != "downloaded":
            raise ValueError(f"Reviewed source unavailable: {ident}; retaining previous public overlay")
        data = (ROOT / "data/raw" / row["file"]).read_bytes()
        if hashlib.sha256(data).hexdigest() != row["sha256"] or len(data) != row["bytes"]:
            raise ValueError(f"Archived capture checksum changed: {ident}; manual review required")
        check_reviewed_content(key, data)
        title, publisher, expected_url = SOURCE_DETAILS[key]
        if row["url"] != expected_url:
            raise ValueError(f"Reviewed source URL changed: {ident}")
        result.append(dict(row, title=title, publisher=publisher,
            referencePeriod="Live institutional listing retrieved 2026-10-10; dated-event period is in title where applicable",
            license="Public provider/government page; explicit reuse licence not established",
            transformationVersion=TRANSFORMATION_VERSION,
            qualification="Desk-review evidence of institutional identity/status and published address; not a surveyed entrance or guarantee of today's operating hours."))
    return result


def build() -> dict:
    education_audit = json.loads((ROOT / "data/public/education-location-audit.json").read_text(encoding="utf-8"))
    records = decisions(education_audit["records"])
    required = {ident for row in records for ident in row["statusSourceIds"]}
    sources = reviewed_sources(required)
    payload = dict(schemaVersion=1, reviewedAt=REVIEW_DATE, transformationVersion=TRANSFORMATION_VERSION,
        qualification="Current institutional listing or direct primary event supports institution status, not audited opening hours. Exact campus/entrance positions remain OSM approximations; conflicting/unsupported sites are excluded. Unverified is not a claim of closure. Colleges, therapy facilities and state care are outside the general School goal.",
        sources=sources, records=records,
        summary=dict(mappedEducationPoints=len(education_audit["records"]),
            mappedSchoolPoints=sum(row["kind"] == "school" for row in education_audit["records"]),
            mappedCollegePoints=sum(row["kind"] == "college" for row in education_audit["records"]),
            generalSchoolEligiblePoints=sum(row["generalSchoolEligible"] for row in records),
            educationOperatingStatusCounts=dict(Counter(row["operatingStatus"] for row in records if row["mappedKind"] in {"school", "college"})),
            independentlyInspectedEntrances=0, existingHealthcareOverlayChanges=0),
        existingHealthcareReview="All mapped healthcare facilities retain the separately versioned, same-date healthcare-location-audit. European Clinic Closed status was freshly reconfirmed in raw operation-european-hems evidence; no health overlay change is needed.",
    )
    version_payload = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    payload["version"] = "facility-operation-review-" + hashlib.sha256(version_payload).hexdigest()[:12]
    validate(payload, {row["id"] for row in education_audit["records"]})
    return payload


def validate(payload: dict, education_ids: set[str]) -> None:
    ids = [row["facilityId"] for row in payload["records"]]
    assert len(ids) == len(set(ids)), "Duplicate facility review"
    assert education_ids.issubset(ids), "Missing education review"
    sources = {row["id"] for row in payload["sources"]}
    for row in payload["records"]:
        assert row["operatingStatus"] in {"open", "closed", "relocated", "unverified"}
        assert row["statusReviewedAt"] == REVIEW_DATE
        assert row["statusSourceIds"] and set(row["statusSourceIds"]).issubset(sources)
        assert not row["generalSchoolEligible"] or (row["operatingStatus"] == "open" and row["mappedKind"] == "school" and row["verification"] is not False)
        assert row["coordinateReview"]["inspectedEntrance"] is False
    assert payload["summary"]["generalSchoolEligiblePoints"] == 17


def fetch_candidates() -> None:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = RAW / "candidates" / stamp
    target.mkdir(parents=True, exist_ok=True)
    def fetch(item):
        key, (title, publisher, url) = item
        result = dict(id="operation-" + key, url=url, title=title, publisher=publisher)
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 MobilitySandboxEvidenceAudit/1.0"})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read()
                final_url = response.url
            filename = key + ".html"
            (target / filename).write_bytes(data)
            result.update(status="downloaded", sha256=hashlib.sha256(data).hexdigest(), bytes=len(data),
                fetchedAt=datetime.now(timezone.utc).isoformat(), finalUrl=final_url,
                file=str((target / filename).relative_to(ROOT / "data/raw")).replace("\\", "/"))
        except Exception as error:
            result.update(status="unavailable", error=str(error), fetchedAt=datetime.now(timezone.utc).isoformat())
        return result
    with ThreadPoolExecutor(max_workers=6) as pool:
        manifest = list(pool.map(fetch, SOURCE_DETAILS.items()))
    path = target / "candidate-manifest.json"
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Candidate captures saved: {path}")
    print("The reviewed public snapshot remains unchanged. Review changed pages/statuses/addresses before adopting captures and updating curated decisions.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validate", action="store_true")
    parser.add_argument("--fetch", action="store_true")
    args = parser.parse_args()
    if args.fetch:
        fetch_candidates()
    else:
        result = build()
        if args.validate:
            existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
            if existing != result:
                raise ValueError("Public overlay differs from curated review/captures; regenerate after review")
            print(f"Validated {len(result['records'])} facility records; all 32 education points covered; 17 eligible schools.")
        else:
            temporary = OUTPUT.with_suffix(".json.tmp")
            temporary.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            temporary.replace(OUTPUT)
            print(f"Prepared {result['version']}: {len(result['records'])} records, {len(result['sources'])} checked sources, 17 eligible schools.")
