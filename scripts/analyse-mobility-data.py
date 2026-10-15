"""Execute the source-backed data audit and forecasting companion notebook.

Run from the repository: uv run --directory backend python ../scripts/analyse-mobility-data.py
Only derived analysis artifacts are written; captured sources are never changed.
"""

from __future__ import annotations

import base64
import html
import json
import re
import sys
from pathlib import Path

import nbformat
from nbclient import NotebookClient

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts" / "analysis" / "2026-10-14"
OUTPUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / "backend"))

from app.forecasting.service import ForecastService  # noqa: E402

service = ForecastService(ROOT / "data" / "public", ROOT / "backend" / "data")
report = service.analysis()
five_month = [item for item in report["horizonDiagnostics"] if item["horizonMonths"] == 5]
snapshot_summary = (
    f"The app exposes **{report['summary']['availableCollections']} collections from "
    f"{report['summary']['uniqueSourceArtifacts']} distinct captured artifacts**. "
    f"There are **{report['summary']['passengerObservations']} usable monthly passenger "
    f"observations in {report['summary']['forecastableSeries']} aggregate categories**. "
    "Five-month later WAPE by category is "
    + "; ".join(f"**{item['name']}: {item['evaluation']['wape']:.1%}**" for item in five_month)
    + ". These are revised-vintage chronological diagnostics, not certified future accuracy."
)
(OUTPUT / "data-analysis.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
)

