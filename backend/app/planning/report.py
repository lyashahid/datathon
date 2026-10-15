"""Portable decision briefs from canonical planning results, never client-supplied totals."""

from __future__ import annotations

import io
import json
import math
from datetime import UTC, datetime
from html import escape
from typing import Any

from pypdf import PdfReader, PdfWriter
from reportlab.graphics.shapes import Circle, Drawing, Line, PolyLine, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.planning.models import PlanningRequest

INK = colors.HexColor("#183e33")
MUTED = colors.HexColor("#62736c")
LINE = colors.HexColor("#dce5df")
PAPER = colors.HexColor("#f6f8f3")
TEAL = colors.HexColor("#27876a")
LIME = colors.HexColor("#d7edaa")
BEFORE = colors.HexColor("#a8b9b2")
AMBER = colors.HexColor("#b4772d")


def finite(value: Any) -> float | None:
    return (
        float(value)
        if not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
        else None
    )


def amount(value: Any) -> str:
    number = finite(value)
    return "Unavailable" if number is None else f"{number:,.0f}"


def factor_amount(value: Any) -> str:
    """Keep fractional cost/emission factors; 0.12 must not print as zero."""
    number = finite(value)
    return "Unavailable" if number is None else f"{number:,}".removesuffix(".0")


def fiscal_projection(capital: Any, annual: Any) -> list[dict[str, Any]]:
    """Explicit constant-service, undiscounted arithmetic, preserving unknowns."""
    one_time, recurring = finite(capital), finite(annual)
    return [
        {
            "years": years,
            "capital_mvr": one_time,
            "operating_mvr": recurring * years if recurring is not None else None,
            "total_mvr": one_time + recurring * years
            if one_time is not None and recurring is not None
            else None,
        }
        for years in (1, 5, 10)
    ]


def printable(value: Any) -> str:
    # Standard PDF fonts support accented Latin names; escape other codepoints visibly
    # rather than emitting missing glyph boxes or losing the underlying source value.
    text = str(value).replace("\u2013", "-").replace("\u2014", "-").replace("\u2011", "-")
    return text.encode("cp1252", errors="backslashreplace").decode("cp1252")


def compact_amount(value: Any) -> str:
    """Short chart labels only; the tables retain full numeric precision."""
    number = finite(value)
    if number is None:
        return "Unavailable"
    absolute = abs(number)
    for threshold, suffix in ((1e9, "bn"), (1e6, "m"), (1e3, "k")):
        if absolute >= threshold:
            return f"{number / threshold:,.1f}".removesuffix(".0") + suffix
    return f"{number:,.0f}"


def chart_text(
    drawing: Drawing,
    x: float,
    y: float,
    value: Any,
    size: float = 9,
    color: colors.Color = INK,
    bold: bool = False,
    anchor: str = "start",
) -> None:
    drawing.add(
        String(
            x,
            y,
            printable(value),
            fontName="Helvetica-Bold" if bold else "Helvetica",
            fontSize=size,
            fillColor=color,
            textAnchor=anchor,
        )
    )


def card(drawing: Drawing, x: float, y: float, width: float, height: float, color=PAPER):
    radius = min(10, width / 2, height / 2)
    drawing.add(Rect(x, y, width, height, rx=radius, ry=radius, fillColor=color, strokeColor=None))


def benefit_cards(
    summary: dict[str, Any],
    delta: dict[str, Any],
    width: float,
    ferry_services: list[dict[str, Any]] | None = None,
) -> Drawing:
    """Lead with the proposal's service outcome, keeping resident access separate."""
    drawing = Drawing(width, 185)
    card(drawing, 0, 65, width, 120, INK)
    if ferry_services:
        service_count = len({service.get("routeId") or service["id"] for service in ferry_services})
        departures = sum(
            len(service.get("timing", {}).get("trips", [])) for service in ferry_services
        )
        chart_text(
            drawing,
            20,
            160,
            "NEW FERRY SERVICE" + ("S" if service_count != 1 else ""),
            8,
            LIME,
            True,
        )
        chart_text(drawing, 18, 101, amount(service_count), 48, colors.white, True)
        chart_text(
            drawing,
            20,
            81,
            f"{departures} planned departures, including return sailings, on the selected date",
            9,
            colors.white,
        )
    else:
        chart_text(drawing, 20, 160, "RESIDENTS GAINING TARGET ACCESS", 8, LIME, True)
        chart_text(
            drawing, 18, 101, amount(summary.get("gained_residents")), 48, colors.white, True
        )
        chart_text(
            drawing, 20, 81, "Newly within the selected journey-time target", 9, colors.white
        )
    gap, cell_width = 10, (width - 20) / 3
    for index, (label, value) in enumerate(
        (
            ("ONE-TIME ADDED CAPITAL", f"MVR {compact_amount(delta.get('capital_mvr'))}"),
            ("ADDED ANNUAL OPERATING", f"MVR {compact_amount(delta.get('annual_operating_mvr'))}"),
            ("RESIDENT ACCESS GAIN", amount(summary.get("gained_residents")))
            if ferry_services
            else ("SUPPORTED RESIDENTS", amount(summary.get("population"))),
        )
    ):
        x = index * (cell_width + gap)
        card(drawing, x, 0, cell_width, 55)
        chart_text(drawing, x + 11, 36, label, 6.8, MUTED, True)
        chart_text(drawing, x + 11, 14, value, 16, INK, True)
    return drawing


