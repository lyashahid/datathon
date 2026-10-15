"""Small-data forecasting with chronologically separated model selection and evaluation.

No fitted model receives observations after its origin. Selection targets are embargoed
until they would have been observed at the first evaluation origin. Published values are
the checked revised vintage; release-time availability is not reconstructed or claimed.
"""

from __future__ import annotations

import math
import re
from functools import lru_cache
from statistics import fmean
from typing import Any

MODEL_VERSION = "monthly-locked-selection-calibration-v4"
MODELS = (
    "last-month",
    "seasonal-naive",
    "mean-3-months",
    "mean-6-months",
    "damped-trend",
    "seasonal-level-blend",
    "adaptive-level",
    "holt-damped",
    "seasonal-ridge",
)
SIMPLE_MODELS = MODELS[:4]
COMPLEXITY_IMPROVEMENT = 0.05
INITIAL_MONTHS = 18
EVALUATION_ORIGINS = 6
MIN_SELECTION_ORIGINS = 6
REVISION_QUALIFICATION = (
    "Backtests use checked revised historical values. Original publication-time vintages "
    "and availability have not been reconstructed; publication-lag and revision bias remain."
)


def month_index(month: str) -> int:
    if not isinstance(month, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise ValueError("Expected month in YYYY-MM format")
    year, number = map(int, month.split("-"))
    return year * 12 + number - 1


def index_month(index: int) -> str:
    year, number = divmod(index, 12)
    return f"{year:04d}-{number + 1:02d}"


def valid_value(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and (math.isfinite(value) and value >= 0)
    )


def validate_series(series: dict[str, Any]) -> list[dict[str, Any]]:
    observations = series.get("points", [])
    if not isinstance(observations, list) or not all(
        isinstance(item, dict) for item in observations
    ):
        raise ValueError("Monthly observations must be an array of objects")
    points = sorted(observations, key=lambda item: str(item.get("month", "")))
    if not points or points[-1].get("month") != series.get("lastActualMonth"):
        raise ValueError("Last actual month does not match the source observations")
    previous: int | None = None
    for point in points:
        current = month_index(point.get("month", ""))
        if previous is not None and current != previous + 1:
            raise ValueError("Duplicate or missing months; no implicit imputation is applied")
        if not valid_value(point.get("value")):
            raise ValueError("Passenger counts must be finite, nonnegative numeric observations")
        previous = current
    return points


def _solve(matrix: list[list[float]], target: list[float]) -> list[float]:
    """Pivoted elimination of a positive-definite ridge normal equation."""
    rows = [row[:] + [value] for row, value in zip(matrix, target, strict=True)]
    for column in range(len(rows)):
        pivot = max(range(column, len(rows)), key=lambda index: abs(rows[index][column]))
        rows[column], rows[pivot] = rows[pivot], rows[column]
        divisor = rows[column][column]
        if abs(divisor) < 1e-12:
            raise ValueError("Ill-conditioned seasonal regression")
        rows[column] = [value / divisor for value in rows[column]]
        for index in range(len(rows)):
            if index != column:
                factor = rows[index][column]
                rows[index] = [
                    value - factor * basis
                    for value, basis in zip(rows[index], rows[column], strict=True)
                ]
    return [row[-1] for row in rows]


@lru_cache(maxsize=2048)
def _fit(values: tuple[float, ...], model: str) -> tuple[float, ...]:
    if model == "adaptive-level":
        choices = []
        for alpha in (0.2, 0.5, 0.8):
            level, errors = values[0], []
            for index, value in enumerate(values[1:], 1):
                if index >= 6:
                    errors.append(abs(value - level))
                level = alpha * value + (1 - alpha) * level
            choices.append((fmean(errors), alpha, level))
        _, alpha, level = min(choices)
        return level, alpha
    if model == "holt-damped":
        level = fmean(values[:3])
        trend = (fmean(values[3:6]) - level) / 3
        for value in values[3:]:
            previous = level
            level = 0.4 * value + 0.6 * (level + 0.9 * trend)
            trend = 0.1 * (level - previous) + 0.9 * 0.9 * trend
        return level, trend
    # Thirty-six most recent observations; fixed shrinkage and recency weights.
    # No regression coefficient or smoothing choice sees post-origin outcomes.
    count, scale = len(values), max(1.0, fmean(values))
    matrix, target = [[0.0] * 13 for _ in range(13)], [0.0] * 13
    for index in range(max(0, count - 36), count):
        features = [1.0, (index - count + 1) / 12] + [
            float(index % 12 == month) for month in range(1, 12)
        ]
        weight = 0.5 ** ((count - 1 - index) / 24)
        for row in range(13):
            target[row] += weight * features[row] * values[index] / scale
            for column in range(13):
                matrix[row][column] += weight * features[row] * features[column]
    for index in range(13):
        matrix[index][index] += 1e-8 if index == 0 else 1.0 if index == 1 else 4.0
    return (*_solve(matrix, target), scale)


def point_forecast(
    values: list[float], horizon: int, model: str, parameters: dict[str, Any] | None = None
) -> float:
    if model == "selection-ensemble":
        weights = (parameters or {}).get("weights", {})
        if (
            not weights
            or not set(weights).issubset(MODELS)
            or any(not valid_value(weight) for weight in weights.values())
            or not math.isclose(sum(weights.values()), 1.0, abs_tol=1e-8)
        ):
            raise ValueError("A frozen ensemble requires valid pre-evaluation weights")
        return sum(
            weight * point_forecast(values, horizon, member) for member, weight in weights.items()
        )
    if horizon < 1 or model not in MODELS or not values or not all(map(valid_value, values)):
        raise ValueError("Invalid forecast model, horizon or observations")
    if model == "last-month":
        return float(values[-1])
    if model == "seasonal-naive":
        if len(values) < 12:
            raise ValueError("Seasonal baseline needs 12 observed months")
        return float(values[len(values) - 12 + (horizon - 1) % 12])
    if model.startswith("mean-"):
        count = 3 if model == "mean-3-months" else 6
        if len(values) < count:
            raise ValueError("Moving mean needs more observed months")
        return fmean(values[-count:])
    if len(values) < 12:
        raise ValueError("Trend and seasonal blend need 12 observed months")
    if model in ("adaptive-level", "holt-damped", "seasonal-ridge"):
        fitted = _fit(tuple(float(value) for value in values), model)
        if model == "adaptive-level":
            return fitted[0]
        if model == "holt-damped":
            return max(0, fitted[0] + fitted[1] * sum(0.9**step for step in range(1, horizon + 1)))
        index = len(values) + horizon - 1
        features = [1.0, horizon / 12] + [float(index % 12 == month) for month in range(1, 12)]
        return max(
            0, sum(value * feature for value, feature in zip(fitted[:13], features)) * fitted[-1]
        )
    recent, earlier = fmean(values[-3:]), fmean(values[-6:-3])
    if model == "damped-trend":
        # A fixed damping value avoids optimizing on the eventual evaluation outcomes.
        monthly_slope = (recent - earlier) / 3
        return max(0.0, recent + monthly_slope * sum(0.8**step for step in range(1, horizon + 1)))
    seasonal = point_forecast(values, horizon, "seasonal-naive")
    annual_level_change = fmean(values[-6:]) - fmean(values[-12:-6])
    # Conservative fixed mixture: annual shape plus current level, without covariate claims.
    return max(0.0, 0.5 * seasonal + 0.5 * fmean(values[-3:]) + 0.25 * annual_level_change)


def quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    index = (len(ordered) - 1) * probability
    lower, upper = math.floor(index), math.ceil(index)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)


