import { DEMO_CONFIG } from '#lib/config/demo.ts';
import { haversineM } from '#lib/analysis/geo.ts';
import type { CandidateSearchState } from '#lib/stores/candidates.svelte.ts';
import type { AnalysisGridState } from '#lib/stores/h3.svelte.ts';
import type { MapState } from '#lib/stores/map.svelte.ts';
import type { ScenarioStore } from '#lib/stores/scenario.svelte.ts';
import type { UiState } from '#lib/stores/ui.svelte.ts';
import type { Position } from '#lib/types/domain.ts';
import type { LngLatBounds } from '#lib/types/map.ts';
import type { ScenarioAnalysisSettings } from '#lib/types/scenario.ts';

/** What a step may touch: the same stores and controls a presenter uses by hand. */
export interface DemoContext {
	ui: UiState;
	scenarios: ScenarioStore;
	analysisGrid: AnalysisGridState;
	candidateSearch: CandidateSearchState;
	mapState: MapState;
	/** Clicks the real control tagged `data-demo="<id>"`, waiting briefly for it to render. */
	click: (id: string) => Promise<void>;
}

export interface DemoStep {
	title: string;
	/** What the presenter can say; describes, never asserts, results. */
	narration: string;
	/** `data-demo` id of the control to highlight while this step is current. */
	highlight?: string;
	/** Moves the app into this step's state. Throws a readable message if it cannot. */
	run: (ctx: DemoContext) => Promise<void> | void;
}

export class DemoStepError extends Error {}

/** Default priorities and normal operations, so every run ranks the same candidates. */
const DEMO_SETTINGS: ScenarioAnalysisSettings = { disruption: 'normal', busStopWeights: undefined };

function focusCell({ analysisGrid }: DemoContext) {
	const [cell] = [...analysisGrid.grid.cells].sort(
		(a, b) =>
			haversineM([...DEMO_CONFIG.focus], a.centroid) -
			haversineM([...DEMO_CONFIG.focus], b.centroid)
	);
	if (!cell) throw new DemoStepError('The analysis grid has no cells.');
	return cell;
}

function demoScenarioId({ scenarios }: DemoContext) {
	return scenarios.scenarios.find((s) => s.name === DEMO_CONFIG.scenarioName)?.id ?? null;
}

function topCandidate({ candidateSearch }: DemoContext) {
	const top = candidateSearch.result?.candidates[0];
	if (!top) throw new DemoStepError('No bus-stop candidates were found for this area.');
	return top;
}

function boundsAround(points: readonly Position[], padDeg = 0.002): LngLatBounds {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	// Callers pass at least one point (the search origin).
	return [
		[Math.min(...xs) - padDeg, Math.min(...ys) - padDeg],
		[Math.max(...xs) + padDeg, Math.max(...ys) + padDeg]
	];
}