def access_comparison(summary: dict[str, Any], width: float) -> Drawing:
    """Use one supported-population denominator, without drawing unknowns as zero."""
    drawing = Drawing(width, 130)
    population = finite(summary.get("population"))
    bar_x, bar_width = 106.0, width - 180
    for index, (label, key, fill) in enumerate(
        (
            ("Current services", "baseline_reachable_residents", BEFORE),
            ("With proposal", "scenario_reachable_residents", TEAL),
        )
    ):
        y = 88 - index * 48
        value = finite(summary.get(key))
        chart_text(drawing, 0, y + 6, label, 9, INK, index == 1)
        card(drawing, bar_x, y, bar_width, 24, LINE)
        if value is not None and population is not None and population > 0:
            length = bar_width * min(max(value / population, 0), 1)
            if length:
                card(drawing, bar_x, y, length, 24, fill)
            chart_text(drawing, width, y + 7, f"{value / population:.1%}", 15, INK, True, "end")
        else:
            chart_text(drawing, width, y + 8, "Unavailable", 9, MUTED, anchor="end")
        chart_text(drawing, bar_x, y - 13, f"{amount(value)} residents", 8, MUTED)
    chart_text(drawing, 0, 3, "Share of the supported resident population within target", 8, MUTED)
    return drawing


def travel_band_chart(bands: dict[str, Any], width: float) -> Drawing:
    before = {row["label"]: row.get("residents") for row in bands.get("before", [])}
    after = {row["label"]: row.get("residents") for row in bands.get("after", [])}
    labels = list(dict.fromkeys([*before, *after]))
    drawing = Drawing(width, max(110, 48 * len(labels) + 42))
    if not labels:
        chart_text(drawing, 15, 55, "Travel-time distribution unavailable", 11, MUTED)
        return drawing
    values = [finite(value) for value in [*before.values(), *after.values()]]
    maximum = max([value for value in values if value is not None and value >= 0] or [1]) or 1
    bar_x, bar_width = 125.0, width - 205
    top = drawing.height - 18
    drawing.add(Rect(bar_x, top - 1, 9, 9, fillColor=BEFORE, strokeColor=None))
    chart_text(drawing, bar_x + 15, top, "Current services", 8, MUTED)
    drawing.add(Rect(bar_x + 120, top - 1, 9, 9, fillColor=TEAL, strokeColor=None))
    chart_text(drawing, bar_x + 135, top, "With proposal", 8, MUTED)
    for index, label in enumerate(labels):
        y = top - 38 - index * 48
        chart_text(drawing, 0, y + 3, label, 9, INK, label == "Unavailable")
        for offset, value, fill in (
            (11, finite(before.get(label)), BEFORE),
            (-3, finite(after.get(label)), TEAL),
        ):
            drawing.add(
                Line(
                    bar_x,
                    y + offset + 4,
                    width - 66,
                    y + offset + 4,
                    strokeColor=LINE,
                    strokeWidth=0.4,
                )
            )
            if value is not None and value >= 0:
                length = bar_width * value / maximum
                if length:
                    card(drawing, bar_x, y + offset, length, 9, fill)
            chart_text(drawing, width, y + offset + 1, amount(value), 8, fill, True, "end")
    return drawing


def resident_outcomes(summary: dict[str, Any], width: float) -> Drawing:
    drawing = Drawing(width, 76)
    cell_width = (width - 20) / 3
    for index, (label, key, fill) in enumerate(
        (
            ("NEW TARGET ACCESS", "gained_residents", TEAL),
            ("KNOWN ACCESS LOST", "lost_residents", AMBER),
            ("JOURNEY UNAVAILABLE", "unknown_residents", MUTED),
        )
    ):
        x = index * (cell_width + 10)
        card(drawing, x, 0, cell_width, 76)
        chart_text(drawing, x + 12, 53, label, 7, MUTED, True)
        chart_text(drawing, x + 12, 21, amount(summary.get(key)), 25, fill, True)
    return drawing


