"""Capture and execute a read-only companion to the analysis opportunity review.

Run from the repository with backend/.venv/Scripts/python.exe.
Writes derived artifacts only; no source, accepted import or model is changed.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import nbformat
from bs4 import BeautifulSoup
from nbclient import NotebookClient
from nbconvert import HTMLExporter

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts" / "analysis" / "2026-10-15"
OUTPUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / "backend"))

from app.forecasting.service import ForecastService

service = ForecastService(ROOT / "data/public", ROOT / "backend/data")
source = service.source()
analysis = service.analysis()
for filename, payload in (
    ("current-data-analysis.json", analysis),
    ("current-passenger-source.json", source),
):
    (OUTPUT / filename).write_text(json.dumps(payload, indent=2), encoding="utf-8")

md, code = nbformat.v4.new_markdown_cell, nbformat.v4.new_code_cell
notebook = nbformat.v4.new_notebook()
notebook.metadata.kernelspec = {
    "name": "python3",
    "display_name": "Python 3",
    "language": "python",
}
notebook.cells = [
    md("""# Analysis opportunities in the installed mobility data

## tl;dr

The installed catalogue has 38 available collections from 15 distinct derived artifacts.
Only three categories currently support the production monthly passenger forecast protocol:
161 monthly observations through June 2026 for ferry endpoints and May for bus movements.
There are also 1,316 Hulhumalé barrier-audit records that can support a dedicated accessibility
repair analysis. The attached repository assessment covers the additional raw census,
hospital and school archives; those inputs are not counted as independent catalogue rows here.

## Context & Methods

Decision: prioritize useful analytical features for policymakers from the data already available.
This companion checks aligned passenger growth, barrier evidence and forecast uncertainty.
It does not refit models, infer individual journeys or establish policy causality.

### Key Assumptions

- Passenger counts are source-defined movements; ferry endpoint overlap is undocumented and
  categories are never added into unique riders. January–May is the common 2025/2026 window.
- June 2026 bus values remain quarantined. Capture time is not the observation period.
- Barrier counts describe the captured audit, not a representative survey of all Hulhumalé.
  Missing fields may be inapplicable; missing and partial entrances stay separate from Yes/No.
- Current backtests use revised historical vintages and six later origins per horizon.
  Independent empirical ranges are unavailable beyond six months with this short history.
- Demo/sample/fixture inputs are excluded. Population totals, demographic categories,
  geographic records, aircraft movements and transport movements are not additive measures.

## Data

### 1. Load captured analysis and check lineage

The snapshot is read through the same services as the app. The barrier source hash must still
match the captured collection receipt. Inputs stay unchanged.
"""),
    code("""from pathlib import Path
import sys, json, hashlib
from collections import Counter
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from IPython.display import display

ROOT = Path.cwd()
if not (ROOT / 'backend/app').exists():
    ROOT = next(parent for parent in ROOT.parents if (parent / 'backend/app').exists())
sys.path.insert(0, str(ROOT / 'backend'))
from app.analytics.service import DatasetService
OUTPUT = ROOT / 'artifacts/analysis/2026-10-15'
analysis = json.loads((OUTPUT / 'current-data-analysis.json').read_text(encoding='utf-8'))
passenger = json.loads((OUTPUT / 'current-passenger-source.json').read_text(encoding='utf-8'))
datasets = DatasetService(ROOT / 'data/public', ROOT / 'backend/data')
barrier_profile = next(p for p in analysis['collectionProfiles']
                       if p['id'] == 'policy-layer-hdc-accessibility-audit')
barrier_schema = datasets.schema('policy-layer-hdc-accessibility-audit')
assert barrier_schema['provenance']['receipt']['sha256'] == barrier_profile['provenance']['receipt']['sha256']
barriers = datasets._load('policy-layer-hdc-accessibility-audit')[1]
assert len(barriers) == barrier_profile['row_count'] == 1316
assert sum(len(s['points']) for s in passenger['series']) == analysis['summary']['passengerObservations']
assert passenger['receipt']['sha256'] == analysis['passengerSourceReceipt']['sha256']
plt.rcParams.update({'font.size': 11, 'figure.dpi': 130, 'axes.spines.top': False,
                     'axes.spines.right': False, 'axes.grid': False})
