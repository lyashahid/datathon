"""Auditable census geography matching and non-overlapping island summaries.

P6 is an atoll/city age table, not island demographics. P3 and P5 repeat
administrative-island totals; P5 also contains Malé wards and aggregate rows.
Matching always respects a supplied atoll and never uses fuzzy similarity.
"""

from __future__ import annotations

from typing import Any

from app.data.normalize.names import normalize_atoll_code, normalize_name

POPULATION_TRANSFORM_VERSION = "census-atoll-locality-v2"

ATOLLS = {
    "aa": "Alifu Alifu",
    "adh": "Alifu Dhaalu",
    "b": "Baa",
    "dh": "Dhaalu",
    "f": "Faafu",
    "ga": "Gaafu Alifu",
    "gdh": "Gaafu Dhaalu",
    "gn": "Gnaviyani",
    "ha": "Haa Alifu",
    "hdh": "Haa Dhaalu",
    "k": "Kaafu",
    "l": "Laamu",
    "lh": "Lhaviyani",
    "m": "Meemu",
    "n": "Noonu",
    "r": "Raa",
    "s": "Seenu",
    "sh": "Shaviyani",
    "th": "Thaa",
    "v": "Vaavu",
    "mle": "MLE",
}

# Explicit transliteration pairs reviewed against the captured P3/P5 workbook
# locality and OneMap residential-island list, constrained to the same atoll.
ALIASES = {
    ("ha", "mulhadhoo"): "Molhadhoo",
    ("ha", "uligamu"): "Uligan",
    ("hdh", "kuribi"): "Kurin'bi",
    ("hdh", "nolhivaramu"): "Nolhivaran",
    ("sh", "bilehffahi"): "Bileiyfahi",
    ("sh", "kaditheemu"): "Kan'ditheemu",
    ("sh", "maaugoodhoo"): "Maaun'goodhoo",
    ("n", "kedhikulhudhoo"): "Ken'dhikulhudhoo",
    ("r", "agolhitheemu"): "An'golhitheemu",
    ("r", "iguraidhoo"): "In'guraidhoo",
    ("r", "ugoofaaru"): "Un'goofaaru",
    ("b", "dhonfanu"): "Dhonfan",
    ("k", "himmafushi"): "Hinmafushi",
    ("adh", "dhagethi"): "Dhan'gethi",
    ("adh", "hangnameedhoo"): "Hangnaameedhoo",
    ("adh", "kuburudhoo"): "Kun'burudhoo",
    ("m", "raimandhoo"): "Raiymandhoo",
    ("f", "biledhdhoo"): "Bileiydhoo",
    ("f", "dharaboodhoo"): "Dharan'boodhoo",
    ("dh", "badidhoo"): "Ban'didhoo",
    ("dh", "maaeboodhoo"): "Maaen'boodhoo",
    ("dh", "ribudhoo"): "Rin'budhoo",
    ("th", "kadoodhoo"): "Kan'doodhoo",
    ("th", "kibidhoo"): "Kin'bidhoo",
    ("l", "dhabidhoo"): "Dhan'bidhoo",
    ("l", "gamu"): "Gan",
    ("ga", "kodey"): "Kon'dey",
    ("ga", "viligili"): "Vilin'gili",
    ("gdh", "fares maathodaa"): "Faresmaathodaa",
    ("gdh", "fiyoari"): "Fiyoaree",
    ("gdh", "hoadedhdhoo"): "Hoan'dehdhoo",
    ("gdh", "nadallaa"): "Nadellaa",
    ("s", "maradhoo feydhoo"): "Maradhoofeydhoo",
    ("s", "meedhoo"): "Addu Meedhoo",
    ("s", "hulhudhoo"): "Addu Hulhudhoo",
}

# These P5 rows are mutually exclusive census enumeration localities. Do not
# assign the Maale city total (211,908) or multi-island harbour row to an island.
MALE_LOCALITIES = {
    "henveiru": "island:1443",
    "galolhu": "island:1443",
    "machchangolhi": "island:1443",
    "maafannu": "island:1443",
    "vilimaale": "island:1382",
    "hulhumaale phase 1": "island:1442",
    "hulhumaale phase 2": "island:1442",
    "hulhule": "island:1483",
}
SOURCE_URL = "https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/07/P5.xlsx"


