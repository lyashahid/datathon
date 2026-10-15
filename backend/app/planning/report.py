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
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.planning.models import PlanningRequest

INK = colors.HexColor("#273732")
MUTED = colors.HexColor("#68706e")
LINE = colors.HexColor("#e5e8e3")
LILAC = colors.HexColor("#efedf5")


def finite(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else None


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


def proposal_map(
    payload: PlanningRequest, baseline: dict[str, Any], width: float
) -> Drawing | None:
    """Local road geometry and numbered proposal sites; no fabricated basemap imagery."""
    edges = [edge.get("geometry") or [] for edge in baseline.get("graph_edges", [])]
    sites = [
        (index, operation.coordinates)
        for index, operation in enumerate(payload.operations, 1)
        if operation.coordinates
    ]
    points = [point for line in edges for point in line] + [point for _, point in sites]
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
    """Build a self-contained PDF with operations, costs, limitations and source pins."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=19 * mm,
        leftMargin=19 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title=title,
        author="Mobility Sandbox MV",
    )
    available = A4[0] - 38 * mm
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            "ReportTitle",
            fontName="Helvetica-Bold",
            fontSize=23,
            leading=28,
            textColor=INK,
            spaceAfter=12,
        )
    )
    styles.add(
        ParagraphStyle(
            "Section",
            fontName="Helvetica-Bold",
            fontSize=14,
            leading=19,
            textColor=INK,
            spaceBefore=20,
            spaceAfter=10,
            keepWithNext=True,
        )
    )
    styles.add(
        ParagraphStyle(
            "Body", fontName="Helvetica", fontSize=9, leading=14, textColor=INK, spaceAfter=8
        )
    )
    styles.add(ParagraphStyle("SectionIntro", parent=styles["Body"], keepWithNext=True))
    styles.add(
        ParagraphStyle(
            "Note",
            fontName="Helvetica",
            fontSize=8,
            leading=12,
            textColor=MUTED,
            spaceAfter=8,
            allowWidows=False,
            allowOrphans=False,
        )
    )
    styles.add(
        ParagraphStyle(
            "Cell", fontName="Helvetica", fontSize=8, leading=12, textColor=INK, spaceAfter=0
        )
    )
    styles.add(
        ParagraphStyle("Label", parent=styles["Note"], fontSize=8, leading=11, textColor=MUTED)
    )

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
                    ("BACKGROUND", (0, 0), (-1, 0), LILAC),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LINEBELOW", (0, 0), (-1, 0), 0.5, LINE),
                    ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
                    ("LEFTPADDING", (0, 0), (-1, -1), 9),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                    ("TOPPADDING", (0, 0), (-1, -1), 9),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                ]
            )
        )
        return result

    a = payload.assumptions
    summary = evaluation.get("summary", {})
    economics = evaluation.get("economics", {})
    delta = economics.get("delta", {})
    budget = economics.get("budget", {})
    scoped_names = [
        island.get("name", island["id"]) for island in (baseline or {}).get("islands", [])
    ]
    scope = ", ".join(scoped_names) or payload.island_id or "National supported resident areas"
    goal = "education" if a.goal == "education" else "healthcare"
    population = finite(summary.get("population"))

    def share(value: Any) -> str:
        count = finite(value)
        return "Unavailable" if count is None or not population else f"{count / population:.1%}"

    story: list[Any] = [
        p("MOBILITY SANDBOX MV  /  DRAFT DECISION BRIEF", "Label"),
        p(title, "ReportTitle"),
        p(
            f"Scope: {scope}  |  Service date: {a.date.isoformat()}  |  "
            f"Departure: {int(a.departure_minutes // 60):02}:"
            f"{int(a.departure_minutes % 60):02} MVT  |  "
            f"Resident projection: {a.population_year}",
            "Note",
        ),
        p(
            "A conditional comparison of current services with your proposed changes. "
            "This draft is for decision support; it does not grant planning approval.",
            "Body",
        ),
        table(
            [
                [
                    "Residents gaining target access",
                    "One-time added capital",
                    "Added annual operating",
                ],
                [
                    amount(summary.get("gained_residents")),
                    f"MVR {amount(delta.get('capital_mvr'))}",
                    f"MVR {amount(delta.get('annual_operating_mvr'))}",
                ],
            ],
            [available / 3] * 3,
        ),
        p(f"Resident access to {goal}", "Section"),
        p(
            f"Target: a modeled journey within {a.target_minutes:g} minutes. Resident origins are "
            "counted once in the overall comparison, including when several new sites serve them."
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
                    "Share of supported resident population",
                    share(summary.get("baseline_reachable_residents")),
                    share(summary.get("scenario_reachable_residents")),
                ],
                ["Newly within target", "-", amount(summary.get("gained_residents"))],
                ["Known journey moved outside target", "-", amount(summary.get("lost_residents"))],
                [
                    "Resident journey evidence unavailable",
                    "-",
                    amount(summary.get("unknown_residents")),
                ],
            ],
            [available * 0.52, available * 0.24, available * 0.24],
        ),
        Spacer(1, 8),
        p(evaluation.get("population_basis") or "Resident allocation unavailable.", "Note"),
        p(
            "Missing journey evidence is separate from a measured loss of access. "
            "These are modeled "
            "journeys, not observed admissions, capacity, ridership or a causal future forecast.",
            "Note",
        ),
        p("Your proposed changes", "Section"),
    ]
    operations = payload.model_dump(mode="json")["operations"]
    site_map = proposal_map(payload, baseline or {}, available)
    if site_map:
        story.extend(
            [
                site_map,
                p(
                    "Numbered proposed sites on the source-backed walking-road network. "
                    "Numbers match the change list below. This overview does not certify "
                    "land ownership, construction feasibility or a transport route.",
                    "Note",
                ),
            ]
        )
    if operations:
        operation_rows: list[list[Any]] = [["Change", "Description and location"]]
        for index, operation in enumerate(operations, 1):
            service = operation.get("service") or {}
            name = (
                operation.get("name") or service.get("name") or operation["type"].replace("_", " ")
            )
            details = [name, operation["type"].replace("_", " ")]
            if operation.get("coordinates"):
                lon, lat = operation["coordinates"]
                details.append(f"Map location: {lat:.6f} latitude, {lon:.6f} longitude")
            if operation.get("target_id"):
                details.append(f"Target: {operation['target_id']}")
            if operation.get("opening_date"):
                details.append(f"Opening date: {operation['opening_date']}")
            operation_rows.append([str(index), "\n".join(details)])
        story.append(table(operation_rows, [available * 0.12, available * 0.88]))
    else:
        story.append(p("No interventions. This report describes the unchanged baseline."))
    story.extend(
        [
            p("Fiscal outlook: 1, 5 and 10 years", "Section"),
            p(
                "Added capital is paid once; the added annual operating cost repeats at the same "
                "service level. Costs are planning inputs, not official local quotations.",
                "SectionIntro",
            ),
            table(
                [
                    ["Horizon", "Capital once (MVR)", "Operating total (MVR)", "Added total (MVR)"],
                    *[
                        [
                            f"{row['years']} year{'s' if row['years'] != 1 else ''}",
                            amount(row["capital_mvr"]),
                            amount(row["operating_mvr"]),
                            amount(row["total_mvr"]),
                        ]
                        for row in fiscal_projection(
                            delta.get("capital_mvr"), delta.get("annual_operating_mvr")
                        )
                    ],
                ],
                [available * 0.16, available * 0.28, available * 0.28, available * 0.28],
            ),
            Spacer(1, 8),
            p(
                "Formula: added capital + years x added annual operating cost. Undiscounted; no "
                "inflation, financing, replacement cycle, residual value or demand growth "
                "is assumed. "
                "Negative totals represent modeled savings. Unknown inputs remain unavailable.",
                "Note",
            ),
            table(
                [
                    ["Budget / delivery measure", "Value"],
                    ["Capital budget", f"MVR {amount(budget.get('capital_budget_mvr'))}"],
                    ["Capital remaining", f"MVR {amount(budget.get('capital_remaining_mvr'))}"],
                    [
                        "Added annual operating budget",
                        f"MVR {amount(budget.get('annual_operating_budget_mvr'))}",
                    ],
                    [
                        "Annual budget remaining",
                        f"MVR {amount(budget.get('annual_remaining_mvr'))}",
                    ],
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
            p(
                "Unavailable emissions are not zero. Facility energy and construction "
                "require explicit "
                "estimates; avoided transport emissions depend on assumed displaced passenger-km.",
                "Note",
            ),
        ]
    )
    sensitivity = economics.get("sensitivity", {})
    bounds = sensitivity.get("capital_mvr", {})
    story.append(
        p(
            f"Capital sensitivity: MVR {amount(bounds.get('low'))} to "
            f"{amount(bounds.get('high'))}. {sensitivity.get('meaning', '')}",
            "Note",
        )
    )
    bands = evaluation.get("travel_time_bands", {})
    after_bands = {row["label"]: row.get("residents") for row in bands.get("after", [])}
    story.extend(
        [
            p("Travel-time distribution", "Section"),
            table(
                [
                    ["Journey time band", "Current residents", "Proposal residents"],
                    *[
                        [
                            row["label"],
                            amount(row.get("residents")),
                            amount(after_bands.get(row["label"])),
                        ]
                        for row in bands.get("before", [])
                    ],
                ],
                [available * 0.45, available * 0.275, available * 0.275],
            ),
            p("Evidence and decision limitations", "Section"),
            p(evaluation.get("coverage", {}).get("meaning", "Coverage information unavailable.")),
            p(evaluation.get("access_method", "Access method unavailable.")),
        ]
    )
    for warning in sorted(set(evaluation.get("warnings", []) + economics.get("warnings", []))):
        story.append(p(f"- {warning}", "Note"))
    story.extend(
        [
            p("Calculation assumptions", "Section"),
            table(
                [
                    ["Input", "Value"],
                    *[
                        [key.replace("_", " "), json.dumps(value, ensure_ascii=False)]
                        for key, value in payload.assumptions.model_dump(mode="json").items()
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
            p(economics.get("basis", "Cost provenance unavailable."), "Note"),
            table(
                [
                    ["Factor", "Applied value"],
                    *[
                        [key.replace("_", " "), factor_amount(value)]
                        for key, value in economics.get("assumptions", {}).items()
                    ],
                ],
                [available * 0.7, available * 0.3],
            ),
        ]
    )
    calibration = economics.get("calibration", {})
    if calibration.get("factor_basis"):
        story.extend([p("Factor provenance", "Section"), p(calibration.get("meaning", ""), "Note")])
        factor_groups: dict[str, list[str]] = {}
        for key, basis in calibration["factor_basis"].items():
            factor_groups.setdefault(basis, []).append(key.replace("_", " "))
        for basis, factors in factor_groups.items():
            names = "All displayed factors" if len(factor_groups) == 1 else ", ".join(factors)
            story.append(p(f"{names}: {basis.replace('_', ' ')}.", "Note"))
    # Full request and source pins remain machine-readable inside the exported PDF.
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

    def page_footer(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.line(19 * mm, 15 * mm, A4[0] - 19 * mm, 15 * mm)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(19 * mm, 10 * mm, "Mobility Sandbox MV - Draft decision support")
        canvas.drawRightString(A4[0] - 19 * mm, 10 * mm, f"Page {document.page}")
        canvas.restoreState()

    story.append(Spacer(1, 12))
    story.append(
        p(
            f"Generated {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')}. "
            "Canonical evaluation recalculated by the backend for this export.",
            "Note",
        )
    )
    story.append(
        p(
            "Exact scenario inputs are included as the proposal-inputs.json attachment "
            "inside this PDF for reproducibility, including service calendars and calibrations.",
            "Note",
        )
    )
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
