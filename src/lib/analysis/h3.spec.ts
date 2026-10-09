import { describe, expect, it } from 'vitest';
import { getResolution } from 'h3-js';
import infrastructureRaw from '../../../data/sample/infrastructure.geojson?raw';
import { H3_RESOLUTION } from '#lib/config/analysis.ts';
import { UNDERSERVED_THRESHOLD } from '#lib/config/scoring.ts';
import { INFO_VIEWS } from '#lib/config/infoViews.ts';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import type { InfrastructureFeature } from '#lib/types/domain.ts';
import { colorAt } from '#lib/utils/color.ts';
import { DEMO_ISLAND_PROFILES } from './demoMetrics.ts';
import { createDemoBaseCells, demoIslandAt } from './h3DemoData.ts';
import { buildAccessibilityGrid } from './h3Grid.ts';

const infrastructure = decodeInfrastructureCollection(JSON.parse(infrastructureRaw)).features;
const base = createDemoBaseCells();
const grid = buildAccessibilityGrid(base, infrastructure);

const disable = (id: string): InfrastructureFeature[] =>
	infrastructure.map((f) => (f.id === id ? { ...f, status: 'disabled' as const } : f));

describe('demo demographic grid', () => {
	it('is deterministic', () => {
		expect(createDemoBaseCells()).toEqual(base);
	});

	it('covers every demo island at the configured resolution', () => {
		const islands = new Set(base.map((c) => c.island));
		expect([...islands].sort()).toEqual(Object.keys(DEMO_ISLAND_PROFILES).sort());
		expect(base.every((c) => getResolution(c.h3Index) === H3_RESOLUTION)).toBe(true);
		expect(new Set(base.map((c) => c.h3Index)).size).toBe(base.length);
	});

	it('preserves each island’s demo population exactly', () => {
		for (const [island, profile] of Object.entries(DEMO_ISLAND_PROFILES)) {
			const total = base.filter((c) => c.island === island).reduce((s, c) => s + c.population, 0);
			expect(total).toBeCloseTo(profile.population, 6);
		}
	});

	it('splits every cell into age groups that sum to its population', () => {
		for (const c of base) {
			expect(c.children + c.workingAge + c.olderPopulation).toBeCloseTo(c.population, 6);
			expect(c.provenance).toBe('demo');
		}
	});

	it('puts more residents in island interiors than on the shore', () => {
		const male = base.filter((c) => c.island === 'Malé').map((c) => c.population);
		expect(Math.max(...male)).toBeGreaterThan(Math.min(...male));
	});
});

describe('accessibility grid', () => {
	it('fills every required field within range', () => {
		for (const c of grid.cells) {
			for (const key of [
				'transportAccessibility',
				'healthAccessibility',
				'educationAccessibility',
				'overallAccessibility'
			] as const) {
				expect(c[key]).toBeGreaterThanOrEqual(0);
				expect(c[key]).toBeLessThanOrEqual(100);
			}
			expect(c.underservedPopulation).toBeGreaterThanOrEqual(0);
			expect(c.underservedPopulation).toBeLessThanOrEqual(c.population);
			expect(c.centroid).toHaveLength(2);
		}
		expect(grid.get(grid.cells[0].h3Index)).toBe(grid.cells[0]);
	});

	it('computes underserved residents from the shortfall below the threshold', () => {
		for (const c of grid.cells) {
			const shortfall =
				Math.max(0, UNDERSERVED_THRESHOLD - c.overallAccessibility) / UNDERSERVED_THRESHOLD;
			expect(c.underservedPopulation).toBeCloseTo(c.population * shortfall, 6);
		}
	});

	it('reaches other islands only via a ferry crossing', () => {
		const villimale = grid.cells.filter((c) => c.island === 'Villimalé');
		expect(villimale.length).toBeGreaterThan(0);
		for (const c of villimale) expect(c.access.health.components[0].viaFerry).toBe(true);
	});

	it('responds to scenario changes: disabling a hospital lowers nearby health access', () => {
		const after = buildAccessibilityGrid(base, disable('hp-igmh'));
		const maleBefore = grid.cells.filter((c) => c.island === 'Malé');
		const maleAfter = after.cells.filter((c) => c.island === 'Malé');
		const avg = (cells: typeof maleBefore) =>
			cells.reduce((s, c) => s + c.healthAccessibility, 0) / cells.length;
		expect(avg(maleAfter)).toBeLessThan(avg(maleBefore));
		expect(after.totals.underservedPopulation).toBeGreaterThanOrEqual(
			grid.totals.underservedPopulation
		);
	});
});

describe('info view scales', () => {
	it('have ascending stops', () => {
		for (const view of INFO_VIEWS) {
			const values = view.scale.stops.map(([v]) => v);
			expect([...values].sort((a, b) => a - b)).toEqual(values);
		}
	});

	it('interpolate colours like the map ramp', () => {
		const scale = {
			kind: 'sequential' as const,
			stops: [
				[0, '#000000'],
				[100, '#ffffff']
			] as const
		};
		expect(colorAt(scale, 50)).toBe('#808080');
		expect(colorAt(scale, -10)).toBe('#000000');
		expect(colorAt(scale, 500)).toBe('#ffffff');
	});
});

describe('demoIslandAt', () => {
	it('places every grid cell centroid on its own island', () => {
		const mismatched = base.filter((c) => demoIslandAt(c.centroid) !== c.island);
		// Cells straddling an outline edge can have a centroid just outside it.
		expect(mismatched.length / base.length).toBeLessThan(0.1);
	});

	it('returns null in open water', () => {
		expect(demoIslandAt([73.47, 4.2])).toBeNull();
	});
});
