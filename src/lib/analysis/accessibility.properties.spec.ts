import { describe, expect, it } from 'vitest';
import infrastructureRaw from '../../../data/sample/infrastructure.geojson?raw';
import { DISRUPTION_SCENARIOS } from '#lib/config/disruptionScenarios.ts';
import { PROXIMITY_TARGETS } from '#lib/config/scoring.ts';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import type { InfrastructureFeature } from '#lib/types/domain.ts';
import { proximityScore } from './accessibility.ts';
import { haversineM } from './geo.ts';
import { createDemoBaseCells } from './h3DemoData.ts';
import { buildAccessibilityGrid } from './h3Grid.ts';

/** Properties that must hold for every facility and cell, not just hand-picked examples. */
const infrastructure = decodeInfrastructureCollection(JSON.parse(infrastructureRaw)).features;
const base = createDemoBaseCells();
const normal = buildAccessibilityGrid(base, infrastructure);
const SCORES = [
	'transportAccessibility',
	'healthAccessibility',
	'educationAccessibility',
	'overallAccessibility'
] as const;

const withStatus = (id: string, status: InfrastructureFeature['status']) =>
	infrastructure.map((f) => (f.id === id ? { ...f, status } : f));

describe('proximity scoring', () => {
	it('never rises with distance and stays within 0–100 for every target', () => {
		for (const target of Object.values(PROXIMITY_TARGETS).flat()) {
			let previous = Infinity;
			for (let d = 0; d <= target.zeroScoreBeyondM * 1.5; d += 25) {
				const s = proximityScore(d, target);
				expect(s).toBeGreaterThanOrEqual(0);
				expect(s).toBeLessThanOrEqual(100);
				expect(s).toBeLessThanOrEqual(previous);
				previous = s;
			}
		}
	});
});

describe('grid invariants', () => {
	it('keeps every score in 0–100 under every planning disruption', () => {
		for (const d of DISRUPTION_SCENARIOS) {
			for (const cell of buildAccessibilityGrid(base, infrastructure, d.conditions).cells) {
				for (const key of SCORES) {
					expect(cell[key]).toBeGreaterThanOrEqual(0);
					expect(cell[key]).toBeLessThanOrEqual(100);
				}
				expect(cell.underservedPopulation).toBeGreaterThanOrEqual(0);
				expect(cell.underservedPopulation).toBeLessThanOrEqual(cell.population);
			}
		}
	});

	it('disabling any one facility never improves any score anywhere', () => {
		for (const f of infrastructure) {
			const after = buildAccessibilityGrid(base, withStatus(f.id, 'disabled'));
			after.cells.forEach((cell, i) => {
				for (const key of SCORES) expect(cell[key]).toBeLessThanOrEqual(normal.cells[i][key]);
			});
		}
	});

	it('moving a bus stop towards a cell never lowers that cell’s transport score', () => {
		const stops = infrastructure.filter((f) => f.type === 'bus_stop');
		for (const stop of stops) {
			const cell = normal.cells
				.filter((c) => c.island === stop.metadata.island)
				.reduce((far, c) =>
					haversineM(c.centroid, stop.geometry.coordinates) >
					haversineM(far.centroid, stop.geometry.coordinates)
						? c
						: far
				);
			const [sx, sy] = stop.geometry.coordinates;
			const [cx, cy] = cell.centroid;
			const halfway = infrastructure.map((f) =>
				f.id === stop.id
					? {
							...f,
							geometry: { type: 'Point' as const, coordinates: [(sx + cx) / 2, (sy + cy) / 2] }
						}
					: f
			);
			const after = buildAccessibilityGrid(base, halfway).get(cell.h3Index)!;
			expect(after.transportAccessibility).toBeGreaterThanOrEqual(cell.transportAccessibility);
		}
	});

	it('leaves the baseline grid identical however the infrastructure is edited', () => {
		const snapshot = JSON.stringify(infrastructure);
		buildAccessibilityGrid(base, withStatus('hp-igmh', 'disabled'));
		expect(JSON.stringify(infrastructure)).toBe(snapshot);
		const again = buildAccessibilityGrid(base, infrastructure);
		expect(again.cells).toEqual(normal.cells);
		expect(again.totals).toEqual(normal.totals);
	});
});
