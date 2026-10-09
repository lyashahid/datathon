import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { DEFAULT_BASEMAPS, MAP_COLORS } from '#lib/config/map.ts';
import {
	OFFLINE_BASEMAP,
	applyHudPalette,
	enforce2dStyle,
	loadBasemapStyle,
	resolveBasemapCandidates
} from './style.ts';

const style3d: StyleSpecification = {
	version: 8,
	sources: {
		v: { type: 'vector', url: 'https://example.test/tiles.json' },
		dem: { type: 'raster-dem', url: 'https://example.test/dem.json' }
	},
	terrain: { source: 'dem', exaggeration: 1.5 },
	sky: {},
	projection: { type: 'globe' },
	pitch: 60,
	layers: [
		{ id: 'bg', type: 'background' },
		{ id: 'buildings', type: 'fill-extrusion', source: 'v', 'source-layer': 'building' },
		{ id: 'relief', type: 'hillshade', source: 'dem' }
	]
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

describe('enforce2dStyle', () => {
	it('removes 3D layers, terrain, sky, DEM sources and globe projection', () => {
		const flat = enforce2dStyle(style3d);
		expect(flat.layers.map((l) => l.id)).toEqual(['bg']);
		expect(flat.terrain).toBeUndefined();
		expect(flat.sky).toBeUndefined();
		expect(Object.keys(flat.sources)).toEqual(['v']);
		expect(flat.projection).toEqual({ type: 'mercator' });
		expect(flat.pitch).toBe(0);
	});

	it('does not mutate the input style', () => {
		enforce2dStyle(style3d);
		expect(style3d.layers).toHaveLength(3);
		expect(style3d.terrain).toBeDefined();
	});
});

describe('applyHudPalette', () => {
	const omt: StyleSpecification = {
		version: 8,
		sources: { v: { type: 'vector', url: 'https://example.test/tiles.json' } },
		layers: [
			{ id: 'bg', type: 'background', paint: { 'background-color': '#000' } },
			{ id: 'water', type: 'fill', source: 'v', 'source-layer': 'water' },
			{ id: 'wood', type: 'fill', source: 'v', 'source-layer': 'landcover' },
			{ id: 'roads', type: 'line', source: 'v', 'source-layer': 'transportation' }
		]
	};

	it('lifts land above water and fades land-detail fills', () => {
		const [bg, water, wood, roads] = applyHudPalette(omt).layers;
		expect(bg.paint).toEqual({ 'background-color': MAP_COLORS.land });
		expect(water.paint).toEqual({ 'fill-color': MAP_COLORS.water });
		expect(wood.paint).toHaveProperty('fill-opacity');
		expect(roads).toBe(omt.layers[3]);
	});
});

describe('resolveBasemapCandidates', () => {
	it('uses the defaults when no override is set', () => {
		expect(resolveBasemapCandidates(undefined)).toEqual(DEFAULT_BASEMAPS);
	});

	it('tries the override first', () => {
		const [first, ...rest] = resolveBasemapCandidates('https://example.test/style.json');
		expect(first.url).toBe('https://example.test/style.json');
		expect(rest).toEqual(DEFAULT_BASEMAPS);
	});
});

describe('loadBasemapStyle', () => {
	const candidates = [
		{ id: 'a', label: 'A', url: 'https://a.test' },
		{ id: 'b', label: 'B', url: 'https://b.test' }
	];

	it('falls through failing candidates to the first valid style', async () => {
		const fetchFn = (async (url: string) =>
			url === 'https://a.test'
				? jsonResponse({}, 503)
				: jsonResponse(style3d)) as unknown as typeof fetch;
		const result = await loadBasemapStyle(candidates, fetchFn);
		expect(result.basemap.id).toBe('b');
		expect(result.failures).toEqual([{ basemapId: 'a', reason: 'HTTP 503' }]);
		expect(result.style.layers.some((l) => l.type === 'fill-extrusion')).toBe(false);
	});

	it('rejects responses that are not MapLibre styles', async () => {
		const fetchFn = (async () => jsonResponse({ hello: 'world' })) as unknown as typeof fetch;
		const result = await loadBasemapStyle(candidates, fetchFn);
		expect(result.basemap).toBe(OFFLINE_BASEMAP);
		expect(result.failures).toHaveLength(2);
	});

	it('uses the offline style when every candidate is unreachable', async () => {
		const fetchFn = (async () => {
			throw new TypeError('network down');
		}) as unknown as typeof fetch;
		const result = await loadBasemapStyle(candidates, fetchFn);
		expect(result.basemap).toBe(OFFLINE_BASEMAP);
		expect(result.failures.map((f) => f.reason)).toEqual(['network down', 'network down']);
	});
});