markdown, code = nbformat.v4.new_markdown_cell, nbformat.v4.new_code_cell
notebook = nbformat.v4.new_notebook()
notebook.metadata.kernelspec = {"name": "python3", "display_name": "Python 3", "language": "python"}
notebook.cells = [
    markdown("""# Maldives mobility: evidence fitness and passenger forecasting

## tl;dr

SNAPSHOT_SUMMARY

All monthly histories have zero duplicate months, missing interior months or invalid counts.
June bus counts remain quarantined rather than silently carried forward.

The forecasting policy now compares nine fixed statistical/baseline candidates and an ensemble.
Earlier rolling origins select the policy; separate embargoed origins calibrate its range when
history permits; six later origins evaluate it. More complex methods must improve earlier MAE
by at least 5%. Later errors remain visible even when a simpler method performs better.

Review measured range coverage beside each horizon's error; nominal coverage is not a guarantee.

## Context & Methods

Decision: choose aggregate resource-review assumptions, and distinguish data-supported access
scenarios from unsupported passenger, occupancy, ETA or causal-effect predictions.

### Key Assumptions

- Forecast target is the source-defined monthly passenger movement count. Ferry endpoint categories
  remain separate; counts are not unique riders and are not summed into a route-rider total.
- Every fit receives only its observed prefix. At each requested horizon, selection/calibration
  targets must be observed by the next partition's first training cutoff (horizon − 1 embargo).
- The first 18 months initialize rolling forecasts. At least six earlier selection origins and
  six later evaluation origins are required. An independent 8–12 origin calibration block is used
  only if enough history remains; otherwise no empirical range is shown.
- Fixed candidates: last month, last-year month, 3/6-month mean, fixed damped recent trend,
  fixed seasonal-level blend, prefix-tuned exponential level, fixed damped Holt, and
  recency-weighted regularized month-dummy/trend regression (latest 36 months).
- Ensemble membership and inverse-selection-MAE weights are frozen on selection outcomes.
  The 5% complexity guard is a conservative engineering rule, not a significance test.
- Empirical 80% ranges use a finite absolute-error order statistic from calibration outcomes
  withheld from model selection. Serial dependence, small samples and structural drift prevent
  a distribution-free coverage guarantee. Later coverage is measured without widening the range.
- Historical data have already been explored. This is a locked chronological design, not an
  untouched prospective experiment. First-publication vintages and release-time lags remain unknown.

Methods: [time-series cross-validation](https://otexts.com/fpp3/toolbox.html#time-series-cross-validation),
[regression predictors](https://otexts.com/fpp3/regression.html#some-useful-predictors),
[exponential smoothing](https://otexts.com/fpp3/exponential-smoothing.html).
""".replace("SNAPSHOT_SUMMARY", snapshot_summary)),
    markdown("## Data\n\n### 1. Load the exact local artifacts\n\nInputs are read through the same source contracts as the app. File SHA-256 receipts and analysis fingerprint are retained in the JSON companion. Captured raw files are lineage inputs, not additional independent observations."),
    code("""from pathlib import Path
import sys, json
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from IPython.display import display

ROOT = Path.cwd()
if not (ROOT / 'backend' / 'app').exists():
    ROOT = next(parent for parent in ROOT.parents if (parent / 'backend' / 'app').exists())
sys.path.insert(0, str(ROOT / 'backend'))
from app.forecasting.service import ForecastService
from app.forecasting.engine import forecast_series, index_month, month_index

OUTPUT = ROOT / 'artifacts' / 'analysis' / '2026-10-14'
service = ForecastService(ROOT / 'data' / 'public', ROOT / 'backend' / 'data')
source = service.source()
analysis = service.analysis()
plt.rcParams.update({'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.grid': True, 'grid.alpha': .18, 'figure.dpi': 110})
COLORS = ['#766394', '#4b7d65', '#c58b42']
display(pd.DataFrame(analysis['passengerProfiles'])[['name', 'observations', 'firstMonth',
    'lastMonth', 'duplicateMonths', 'missingMonths', 'invalidCounts']])
print('Analysis fingerprint:', analysis['analysisFingerprint'])
print('Passenger source:', source['receipt'])
"""),
    markdown("### 2. Audit the source collections\n\nRow counts describe each source grain; they must not be added into a population or demand total. Null cells are retained as unknown, not filled with zero. Exact duplicate rows are a narrow diagnostic, not a substitute for composite-grain checks."),
    code("""profiles = pd.DataFrame(analysis['collectionProfiles'])
display(profiles[['title', 'row_count', 'exactDuplicateRows', 'nullCellRate', 'forecastFitness']]
        .sort_values('row_count', ascending=False).head(12))
population = next(item for item in analysis['collectionProfiles'] if item['id'] == 'national-population')
print('Census geographic coverage:', population['geographyCoverage'])
print('Empty captures:', analysis['summary']['emptyCollections'])
assert analysis['summary']['availableCollections'] == len(profiles)
assert analysis['summary']['passengerObservations'] == sum(item['observations'] for item in analysis['passengerProfiles'])
assert not analysis['summary']['collectionsWithExactDuplicates']
assert all(not item[key] for item in analysis['passengerProfiles']
           for key in ['duplicateMonths', 'missingMonths', 'invalidCounts'])
"""),
    markdown("## Results\n\n### 3. Inspect all passenger histories\n\nMonthly movements have changing levels and limited seasonal repetitions. Each panel has its own y scale. Month-to-month passenger totals do not reveal capacity, load factors or individual-trip purpose."),
    code("""fig, axes = plt.subplots(3, 1, figsize=(11, 8), constrained_layout=True)
for index, (series, axis) in enumerate(zip(source['series'], axes)):
    history = pd.DataFrame(series['points'])
    dates = pd.to_datetime(history['month'])
    axis.plot(dates, history['value'] / 1000, color=COLORS[index], linewidth=2)
    axis.set_title(f\"{series['name']} · {len(history)} observed months\", loc='left')
    axis.set_ylabel('Movements (thousands)')
    axis.text(.01, .96, f\"Last trusted month: {series['lastActualMonth']}\", transform=axis.transAxes,
              va='top', fontsize=9)
axes[-1].set_xlabel('Calendar month (2022–2026)')
fig.suptitle('Official aggregate movement histories — revised checked vintage', fontsize=13)
fig.savefig(OUTPUT / 'passenger-histories.png', dpi=160)
plt.show()
"""),
    markdown("### 4. Verify chronological separation and compare policy candidates\n\nThe five-month example locks model selection before independent calibration and later evaluation. Selection MAE explains the chosen policy; later MAE evaluates it and does not select a replacement after seeing the answers."),
    code("""results = []
fig, axes = plt.subplots(3, 1, figsize=(11, 12), constrained_layout=True)
for index, (series, axis) in enumerate(zip(source['series'], axes)):
    target = index_month(month_index(series['lastActualMonth']) + 5)
    result = forecast_series(series, target)
    results.append(result)
    assert result['selection']['lastTargetMonth'] <= result['calibration'][0]['trainingCutoff']
    assert result['calibration'][-1]['targetMonth'] <= result['backtest'][0]['trainingCutoff']
    models = result['benchmarks']
    positions = np.arange(len(models))
    axis.barh(positions - .18, [item['selectionMae']/1000 for item in models],
              height=.35, color='#b5a4cf', label='Earlier selection MAE')
    axis.barh(positions + .18, [item['metrics']['mae']/1000 for item in models],
              height=.35, color='#577e66', label='Later evaluation MAE')
    axis.set_yticks(positions, [item['model'] + ('  ← selected' if item['model'] == result['model'] else '')
                              for item in models])
    axis.invert_yaxis()
    axis.set_xlabel('Mean absolute error (thousands of movements; zero-based)')
    axis.set_title(f\"{series['name']} · 5-month horizon\", loc='left')
fig.legend(*axes[0].get_legend_handles_labels(), loc='outside lower center', ncol=2, fontsize=9)
fig.suptitle('A stronger method still has to earn its complexity', fontsize=13)
fig.savefig(OUTPUT / 'model-comparisons.png', dpi=160)
plt.show()
display(pd.DataFrame([{'Category': item['name'], 'Locked model': item['model'],
    'Selection origins': item['selection']['origins'], 'Calibration origins': len(item['calibration']),
    'Later origins': item['evaluation']['n'], 'Later WAPE (%)': round(item['evaluation']['wape']*100, 1),
    'Later bias (movements)': round(item['evaluation']['bias']),
    'Range coverage (%)': round(item['empiricalRange']['historicalCoverage']*100, 1)} for item in results]))
"""),
    markdown("### 5. Check horizon-specific errors\n\nA model good at one month is not automatically useful at six or twelve. The same six latest target months are used within each category; training cutoffs shift with the horizon. Errors across horizons and rolling forecasts are dependent."),
    code("""horizons = pd.DataFrame([{'seriesId': item['seriesId'], 'name': item['name'],
    'horizon': item['horizonMonths'], 'wape': item['evaluation']['wape'],
    'coverage': item['empiricalRange']['historicalCoverage'] if item['empiricalRange'] else np.nan}
    for item in analysis['horizonDiagnostics']])
fig, axis = plt.subplots(figsize=(11, 4.5), constrained_layout=True)
for index, series in enumerate(source['series']):
    points = horizons[horizons['seriesId'] == series['id']]
    axis.plot(points['horizon'], points['wape']*100, marker=['o','s','^'][index],
              color=COLORS[index], label=series['name'])
axis.set(xlabel='Months after last observed actual', ylabel='Later WAPE (%)',
         title='Later forecast error by horizon — 6 dependent evaluation origins each',
         xticks=range(1,13), ylim=(0, max(horizons['wape'])*115))
axis.legend(fontsize=9)
fig.savefig(OUTPUT / 'horizon-errors.png', dpi=160)
plt.show()
"""),
    markdown("### 6. Check empirical range reliability\n\nThe nominal empirical target is 80%. Six later outcomes make observed coverage coarse (steps of 16.7%). Grey cells mean no separate calibration block is possible, not zero uncertainty. Ranges are not widened after inspecting held-out misses."),
    code("""matrix = np.array([horizons[horizons['seriesId'] == series['id']]['coverage'].to_numpy()
                   for series in source['series']])
fig, axis = plt.subplots(figsize=(11, 3), constrained_layout=True)
cmap = plt.colormaps['YlGn'].copy(); cmap.set_bad('#e8e4ec')
image = axis.imshow(matrix, vmin=0, vmax=1, cmap=cmap, aspect='auto')
for row in range(matrix.shape[0]):
    for column in range(matrix.shape[1]):
        value = matrix[row,column]
        axis.text(column, row, 'No range' if np.isnan(value) else f'{value*100:.0f}%',
                  ha='center', va='center', fontsize=8,
                  color='white' if value > .75 else '#3c3445')
axis.set_yticks(range(3), [item['name'] for item in source['series']])
axis.set_xticks(range(12), range(1,13))
axis.set(xlabel='Forecast horizon (months)', title='Later observed coverage of nominal 80% empirical ranges')
axis.grid(False)
fig.savefig(OUTPUT / 'range-coverage.png', dpi=160)
plt.show()
"""),
    markdown("""## Takeaways

1. Use the horizon-specific selected policy for **aggregate movement planning** and retain the
   later error, bias and range-coverage diagnostics beside the estimate. A forecast is not a
   measured operating load or an automatically sufficient fleet size.
2. Retain simple baselines when earlier evidence does not support added complexity. The revised
   method improves selection/calibration separation; it does not claim every accuracy score improved.
3. Review every horizon's later measured range coverage and errors. Stress-test policy budgets
   with wider scenarios when coverage misses its nominal target instead of treating the displayed
   estimate as a guaranteed passenger outcome.
4. Census locality reconciliation maps records to **190 islands** while excluding P6 city/atoll
   aggregates. Population weights support accessibility scenarios; they do not establish trip demand.
5. Live weather/traffic, facility locations, route snapshots, airport/port aggregates and census
   categories cannot become passenger predictors until their historic geography, time, publication
   availability and units form a validated feature panel. No causal policy effects are inferred.
6. To improve prediction with evidence, retain first-release passenger vintages and dated operational
   history, then test newly frozen forecast receipts against later publications. New source JSON can
   be staged and reviewed through the app without rewriting the original snapshot or frozen issues.

The full collection profile, receipt hashes, model selection/calibration partitions and every
1–12 month diagnostic are in `data-analysis.json` beside this notebook. Source artifacts are
preserved, and the data-quality profile is rerunnable with the command in the script header.
"""),
]
nbformat.validate(notebook)
NotebookClient(
    notebook, timeout=180, kernel_name="python3", resources={"metadata": {"path": str(ROOT)}}
).execute()
nbformat.write(notebook, OUTPUT / "mobility-data-analysis.ipynb")

