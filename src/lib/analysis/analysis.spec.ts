import { describe, expect, it } from 'vitest';
import infrastructureRaw from '../../../data/sample/infrastructure.geojson?raw';
import routesRaw from '../../../data/sample/routes.geojson?raw';
import { SCORE_WEIGHTS } from '#lib/config/analysis.ts';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import { decodeRouteCollection } from '#lib/data/routes.ts';
import type { AnalysisWorld } from './facilityScore.ts';
import { DEMO_ISLAND_PROFILES, createDemoAnalysisProvider, demoCoverage } from './demoMetrics.ts';
import { haversineM } from './geo.ts';
import { clampScore, composeScore, scoreCategory } from './scoring.ts';
import { walkMinutes, walkRadiusM } from './walk.ts';

const infrastructure = decodeInfrastructureCollection(JSON.parse(infrastructureRaw)).features;
const routes = decodeRouteCollection(JSON.parse(routesRaw)).routes;
const world: AnalysisWorld = {
	infrastructure,
	routesServing: (id) => routes.filter((r) => r.stopIds.includes(id))
};
const byId = (id: string) => {
	const f = infrastructure.find((x) => x.id === id);
	if (!f) throw new Error(`missing fixture ${id}`);
	return f;
};

describe('geometry and walking model', () => {
	it('computes great-circle distance', () => {
		// One degree of latitude is ~111.2 km.
		expect(haversineM([73.5, 4], [73.5, 5])).toBeCloseTo(111_195, -2);
	});

	it('inverts walk time and radius', () => {
		expect(walkMinutes(walkRadiusM(10))).toBeCloseTo(10);
	});
});

describe('composeScore', () => {
	it('has component weights that sum to 1', () => {
		const total = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
		expect(total).toBeCloseTo(1);
	});

	it('forms the total from weighted components plus penalties', () => {
		const b = composeScore(
			[
				{ id: 'populationCoverage', label: '', score: 90, explanation: '', inputs: [] },
				{ id: 'connectivity', label: '', score: 76, explanation: '', inputs: [] },
				{ id: 'serviceAccess', label: '', score: 81, explanation: '', inputs: [] }
			],
			[{ id: 'overlap', label: '', points: -8, explanation: '' }]
		);
		expect(b.rawTotal).toBeCloseTo(90 * 0.4 + 76 * 0.3 + 81 * 0.3 - 8);
		expect(b.score).toBe(Math.round(b.rawTotal));
		expect(b.category).toBe('good');
	});

	it('clamps components and totals to 0–100', () => {
		const b = composeScore(
			[{ id: 'populationCoverage', label: '', score: 250, explanation: '', inputs: [] }],
			[{ id: 'overlap', label: '', points: -80, explanation: '' }]
		);
		expect(b.components[0].score).toBe(100);
		expect(b.score).toBe(0);
		expect(clampScore(-3)).toBe(0);
	});

	it('maps scores to categories at the configured thresholds', () => {
		expect(scoreCategory(80)).toBe('excellent');
		expect(scoreCategory(79)).toBe('good');
		expect(scoreCategory(0)).toBe('critical');
	});
});

describe('demo analysis', () => {
	const provider = createDemoAnalysisProvider(world);

	it('is deterministic', () => {
		const a = createDemoAnalysisProvider(world).analyseInfrastructure('hp-igmh');
		const b = createDemoAnalysisProvider(world).analyseInfrastructure('hp-igmh');
		expect(a).toEqual(b);
	});

	it('produces a breakdown that reproduces every score', () => {
		for (const f of infrastructure) {
			const { accessibility: s } = provider.analyseInfrastructure(f.id)!;
			const raw =
				s.components.reduce((t, c) => t + c.score * c.weight, 0) +
				s.penalties.reduce((t, p) => t + p.points, 0);
			expect(s.score).toBe(Math.round(clampScore(raw)));
			expect(s.score).toBeGreaterThanOrEqual(0);
			expect(s.score).toBeLessThanOrEqual(100);
		}
	});

	it('marks every result as demo', () => {
		const a = provider.analyseInfrastructure('bt-male')!;
		expect(a.provenance).toBe('demo');
		expect(a.coverage.provenance).toBe('demo');
		expect(a.nearby.provenance).toBe('demo');
	});

	it('caps coverage at the island population and grows with time', () => {
		const bands = demoCoverage(byId('sc-villimale')).bands.map((b) => b.population);
		expect(bands[0]).toBeLessThanOrEqual(bands[1]);
		expect(bands[1]).toBeLessThanOrEqual(bands[2]);
		expect(Math.max(...bands)).toBeLessThanOrEqual(DEMO_ISLAND_PROFILES.Villimalé.population);
	});

	it('treats other islands as reachable only by sea', () => {
		const a = provider.analyseInfrastructure('sc-villimale')!;
		expect(a.nearby.hospitals[0].sameIsland).toBe(false);
		expect(a.nearby.hospitals[0].walkMinutes).toBeNull();
		expect(a.concerns.map((c) => c.id)).toContain('hospital-crossing');
	});

	it('penalises same-type facilities closer than the minimum spacing', () => {
		// Majeediyya and Aminiya schools are ~740 m apart; school spacing is 800 m.
		const school = provider.analyseInfrastructure('sc-majeediyya')!;
		const [penalty] = school.accessibility.penalties;
		expect(penalty.id).toBe('overlap');
		expect(penalty.points).toBeLessThan(0);
		expect(penalty.explanation).toContain('Aminiya School');
		expect(school.concerns.map((c) => c.id)).toContain('penalty-overlap');
		// Hulhumalé Hospital has no other hospital within its 1.5 km spacing.
		expect(provider.analyseInfrastructure('hp-hulhumale')!.accessibility.penalties).toEqual([]);
	});

	it('counts the facility itself as access to its own service type', () => {
		const igmh = provider.analyseInfrastructure('hp-igmh')!;
		const service = igmh.accessibility.components.find((c) => c.id === 'serviceAccess')!;
		expect(service.inputs[0].value).toBe(0);
	});
});
