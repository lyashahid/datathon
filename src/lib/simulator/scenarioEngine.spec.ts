import { describe, expect, it } from 'vitest';
import type { InfrastructureFeature, TransportRoute } from '#lib/types/domain.ts';
import type { ScenarioChange } from '#lib/types/scenario.ts';
import { deepFreeze } from '#lib/utils/freeze.ts';
import { checkChange, deriveEffectiveState, type BaselineData } from './scenarioEngine.ts';

const source = { provenance: 'demo', dataset: 'test', syntheticFields: [] } as const;

function feature(id: string, lng: number, lat: number): InfrastructureFeature {
	return {
		id,
		name: id,
		type: 'bus_stop',
		status: 'existing',
		geometry: { type: 'Point', coordinates: [lng, lat] },
		source,
		metadata: {}
	};
}

const route: TransportRoute = {
	id: 'r1',
	name: 'Route 1',
	mode: 'bus',
	status: 'existing',
	geometry: {
		type: 'LineString',
		coordinates: [
			[73.5, 4.17],
			[73.51, 4.18]
		]
	},
	stopIds: ['a', 'b'],
	source,
	metadata: {}
};

const baseline: BaselineData = deepFreeze({
	infrastructure: [feature('a', 73.5, 4.17), feature('b', 73.51, 4.18)],
	routes: [route]
});
const baselineSnapshot = JSON.stringify(baseline);

let seq = 0;
const at = '2026-01-01T00:00:00.000Z';
const move = (id: string, to: [number, number]): ScenarioChange => ({
	id: `c${++seq}`,
	createdAt: at,
	kind: 'move',
	target: { kind: 'infrastructure', id },
	from: [0, 0],
	to
});
const disable = (
	id: string,
	kind: 'infrastructure' | 'route' = 'infrastructure'
): ScenarioChange => ({
	id: `c${++seq}`,
	createdAt: at,
	kind: 'disable',
	target: { kind, id }
});
const restore = (
	id: string,
	kind: 'infrastructure' | 'route' = 'infrastructure'
): ScenarioChange => ({
	id: `c${++seq}`,
	createdAt: at,
	kind: 'restore',
	target: { kind, id }
});
const remove = (id: string): ScenarioChange => ({
	id: `c${++seq}`,
	createdAt: at,
	kind: 'remove',
	target: { kind: 'infrastructure', id }
});
const add = (id: string): ScenarioChange => ({
	id: `c${++seq}`,
	createdAt: at,
	kind: 'add',
	feature: { ...feature(id, 73.52, 4.19), status: 'proposed' }
});

const coords = (state: ReturnType<typeof deriveEffectiveState>, id: string) =>
	state.getInfrastructure(id)?.geometry.coordinates;

describe('deriveEffectiveState', () => {
	it('1. leaves the baseline unchanged after a move', () => {
		const state = deriveEffectiveState(baseline, [move('a', [73.6, 4.2])]);
		expect(coords(state, 'a')).toEqual([73.6, 4.2]);
		expect(baseline.infrastructure[0].geometry.coordinates).toEqual([73.5, 4.17]);
		expect(JSON.stringify(baseline)).toBe(baselineSnapshot);
		expect(state.infrastructureDeltas.get('a')).toMatchObject({
			origin: 'baseline',
			moved: true,
			originalPosition: [73.5, 4.17]
		});
	});

	it('2. shows an added feature only in the scenario', () => {
		const state = deriveEffectiveState(baseline, [add('new')]);
		expect(state.getInfrastructure('new')?.status).toBe('proposed');
		expect(state.infrastructureDeltas.get('new')?.origin).toBe('scenario');
		expect(baseline.infrastructure.some((f) => f.id === 'new')).toBe(false);
		expect(deriveEffectiveState(baseline, []).getInfrastructure('new')).toBeUndefined();
	});

	it('3. marks a disabled baseline feature only in the scenario', () => {
		const state = deriveEffectiveState(baseline, [disable('a')]);
		expect(state.getInfrastructure('a')?.status).toBe('disabled');
		expect(state.infrastructureDeltas.get('a')?.statusChanged).toBe(true);
		expect(baseline.infrastructure[0].status).toBe('existing');
	});

	it('6. resolves multiple changes to the same feature in order', () => {
		const changes = [move('a', [73.6, 4.2]), disable('a'), move('a', [73.7, 4.3]), restore('a')];
		const state = deriveEffectiveState(baseline, changes);
		const a = state.getInfrastructure('a');
		expect(a?.geometry.coordinates).toEqual([73.7, 4.3]);
		expect(a?.status).toBe('existing');
		expect(state.infrastructureDeltas.get('a')?.changeIds).toEqual(changes.map((c) => c.id));
		expect(state.issues).toEqual([]);
	});

	it('7. collapses to the baseline when changes cancel out', () => {
		const state = deriveEffectiveState(baseline, [
			disable('a'),
			restore('a'),
			move('b', [73.6, 4.2]),
			move('b', [73.51, 4.18])
		]);
		expect(state.infrastructure).toEqual(baseline.infrastructure);
		// Identity, not just equality: unchanged assets are the frozen baseline objects.
		expect(state.infrastructure[0]).toBe(baseline.infrastructure[0]);
		expect(state.infrastructureDeltas.size).toBe(0);
	});

	it('withdraws and restores proposals, but never removes baseline assets', () => {
		const added = add('p');
		const removal = remove('p');
		const state = deriveEffectiveState(baseline, [added, removal]);
		expect(state.getInfrastructure('p')).toBeUndefined();
		expect(
			deriveEffectiveState(baseline, [added, removal, restore('p')]).getInfrastructure('p')
		).toBeDefined();

		const bad = remove('a');
		const withIssue = deriveEffectiveState(baseline, [bad]);
		expect(withIssue.getInfrastructure('a')).toBeDefined();
		expect(withIssue.issues).toEqual([
			{ changeId: bad.id, message: expect.stringContaining('disable it instead') }
		]);
	});

	it('skips invalid changes and reports them', () => {
		const ghost = move('missing', [73.5, 4.1]);
		const twice = [disable('a'), disable('a')];
		const state = deriveEffectiveState(baseline, [ghost, ...twice]);
		expect(state.issues.map((i) => i.changeId)).toEqual([ghost.id, twice[1].id]);
		expect(state.getInfrastructure('a')?.status).toBe('disabled');
		expect(checkChange(baseline, [], move('a', [999, 0]))).toBe('invalid position');
	});

	it('stops disabled routes serving their stops', () => {
		expect(deriveEffectiveState(baseline, []).routesServing('a')).toHaveLength(1);
		const state = deriveEffectiveState(baseline, [disable('r1', 'route')]);
		expect(state.getRoute('r1')?.status).toBe('disabled');
		expect(state.routesServing('a')).toEqual([]);
	});

	it('is deterministic and returns frozen output', () => {
		const changes = [add('n'), move('a', [73.55, 4.2]), disable('b')];
		const one = deriveEffectiveState(baseline, changes);
		const two = deriveEffectiveState(baseline, changes);
		expect(one.infrastructure).toEqual(two.infrastructure);
		expect([...one.infrastructureDeltas]).toEqual([...two.infrastructureDeltas]);
		expect(one.infrastructure.map((f) => f.id)).toEqual(['a', 'b', 'n']);
		expect(Object.isFrozen(one.getInfrastructure('a'))).toBe(true);
		expect(() => {
			(one.getInfrastructure('a') as { name: string }).name = 'x';
		}).toThrow(TypeError);
	});
});
