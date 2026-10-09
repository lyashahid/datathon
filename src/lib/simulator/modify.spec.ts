import { beforeEach, describe, expect, it } from 'vitest';
import infrastructureRaw from '../../../data/sample/infrastructure.geojson?raw';
import routesRaw from '../../../data/sample/routes.geojson?raw';
import {
	createDemoAnalysisProvider,
	demoDensityForIsland,
	demoScoreCandidate
} from '#lib/analysis/demoMetrics.ts';
import { fromLocalM } from '#lib/analysis/geo.ts';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import { decodeRouteCollection } from '#lib/data/routes.ts';
import { Baseline } from '#lib/stores/baseline.ts';
import { ScenarioStore } from '#lib/stores/scenario.svelte.ts';
import type { Position } from '#lib/types/domain.ts';
import { assetStateLabels } from './assetState.ts';
import { evaluateMove } from './move.ts';

const raw = {
	infrastructure: decodeInfrastructureCollection(JSON.parse(infrastructureRaw)),
	routes: decodeRouteCollection(JSON.parse(routesRaw))
};
const IGMH = 'hp-igmh';
const SCHOOL = 'sc-majeediyya';
const STOP = 'bs-hulhumale-central';

function setup() {
	const baseline = new Baseline(raw.infrastructure, raw.routes);
	let n = 0;
	const store = new ScenarioStore(baseline, {
		now: () => '2026-01-01T00:00:00.000Z',
		createId: (p) => `${p}-${++n}`
	});
	return { baseline, store, snapshot: JSON.stringify(baseline.infrastructure) };
}

const position = (store: ScenarioStore, id: string) =>
	store.effective.getInfrastructure(id)?.geometry.coordinates;

describe('move: select → move → confirm → undo → redo', () => {
	let ctx: ReturnType<typeof setup>;
	beforeEach(() => (ctx = setup()));

	it('moves only in the scenario and round-trips through history', () => {
		const { baseline, store, snapshot } = ctx;
		const original = baseline.getInfrastructure(IGMH)!.geometry.coordinates;
		const target: Position = fromLocalM(original, [150, 0]);

		store.ensureScenario();
		expect(store.moveInfrastructure(IGMH, target).ok).toBe(true);
		expect(position(store, IGMH)).toEqual(target);
		expect(store.effective.infrastructureDeltas.get(IGMH)).toMatchObject({
			moved: true,
			originalPosition: original
		});
		expect(assetStateLabels('existing', store.effective.infrastructureDeltas.get(IGMH))).toEqual([
			'existing',
			'moved'
		]);

		store.undo();
		expect(position(store, IGMH)).toEqual(original);
		expect(store.effective.infrastructureDeltas.has(IGMH)).toBe(false);

		store.redo();
		expect(position(store, IGMH)).toEqual(target);

		expect(JSON.stringify(baseline.infrastructure)).toBe(snapshot);
		expect(baseline.getInfrastructure(IGMH)!.geometry.coordinates).toEqual(original);
	});

	it('keeps the same id so selection survives the move', () => {
		const { store } = ctx;
		store.ensureScenario();
		store.moveInfrastructure(IGMH, fromLocalM(position(store, IGMH)!, [100, 0]));
		expect(store.effective.getInfrastructure(IGMH)?.name).toBe('Indira Gandhi Memorial Hospital');
	});
});