def _metrics(rows: list[dict[str, Any]], horizon: int) -> dict[str, Any]:
    absolute = sum(abs(row["error"]) for row in rows)
    actual_sum = sum(row["actual"] for row in rows)
    return {
        "mae": absolute / len(rows),
        "rmse": math.sqrt(fmean(row["error"] ** 2 for row in rows)),
        "wape": absolute / actual_sum if actual_sum else None,
        "bias": fmean(row["error"] for row in rows),
        "maximumAbsoluteError": max(abs(row["error"]) for row in rows),
        "n": len(rows),
        "firstTargetMonth": rows[0]["targetMonth"],
        "lastTargetMonth": rows[-1]["targetMonth"],
        "horizonMonths": horizon,
        "qualification": (
            "Six later expanding origins evaluate a policy locked on earlier available targets. "
            "Overlapping forecasts are dependent; this is exploratory revised-vintage evaluation."
        ),
    }


def forecast_series(series: dict[str, Any], target_month: str) -> dict[str, Any]:
    last = month_index(series["lastActualMonth"])
    horizon = month_index(target_month) - last
    result: dict[str, Any] = {
        **{
            key: series.get(key)
            for key in (
                "name",
                "mode",
                "geography",
                "unit",
                "sourceUrl",
                "lastActualMonth",
                "qualification",
            )
        },
        "seriesId": series["id"],
        "forecastMonth": target_month,
        "horizonMonths": horizon,
        "status": "unavailable",
        "estimate": None,
        "empiricalRange": None,
        "model": None,
        "evaluation": None,
        "benchmarks": [],
        "projections": [],
        "history": series.get("points", []),
        "backtest": [],
        "unavailableReason": None,
        "modelCard": {
            "version": MODEL_VERSION,
            "target": "Source-defined aggregate monthly passenger movements",
            "intendedUse": "Aggregate service-resource review with source lag and errors visible",
            "excludedUses": ["Stop-level demand", "Unique riders", "Peak occupancy", "Congestion"],
            "trainingCutoff": series["lastActualMonth"],
            "evaluation": (
                "18 initial months; earlier rolling-origin MAE selects the policy; a separate "
                "calibration block is used when history permits; six later origins evaluate it. "
                "Horizon-minus-one embargoes prevent unavailable targets crossing partitions."
            ),
            "limitations": [
                REVISION_QUALIFICATION,
                (
                    "Passenger movements are not unique people; ferry endpoint categories stay "
                    "separate."
                ),
                (
                    "Seasonality, service changes and structural breaks can invalidate past "
                    "relationships."
                ),
                "Ranges use errors withheld from model selection, where history permits. "
                "Temporal dependence and drift prevent a guaranteed probability interpretation.",
                (
                    "The existing history has been explored; no pristine prospective holdout is "
                    "claimed."
                ),
            ],
        },
    }
    if not 1 <= horizon <= 12:
        result["unavailableReason"] = "Target must be 1–12 months after the last trusted actual"
        return result
    try:
        points = validate_series(series)
    except ValueError as error:
        result["unavailableReason"] = str(error)
        return result
    values = [float(point["value"]) for point in points]
    comparisons: list[dict[str, Any]] = []
    available = len(values) - horizon + 1 - INITIAL_MONTHS - EVALUATION_ORIGINS - (horizon - 1)
    calibration_count = min(12, max(8, available // 3))
    selection_count = available - calibration_count - (horizon - 1)
    if selection_count < MIN_SELECTION_ORIGINS:
        calibration_count, selection_count = 0, available
    for model in MODELS:
        rows = []
        for count in range(INITIAL_MONTHS, len(values) - horizon + 1):
            prediction = point_forecast(values[:count], horizon, model)
            target_index = count + horizon - 1
            rows.append(
                {
                    "trainingCutoff": points[count - 1]["month"],
                    "targetMonth": points[target_index]["month"],
                    "estimate": prediction,
                    "actual": values[target_index],
                    "error": values[target_index] - prediction,
                }
            )
        if selection_count < MIN_SELECTION_ORIGINS:
            continue
        selection = rows[:selection_count]
        evaluation = rows[-EVALUATION_ORIGINS:]
        calibration = rows[available - calibration_count : available] if calibration_count else []
        comparisons.append(
            {
                "model": model,
                "selectionMae": fmean(abs(row["error"]) for row in selection),
                "selectionCount": len(selection),
                "selectionLastTargetMonth": selection[-1]["targetMonth"],
                "firstEvaluationTrainingCutoff": evaluation[0]["trainingCutoff"],
                "metrics": _metrics(evaluation, horizon),
                "estimate": point_forecast(values, horizon, model),
                "_selection": selection,
                "_calibration": calibration,
                "_evaluation": evaluation,
            }
        )
    if not comparisons:
        result["unavailableReason"] = (
            "Insufficient chronological history for 18 initial months, six selection and six "
            "evaluation origins plus the horizon embargo"
        )
        return result
    comparisons.sort(key=lambda item: (item["selectionMae"], MODELS.index(item["model"])))
    members = comparisons[:3]
    floor = max(1e-9, fmean(item["selectionMae"] for item in members) * 0.1)
    weights = {item["model"]: 1 / max(floor, item["selectionMae"]) for item in members}
    denominator = sum(weights.values())
    weights = {model: value / denominator for model, value in weights.items()}
    parameters = {"weights": weights}
    ensemble = {
        "model": "selection-ensemble",
        "parameters": parameters,
        "selectionCount": selection_count,
        "selectionLastTargetMonth": comparisons[0]["selectionLastTargetMonth"],
        "firstEvaluationTrainingCutoff": comparisons[0]["firstEvaluationTrainingCutoff"],
        "estimate": point_forecast(values, horizon, "selection-ensemble", parameters),
    }
    for partition in ("_selection", "_calibration", "_evaluation"):
        ensemble[partition] = []
        for index, row in enumerate(members[0][partition]):
            prediction = sum(
                weights[item["model"]] * item[partition][index]["estimate"] for item in members
            )
            ensemble[partition].append(
                {**row, "estimate": prediction, "error": row["actual"] - prediction}
            )
    ensemble["selectionMae"] = fmean(abs(row["error"]) for row in ensemble["_selection"])
    ensemble["metrics"] = _metrics(ensemble["_evaluation"], horizon)
    comparisons.append(ensemble)
    comparisons.sort(key=lambda item: (item["selectionMae"], item["model"]))
    best = comparisons[0]
    simple_baseline = min(
        (item for item in comparisons if item["model"] in SIMPLE_MODELS),
        key=lambda item: (item["selectionMae"], SIMPLE_MODELS.index(item["model"])),
    )
    improvement = (
        1 - best["selectionMae"] / simple_baseline["selectionMae"]
        if simple_baseline["selectionMae"]
        else 0
    )
    selected = best if improvement >= COMPLEXITY_IMPROVEMENT else simple_baseline
    estimate = selected["estimate"]
    calibration_errors = [abs(row["error"]) for row in selected["_calibration"]]
    interval = None
    if calibration_errors:
        rank = min(len(calibration_errors), math.ceil((len(calibration_errors) + 1) * 0.8))
        radius = sorted(calibration_errors)[rank - 1]
        coverage = fmean(abs(row["error"]) <= radius for row in selected["_evaluation"])
        interval = {
            "lower": max(0, estimate - radius),
            "upper": estimate + radius,
            "label": "80% empirical calibration range; temporal coverage is not guaranteed",
            "method": "Absolute-error order statistic from a separate pre-evaluation block",
            "nominalCoverage": 0.8,
            "residualCount": len(calibration_errors),
            "historicalCoverage": coverage,
            "calibrationFirstTarget": selected["_calibration"][0]["targetMonth"],
            "calibrationCutoff": selected["_calibration"][-1]["targetMonth"],
            "radius": radius,
            "reliability": "under-covered" if coverage < 0.8 else "small-sample",
        }
    selected_metrics = selected["metrics"]
    naive = next(item for item in comparisons if item["model"] == "last-month")
    seasonal = next(item for item in comparisons if item["model"] == "seasonal-naive")
    skills = {}
    for key, baseline in (("lastMonth", naive), ("seasonalNaive", seasonal)):
        baseline_mae = baseline["metrics"]["mae"]
        skills[key] = 1 - selected_metrics["mae"] / baseline_mae if baseline_mae else None
    evaluation_cutoff = month_index(selected["firstEvaluationTrainingCutoff"])
    training_values = [
        point["value"] for point in points if month_index(point["month"]) <= evaluation_cutoff
    ]
    seasonal_scale = fmean(
        abs(value - training_values[index - 12])
        for index, value in enumerate(training_values)
        if index >= 12
    )
    recent = fmean(values[-12:])
    previous = fmean(values[-24:-12]) if len(values) >= 24 else None
    annual_change = recent / previous - 1 if previous else None
    selected_errors = [row["error"] for row in selected["_evaluation"]]
    mean_error = fmean(selected_errors)
    error_denominator = sum((value - mean_error) ** 2 for value in selected_errors)
    residual_correlation = (
        sum(
            (left - mean_error) * (right - mean_error)
            for left, right in zip(selected_errors[:-1], selected_errors[1:])
        )
        / error_denominator
        if error_denominator
        else None
    )
    reliability_notes = [
        "Six dependent evaluation forecasts cannot establish production reliability.",
        REVISION_QUALIFICATION,
    ]
    if any(value is not None and value < 0 for value in skills.values()):
        reliability_notes.append(
            "The locked policy lost to at least one simple baseline on later outcomes."
        )
    if interval is None:
        reliability_notes.append(
            "History cannot support a separate calibration block at this horizon; "
            "no range is shown."
        )
    elif interval["historicalCoverage"] < 0.8:
        reliability_notes.append(
            "The empirical range missed its nominal coverage on later outcomes; "
            "budget for wider stress scenarios."
        )
    return {
        **result,
        "status": "exploratory",
        "estimate": estimate,
        "empiricalRange": interval,
        "model": selected["model"],
        "parameters": selected.get("parameters", {}),
        "evaluation": {
            **selected_metrics,
            "skill": skills,
            "mase": selected_metrics["mae"] / seasonal_scale if seasonal_scale else None,
            "seasonalScale": seasonal_scale,
        },
        "selection": {
            "metric": "MAE",
            "origins": selected["selectionCount"],
            "lastTargetMonth": selected["selectionLastTargetMonth"],
            "firstEvaluationTrainingCutoff": selected["firstEvaluationTrainingCutoff"],
            "embargoMonths": horizon - 1,
            "firstTargetMonth": selected["_selection"][0]["targetMonth"],
            "firstCalibrationTrainingCutoff": selected["_calibration"][0]["trainingCutoff"]
            if calibration_count
            else None,
            "calibrationOrigins": calibration_count,
            "complexityImprovementRequired": COMPLEXITY_IMPROVEMENT,
            "bestCandidate": best["model"],
            "bestSimpleBaseline": simple_baseline["model"],
            "candidateImprovement": improvement,
            "reason": (
                "Candidate cleared the 5% earlier MAE improvement guard."
                if selected is best and improvement >= COMPLEXITY_IMPROVEMENT
                else "A simple baseline is retained unless earlier MAE improves by at least 5%."
            ),
        },
        "diagnostics": {
            "observations": len(values),
            "recentTwelveMonthMean": recent,
            "previousTwelveMonthMean": previous,
            "annualMeanChange": annual_change,
            "residualLagOneCorrelation": residual_correlation,
            "evaluationBiasDirection": "under-predicting"
            if mean_error > 0
            else "over-predicting"
            if mean_error < 0
            else "balanced",
            "planningReadiness": "exploratory",
            "notes": reliability_notes,
        },
        "calibration": selected["_calibration"],
        "benchmarks": [
            {key: value for key, value in item.items() if not key.startswith("_")}
            for item in comparisons
        ],
        "backtest": selected["_evaluation"],
        "projections": [
            {
                "month": index_month(last + step),
                "estimate": point_forecast(
                    values, step, selected["model"], selected.get("parameters")
                ),
            }
            for step in range(1, horizon + 1)
        ],
    }