def budget_chart(delta: dict[str, Any], budget: dict[str, Any], width: float) -> Drawing:
    drawing = Drawing(width, 158)
    for index, (label, cost_key, budget_key) in enumerate(
        (
            ("Capital budget", "capital_mvr", "capital_budget_mvr"),
            ("Annual operating budget", "annual_operating_mvr", "annual_operating_budget_mvr"),
        )
    ):
        y = 113 - index * 77
        cost, limit = finite(delta.get(cost_key)), finite(budget.get(budget_key))
        over = cost is not None and limit is not None and cost > limit
        chart_text(drawing, 0, y + 25, label, 10, INK, True)
        chart_text(
            drawing,
            width,
            y + 25,
            f"MVR {compact_amount(cost)} / {compact_amount(limit)}"
            if limit is not None
            else f"MVR {compact_amount(cost)} - no limit set",
            9,
            AMBER if over else MUTED,
            anchor="end",
        )
        card(drawing, 0, y, width, 15, LINE)
        if cost is not None and limit is not None:
            proportion = 1.0 if limit == 0 and cost > 0 else (max(cost, 0) / limit if limit else 0)
            length = width * min(proportion, 1)
            if length:
                card(drawing, 0, y, length, 15, AMBER if over else TEAL)
            remaining = limit - cost
            label = (
                f"Over budget by MVR {amount(-remaining)}"
                if over
                else (f"MVR {amount(remaining)} remaining")
            )
        elif cost is None:
            label = "Cost estimate unavailable; affordability cannot be confirmed"
        else:
            label = "Set a budget to assess affordability"
        chart_text(drawing, 0, y - 15, label, 8, AMBER if over else MUTED)
    return drawing


def fiscal_chart(capital: Any, annual: Any, width: float) -> Drawing:
    """Signed cost components, including operating savings, at three explicit horizons."""
    drawing = Drawing(width, 184)
    rows = fiscal_projection(capital, annual)
    if finite(capital) is None or finite(annual) is None:
        card(drawing, 0, 20, width, 140)
        chart_text(drawing, 18, 104, "Fiscal projection unavailable", 13, MUTED, True)
        chart_text(
            drawing, 18, 80, "Capital and annual operating estimates are both required.", 9, MUTED
        )
        chart_text(drawing, 18, 58, "Unknown inputs remain unavailable.", 9, MUTED)
        return drawing
    maximum = max(sum(max(row[key], 0) for key in ("capital_mvr", "operating_mvr")) for row in rows)
    minimum = min(sum(min(row[key], 0) for key in ("capital_mvr", "operating_mvr")) for row in rows)
    span = maximum - minimum or 1
    left, chart_width = 56.0, width - 160
    zero = left + (0 - minimum) / span * chart_width
    for index, (label, fill) in enumerate((("Capital once", INK), ("Operating total", TEAL))):
        x = left + index * 132
        drawing.add(Rect(x, 168, 9, 9, fillColor=fill, strokeColor=None))
        chart_text(drawing, x + 15, 169, label, 8, MUTED)
    for index, row in enumerate(rows):
        y = 122 - index * 45
        chart_text(
            drawing, 0, y + 8, f"{row['years']} year" + ("s" if row["years"] != 1 else ""), 9
        )
        positive = negative = zero
        for key, fill in (("capital_mvr", INK), ("operating_mvr", TEAL)):
            value = row[key]
            size = abs(value) / span * chart_width
            if value >= 0:
                x, positive = positive, positive + size
            else:
                negative -= size
                x = negative
            if size:
                drawing.add(Rect(x, y, size, 23, fillColor=fill, strokeColor=None))
        chart_text(
            drawing, width, y + 8, f"MVR {compact_amount(row['total_mvr'])}", 10, INK, True, "end"
        )
    drawing.add(Line(zero, 26, zero, 150, strokeColor=MUTED, strokeWidth=0.5))
    chart_text(drawing, zero, 13, "0", 7, MUTED, anchor="middle")
    return drawing