COLORS = ['#285f63', '#796099', '#ac7234']
display(pd.DataFrame(analysis['passengerProfiles'])[['name', 'observations', 'firstMonth', 'lastMonth']])
print('Analysis fingerprint:', analysis['analysisFingerprint'])
"""),
    md("""## Results

### 2. Compare passenger growth over the same months

Use each published category independently. This describes growth in movements, not mode shift,
route-specific demand, unique people or the effect of a policy.
"""),
    code("""growth = []
for series in passenger['series']:
    values = {p['month']: p['value'] for p in series['points']}
    previous = sum(values[f'2025-{m:02}'] for m in range(1, 6))
    current = sum(values[f'2026-{m:02}'] for m in range(1, 6))
    assert previous > 0 and current > 0
    growth.append({'seriesId': series['id'], 'category': series['name'],
                   'janMay2025': previous, 'janMay2026': current,
                   'changePercent': 100 * (current / previous - 1)})
growth_df = pd.DataFrame(growth)
display(growth_df[['category', 'janMay2025', 'janMay2026', 'changePercent']].round(2))
fig, ax = plt.subplots(figsize=(10, 4.5), layout='constrained')
labels = ['Malé ferry endpoint', 'Viligili ferry endpoint', 'Malé/Hulhumalé bus']
ax.barh(labels, growth_df.changePercent, color=COLORS)
ax.axvline(0, color='#535b61', linewidth=.8)
ax.invert_yaxis()
ax.set_xlabel('Change in published movements (%)')
ax.set_title('Passenger growth: January–May 2026 versus January–May 2025', loc='left', pad=18)
extent = max(abs(growth_df.changePercent).max(), 1)
ax.set_xlim(min(0, growth_df.changePercent.min()),
            max(0, growth_df.changePercent.max()) + extent * .3)
for y, value in enumerate(growth_df.changePercent):
    ax.text(value + (extent * .025 if value >= 0 else -extent * .025), y,
            f'{value:+.1f}%', va='center', ha='left' if value >= 0 else 'right')
fig.savefig(OUTPUT / 'comparable-passenger-growth.png', bbox_inches='tight')
plt.show()
"""),
    md("""### 3. Locate a concrete accessibility-repair opportunity

These counts are for the captured entrance assessment. They preserve 213 missing values and
31 partial entrances. They establish recorded barriers, not an audited wheelchair route network.
Commercial locations dominate the audit, so extrapolation to all facilities is unsupported.
"""),
    code("""entrances = Counter(r.get('step_free_entrance') for r in barriers)
movements = Counter(r.get('continuous_movement') for r in barriers)
assert entrances == {'No': 858, 'Yes': 214, None: 213, 'Partial (small step/threshold)': 31}
assert sum(entrances.values()) == len(barriers)
assessed = len(barriers) - entrances.get(None, 0)
audit_summary = {'totalRecords': len(barriers), 'assessedEntrances': assessed,
                 'entranceCounts': {'No': entrances['No'], 'Yes': entrances['Yes'],
                     'Partial': entrances['Partial (small step/threshold)'], 'Missing': entrances[None]},
                 'noStepFreeEntranceAmongAssessedPercent': entrances['No'] / assessed * 100,
                 'continuousMovementCounts': {'No': movements['No'], 'Yes': movements['Yes'],
                                              'Missing': movements[None]}}
display(pd.DataFrame(audit_summary['entranceCounts'].items(), columns=['Recorded assessment', 'Records']))
fig, ax = plt.subplots(figsize=(9, 4.3), layout='constrained')
counts = audit_summary['entranceCounts']
ax.bar(list(counts), list(counts.values()), color=['#9f6249', '#285f63', '#ac893f', '#939ba0'])
for x, value in enumerate(counts.values()):
    ax.text(x, value + 14, str(value), ha='center', va='bottom')
ax.set_ylim(0, max(counts.values()) * 1.15)
ax.set_ylabel('Captured audit records')
ax.set_title('Hulhumalé audit: recorded step-free entrance status', loc='left', pad=18)
fig.savefig(OUTPUT / 'barrier-evidence.png', bbox_inches='tight')
plt.show()
"""),
    md("""### 4. Keep horizon-specific forecast limitations in the decision

