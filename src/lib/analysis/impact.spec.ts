import { describe, expect, it } from 'vitest';
import infrastructureRaw from '../../../data/sample/infrastructure.geojson?raw';
import { IMPACT_CONFIG } from '#lib/config/impact.ts';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import type { InfrastructureFeature, Position } from '#lib/types/domain.ts';
import { createDemoBaseCells } from './h3DemoData.ts';
import { buildAccessibilityGrid } from './h3Grid.ts';
import { classifyChange, compareGrids, localImpact } from './impact.ts';

const infrastructure = decodeInfrastructureCollection(JSON.parse(infrastructureRaw)).features;
const base = createDemoBaseCells();
const baseline = buildAccessibilityGrid(base, infrastructure);

/** East side of the airport island, far from every existing stop. */
const UNDERSERVED_SPOT: Position = [73.535, 4.192];

function withStop(position: Position): InfrastructureFeature[] {
	return [
		...infrastructure,
		{
			id: 'proposed-stop',
			name: 'Proposed stop',
			type: 'bus_stop',
			status: 'proposed',
			geometry: { type: 'Point', coordinates: position },
			source: { provenance: 'simulated', dataset: 'test', syntheticFields: [] },
			metadata: { island: 'Hulhulé', atoll: 'Malé City' }
		}
	];
}

const disabled = (id: string) =>
	infrastructure.map((f) => (f.id === id ? { ...f, status: 'disabled' as const } : f));

describe('compareGrids', () => {
	it('reports no change for an unmodified scenario', () => {
		const impact = compareGrids(baseline, buildAccessibilityGrid(base, infrastructure));
		expect(impact.hasChanges).toBe(false);
		expect(impact.summary.benefiting.total).toBe(0);
		expect(impact.summary.losing.total).toBe(0);
		expect(impact.summary.transport.delta).toBe(0);
		expect(impact.summary.underservedPopulation.delta).toBe(0);
	});

	it('credits residents who gain access when a stop is added where none was near', () => {
		const impact = compareGrids(baseline, buildAccessibilityGrid(base, withStop(UNDERSERVED_SPOT)));
		const s = impact.summary;
		expect(impact.hasChanges).toBe(true);
		expect(s.benefiting.total).toBeGreaterThan(0);
		expect(s.losing.total).toBe(0);
		expect(s.transport.delta).toBeGreaterThan(0);
		// Adding infrastructure can never reduce anyone's score.
		expect(impact.cells.every((c) => c.delta.overall >= 0)).toBe(true);
		expect(s.underservedPopulation.delta).toBeLessThanOrEqual(0);
	});

	it('records losses when a hospital is disabled', () => {
		const impact = compareGrids(baseline, buildAccessibilityGrid(base, disabled('hp-igmh')));
		expect(impact.summary.losing.total).toBeGreaterThan(0);
		expect(impact.summary.health.delta).toBeLessThan(0);
		expect(impact.summary.benefiting.total).toBe(0);
	});

	it('splits benefiting residents into age groups that sum to the total', () => {
		const { benefiting } = compareGrids(
			baseline,
			buildAccessibilityGrid(base, withStop(UNDERSERVED_SPOT))
		).summary;
		expect(benefiting.children + benefiting.workingAge + benefiting.olderPopulation).toBeCloseTo(
			benefiting.total,
			6
		);
	});

	it('only counts cells that move by at least the threshold', () => {
		const t = IMPACT_CONFIG.changeThresholdPoints;
		expect(classifyChange(t)).toBe('improved');
		expect(classifyChange(t - 0.5)).toBe('unchanged');
		expect(classifyChange(-t)).toBe('worsened');
		const impact = compareGrids(
			baseline,
			buildAccessibilityGrid(base, withStop(UNDERSERVED_SPOT)),
			1000
		);
		expect(impact.summary.benefiting.total).toBe(0);
		expect(impact.hasChanges).toBe(true);
	});

	it('is deterministic', () => {
		const scenario = buildAccessibilityGrid(base, withStop(UNDERSERVED_SPOT));
		expect(compareGrids(baseline, scenario).summary).toEqual(
			compareGrids(baseline, scenario).summary
		);
	});
});

describe('localImpact', () => {
	it('limits the summary to residents near the facility', () => {
		const impact = compareGrids(baseline, buildAccessibilityGrid(base, withStop(UNDERSERVED_SPOT)));
		const local = localImpact(impact, 'proposed-stop', [UNDERSERVED_SPOT], 500);
		expect(local.summary.cellsCompared).toBeGreaterThan(0);
		expect(local.summary.cellsCompared).toBeLessThan(impact.summary.cellsCompared);
		expect(local.summary.benefiting.total).toBeLessThanOrEqual(impact.summary.benefiting.total);
		expect(localImpact(impact, 'x', [[73.4, 4.0]], 500).summary.cellsCompared).toBe(0);
	});
});
