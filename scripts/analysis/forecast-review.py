"""Read-only audit of the currently deployed passenger specification and local evidence.

Run with uv run --directory backend python ../scripts/analysis/forecast-review.py.
Uses bundled sources and writes derived evidence under artifacts/analysis.
It does not change source data, access live providers or fit a new policy.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sys
from collections import defaultdict
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from statistics import fmean

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.forecasting.engine import (
    MODEL_VERSION,
    forecast_series,
    index_month,
    month_index,
    point_forecast,
)
from app.forecasting.service import ForecastService


def receipt(relative: str) -> dict:
    path = ROOT / relative
    return {
        "path": relative,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "bytes": path.stat().st_size,
    }


def main() -> None:
    now = datetime.now(timezone(timedelta(hours=5)))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "artifacts" / "analysis" / datetime.now(UTC).date().isoformat(),
        help="Derived output directory; defaults to artifacts/analysis/<UTC run date>.",
    )
    parser.add_argument(
        "--reference-month",
        default=now.strftime("%Y-%m"),
        metavar="YYYY-MM",
        help="Current-month diagnostic target; defaults to the current Maldives month.",
    )
    args = parser.parse_args()
    try:
        reference_date = datetime.strptime(args.reference_month, "%Y-%m")
        if reference_date.strftime("%Y-%m") != args.reference_month:
            raise ValueError("Use YYYY-MM")
    except ValueError:
        parser.error("--reference-month must use YYYY-MM with a valid calendar month")
    reference_month = args.reference_month
    next_month = index_month(month_index(reference_month) + 1)
    OUT = args.output.resolve()
    service = ForecastService(ROOT / "data/public", ROOT / "backend/data")
    source = service.source()
    rows, forecasts, profiles = [], [], []
    for series in source["series"]:
        values = [item["value"] for item in series["points"]]
        months = [item["month"] for item in series["points"]]
        annual = defaultdict(list)
        for item in series["points"]:
            annual[item["month"][:4]].append(item["value"])
        profiles.append(
            {
                "seriesId": series["id"],
                "name": series["name"],
                "observations": len(values),
                "firstMonth": months[0],
                "lastMonth": months[-1],
                "latestActual": values[-1],
                "minimum": min(values),
                "maximum": max(values),
                "annualObserved": [
                    {
                        "year": year,
                        "months": len(counts),
                        "movements": sum(counts),
                        "monthlyMean": fmean(counts),
                        "complete": len(counts) == 12,
                    }
                    for year, counts in sorted(annual.items())
                ],
                "recent12Mean": fmean(values[-12:]),
                "previous12Mean": fmean(values[-24:-12]),
                "recent12VersusPrevious12Change": fmean(values[-12:])
                / fmean(values[-24:-12])
                - 1,
                "recent6VersusSame6PreviousYearChange": sum(values[-6:])
                / sum(values[-18:-12])
                - 1,
                "sourceUrl": series["sourceUrl"],
                "qualification": "Observed source-defined movements; categories cannot be combined as unique riders.",
            }
        )
        for horizon in range(1, 13):
            forecast = forecast_series(
                series, index_month(month_index(series["lastActualMonth"]) + horizon)
            )
            forecasts.append(forecast)
            evaluation, interval = forecast["evaluation"], forecast["empiricalRange"]
            assert len(forecast["backtest"]) == 6
            errors = []
            for item in forecast["backtest"]:
                prefix = [
                    point["value"]
                    for point in series["points"]
                    if point["month"] <= item["trainingCutoff"]
                ]
                independent = point_forecast(
                    prefix, horizon, forecast["model"], forecast.get("parameters")
                )
                assert math.isclose(independent, item["estimate"], rel_tol=1e-12)
                errors.append(item["actual"] - independent)
            mae = fmean(abs(error) for error in errors)
            assert math.isclose(mae, evaluation["mae"], rel_tol=1e-12)
            simple = min(
                (
                    benchmark
                    for benchmark in forecast["benchmarks"]
                    if benchmark["model"]
                    in (
                        "last-month",
                        "seasonal-naive",
                        "mean-3-months",
                        "mean-6-months",
                    )
                ),
                key=lambda item: item["metrics"]["mae"],
            )
            row = {
                "seriesId": series["id"],
                "name": series["name"],
                "horizonMonths": horizon,
                "model": forecast["model"],
                "estimate": forecast["estimate"],
                "mae": mae,
                "rmse": evaluation["rmse"],
                "wape": evaluation["wape"],
                "biasActualMinusPrediction": fmean(errors),
                "biasDirection": forecast["diagnostics"]["evaluationBiasDirection"],
                "evaluations": len(errors),
                "evaluationFirstTarget": evaluation["firstTargetMonth"],
                "evaluationLastTarget": evaluation["lastTargetMonth"],
                "lastMonthSkill": evaluation["skill"]["lastMonth"],
                "seasonalNaiveSkill": evaluation["skill"]["seasonalNaive"],
                "bestLaterSimpleBaseline": simple["model"],
                "bestLaterSimpleMae": simple["metrics"]["mae"],
                "selectedVsBestLaterSimpleMaeRatio": mae / simple["metrics"]["mae"],
                "selectionOrigins": forecast["selection"]["origins"],
                "calibrationOrigins": forecast["selection"]["calibrationOrigins"],
                "rangeRadius": interval["radius"] if interval else None,
                "rangeLower": interval["lower"] if interval else None,
                "rangeUpper": interval["upper"] if interval else None,
                "rangeLaterCoverage": interval["historicalCoverage"]
                if interval
                else None,
                "rangeLaterCoveredCount": sum(
                    abs(error) <= interval["radius"] for error in errors
                )
                if interval
                else None,
                "qualification": "Six dependent revised-vintage evaluation rows. Baseline winner is a diagnostic, not a retuned policy.",
            }
            if interval:
                assert math.isclose(
                    row["rangeLaterCoveredCount"] / 6,
                    interval["historicalCoverage"],
                )
            rows.append(row)

    airports = json.loads(
        (ROOT / "data/public/context/agency-context.json").read_text()
    )["layers"]["flights"]["observations"]
    airport_groups = defaultdict(list)
    for item in airports:
        airport_groups[item.get("seriesId", item["id"])].append(item)
    airport_profiles = []
    for key, items in sorted(airport_groups.items()):
        monthly = [
            item for item in items if re.fullmatch(r"\d{4}-\d{2}", item["refPeriod"])
        ]
        annual = [item for item in items if re.fullmatch(r"\d{4}", item["refPeriod"])]
        if monthly:
            airport_profiles.append(
                {
                    "seriesId": key,
                    "monthlyObservations": len(monthly),
                    "monthlyFirst": min(item["refPeriod"] for item in monthly),
                    "monthlyLast": max(item["refPeriod"] for item in monthly),
                    "annualObservations": len(annual),
                    "monthlySum": sum(item["value"] for item in monthly),
                    "annualValues": [item["value"] for item in annual],
                    "qualification": "One year of monthly data; overlapping annual totals are not independent observations. No forecast fitted.",
                }
            )

    failures = [
        row for row in rows if row["selectedVsBestLaterSimpleMaeRatio"] > 1 + 1e-9
    ]
    ranges = [row for row in rows if row["rangeLaterCoverage"] is not None]
    summary = {
        "series": len(source["series"]),
        "observations": sum(item["observations"] for item in profiles),
        "horizonSpecifications": len(rows),
        "horizonsWithRanges": len(ranges),
        "horizonsWithoutRanges": len(rows) - len(ranges),
        "rangesBelowNominalCoverage": sum(
            row["rangeLaterCoverage"] < 0.8 for row in ranges
        ),
        "selectedPoliciesLoseToAtLeastOneLaterSimpleBaseline": len(failures),
        "selectedPoliciesBeatBothPersistenceAndSeasonalOnLaterRows": sum(
            row["lastMonthSkill"] > 0 and row["seasonalNaiveSkill"] > 0 for row in rows
        ),
        "underPredictionSpecifications": sum(
            row["biasActualMinusPrediction"] > 0 for row in rows
        ),
        "overPredictionSpecifications": sum(
            row["biasActualMinusPrediction"] < 0 for row in rows
        ),
        "airportRows": len(airports),
        "airportMonthlySeries": len(airport_profiles),
        "qualification": "Specifications share the same outcomes, so these counts are diagnostics rather than independent trials or accuracy rates.",
    }
    issues = service.issues()
    result = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "analysisDate": now.date().isoformat(),
        "referenceMonth": reference_month,
        "nextMonth": next_month,
        "modelVersion": MODEL_VERSION,
        "sourceReceipt": source["receipt"],
        "sourceAudit": source["audit"],
        "sourceFiles": [
            receipt(relative)
            for relative in (
                "data/public/prediction-source.json",
                "backend/app/forecasting/engine.py",
                "backend/app/forecasting/service.py",
                "backend/app/forecasting/analysis.py",
                "data/public/context/agency-context.json",
            )
        ],
        "summary": summary,
        "profiles": profiles,
        "horizons": rows,
        "currentMonthDiagnostics": [
            {"targetMonth": reference_month, **row}
            for row in rows
            if index_month(
                month_index(
                    next(
                        item["lastMonth"]
                        for item in profiles
                        if item["seriesId"] == row["seriesId"]
                    )
                )
                + row["horizonMonths"]
            )
            == reference_month
        ],
        "nextMonthDiagnostics": [
            {"targetMonth": next_month, **row}
            for row in rows
            if index_month(
                month_index(
                    next(
                        item["lastMonth"]
                        for item in profiles
                        if item["seriesId"] == row["seriesId"]
                    )
                )
                + row["horizonMonths"]
            )
            == next_month
        ],
        "airportProfiles": airport_profiles,
        "issueStatus": [
            {
                "id": issue["issue"]["id"],
                "modelVersion": issue["issue"]["provenance"].get("modelVersion"),
                "issuedAt": issue["issue"]["issuedAt"],
                "integrityVerified": issue["integrityVerified"],
                "scores": issue["scores"],
            }
            for issue in issues
        ],
        "historicalPublicIndexCheck": {
            "url": "https://statisticsmaldives.gov.mv/monthly-statistics/",
            "checkedDate": "2026-10-15",
            "listedLatestRelease": "Maldives in Figures - June 2026",
            "qualification": "Historical index check recorded on 15 October 2026; this offline audit does not recheck the index or refresh source bytes.",
        },
        "fullForecasts": forecasts,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "forecast-review.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    with (OUT / "forecast-review.csv").open(
        "w", newline="", encoding="utf-8"
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(
        json.dumps(
            {
                "summary": summary,
                "nextMonthDiagnostics": result["nextMonthDiagnostics"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