describe('disable: select → disable → restore', () => {
	let ctx: ReturnType<typeof setup>;
	beforeEach(() => (ctx = setup()));

	it('marks the asset disabled only in the scenario, then restores it', () => {
		const { baseline, store, snapshot } = ctx;
		store.ensureScenario();
		store.disableAsset({ kind: 'infrastructure', id: IGMH });
		expect(store.effective.getInfrastructure(IGMH)?.status).toBe('disabled');
		expect(baseline.getInfrastructure(IGMH)?.status).toBe('existing');

		store.selectBaseline();
		expect(store.effective.getInfrastructure(IGMH)?.status).toBe('existing');
		store.selectScenario(store.scenarios[0].id);

		store.restoreAsset({ kind: 'infrastructure', id: IGMH });
		expect(store.effective.getInfrastructure(IGMH)?.status).toBe('existing');
		// Net effect is nil, so it collapses back to the frozen baseline object.
		expect(store.effective.getInfrastructure(IGMH)).toBe(baseline.getInfrastructure(IGMH));
		expect(JSON.stringify(baseline.infrastructure)).toBe(snapshot);
	});

	it('excludes a disabled facility from other facilities’ accessibility', () => {
		const { store } = ctx;
		const before = createDemoAnalysisProvider(store.effective).analyseInfrastructure(SCHOOL)!;
		expect(before.nearby.hospitals.map((h) => h.id)).toContain(IGMH);

		store.ensureScenario();
		store.disableAsset({ kind: 'infrastructure', id: IGMH });
		const after = createDemoAnalysisProvider(store.effective).analyseInfrastructure(SCHOOL)!;
		expect(after.nearby.hospitals.map((h) => h.id)).not.toContain(IGMH);
		expect(after.accessibility.score).toBeLessThan(before.accessibility.score);
	});

	it('combines with moves in any order', () => {
		const { store } = ctx;
		store.ensureScenario();
		const target = fromLocalM(position(store, IGMH)!, [120, 0]);
		store.disableAsset({ kind: 'infrastructure', id: IGMH });
		store.moveInfrastructure(IGMH, target);
		const delta = store.effective.infrastructureDeltas.get(IGMH);
		expect(assetStateLabels('disabled', delta)).toEqual(['disabled', 'moved']);

		store.restoreAsset({ kind: 'infrastructure', id: IGMH });
		expect(store.effective.getInfrastructure(IGMH)).toMatchObject({
			status: 'existing',
			geometry: { coordinates: target }
		});
	});
});

describe('evaluateMove', () => {
	const { store } = setup();
	const world = store.effective;
	const scoreCandidate = demoScoreCandidate(world);
	const provider = createDemoAnalysisProvider(world);

	function evaluate(id: string, eastM: number, northM = 0, road = 5) {
		const feature = world.getInfrastructure(id)!;
		return evaluateMove({
			feature,
			to: fromLocalM(feature.geometry.coordinates, [eastM, northM]),
			infrastructure: world.infrastructure,
			road: { status: 'checked', distanceM: road },
			densityForIsland: demoDensityForIsland,
			scoreCandidate,
			scoreBefore: provider.analyseInfrastructure(id)!.accessibility
		});
	}

	it('does not treat a facility as a duplicate of its own old position', () => {
		const e = evaluate(STOP, 20);
		expect(e.issues.some((i) => i.message.includes('Duplicates'))).toBe(false);
		expect(e.distanceM).toBeCloseTo(20, 0);
		expect(e.scoreAfter).not.toBeNull();
	});

	it('blocks moves to another island', () => {
		// Hulhumalé Central Park stop dragged ~2.5 km south-west lands near Hulhulé facilities.
		const e = evaluate(STOP, -1400, -2000);
		expect(e.validity).toBe('invalid');
		expect(e.scoreAfter).toBeNull();
	});

	it('applies the road rule to stops but not to hospitals', () => {
		expect(evaluate(STOP, 30, 0, 200).validity).toBe('invalid');
		expect(evaluate(IGMH, 30, 0, 200).validity).not.toBe('invalid');
	});

	it('reports the score before and after deterministically', () => {
		const a = evaluate(IGMH, 100);
		const b = evaluate(IGMH, 100);
		expect(a).toEqual(b);
		expect(a.scoreBefore.score).toBe(provider.analyseInfrastructure(IGMH)!.accessibility.score);
	});
});

describe('assetStateLabels', () => {
	it('labels lifecycle first, then moved', () => {
		expect(assetStateLabels('existing', undefined)).toEqual(['existing']);
		expect(assetStateLabels('proposed', undefined)).toEqual(['proposed']);
	});
});