def proposal_map(
    payload: PlanningRequest,
    baseline: dict[str, Any],
    width: float,
    world_stops: dict[str, Any] | None = None,
) -> Drawing | None:
    """Local road geometry and numbered proposal sites; no fabricated basemap imagery."""
    edges = [edge.get("geometry") or [] for edge in baseline.get("graph_edges", [])]
    sites = [
        (index, operation.coordinates)
        for index, operation in enumerate(payload.operations, 1)
        if operation.coordinates
        and not (
            operation.type == "add_service" and (operation.service or {}).get("mode") == "ferry"
        )
    ]
    seen_terminals = set()
    for index, operation in enumerate(payload.operations, 1):
        if operation.type != "use_existing_ferry_terminal" or operation.target_id in seen_terminals:
            continue
        seen_terminals.add(operation.target_id)
        terminal = (world_stops or {}).get(operation.target_id, {})
        point = terminal.get("coordinate") or [terminal.get("lon"), terminal.get("lat")]
        if not operation.coordinates and all(isinstance(value, (int, float)) for value in point):
            sites.append((index, point))

    def map_features(operation):
        value = operation.metadata.get("ui_map_features", [])
        if isinstance(value, dict):
            value = value.get("features", [])
        return value if isinstance(value, list) else []

    corridors = [
        feature["geometry"]["coordinates"]
        for operation in payload.operations
        for feature in map_features(operation)
        if isinstance(feature, dict) and feature.get("geometry", {}).get("type") == "LineString"
    ]
    for index, operation in enumerate(payload.operations, 1):
        if operation.type == "use_existing_ferry_terminal" or (
            operation.type == "add_service" and (operation.service or {}).get("mode") == "ferry"
        ):
            continue
        for feature in map_features(operation):
            geometry = feature.get("geometry", {}) if isinstance(feature, dict) else {}
            coordinates = geometry.get("coordinates", [])
            if geometry.get("type") == "LineString" and len(coordinates) >= 2:
                sites.extend([(index, coordinates[0]), (index, coordinates[-1])])
    # Shared landings and outbound/return corridors must not stack numbered markers.
    sites = list({tuple(point): (index, point) for index, point in reversed(sites)}.values())
    points = [point for line in edges + corridors for point in line] + [point for _, point in sites]
    points = [
        point
        for point in points
        if len(point) == 2
        and all(
            isinstance(coordinate, (int, float)) and math.isfinite(coordinate)
            for coordinate in point
        )
    ]
    if not sites or len(points) < 2:
        return None
    west, east = min(point[0] for point in points), max(point[0] for point in points)
    south, north = min(point[1] for point in points), max(point[1] for point in points)
    cos_lat = math.cos(math.radians((north + south) / 2))
    span_x = max((east - west) * cos_lat, 0.001)
    span_y = max(north - south, 0.001)
    height, padding = 190.0, 16.0
    scale = min((width - 2 * padding) / span_x, (height - 2 * padding) / span_y)
    offset_x, offset_y = (width - span_x * scale) / 2, (height - span_y * scale) / 2

    def xy(point):
        return (
            offset_x + (point[0] - west) * cos_lat * scale,
            offset_y + (point[1] - south) * scale,
        )

    drawing = Drawing(width, height)
    drawing.add(
        Rect(
            0,
            0,
            width,
            height,
            fillColor=colors.HexColor("#f4f7f4"),
            strokeColor=LINE,
            strokeWidth=0.5,
        )
    )
    for line in edges:
        if len(line) >= 2:
            drawing.add(
                PolyLine(
                    [value for point in line for value in xy(point)],
                    strokeColor=colors.HexColor("#c5d1c7"),
                    strokeWidth=0.45,
                )
            )
    for corridor in corridors:
        if len(corridor) >= 2:
            drawing.add(
                PolyLine(
                    [value for point in corridor for value in xy(point)],
                    strokeColor=TEAL,
                    strokeWidth=2,
                    strokeDashArray=[5, 3],
                )
            )
    for number, point in sites:
        x, y = xy(point)
        drawing.add(Circle(x, y, 7, fillColor=INK, strokeColor=colors.white, strokeWidth=1.5))
        drawing.add(
            String(
                x,
                y - 2.7,
                str(number),
                textAnchor="middle",
                fontName="Helvetica-Bold",
                fontSize=8,
                fillColor=colors.white,
            )
        )
    drawing.add(
        Line(width - 18, height - 28, width - 18, height - 13, strokeColor=MUTED, strokeWidth=1)
    )
    drawing.add(
        String(width - 18, height - 10, "N", textAnchor="middle", fontSize=7, fillColor=MUTED)
    )
    return drawing