# Portable inspected preview: native notebook figures and bounded textual tables.
def render_narrative(source: str) -> str:
    """Render the authored notebook's small Markdown subset without remote dependencies."""
    def inline(value: str) -> str:
        escaped = html.escape(value)
        escaped = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)
        escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
        return re.sub(r"\[([^]]+)\]\((https://[^)]+)\)", r'<a href="\2">\1</a>', escaped)

    blocks = []
    for paragraph in source.strip().split("\n\n"):
        text = paragraph.strip()
        heading = re.match(r"^(#{1,3}) (.+)$", text)
        if heading:
            level = len(heading[1])
            blocks.append(f"<h{level}>{inline(heading[2])}</h{level}>")
        elif re.match(r"^(?:- |\d+\. )", text):
            entries = []
            for line in text.splitlines():
                match = re.match(r"^(?:- |\d+\. )(.*)", line)
                if match:
                    entries.append(match[1])
                elif entries:
                    entries[-1] += " " + line.strip()
            tag = "ul" if text.startswith("- ") else "ol"
            blocks.append(f"<{tag}>" + "".join(f"<li>{inline(item)}</li>" for item in entries) + f"</{tag}>")
        else:
            blocks.append("<p>" + inline(" ".join(text.splitlines())) + "</p>")
    return "<section class='narrative'>" + "".join(blocks) + "</section>"


