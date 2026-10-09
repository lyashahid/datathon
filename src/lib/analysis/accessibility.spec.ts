import { describe, expect, it } from 'vitest';
import infrastructureRaw from '../../../data/sample/infrastructure.geojson?raw';
import routesRaw from '../../../data/sample/routes.geojson?raw';
import {
	OVERALL_WEIGHTS,
	PROXIMITY_TARGETS,
	SEA_CROSSING_EQUIVALENT_M
} from '#lib/config/scoring.ts';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import { decodeRouteCollection } from '#lib/data/routes.ts';
import { Baseline } from '#lib/stores/baseline.ts';
import { ScenarioStore } from '#lib/stores/scenario.svelte.ts';
import type { InfrastructureFeature, Position } from '#lib/types/domain.ts';
import {
	calculateEducationAccessibility,
	calculateHealthAccessibility,
	calculateLocationAccess,
	calculateOverallAccessibility,
	calculateTransportAccessibility,
	createAccessIndex,
	proximityScore
} from './accessibility.ts';
import { fromLocalM, haversineM } from './geo.ts';
import { createDemoBaseCells } from './h3DemoData.ts';
import { buildAccessibilityGrid } from './h3Grid.ts';

const ORIGIN: Position = [73.51, 4.175];
const at = (eastM: number, northM = 0) => fromLocalM(ORIGIN, [eastM, northM]);

function facility(
	id: string,
	type: InfrastructureFeature['type'],
	position: Position,
	island = 'A',
	status: InfrastructureFeature['status'] = 'existing'
): InfrastructureFeature {
	return {
		id,
		name: id,
		type,
		status,
		geometry: { type: 'Point', coordinates: position },
		source: { provenance: 'demo', dataset: 't', syntheticFields: [] },
		metadata: { island }
	};
}

const here = { position: ORIGIN, island: 'A' };

describe('proximityScore', () => {
	const t = { fullScoreWithinM: 200, zeroScoreBeyondM: 800 };
	it('decays linearly between the thresholds', () => {
		expect(proximityScore(100, t)).toBe(100);
		expect(proximityScore(200, t)).toBe(100);
		expect(proximityScore(500, t)).toBe(50);
		expect(proximityScore(800, t)).toBe(0);
		expect(proximityScore(null, t)).toBe(0);
	});
});

describe('category calculations', () => {
	it('scores transport as the weighted sum of its components', () => {
		const index = createAccessIndex([
			facility('stop', 'bus_stop', at(100)),
			facility('ferry', 'ferry_terminal', at(1200)),
			facility('term', 'bus_terminal', at(3000))
		]);
		const t = calculateTransportAccessibility(here, index);
		const [stop, ferry, terminal] = t.components;
		expect(stop).toMatchObject({ id: 'busStop', nearestId: 'stop', score: 100, weight: 0.5 });
		expect(ferry.score).toBeCloseTo(50, 0);
		expect(terminal.score).toBe(0);
		const sum = t.components.reduce((s, c) => s + c.contribution, 0);
		expect(t.score).toBe(Math.round(sum));
		const weights = PROXIMITY_TARGETS.transport.reduce((s, x) => s + x.weight, 0);
		expect(weights).toBeCloseTo(1);
	});

	it('only counts transport on the same island', () => {
		const index = createAccessIndex([facility('stop', 'bus_stop', at(50), 'B')]);
		expect(calculateTransportAccessibility(here, index).components[0].distanceM).toBeNull();
	});

	it('reaches hospitals on other islands via ferry terminals plus a crossing allowance', () => {
		const index = createAccessIndex([
			facility('ft-a', 'ferry_terminal', at(300)),
			facility('ft-b', 'ferry_terminal', at(2000), 'B'),
			facility('hosp', 'hospital', at(2400), 'B')
		]);
		const [hospital] = calculateHealthAccessibility(here, index).components;
		expect(hospital.viaFerry).toBe(true);
		expect(hospital.distanceM).toBeCloseTo(300 + SEA_CROSSING_EQUIVALENT_M + 400, -1);
	});

	it('prefers a nearer same-island facility over a ferry trip', () => {
		const index = createAccessIndex([
			facility('school-a', 'school', at(900)),
			facility('ft-a', 'ferry_terminal', at(100)),
			facility('ft-b', 'ferry_terminal', at(300), 'B'),
			facility('school-b', 'school', at(320), 'B')
		]);
		const [school] = calculateEducationAccessibility(here, index).components;
		expect(school).toMatchObject({ nearestId: 'school-a', viaFerry: false });
	});

	it('ignores disabled facilities', () => {
		const index = createAccessIndex([facility('h', 'hospital', at(10), 'A', 'disabled')]);
		expect(calculateHealthAccessibility(here, index).score).toBe(0);
	});

	it('combines categories with the configured overall weights', () => {
		const index = createAccessIndex([
			facility('stop', 'bus_stop', at(0)),
			facility('school', 'school', at(0))
		]);
		const access = calculateLocationAccess(here, index);
		const expected =
			access.transport.score * OVERALL_WEIGHTS.transport +
			access.health.score * OVERALL_WEIGHTS.health +
			access.education.score * OVERALL_WEIGHTS.education;
		expect(access.overall.score).toBe(Math.round(expected));
		expect(calculateOverallAccessibility(access).score).toBe(access.overall.score);
	});

	it('is deterministic, including ties', () => {
		const a = facility('a', 'school', at(100));
		const b = facility('b', 'school', at(-100));
		const one = calculateLocationAccess(here, createAccessIndex([a, b]));
		const two = calculateLocationAccess(here, createAccessIndex([b, a]));
		expect(one).toEqual(two);
		expect(one.education.components[0].nearestId).toBe('a');
	});
});

describe('scenario edits change the grid (acceptance)', () => {
	const baseline = new Baseline(
		decodeInfrastructureCollection(JSON.parse(infrastructureRaw)),
		decodeRouteCollection(JSON.parse(routesRaw))
	);
	const base = createDemoBaseCells();
	const STOP = 'bs-hulhumale-north';

	it('moving a bus stop lowers transport access at its old spot and raises it at the new one', () => {
		let n = 0;
		const store = new ScenarioStore(baseline, {
			now: () => '2026-01-01T00:00:00.000Z',
			createId: (p) => `${p}-${++n}`
		});
		const before = buildAccessibilityGrid(base, store.effective.infrastructure);
		const from = baseline.getInfrastructure(STOP)!.geometry.coordinates;
		const to = fromLocalM(from, [-150, -500]);

		store.ensureScenario();
		expect(store.moveInfrastructure(STOP, to).ok).toBe(true);
		const after = buildAccessibilityGrid(base, store.effective.infrastructure);

		const nearestCell = (p: Position) =>
			before.cells
				.filter((c) => c.island === 'Hulhumalé')
				.reduce((best, c) => (haversineM(c.centroid, p) < haversineM(best.centroid, p) ? c : best));
		const oldCell = nearestCell(from).h3Index;
		const newCell = nearestCell(to).h3Index;

		expect(after.get(oldCell)!.transportAccessibility).toBeLessThan(
			before.get(oldCell)!.transportAccessibility
		);
		expect(after.get(newCell)!.transportAccessibility).toBeGreaterThanOrEqual(
			before.get(newCell)!.transportAccessibility
		);
		const changed = after.cells.filter(
			(c) => c.transportAccessibility !== before.get(c.h3Index)!.transportAccessibility
		);
		expect(changed.length).toBeGreaterThan(0);
		// Only cells on the stop's island can be affected: transport is same-island only.
		expect(changed.every((c) => c.island === 'Hulhumalé')).toBe(true);
	});
});