export const DEMO_STEPS: readonly DemoStep[] = [
	{
		title: 'Start from the baseline',
		narration:
			"This is today's Greater Malé network: bus stops, terminals, ferries and essential services. Nothing is edited yet.",
		highlight: 'scenario-selector',
		run: (ctx) => {
			const { ui, scenarios, candidateSearch, mapState } = ctx;
			ui.cancelPointerTool();
			ui.endCompare();
			ui.select(null);
			ui.setInfoView(null);
			ui.selectTool('inspect');
			candidateSearch.close();
			// Reuse (and empty) the demo scenario so repeated runs never pile up copies.
			const id = demoScenarioId(ctx);
			if (id) {
				scenarios.selectScenario(id);
				scenarios.resetScenario(id);
				scenarios.setAnalysisSettings(DEMO_SETTINGS);
			}
			scenarios.selectBaseline();
			scenarios.setAnalysisSettings(DEMO_SETTINGS);
			mapState.showPreset('greaterMale');
		}
	},
	{
		title: 'Show transport accessibility',
		narration:
			'Each hexagon scores straight-line proximity to bus stops, ferry and bus terminals. Red areas are furthest from transport.',
		highlight: 'view-transportAccessibility',
		run: ({ ui }) => {
			ui.selectTool('infoViews');
			ui.setInfoView('transportAccessibility');
		}
	},
	{
		title: 'Focus on an underserved area',
		narration: "Malé's eastern tip has residents far from any bus stop.",
		run: ({ mapState }) => {
			mapState.flyTo({ center: DEMO_CONFIG.focus, zoom: DEMO_CONFIG.focusZoom });
		}
	},
	{
		title: 'Select the area',
		narration: 'The inspector explains the score: who lives here and what is nearby.',
		run: (ctx) => {
			const cell = focusCell(ctx);
			ctx.ui.selectCell(cell.h3Index);
		}
	},
	{
		title: 'Find improvements',
		narration: 'Rule-based checks suggest which kinds of intervention are worth evaluating here.',
		highlight: 'find-improvements',
		run: ({ click }) => click('find-improvements')
	},
	{
		title: 'Find bus-stop locations',
		narration: 'For the bus-stop suggestion, the simulator scores nearby candidate sites.',
		highlight: 'find-bus-stops',
		run: ({ click }) => click('find-bus-stops')
	},
	{
		title: 'Show the top three candidates',
		narration:
			'Candidates are ranked by underserved residents reached, coverage, walking gain, network fit and nearby services.',
		run: (ctx) => {
			const result = ctx.candidateSearch.result;
			if (!result?.candidates.length) {
				throw new DemoStepError('No bus-stop candidates were found for this area.');
			}
			ctx.ui.select({ kind: 'candidates' });
			ctx.mapState.fitBounds(
				boundsAround([result.area.centre, ...result.candidates.map((c) => c.position)])
			);
		}
	},
	{
		title: 'Select candidate #1',
		narration:
			'The highest-scoring candidate under the selected priorities, with its full breakdown and trade-offs.',
		run: (ctx) => {
			ctx.ui.select({ kind: 'candidate', id: topCandidate(ctx).id });
		}
	},
	{
		title: 'Add it to the scenario',
		narration: 'Adding it creates a proposal; the baseline is never modified.',
		highlight: 'add-to-scenario',
		run: async (ctx) => {
			const { scenarios, ui } = ctx;
			const candidate = topCandidate(ctx);
			const existing = demoScenarioId(ctx);
			if (existing) {
				scenarios.selectScenario(existing);
				scenarios.resetScenario(existing);
			} else scenarios.createScenario(DEMO_CONFIG.scenarioName);
			scenarios.setAnalysisSettings(DEMO_SETTINGS);
			ui.select({ kind: 'candidate', id: candidate.id });
			await ctx.click('add-to-scenario');
		}
	},
	{
		title: 'Show the impact',
		narration:
			'Accessibility is recalculated for every cell: who benefits, who loses, and the change in underserved residents.',
		highlight: 'show-change-on-map',
		run: ({ ui, mapState }) => {
			ui.select(null);
			ui.selectTool('infoViews');
			ui.setInfoView('scenarioImpact');
			mapState.flyTo({ center: DEMO_CONFIG.focus, zoom: DEMO_CONFIG.impactZoom });
		}
	},
	{
		title: 'Activate a marine disruption',
		narration:
			'A planning scenario, not a forecast: ferry crossings are suspended under explicit, listed assumptions.',
		highlight: 'conditions',
		run: ({ scenarios, ui }) => {
			ui.select(null);
			scenarios.setAnalysisSettings({ disruption: 'severeMarine' });
		}
	},
	{
		title: 'Show the resilience impact',
		narration:
			'The same model, re-run with crossings suspended: who loses access compared with normal operations.',
		run: ({ ui, mapState }) => {
			ui.select(null);
			ui.setInfoView('disruptionImpact');
			mapState.showPreset('greaterMale');
		}
	},
	{
		title: 'Compare baseline and proposal',
		narration:
			'Drag the divider: baseline on the left, the proposal on the right, with the headline deltas in the inspector.',
		highlight: 'compare',
		run: ({ scenarios, ui, mapState }) => {
			scenarios.setAnalysisSettings({ disruption: 'normal' });
			ui.startCompare();
			ui.setInfoView('transportAccessibility');
			mapState.flyTo({ center: DEMO_CONFIG.focus, zoom: DEMO_CONFIG.impactZoom });
		}
	}
];