WAPE is the sum of absolute errors divided by the sum of actual movements at the six later
historical evaluation origins. Error rises unevenly by category. A short holdout and revised
vintages cannot establish future accuracy. Nominal 80% interval coverage is separately measured;
an unavailable range is not replaced with zero uncertainty.
"""),
    code("""diagnostics = analysis['horizonDiagnostics']
assert len(diagnostics) == 36
fig, ax = plt.subplots(figsize=(10, 4.8), layout='constrained')
for color, series, label, style in zip(COLORS, passenger['series'], labels, ['-', '--', ':']):
    rows = sorted([d for d in diagnostics if d['seriesId'] == series['id']], key=lambda r: r['horizonMonths'])
    ax.plot([r['horizonMonths'] for r in rows], [100*r['evaluation']['wape'] for r in rows],
            marker='o', label=label, color=color, linestyle=style)
ax.set_xticks(range(1, 13))
ax.set_xlabel('Forecast horizon (months after the last trusted actual)')
ax.set_ylabel('Later historical WAPE (%)')
ax.set_ylim(bottom=0)
ax.set_title('Aggregate forecasts: later historical error by decision horizon', loc='left', pad=18)
ax.legend(loc='lower left', frameon=False, fontsize=10)
ax.grid(axis='y', alpha=.2)
fig.savefig(OUTPUT / 'forecast-horizon-error.png', bbox_inches='tight')
plt.show()
findings = {'analysisFingerprint': analysis['analysisFingerprint'],
            'summary': analysis['summary'], 'comparablePassengerGrowth': growth,
            'barrierAudit': audit_summary,
            'sourceReceipts': {'passenger': passenger['receipt'],
                              'barrier': barrier_schema['provenance']['receipt']}}
(OUTPUT / 'opportunity-findings.json').write_text(json.dumps(findings, indent=2), encoding='utf-8')
"""),
    md("""## Takeaways

Prioritize (1) evidence-aware service-gap and proposal-value comparisons, (2) a dedicated HDC
accessibility repair workflow, and (3) extracting archived island census and hospital history.
Those recommendations combine current-code review with raw-source checks in the attached notes.

Add matched histories and prospectively frozen outcomes before claiming better demand or arrival
prediction. Modeled population placement is suitable for access scenarios, not measured trips.
This notebook executes independently; it neither publishes sources nor modifies app inputs.
"""),
]
for cell, alt in zip(
    (notebook.cells[3], notebook.cells[5], notebook.cells[7]),
    (
        "January–May movement growth is 7.3% at the Malé ferry endpoint, 4.3% at the Villigili endpoint and 10.1% for Malé/Hulhumalé bus.",
        "Captured step-free entrance responses: No 858, Yes 214, Partial 31 and Missing 213.",
        "Historical WAPE by horizon for three aggregate movement categories; errors vary with category and evaluation window.",
    ),
    strict=True,
):
    cell.metadata.alt = alt
NotebookClient(
    notebook,
    timeout=240,
    kernel_name="python3",
    resources={"metadata": {"path": str(ROOT)}},
).execute()
nbformat.validate(notebook)
notebook_path = OUTPUT / "analysis-opportunities.ipynb"
nbformat.write(notebook, notebook_path)
preview_html, _ = HTMLExporter().from_notebook_node(notebook)
preview = BeautifulSoup(preview_html, "html.parser")
figure_cells = (notebook.cells[3], notebook.cells[5], notebook.cells[7])
for element, cell in zip(preview.select("img"), figure_cells, strict=True):
    element["alt"] = cell.metadata.alt
(OUTPUT / "notebook-preview.html").write_text(str(preview), encoding="utf-8")
manifest = {
    "analysisFingerprint": analysis["analysisFingerprint"],
    "notebook": notebook_path.name,
    "executedCodeCells": sum(c.cell_type == "code" for c in notebook.cells),
    "htmlPreview": "notebook-preview.html",
    "describedFigures": len(preview.select("img[alt]")),
    "figures": [
        "comparable-passenger-growth.png",
        "barrier-evidence.png",
        "forecast-horizon-error.png",
    ],
    "sourceFiles": {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in (
            OUTPUT / "current-passenger-source.json",
            OUTPUT / "current-data-analysis.json",
        )
    },
}
(OUTPUT / "notebook-verification.json").write_text(
    json.dumps(manifest, indent=2), encoding="utf-8"
)
print(json.dumps(manifest, indent=2))
