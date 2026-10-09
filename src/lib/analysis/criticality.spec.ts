import { describe, expect, it } from 'vitest';
import infrastructureRaw from '../../../data/sample/infrastructure.geojson?raw';
import { CRITICALITY_TYPES } from '#lib/config/criticality.ts';
import { getDisruption } from '#lib/config/disruptionScenarios.ts';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import { assessCriticality, criticalityBand } from './criticality.ts';
import { createDemoBaseCells } from './h3DemoData.ts';
import { buildAccessibilityGrid } from './h3Grid.ts';

const infrastructure = decodeInfrastructureCollection(JSON.parse(infrastructureRaw)).features;
const base = createDemoBaseCells();
const grid = buildAccessibilityGrid(base, infrastructure);
const result = assessCriticality(base, infrastructure, grid);

describe('assessCriticality', () => {
	it('assesses every active scored facility, and nothing else', () => {
		const expected = infrastructure
			.filter((f) => f.status !== 'disabled' && CRITICALITY_TYPES.includes(f.type))
			.map((f) => f.id)
			.sort();
		expect(result.facilities.map((f) => f.featureId).sort()).toEqual(expected);
		expect(result.get('ap-velana')).toBeUndefined();
	});

	it('ranks by average loss, deterministically', () => {
		const losses = result.facilities.map((f) => f.averagePointsLost);
		expect([...losses].sort((a, b) => b - a)).toEqual(losses);
		expect(result.facilities.map((f) => f.rank)).toEqual(losses.map((_, i) => i + 1));
		expect(assessCriticality(base, infrastructure, grid).facilities).toEqual(result.facilities);
	});

	it("flags a facility with no same-type alternative as more critical than one that's duplicated", () => {
		const hospital = result.get('hp-igmh')!;
		const stop = result.get('bs-male-majeedhee-c')!;
		expect(hospital.averagePointsLost).toBeGreaterThan(stop.averagePointsLost);
		expect(hospital.nearestAlternative?.id).toBe('hp-hulhumale');
	});

	it('records each cell’s worst single closure', () => {
		for (const [h, e] of result.exposure) {
			expect(e.drop).toBeGreaterThan(0);
			expect(grid.get(h)).toBeDefined();
			expect(result.get(e.featureId)).toBeDefined();
		}
		const worst = Math.max(...result.facilities.map((f) => f.maxCellDrop));
		expect(Math.max(...[...result.exposure.values()].map((e) => e.drop))).toBe(worst);
	});

	it('ignores disabled facilities and reflects their absence', () => {
		const without = infrastructure.map((f) =>
			f.id === 'hp-hulhumale' ? { ...f, status: 'disabled' as const } : f
		);
		const after = assessCriticality(base, without, buildAccessibilityGrid(base, without));
		expect(after.get('hp-hulhumale')).toBeUndefined();
		// With the only other hospital gone, IGMH carries everyone.
		expect(after.get('hp-igmh')!.averagePointsLost).toBeGreaterThan(
			result.get('hp-igmh')!.averagePointsLost
		);
		expect(after.get('hp-igmh')!.nearestAlternative).toBeNull();
	});

	it('respects disruption conditions', () => {
		const conditions = getDisruption('severeMarine').conditions;
		const severe = assessCriticality(
			base,
			infrastructure,
			buildAccessibilityGrid(base, infrastructure, conditions),
			conditions
		);
		// Ferry terminals give no access when crossings are suspended, so closing one costs nothing.
		expect(severe.get('ft-villimale')!.averagePointsLost).toBe(0);
	});

	it('explains every result in plain language', () => {
		for (const f of result.facilities) expect(f.explanation.length).toBeGreaterThan(0);
		expect(criticalityBand(5)).toBe('critical');
		expect(criticalityBand(0)).toBe('low');
	});
});
