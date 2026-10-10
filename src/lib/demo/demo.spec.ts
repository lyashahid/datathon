import { describe, expect, it } from 'vitest';
import infrastructureRaw from '../../../data/sample/infrastructure.geojson?raw';
import routesRaw from '../../../data/sample/routes.geojson?raw';
import { createDemoBaseCells, demoIslandAt } from '#lib/analysis/h3DemoData.ts';
import { suggestInterventions } from '#lib/analysis/interventions.ts';
import { DEFAULT_BUS_STOP_WEIGHTS } from '#lib/config/busStopScoring.ts';
import { DEMO_CONFIG } from '#lib/config/demo.ts';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import { decodeRouteCollection } from '#lib/data/routes.ts';
import { proposedName } from '#lib/simulator/placement.ts';
import { CandidateSearchState } from '#lib/stores/candidates.svelte.ts';
import { AnalysisGridState } from '#lib/stores/h3.svelte.ts';
import { MapState } from '#lib/stores/map.svelte.ts';
import { ScenarioStore } from '#lib/stores/scenario.svelte.ts';
import { UiState } from '#lib/stores/ui.svelte.ts';
import { DEMO_STEPS, type DemoContext } from './script.ts';

/**
 * Headless dry run of the presentation script against the real stores and analysis. Only
 * the three button clicks are stood in for, by the same store calls those buttons make.
 */
function setup() {
	const baseline = {
		infrastructure: decodeInfrastructureCollection(JSON.parse(infrastructureRaw)).features,
		routes: decodeRouteCollection(JSON.parse(routesRaw)).routes
	};
	const scenarios = new ScenarioStore(baseline);
	const analysisGrid = new AnalysisGridState(
		createDemoBaseCells(),
		baseline.infrastructure,
		() => scenarios.effective.infrastructure,
		() => scenarios.analysisSettings.disruption ?? 'normal'
	);
	const ui = new UiState();
	const candidateSearch = new CandidateSearchState({
		grid: () => analysisGrid.grid,
		infrastructure: () => scenarios.effective.infrastructure,
		routes: () => scenarios.effective.routes,
		weights: () => scenarios.analysisSettings.busStopWeights ?? DEFAULT_BUS_STOP_WEIGHTS,
		islandAt: demoIslandAt
	});
	const selectedCell = () =>
		ui.selection?.kind === 'area' ? analysisGrid.grid.get(ui.selection.cellIds[0]) : undefined;

	const clicks: Record<string, () => void> = {
		'find-improvements': () => {
			// The finder only reveals suggestions; the bus-stop button needs this one to exist.
			expect(suggestInterventions(selectedCell()!).map((s) => s.type)).toContain('add_bus_stop');
		},
		'find-bus-stops': () => {
			candidateSearch.start(selectedCell()!.h3Index);
			ui.select({ kind: 'candidates' });
		},
		'add-to-scenario': () => {
			const id = ui.selection?.kind === 'candidate' ? ui.selection.id : '';
			const candidate = candidateSearch.get(id)!;
			scenarios.ensureScenario();
			const result = scenarios.addInfrastructure({
				name: proposedName('bus_stop', scenarios.effective.infrastructure),
				type: 'bus_stop',
				position: candidate.position,
				metadata: { island: candidate.island }
			});
			if (!result.ok) throw new Error(result.reason);
			candidateSearch.close();
			ui.select({ kind: 'infrastructure', id: result.id });
		}
	};
	const ctx: DemoContext = {
		ui,
		scenarios,
		analysisGrid,
		candidateSearch,
		mapState: new MapState(),
		click: async (id) => clicks[id]()
	};
	return { ctx, scenarios, analysisGrid, ui, candidateSearch };
}

async function runSteps(ctx: DemoContext, upTo = DEMO_STEPS.length - 1) {
	for (const step of DEMO_STEPS.slice(0, upTo + 1)) await step.run(ctx);
}

describe('demo script', () => {
	it('has the thirteen presentation steps', () => {
		expect(DEMO_STEPS).toHaveLength(13);
	});

	it('runs end to end on the demo data with real, non-trivial results', async () => {
		const { ctx, scenarios, analysisGrid, ui } = setup();

		await runSteps(ctx, 6);
		expect(ctx.candidateSearch.result!.candidates.length).toBeGreaterThanOrEqual(3);

		await runSteps(ctx, 9);
		expect(scenarios.active?.name).toBe(DEMO_CONFIG.scenarioName);
		expect(scenarios.active?.changes).toHaveLength(1);
		expect(analysisGrid.impact.summary.benefiting.total).toBeGreaterThan(0);
		expect(ui.infoView).toBe('scenarioImpact');

		await runSteps(ctx, 11);
		expect(analysisGrid.disruption.id).toBe('severeMarine');
		expect(analysisGrid.disruptionImpact!.summary.losing.total).toBeGreaterThan(0);

		await runSteps(ctx);
		expect(ui.compare).toBe(true);
		expect(analysisGrid.disruption.id).toBe('normal');
	});

	it('is repeatable: restarting reuses one empty demo scenario', async () => {
		const { ctx, scenarios } = setup();
		await runSteps(ctx);
		// Proposal ids are random by design; the proposal itself must be identical.
		const shape = () =>
			JSON.stringify(scenarios.effective.infrastructure.map((f) => [f.name, f.geometry]));
		const first = shape();
		await runSteps(ctx);
		await runSteps(ctx);
		expect(scenarios.scenarios.filter((s) => s.name === DEMO_CONFIG.scenarioName)).toHaveLength(1);
		expect(shape()).toBe(first);

		await DEMO_STEPS[0].run(ctx);
		expect(scenarios.active).toBeNull();
		expect(scenarios.scenarios.find((s) => s.name === DEMO_CONFIG.scenarioName)?.changes).toEqual(
			[]
		);
	});

	it('ranks the same candidate #1 even after someone changed the priorities', async () => {
		const { ctx, scenarios, candidateSearch } = setup();
		await runSteps(ctx, 7);
		const first = candidateSearch.result!.candidates[0].position;
		scenarios.setAnalysisSettings({
			busStopWeights: {
				underservedReached: 0,
				populationCoverage: 0,
				walkingImprovement: 0,
				networkSuitability: 1,
				essentialServices: 0
			}
		});
		await runSteps(ctx, 7);
		expect(candidateSearch.result!.candidates[0].position).toEqual(first);
	});
});
