import { describe, expect, it } from 'vitest';
import infrastructureRaw from '../../../data/sample/infrastructure.geojson?raw';
import routesRaw from '../../../data/sample/routes.geojson?raw';
import { MAP_VIEW_PRESETS } from '#lib/config/map.ts';
import { INFRASTRUCTURE_TYPES } from '#lib/types/domain.ts';
import { DataValidationError } from './decode.ts';
import { decodeInfrastructureCollection } from './infrastructure.ts';
import { assertRouteStopsExist, decodeRouteCollection } from './routes.ts';

const dataset = {
	id: 'test',
	title: 'Test',
	version: '1',
	provenance: 'demo',
	description: 'Test data'
};

function point(overrides: Record<string, unknown> = {}) {
	return {
		type: 'Feature',
		id: 'a',
		geometry: { type: 'Point', coordinates: [73.5, 4.17] },
		properties: {
			name: 'A',
			type: 'school',
			status: 'existing',
			source: { provenance: 'demo', dataset: 'test', syntheticFields: ['students'] },
			metadata: { students: 10 },
			...overrides
		}
	};
}

describe('decodeInfrastructureCollection', () => {
	it('decodes a valid feature', () => {
		const { features } = decodeInfrastructureCollection({
			type: 'FeatureCollection',
			dataset,
			features: [point()]
		});
		expect(features[0]).toMatchObject({
			id: 'a',
			type: 'school',
			status: 'existing',
			metadata: { students: 10 },
			source: { provenance: 'demo', syntheticFields: ['students'] }
		});
	});

	it('rejects unknown types with a path to the bad value', () => {
		const bad = { type: 'FeatureCollection', dataset, features: [point({ type: 'castle' })] };
		expect(() => decodeInfrastructureCollection(bad)).toThrow(DataValidationError);
		expect(() => decodeInfrastructureCollection(bad)).toThrow('$.features[0].properties.type');
	});

	it('rejects duplicate ids', () => {
		const dup = { type: 'FeatureCollection', dataset, features: [point(), point()] };
		expect(() => decodeInfrastructureCollection(dup)).toThrow('duplicate id');
	});

	it('rejects non-scalar metadata', () => {
		const bad = {
			type: 'FeatureCollection',
			dataset,
			features: [point({ metadata: { nested: { x: 1 } } })]
		};
		expect(() => decodeInfrastructureCollection(bad)).toThrow('scalar');
	});
});

describe('sample dataset', () => {
	const infrastructure = decodeInfrastructureCollection(JSON.parse(infrastructureRaw));
	const routes = decodeRouteCollection(JSON.parse(routesRaw));

	it('covers every infrastructure type', () => {
		const present = new Set(infrastructure.features.map((f) => f.type));
		expect([...present].sort()).toEqual([...INFRASTRUCTURE_TYPES].sort());
	});

	it('is marked as demo data throughout', () => {
		expect(infrastructure.dataset.provenance).toBe('demo');
		for (const f of [...infrastructure.features, ...routes.routes]) {
			expect(f.source.provenance).toBe('demo');
		}
	});

	it('only flags synthetic fields that exist on the record', () => {
		for (const f of [...infrastructure.features, ...routes.routes]) {
			for (const key of f.source.syntheticFields) expect(f.metadata).toHaveProperty(key);
		}
	});

	it('lies within Greater Malé', () => {
		const [[w, s], [e, n]] = MAP_VIEW_PRESETS.greaterMale.bounds;
		for (const f of infrastructure.features) {
			const [lng, lat] = f.geometry.coordinates;
			expect(lng).toBeGreaterThanOrEqual(w);
			expect(lng).toBeLessThanOrEqual(e);
			expect(lat).toBeGreaterThanOrEqual(s);
			expect(lat).toBeLessThanOrEqual(n);
		}
	});

	it('has routes that only reference existing stops', () => {
		expect(routes.routes.length).toBeGreaterThan(0);
		expect(() => assertRouteStopsExist(routes.routes, infrastructure.features)).not.toThrow();
	});
});
