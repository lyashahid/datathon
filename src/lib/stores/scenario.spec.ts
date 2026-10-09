import { beforeEach, describe, expect, it } from 'vitest';
import type { BaselineData } from '#lib/simulator/scenarioEngine.ts';
import { deepFreeze } from '#lib/utils/freeze.ts';
import { ScenarioStore } from './scenario.svelte.ts';

const baseline: BaselineData = deepFreeze({
	infrastructure: [
		{
			id: 'a',
			name: 'A',
			type: 'school' as const,
			status: 'existing' as const,
			geometry: { type: 'Point' as const, coordinates: [73.5, 4.17] },
			source: { provenance: 'demo' as const, dataset: 't', syntheticFields: [] },
			metadata: {}
		}
	],
	routes: []
});

function deterministicDeps() {
	let n = 0;
	return { now: () => '2026-01-01T00:00:00.000Z', createId: (p: string) => `${p}-${++n}` };
}

describe('ScenarioStore', () => {
	let store: ScenarioStore;
	beforeEach(() => {
		store = new ScenarioStore(baseline, deterministicDeps());
	});

	it('starts in read-only baseline mode', () => {
		expect(store.isBaseline).toBe(true);
		const result = store.disableAsset({ kind: 'infrastructure', id: 'a' });
		expect(result.ok).toBe(false);
		expect(store.effective.getInfrastructure('a')?.status).toBe('existing');
	});

	it('creates, names and switches scenarios', () => {
		const first = store.createScenario();
		const second = store.createScenario('Ferry cuts');
		expect(store.scenarios.map((s) => s.name)).toEqual(['Scenario 1', 'Ferry cuts']);
		expect(store.activeId).toBe(second);
		store.selectScenario(first);
		expect(store.active?.name).toBe('Scenario 1');
		store.selectBaseline();
		expect(store.isBaseline).toBe(true);
	});

	it('renames, rejecting empty names', () => {
		const id = store.createScenario();
		expect(store.renameScenario(id, '  ').ok).toBe(false);
		expect(store.renameScenario(id, ' New name ').ok).toBe(true);
		expect(store.active?.name).toBe('New name');
	});

	it('4–5. undoes a move to the previous location and redoes it', () => {
		store.createScenario();
		store.moveInfrastructure('a', [73.6, 4.2]);
		store.moveInfrastructure('a', [73.7, 4.3]);
		expect(store.effective.getInfrastructure('a')?.geometry.coordinates).toEqual([73.7, 4.3]);

		expect(store.undo()).toBe(true);
		expect(store.effective.getInfrastructure('a')?.geometry.coordinates).toEqual([73.6, 4.2]);
		expect(store.canRedo).toBe(true);

		expect(store.redo()).toBe(true);
		expect(store.effective.getInfrastructure('a')?.geometry.coordinates).toEqual([73.7, 4.3]);
		expect(store.canRedo).toBe(false);
	});

	it('records the position a move started from', () => {
		store.createScenario();
		store.moveInfrastructure('a', [73.6, 4.2]);
		store.moveInfrastructure('a', [73.7, 4.3]);
		const moves = store.active!.changes.filter((c) => c.kind === 'move');
		expect(moves.map((m) => m.from)).toEqual([
			[73.5, 4.17],
			[73.6, 4.2]
		]);
	});

	it('clears redo when a new change is made after undo', () => {
		store.createScenario();
		store.disableAsset({ kind: 'infrastructure', id: 'a' });
		store.undo();
		store.moveInfrastructure('a', [73.6, 4.2]);
		expect(store.canRedo).toBe(false);
	});

	it('7. resets to a baseline-equivalent state, and the reset is undoable', () => {
		store.createScenario();
		const added = store.addInfrastructure({
			name: 'New school',
			type: 'school',
			position: [73.52, 4.2]
		});
		store.disableAsset({ kind: 'infrastructure', id: 'a' });
		expect(added.ok).toBe(true);

		store.resetScenario();
		expect(store.active?.changes).toEqual([]);
		expect(store.effective.infrastructure).toEqual(baseline.infrastructure);

		store.undo();
		expect(store.effective.infrastructure).toHaveLength(2);
	});

	it('removes only proposed infrastructure', () => {
		store.createScenario();
		const added = store.addInfrastructure({ name: 'P', type: 'hospital', position: [73.52, 4.2] });
		if (!added.ok) throw new Error(added.reason);
		expect(store.effective.getInfrastructure(added.id)?.status).toBe('proposed');
		expect(store.removeProposed(added.id).ok).toBe(true);
		expect(store.effective.getInfrastructure(added.id)).toBeUndefined();
		expect(store.restoreAsset({ kind: 'infrastructure', id: added.id }).ok).toBe(true);
		expect(store.effective.getInfrastructure(added.id)).toBeDefined();

		const refused = store.removeProposed('a');
		expect(refused.ok).toBe(false);
		expect(store.active?.changes).toHaveLength(3);
	});

	it('rejects invalid edits without recording them', () => {
		store.createScenario();
		expect(store.restoreAsset({ kind: 'infrastructure', id: 'a' }).ok).toBe(false);
		expect(store.canUndo).toBe(false);
	});

	it('duplicates a scenario with independent history', () => {
		const original = store.createScenario('Base plan');
		store.disableAsset({ kind: 'infrastructure', id: 'a' });
		const copy = store.duplicateScenario();
		if (!copy.ok) throw new Error(copy.reason);
		expect(store.active?.name).toBe('Base plan (copy)');
		expect(store.effective.getInfrastructure('a')?.status).toBe('disabled');
		expect(store.canUndo).toBe(false);

		store.restoreAsset({ kind: 'infrastructure', id: 'a' });
		store.selectScenario(original);
		expect(store.effective.getInfrastructure('a')?.status).toBe('disabled');
	});

	it('never mutates the baseline and keeps stored changes frozen', () => {
		const snapshot = JSON.stringify(baseline);
		store.createScenario();
		store.moveInfrastructure('a', [73.6, 4.2]);
		store.disableAsset({ kind: 'infrastructure', id: 'a' });
		store.resetScenario();
		store.undo();
		expect(JSON.stringify(baseline)).toBe(snapshot);
		expect(Object.isFrozen(store.active?.changes[0])).toBe(true);
	});
});

describe('analysis settings', () => {
	it('keeps priorities per scenario, outside undo history, and carries baseline ones forward', () => {
		const store = new ScenarioStore(baseline, deterministicDeps());
		const w = {
			underservedReached: 1,
			populationCoverage: 0,
			walkingImprovement: 0,
			networkSuitability: 0,
			essentialServices: 0
		};
		store.setAnalysisSettings({ busStopWeights: w });
		expect(store.analysisSettings.busStopWeights).toEqual(w);

		const first = store.createScenario();
		expect(store.analysisSettings.busStopWeights).toEqual(w);
		expect(store.canUndo).toBe(false);

		store.setAnalysisSettings({ busStopWeights: { ...w, essentialServices: 1 } });
		store.selectBaseline();
		expect(store.analysisSettings.busStopWeights).toEqual(w);
		store.selectScenario(first);
		expect(store.analysisSettings.busStopWeights?.essentialServices).toBe(1);
	});
});
