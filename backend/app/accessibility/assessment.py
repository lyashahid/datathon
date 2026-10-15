"""Plain-language access-index assessments; evidence gaps remain explicit."""

from __future__ import annotations

from typing import Any

from app.accessibility.config import AccessibilityConfig
from app.accessibility.evidence import scored_facilities

ASSESSMENT_VERSION = "island-access-assessment-v1"


def _score_label(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".")


def island_assessment(
    result: dict[str, Any], policy: AccessibilityConfig, facilities: list[dict[str, Any]]
) -> dict[str, Any]:
    """A public-facing access index, with evidence gaps kept distinct from zero access."""
    domains = result["domains"]
    population = result["population"]
    components: dict[str, Any] = {}
    reasons = []
    limitations = [
        "This is an access index based on mapped services and planning assumptions, "
        "not a percentage of residents served."
    ]
    scored_domains = 0
    for domain, weights, label in (
        ("health", policy.health_quality_weights, "Healthcare"),
        ("education", policy.education_quality_weights, "Schools"),
    ):
        details = domains[domain]
        count = len(scored_facilities(facilities, weights))
        components[domain] = {"score": details["score"], "facility_count": count}
        noun = "healthcare location" if domain == "health" else "school"
        plural = "s" if count != 1 else ""
        if not count:
            text = (
                f"No {noun}s have a confirmed map position for this island. "
                "This part of the index is 0; services may still exist."
            )
        elif "no_geocoded_demand_anchor" in details.get("missing_data", []):
            text = (
                f"{count:,} mapped {noun}{plural}, but distances could not "
                "be estimated. This part of the index is 0."
            )
        else:
            scored_domains += 1
            text = (
                f"{count:,} mapped {noun}{plural}; distance and facility type give "
                f"{label.lower()} {_score_label(details['score'])}/100."
            )
            distance = details.get("best_distance_m")
            if distance is not None:
                method = (
                    "in a straight line"
                    if details.get("distance_method") == "straight_line_fallback"
                    else "along mapped walking routes"
                )
                distance_label = (
                    f"{distance / 1000:.1f} km" if distance >= 1000 else f"{distance:.0f} m"
                )
                text += f" The best recorded connection is about {distance_label} {method}."
            if details.get("population_pressure_factor", 1) < 1:
                text += " Estimated resident demand lowers this part of the index."
        reasons.append({"domain": domain, "score": details["score"], "text": text})

    transport_counts = domains["transport"]["mapped_counts"]
    components["transport"] = {"score": domains["transport"]["score"], **transport_counts}
    if any(transport_counts.values()):
        scored_domains += 1
    included = []
    for key, noun in (("bus_stop_count", "bus stop"), ("airport_count", "airport")):
        count = transport_counts[key]
        if count:
            included.append(f"{count:,} mapped {noun}{'s' if count != 1 else ''}")
    transport_text = (
        f"Mapped transport includes {' and '.join(included)}. "
        f"Transport contributes {_score_label(domains['transport']['score'])}/100."
        if included
        else "No bus stops or airports are mapped for this island."
    )
    marine_count = transport_counts["marine_terminal_count"]
    if marine_count:
        transport_text += (
            f" {marine_count:,} mapped marine access point{'s' if marine_count != 1 else ''} "
            f"{'are' if marine_count != 1 else 'is'} "
            + (
                "included as an assumption; ferry services are unverified."
                if policy.include_unverified_marine
                else "excluded because ferry services are unverified."
            )
        )
    else:
        transport_text += (
            " No marine access points are mapped; this does not prove no ferry service."
        )
    reasons.append(
        {"domain": "transport", "score": domains["transport"]["score"], "text": transport_text}
    )

    population_available = population.get("total") is not None
    if not population_available:
        limitations.append(
            "Resident counts are missing, so resident demand and people served cannot be measured."
        )
    if scored_domains < 3:
        limitations.append(
            "Some services or travel connections are not mapped. A low index may reflect "
            "missing evidence rather than poor access."
        )
    if any(
        details.get("distance_method") == "straight_line_fallback"
        for key, details in domains.items()
        if key != "transport"
    ):
        limitations.append(
            "Some distances use a straight line because a walking route could not be confirmed."
        )
    if any(details.get("population_pressure_factor", 1) < 1 for details in domains.values()):
        limitations.append(
            "Capacity adjustments use planning assumptions, "
            "not verified staffing or building capacity."
        )
    if any(details.get("density_factor", 1) < 1 for details in domains.values()):
        limitations.append(
            "Higher resident density lowers the index under the current planning assumptions."
        )
    if transport_counts["bus_stop_count"] or transport_counts["airport_count"] or marine_count:
        limitations.append(
            "Mapped stops, airports and marine access points do not confirm "
            "operating services or timetables."
        )
    score = result["score"]
    if scored_domains == 0:
        label = "Limited evidence"
    elif score >= 75:
        label = "Higher access index"
    elif score >= 50:
        label = "Moderate access index"
    elif score >= 25:
        label = "Lower access index"
    else:
        label = "Low access index"
    coverage_status = (
        "limited"
        if scored_domains < 3
        else "partial"
        if not population_available or result["missing_data"] or len(limitations) > 1
        else "mapped"
    )
    coverage_label = {
        "limited": "Limited evidence",
        "partial": "Partial evidence",
        "mapped": "Mapped evidence",
    }[coverage_status]
    coverage_note = f"{scored_domains} of 3 areas have mapped evidence. " + (
        "Resident counts are available." if population_available else "Resident counts are missing."
    )
    return {
        "version": ASSESSMENT_VERSION,
        "score": score,
        "out_of": 100,
        "label": label,
        "summary": f"Accessibility score: {_score_label(score)}/100. {coverage_note}",
        "reasons": reasons,
        "components": components,
        "coverage": {
            "status": coverage_status,
            "label": coverage_label,
            "note": coverage_note,
            "population_available": population_available,
            "scored_domains": scored_domains,
            "total_domains": 3,
        },
        "limitations": limitations,
    }