def build_planning_report(
    payload: PlanningRequest,
    evaluation: dict[str, Any],
    title: str,
    baseline: dict[str, Any] | None = None,
) -> bytes:
    """Visual decision brief with traceable charts and a full reproducibility appendix."""
    buffer = io.BytesIO()
    margin = 19 * mm
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=margin,
        leftMargin=margin,
        topMargin=23 * mm,
        bottomMargin=20 * mm,
        title=title,
        author="Mobility Sandbox MV",
        subject="Source-backed community investment and resident accessibility comparison",
    )
    available = A4[0] - 2 * margin
    styles = getSampleStyleSheet()
    for name, options in {
        "ReportTitle": dict(
            fontName="Helvetica-Bold", fontSize=27, leading=32, textColor=INK, spaceAfter=12
        ),
        "Section": dict(
            fontName="Helvetica-Bold",
            fontSize=15,
            leading=20,
            textColor=INK,
            spaceBefore=17,
            spaceAfter=8,
            keepWithNext=True,
        ),
        "Body": dict(fontName="Helvetica", fontSize=9, leading=14, textColor=INK, spaceAfter=8),
        "Note": dict(
            fontName="Helvetica",
            fontSize=8,
            leading=12,
            textColor=MUTED,
            spaceAfter=8,
            allowWidows=False,
            allowOrphans=False,
        ),
        "Cell": dict(fontName="Helvetica", fontSize=8, leading=12, textColor=INK, spaceAfter=0),
        "Label": dict(
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=11,
            textColor=TEAL,
            spaceAfter=8,
            keepWithNext=True,
        ),
    }.items():
        styles.add(ParagraphStyle(name, **options))
    styles.add(ParagraphStyle("SectionIntro", parent=styles["Note"], keepWithNext=True))

    def p(value: Any, style: str = "Body") -> Paragraph:
        return Paragraph(escape(printable(value)).replace("\n", "<br/>"), styles[style])

    def table(rows: list[list[Any]], widths: list[float] | None = None) -> Table:
        result = Table(
            [[p(cell, "Cell") for cell in row] for row in rows],
            colWidths=widths,
            repeatRows=1,
            hAlign="LEFT",
        )
        result.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e5eee6")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PAPER]),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LINEBELOW", (0, 0), (-1, 0), 0.6, LINE),
                    ("LINEBELOW", (0, 1), (-1, -1), 0.35, LINE),
                    ("LEFTPADDING", (0, 0), (-1, -1), 9),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ]
            )
        )
        return result

    def new_page(number: str, label: str, heading: str, intro: str):
        return [
            PageBreak(),
            p(f"{number} / {label.upper()}", "Label"),
            p(heading, "ReportTitle"),
            p(intro),
        ]

    a = payload.assumptions
    summary = evaluation.get("summary") or {}
    economics = evaluation.get("economics") or {}
    delta = economics.get("delta") or {}
    budget = economics.get("budget") or {}
    bands = evaluation.get("travel_time_bands") or {}
    proposed_ferries = [
        operation
        for operation in payload.operations
        if operation.type == "add_service" and (operation.service or {}).get("mode") == "ferry"
    ]
    world_stops = {stop["id"]: stop for stop in evaluation.get("world", {}).get("stops", [])}
    terminal_sites: dict[str, str] = {}
    for index, operation in enumerate(payload.operations, 1):
        if operation.type == "use_existing_ferry_terminal":
            terminal_sites.setdefault(operation.target_id, str(index))
    scoped_names = [
        island.get("name", island["id"]) for island in (baseline or {}).get("islands", [])
    ]
    scope = ", ".join(scoped_names) or payload.island_id or "National supported resident areas"
    goal = {
        "education": "education",
        "healthcare": "healthcare",
        "transport": "mapped public transport boarding points",
    }[a.goal]
    population = finite(summary.get("population"))

    def share(value: Any) -> str:
        count = finite(value)
        return "Unavailable" if count is None or not population else f"{count / population:.1%}"

    story: list[Any] = [
        p("01 / THE DECISION", "Label"),
        p(title, "ReportTitle"),
        p(
            f"{scope}  |  {a.date.isoformat()}  |  "
            f"{int(a.departure_minutes // 60):02}:{int(a.departure_minutes % 60):02} MVT  |  "
            f"{a.population_year} resident projection",
            "Note",
        ),
        p(
            "Connect islands with a new ferry service using existing landing points. "
            "Review planned sailings and investment, with resident access measured separately."
            if proposed_ferries
            else f"What changes when your proposal brings {goal} within "
            f"{a.target_minutes:g} minutes of more residents?"
        ),
        Spacer(1, 5),
        benefit_cards(
            summary, delta, available, [operation.service for operation in proposed_ferries]
        ),
        p(f"Access to {goal}, before and after", "Section"),
        access_comparison(summary, available),
        Spacer(1, 5),
        p(
            "A conditional comparison of current services with your proposed changes. "
            "This draft is for decision support; it does not grant planning approval.",
            "Note",
        ),
        p(
            "Read this as modeled access, not observed admissions, available capacity, "
            "ridership or a causal future forecast. The evidence and exact assumptions "
            "are preserved in the appendix.",
            "Note",
        ),
    ]
    story.extend(
        new_page(
            "02",
            "Resident outcomes",
            "Who benefits, and how far away?",
            f"Resident origins are counted once, even when several new sites serve them. "
            f"The target is a modeled journey within {a.target_minutes:g} minutes to {goal}.",
        )
    )
    story.extend(
        [
            resident_outcomes(summary, available),
            p("Travel-time distribution", "Section"),
            travel_band_chart(bands, available),
            p(
                "Each pair of bars shows residents allocated to a journey-time band. "
                "The target may sit inside a band, so target access can improve while band "
                "totals stay the same. Unavailable is an evidence category, not a measured loss.",
                "Note",
            ),
            p(
                (evaluation.get("population_basis") or "Resident allocation unavailable.")
                + ". Resident counts are rounded from modeled allocations; exact chart values "
                "are attached to this PDF.",
                "Note",
            ),
            table(
                [
                    ["Measure", "Current services", "With proposal"],
                    [
                        "Residents within target",
                        amount(summary.get("baseline_reachable_residents")),
                        amount(summary.get("scenario_reachable_residents")),
                    ],
                    [
                        "Share of supported population",
                        share(summary.get("baseline_reachable_residents")),
                        share(summary.get("scenario_reachable_residents")),
                    ],
                ],
                [available * 0.52, available * 0.24, available * 0.24],
            ),
        ]
    )
    story.extend(
        new_page(
            "03",
            "Investment",
            "A clear view of the commitment.",
            "Added capital is paid once. Added annual operating costs repeat at the same "
            "service level. All amounts are in Maldivian rufiyaa (MVR).",
        )
    )
    story.extend(
        [
            budget_chart(delta, budget, available),
            p("Fiscal outlook: 1, 5 and 10 years", "Section"),
            fiscal_chart(delta.get("capital_mvr"), delta.get("annual_operating_mvr"), available),
            table(
                [
                    ["Horizon", "Capital once (MVR)", "Operating total (MVR)", "Added total (MVR)"],
                    *[
                        [
                            f"{row['years']} year" + ("s" if row["years"] != 1 else ""),
                            amount(row["capital_mvr"]),
                            amount(row["operating_mvr"]),
                            amount(row["total_mvr"]),
                        ]
                        for row in fiscal_projection(
                            delta.get("capital_mvr"), delta.get("annual_operating_mvr")
                        )
                    ],
                ],
                [available * 0.13, available * 0.28, available * 0.29, available * 0.30],
            ),
            Spacer(1, 8),
            p(
                "Formula: added capital + years x added annual operating cost. Undiscounted; no "
                "inflation, financing, replacement cycle, residual value or demand growth "
                "is assumed. "
                "Negative totals represent modeled savings. Unknown inputs remain unavailable.",
                "Note",
            ),
            p(
                "Costs are editable planning assumptions, not official local quotations. "
                "Confirm site feasibility and obtain cost estimates before an investment decision.",
                "Note",
            ),
        ]
    )
    story.extend(
        new_page(
            "04",
            "Delivery plan",
            "Put the proposal in context.",
            f"{len(payload.operations)} proposed change"
            + ("s" if len(payload.operations) != 1 else "")
            + ". Numbered sites connect the map to the change list below.",
        )
    )
    site_map = proposal_map(payload, baseline or {}, available, world_stops)
    if site_map:
        story.extend(
            [
                site_map,
                Spacer(1, 7),
                p(
                    "Numbered proposed sites on the source-backed walking-road network. "
                    "Dashed ferry corridors connect existing terminals and are planning "
                    "assumptions, not charted navigation routes. "
                    "Numbers mark locations in the change list; ferry rows refer to those "
                    "landing numbers. This overview does not certify "
                    "land ownership, construction feasibility or a transport route.",
                    "Note",
                ),
            ]
        )
    else:
        story.append(
            p(
                "A site map is unavailable for this proposal. Changes without a placed "
                "location are listed below rather than assigned an invented map position.",
                "Note",
            )
        )
    operations = payload.model_dump(mode="json")["operations"]
    if operations:
        operation_rows: list[list[Any]] = [["Site", "Proposed change and location"]]
        for index, operation in enumerate(operations, 1):
            service = operation.get("service") or {}
            name = (
                operation.get("name") or service.get("name") or operation["type"].replace("_", " ")
            )
            details = [name, operation["type"].replace("_", " ")]
            site_label = str(index)
            if operation["type"] == "use_existing_ferry_terminal":
                site_label = terminal_sites[operation["target_id"]]
                terminal = world_stops.get(operation.get("target_id"), {})
                details = [
                    terminal.get("name", "Existing ferry landing"),
                    "Use the existing landing. New terminal construction: MVR 0.",
                ]
            elif operation["type"] == "add_service" and service.get("mode") == "ferry":
                landing_numbers = [
                    terminal_sites.get(identity) for identity in service.get("stopIds", [])
                ]
                site_label = (
                    " to ".join(landing_numbers)
                    if landing_numbers and all(landing_numbers)
                    else "Service"
                )
                direction = (
                    "Return sailings" if service["id"].endswith(":return") else "Outward sailings"
                )
                details = [
                    name,
                    direction,
                    f"{len(service.get('timing', {}).get('trips', []))} planned departures "
                    f"on {a.date.isoformat()}.",
                ]
            if operation.get("coordinates"):
                lon, lat = operation["coordinates"]
                details.append(f"Map location: {lat:.6f} latitude, {lon:.6f} longitude")
            if operation.get("target_id") and operation["type"] != "use_existing_ferry_terminal":
                details.append(f"Target: {operation['target_id']}")
            if operation.get("opening_date"):
                details.append(f"Opening date: {operation['opening_date']}")
            operation_rows.append([site_label, "\n".join(details)])
        story.append(table(operation_rows, [available * 0.11, available * 0.89]))
    else:
        story.append(p("No interventions. This report describes the unchanged baseline."))
    transport = evaluation.get("transport_connectivity", {})
    if proposed_ferries:
        rows = [["Ferry service", "Existing landing points", "Assumed crossing", "Departures"]]
        for operation in proposed_ferries:
            service = operation.service or {}
            trips = service.get("timing", {}).get("trips", [])
            first_trip = trips[0].get("stopTimes", []) if trips else []
            crossing = (
                first_trip[-1]["arrivalMinutes"] - first_trip[0]["departureMinutes"]
                if first_trip
                else None
            )
            landings = " to ".join(
                world_stops.get(identity, {}).get("name", identity)
                for identity in service.get("stopIds", [])
            )
            rows.append(
                [
                    service.get("name", "Proposed ferry"),
                    landings,
                    f"{amount(crossing)} min",
                    str(len(trips)),
                ]
            )
        story.extend(
            [
                p("Public transport and island connections", "Section"),
                table(
                    rows, [available * 0.27, available * 0.37, available * 0.19, available * 0.17]
                ),
                p(
                    "New terminal / port construction: MVR 0. Existing source-mapped "
                    "landing points are reused. Capital includes illustrative vessel "
                    "procurement; annual operation and fleet reserve are included in the "
                    "investment figures. Sailing times and corridor distances are "
                    "assumptions. Confirm berth access, permissions, navigational safety, "
                    "vessel suitability and demand before approval.",
                    "Note",
                ),
                p(transport.get("after", {}).get("qualification", ""), "Note"),
            ]
        )
    story.extend(
        [
            p("Fleet and environmental implications", "Section"),
            table(
                [
                    ["Delivery measure", "Modeled change"],
                    ["Additional modeled vehicles", amount(delta.get("additional_fleet"))],
                    [
                        "Net annual emissions change",
                        f"{amount(delta.get('net_annual_kg_co2e'))} kg CO2e",
                    ],
                    [
                        "Construction emissions change",
                        f"{amount(delta.get('embodied_facility_kg_co2e'))} kg CO2e",
                    ],
                ],
                [available * 0.65, available * 0.35],
            ),
            Spacer(1, 7),
            p(
                "Unavailable emissions are not zero. Facility energy and construction "
                "require explicit "
                "estimates; avoided transport emissions depend on assumed displaced passenger-km.",
                "Note",
            ),
        ]
    )
    story.extend(
        new_page(
            "05",
            "Evidence appendix",
            "What the decision rests on.",
            "Review coverage, assumptions and source versions alongside the modeled benefits. "
            "The PDF also includes exact scenario inputs and chart evidence as JSON attachments.",
        )
    )
    story.extend(
        [
            p("Evidence and decision limitations", "Section"),
            p(
                (evaluation.get("coverage") or {}).get(
                    "meaning", "Coverage information unavailable."
                )
            ),
            p(
                "Shortest walking time to mapped public transport boarding points on the "
                "available walking network. This access measure excludes scheduled waits, "
                "sailing times and transfers; service connections are reviewed separately."
                if a.goal == "transport"
                else evaluation.get("access_method") or "Access method unavailable."
            ),
        ]
    )
    warnings = (evaluation.get("warnings") or []) + (economics.get("warnings") or [])
    for warning in sorted(set(warnings)):
        story.append(p(f"- {warning}", "Note"))
    sensitivity = economics.get("sensitivity") or {}
    bounds = sensitivity.get("capital_mvr") or {}
    story.extend(
        [
            p("Cost sensitivity", "Section"),
            p(
                f"Capital sensitivity: MVR {amount(bounds.get('low'))} to "
                f"{amount(bounds.get('high'))}. {sensitivity.get('meaning', '')}",
                "Note",
            ),
            p("Calculation assumptions", "Section"),
            table(
                [
                    ["Input", "Value"],
                    *[
                        [key.replace("_", " "), json.dumps(value, ensure_ascii=False)]
                        for key, value in a.model_dump(mode="json").items()
                        if key
                        not in {
                            "calibration_records",
                            "fleet_resources",
                            "cost_overrides",
                            "energy_overrides",
                        }
                    ],
                ],
                [available * 0.5, available * 0.5],
            ),
            p("Cost factors", "Section"),
            p(economics.get("basis") or "Cost provenance unavailable.", "SectionIntro"),
            table(
                [
                    ["Factor", "Applied value"],
                    *[
                        [key.replace("_", " "), factor_amount(value)]
                        for key, value in (economics.get("assumptions") or {}).items()
                    ],
                ],
                [available * 0.7, available * 0.3],
            ),
        ]
    )
    calibration = economics.get("calibration") or {}
    if calibration.get("factor_basis"):
        story.extend([p("Factor provenance", "Section"), p(calibration.get("meaning", ""), "Note")])
        factor_groups: dict[str, list[str]] = {}
        for key, basis in calibration["factor_basis"].items():
            factor_groups.setdefault(basis, []).append(key.replace("_", " "))
        for basis, factors in factor_groups.items():
            names = "All displayed factors" if len(factor_groups) == 1 else ", ".join(factors)
            story.append(p(f"{names}: {basis.replace('_', ' ')}.", "Note"))
    before_bands = {row["label"]: row.get("residents") for row in bands.get("before", [])}
    after_bands = {row["label"]: row.get("residents") for row in bands.get("after", [])}
    story.extend(
        [
            p("Travel-time chart values", "Section"),
            table(
                [
                    ["Journey time band", "Current residents", "Proposal residents"],
                    *[
                        [label, amount(before_bands.get(label)), amount(after_bands.get(label))]
                        for label in dict.fromkeys([*before_bands, *after_bands])
                    ],
                ],
                [available * 0.45, available * 0.275, available * 0.275],
            ),
            p("Budget detail", "Section"),
            table(
                [
                    ["Budget measure", "Value (MVR)"],
                    ["Capital budget", amount(budget.get("capital_budget_mvr"))],
                    ["Capital remaining", amount(budget.get("capital_remaining_mvr"))],
                    [
                        "Added annual operating budget",
                        amount(budget.get("annual_operating_budget_mvr")),
                    ],
                    ["Annual budget remaining", amount(budget.get("annual_remaining_mvr"))],
                ],
                [available * 0.65, available * 0.35],
            ),
        ]
    )
    source_rows = [["Source / model pin", "Value"]]
    for receipt in evaluation.get("source_receipts", []) or []:
        source_rows.append(
            [
                receipt.get("path", receipt.get("id", "Source receipt")),
                json.dumps(receipt, ensure_ascii=False),
            ]
        )
    for key, value in (evaluation.get("version_pins") or {}).items():
        source_rows.append([key, str(value)])
    story.extend(
        [
            p("Source receipts and model versions", "Section"),
            table(source_rows, [available * 0.35, available * 0.65]),
        ]
    )
    for label, value in (
        ("User calibration records", a.calibration_records),
        ("Fleet resource assumptions", a.fleet_resources),
    ):
        if value:
            story.extend(
                [
                    p(label, "Section"),
                    p(
                        json.dumps(
                            [item.model_dump(mode="json") for item in value],
                            ensure_ascii=False,
                            indent=2,
                        ),
                        "Note",
                    ),
                ]
            )
    story.extend(
        [
            Spacer(1, 12),
            p(
                f"Generated {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')}. "
                "Canonical evaluation recalculated by the backend for this export.",
                "Note",
            ),
            p(
                "Exact scenario inputs are included as the proposal-inputs.json attachment "
                "inside this PDF for reproducibility, including service calendars "
                "and calibrations. "
                "The evaluation-evidence.json attachment preserves the values behind the charts.",
                "Note",
            ),
        ]
    )

    def page_footer(canvas, document):
        canvas.saveState()
        canvas.setFillColor(TEAL)
        canvas.roundRect(margin, A4[1] - 14 * mm, 7 * mm, 3 * mm, 1.5 * mm, fill=1, stroke=0)
        canvas.setFont("Helvetica-Bold", 7.5)
        canvas.setFillColor(INK)
        canvas.drawString(margin + 10 * mm, A4[1] - 13.2 * mm, "MOBILITY SANDBOX MV")
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(A4[0] - margin, A4[1] - 13.2 * mm, "COMMUNITY INVESTMENT / DRAFT")
        canvas.setStrokeColor(LINE)
        canvas.line(margin, 15 * mm, A4[0] - margin, 15 * mm)
        canvas.drawString(margin, 10 * mm, "Mobility Sandbox MV - Draft decision support")
        canvas.drawRightString(A4[0] - margin, 10 * mm, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=page_footer, onLaterPages=page_footer)
    writer = PdfWriter()
    writer.clone_document_from_reader(PdfReader(io.BytesIO(buffer.getvalue())))
    writer.add_attachment(
        "proposal-inputs.json",
        json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, indent=2).encode("utf-8"),
    )
    writer.add_attachment(
        "evaluation-evidence.json",
        json.dumps(
            {
                key: evaluation.get(key)
                for key in (
                    "summary",
                    "travel_time_bands",
                    "transport_connectivity",
                    "economics",
                    "island_summaries",
                    "coverage",
                    "source_receipts",
                    "version_pins",
                    "population_basis",
                    "access_method",
                    "warnings",
                )
            },
            ensure_ascii=False,
            indent=2,
        ).encode("utf-8"),
    )
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue()