def attach_population(records: list[dict[str, Any]], islands: list[dict[str, Any]]) -> None:
    """Reconcile existing records in place, keeping raw files untouched."""
    by_name: dict[str, list[dict[str, Any]]] = {}
    ids = {x.get("properties", {}).get("id") for x in islands}
    for feature in islands:
        item = feature.get("properties", {})
        name = item.get("name_normalized") or normalize_name(item.get("name", ""))
        by_name.setdefault(name, []).append(item)
    for record in records:
        locality = record.get("locality_normalized") or normalize_name(record.get("locality"))
        if not locality:
            continue  # Preserve explicitly attached fixtures/approved records without names.
        code = normalize_atoll_code(record.get("atoll_code") or record.get("atoll"))
        if record.get("source", "").endswith("P5"):
            if record.get("id"):
                record.setdefault("captured_record_id", record["id"])
            record["id"] = (
                f"population:mbs-p5:2022:{code or 'mle'}:{locality}:"
                f"{record.get('sex', 'both')}:{record.get('nationality', 'total')}"
            )
        if record.get("source", "").endswith("P6"):
            record["island_id"] = None
            record["match_status"] = "aggregate_geography_not_island"
            continue
        if not code and record.get("source", "").endswith("P5"):
            island_id = MALE_LOCALITIES.get(locality)
            record["island_id"] = island_id if island_id in ids else None
            record["match_status"] = (
                "matched_census_ward_or_phase" if record["island_id"] else "aggregate_or_unmapped"
            )
            continue
        target_name = normalize_name(ALIASES.get((code, locality), record.get("locality", "")))
        matches = by_name.get(target_name, [])
        expected_atoll = ATOLLS.get(code, record.get("atoll"))
        if expected_atoll:
            matches = [
                x
                for x in matches
                if normalize_name(x.get("atoll")) == normalize_name(expected_atoll)
            ]
        residential = [x for x in matches if x.get("category") == "Residential Island"]
        if residential:
            matches = residential
        record["island_id"] = matches[0]["id"] if len(matches) == 1 else None
        record["match_status"] = (
            "matched_atoll_name_alias"
            if len(matches) == 1 and (code, locality) in ALIASES
            else "matched_atoll_island_name"
            if len(matches) == 1 and expected_atoll
            else "matched_island_name"
            if len(matches) == 1
            else "ambiguous_island_name"
            if matches
            else "unmatched_island_name"
        )
        if record["island_id"]:
            record["mapping_basis"] = "census locality + administrative atoll + OneMap identity"


def population_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    """One census total; disjoint wards sum, overlapping P3/P5 tables do not."""
    demographic = [
        x
        for x in records
        if x.get("age_group")
        and x.get("age_group", "").casefold() != "all ages"
        and x.get("sex")
        and x.get("nationality")
    ]
    p3 = [x for x in records if x.get("sex") is None and x.get("nationality") is None]
    totals = p3 or [
        x
        for x in records
        if x.get("sex") == "both" and x.get("nationality") == "total" and not x.get("age_group")
    ]
    by_age_sex: dict[str, dict[str, int]] = {}
    for item in demographic:
        if item.get("nationality") == "total":
            by_age_sex.setdefault(item["age_group"], {})[item["sex"]] = int(item["population"])
    total = sum(int(x["population"]) for x in totals) if totals else None
    if by_age_sex:
        total = sum(x.get("both", 0) for x in by_age_sex.values())
    sex_records = demographic or [x for x in records if not x.get("age_group")]
    by_sex = {
        sex: sum(
            int(x["population"])
            for x in sex_records
            if x.get("sex") == sex and x.get("nationality") == "total"
        )
        for sex in ("both", "female", "male")
        if any(x.get("sex") == sex and x.get("nationality") == "total" for x in sex_records)
    }
    by_nationality = {
        nat: sum(
            int(x["population"])
            for x in sex_records
            if x.get("sex") == "both" and x.get("nationality") == nat
        )
        for nat in ("total", "Maldivian", "foreign")
        if any(x.get("sex") == "both" and x.get("nationality") == nat for x in sex_records)
    }

    def age_total(starts: set[int]) -> int:
        return sum(x.get("both", 0) for age, x in by_age_sex.items() if _age_start(age) in starts)

    chosen = totals or demographic
    wards = any(x.get("match_status") == "matched_census_ward_or_phase" for x in chosen)
    return {
        "year": chosen[0].get("year") if chosen else None,
        "basis": "resident_population",
        "source": chosen[0].get("source") if chosen else None,
        "source_url": SOURCE_URL.replace("P5.xlsx", "P3.xlsx")
        if chosen and chosen[0].get("source", "").endswith("P3")
        else SOURCE_URL
        if chosen
        else None,
        "status": "census" if total is not None else "unavailable",
        "total": total,
        "school_age": age_total({5, 10, 15}) if by_age_sex else None,
        "early_childhood": age_total({0}) if by_age_sex else None,
        "older_adult": age_total(set(range(65, 121))) if by_age_sex else None,
        "working_age": age_total(set(range(20, 65))) if by_age_sex else None,
        "by_age_sex": by_age_sex,
        "by_sex": by_sex,
        "by_nationality": by_nationality,
        "record_count": len(records),
        "demographic_breakdown": bool(by_age_sex),
        "localities": sorted({x.get("locality", "") for x in chosen if x.get("locality")}),
        "qualification": (
            "Census 2022 enumeration wards/phases combined for this island; excludes the "
            "unallocatable multi-island harbour row. This is a census count, "
            "not a current projection."
            if wards
            else "Census 2022 resident count, not a current-year projection."
            if total is not None
            else "No island-specific resident count in the captured census "
            "tables. A resort or industrial-island label does not imply zero residents."
        ),
    }


def _age_start(age: str) -> int | None:
    if age.casefold() == "75 or older":
        return 75
    try:
        return int(age.split("-", 1)[0])
    except ValueError, TypeError:
        return None