sections = []
for cell in notebook.cells:
    if cell.cell_type == "markdown":
        sections.append(render_narrative(cell.source))
    else:
        sections.append("<details><summary>Inspect computation</summary><pre>" + html.escape(cell.source) + "</pre></details>")
        for output in cell.get("outputs", []):
            if "image/png" in output.get("data", {}):
                image = output["data"]["image/png"]
                base64.b64decode(image, validate=True)
                sections.append("<img alt='Executed analytical figure' src='data:image/png;base64," + image + "'>")
            elif "text/html" in output.get("data", {}):
                sections.append(output["data"]["text/html"])
            elif "text/plain" in output.get("data", {}):
                sections.append("<pre>" + html.escape(output["data"]["text/plain"]) + "</pre>")
            elif output.get("text"):
                sections.append("<pre>" + html.escape(output["text"]) + "</pre>")
preview = """<!doctype html><html><meta charset='utf-8'><title>Mobility data analysis</title>
<style>body{font:15px/1.7 system-ui;background:#f4f1f8;color:#30283b;margin:0;padding:40px}
main{max-width:1120px;margin:auto;background:white;padding:40px;border-radius:20px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f7f5fa;padding:18px}
.narrative{font:15px/1.75 system-ui;background:white;padding:0;margin:25px 0}
h1{font-size:30px;line-height:1.3}h2{font-size:23px;margin:28px 0 12px}h3{font-size:18px}
li{margin:8px 0}a{color:#70538d}code{background:#f1edf6;padding:2px 4px;border-radius:3px}
img{display:block;width:100%;height:auto;margin:20px 0}table{border-collapse:collapse;width:100%;font-size:11px}
th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}details{margin:18px 0}summary{cursor:pointer;color:#7b659b}
</style><main>""" + "".join(sections) + "</main></html>"
(OUTPUT / "notebook-preview.html").write_text(preview, encoding="utf-8")
print(json.dumps({"notebook": str(OUTPUT / "mobility-data-analysis.ipynb"),
                  "preview": str(OUTPUT / "notebook-preview.html"),
                  "summary": report["summary"], "executedCells": sum(cell.cell_type == "code" for cell in notebook.cells)}, indent=2))
