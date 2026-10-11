import { describe, expect, it, vi } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { BASEMAP_PREFIX, OPENFREEMAP_STYLE_URL, loadBasemap } from './basemaps.ts';

function response(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), { status });
}

const streetStyle: StyleSpecification = {
	version: 8,
	glyphs: 'https://tiles.example/fonts/{fontstack}/{range}.pbf',
	sprite: 'https://tiles.example/sprite',
	sources: {
		streets: { type: 'vector', url: 'https://tiles.example/planet' },
		unused: { type: 'raster', tiles: ['https://tiles.example/{z}/{x}/{y}.png'], tileSize: 256 }
	},
	layers: [
		{ id: 'land', type: 'background', paint: { 'background-color': '#fafafa' } },
		{ id: 'roads', type: 'line', source: 'streets', 'source-layer': 'transportation' },
		{ id: 'building', type: 'fill', source: 'streets', 'source-layer': 'building' },
		{ id: '3d-buildings', type: 'fill-extrusion', source: 'streets', 'source-layer': 'building' },
		{ id: 'poi', type: 'circle', source: 'streets', 'source-layer': 'poi' },
		{
			id: 'road-names',
			type: 'symbol',
			source: 'streets',
			'source-layer': 'transportation_name',
			layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'] }
		},
		{
			id: 'road-shields',
			type: 'symbol',
			source: 'streets',
			'source-layer': 'transportation_name',
			layout: { 'text-field': ['get', 'ref'], 'icon-image': 'shield' }
		},
		{
			id: 'town',
			type: 'symbol',
			source: 'streets',
			'source-layer': 'place',
			layout: { 'text-field': ['get', 'name'], 'icon-image': 'citydot', 'icon-size': 0.5 },
			paint: { 'text-color': '#444', 'icon-opacity': 0.7 }
		},
		{
			id: 'airport',
			type: 'symbol',
			source: 'streets',
			'source-layer': 'aerodrome_label',
			layout: { 'text-field': ['get', 'name'], 'icon-image': 'airport' }
		}
	]
};

describe('planning basemaps', () => {
	it('keeps atlas and the keyless satellite definition independent of metadata requests', async () => {
		const fetchFn = vi.fn<typeof fetch>();
		const atlas = await loadBasemap('atlas', { fetchFn });
		const satellite = await loadBasemap('satellite', { fetchFn, maptilerKey: ' ' });
		expect(fetchFn).not.toHaveBeenCalled();
		expect(atlas).toMatchObject({ sources: {}, layers: [], captureAllowed: true });
		expect(satellite.captureAllowed).toBe(false);
		expect(satellite.unavailableReason).toBeUndefined();
	});

	it('uses the verified EOX 2025 Web Mercator template with native zoom and full licensed credits', async () => {
		const result = await loadBasemap('satellite', { maptilerKey: '' });
		const source = result.sources['basemap-satellite'];
		expect(source).toMatchObject({
			type: 'raster',
			tiles: [
				'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg'
			],
			tileSize: 256,
			minzoom: 0,
			maxzoom: 14
		});
		expect(result.layers).toEqual([
			{ id: 'basemap-satellite', type: 'raster', source: 'basemap-satellite' }
		]);
		expect(result.attribution).toContain('https://cloudless.eox.at/');
		expect(result.attribution).toContain('https://eox.at/');
		expect(result.attribution).toContain('EOX IT Services GmbH');
		expect(result.attribution).toContain('Contains modified Copernicus Sentinel data 2025');
		expect(result.attribution).toContain('https://creativecommons.org/licenses/by-nc-sa/4.0/');
		if ('attribution' in source) expect(source.attribution).toBe(result.attribution);
		expect(JSON.stringify(source)).not.toContain('key=');
	});

	it('isolates imported IDs while keeping road names and removing competing POIs and sprite dependencies', async () => {
		const original = structuredClone(streetStyle);
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response(streetStyle));
		const result = await loadBasemap('streets', { fetchFn });
		expect(fetchFn).toHaveBeenCalledWith(
			OPENFREEMAP_STYLE_URL,
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
		expect(result.layers.map((layer) => layer.id)).toEqual([
			'basemap-land',
			'basemap-roads',
			'basemap-building',
			'basemap-road-names',
			'basemap-town'
		]);
		expect(Object.keys(result.sources)).toEqual(['basemap-streets']);
		expect(
			result.layers
				.filter((layer) => 'source' in layer)
				.every(
					(layer) =>
						'source' in layer &&
						layer.source.startsWith(BASEMAP_PREFIX) &&
						!!result.sources[layer.source]
				)
		).toBe(true);
		const town = result.layers.find((layer) => layer.id === 'basemap-town');
		expect(town?.layout).toEqual({ 'text-field': ['get', 'name'] });
		expect(town?.paint).toEqual({ 'text-color': '#444' });
		expect(result.glyphs).toBe(streetStyle.glyphs);
		expect(result.sprite).toBe(streetStyle.sprite);
		expect(result.captureAllowed).toBe(true);
		expect(streetStyle).toEqual(original);
	});

	it.each([
		{ version: 7, sources: {}, layers: [] },
		{ version: 8, sources: {}, layers: [{ id: 'broken', type: 'line', source: 'absent' }] },
		{
			version: 8,
			sources: {},
			layers: [
				{ id: 'same', type: 'background' },
				{ id: 'same', type: 'background' }
			]
		}
	])('rejects malformed styles before a caller replaces its working map', async (payload) => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response(payload));
		await expect(loadBasemap('streets', { fetchFn })).rejects.toThrow(/Street map/);
	});

	it('rejects retained text when its remote font URL is missing', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(response({ ...streetStyle, glyphs: undefined }));
		await expect(loadBasemap('streets', { fetchFn })).rejects.toThrow('fonts');
	});

	it('uses authenticated provider TileJSON and retains its imagery credits without allowing screenshot export', async () => {
		const imageryCredits = '© Imagery provider';
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
			response({
				tiles: ['https://api.maptiler.com/tiles/satellite-v4/{z}/{x}/{y}.jpg?key=a%2Bb'],
				attribution: imageryCredits,
				minzoom: 0,
				maxzoom: 20,
				bounds: [-180, -85, 180, 85]
			})
		);
		const result = await loadBasemap('satellite', { fetchFn, maptilerKey: 'a+b' });
		expect(fetchFn.mock.calls[0][0]).toBe(
			'https://api.maptiler.com/tiles/satellite-v4/tiles.json?key=a%2Bb'
		);
		expect(result.sources['basemap-satellite']).toMatchObject({
			type: 'raster',
			tileSize: 256,
			attribution: imageryCredits,
			minzoom: 0,
			maxzoom: 20
		});
		expect(result.layers).toEqual([
			{ id: 'basemap-satellite', type: 'raster', source: 'basemap-satellite' }
		]);
		expect(result.attribution).toContain(imageryCredits);
		expect(result.attribution).toContain('MapTiler');
		expect(result.attribution).not.toContain('EOxCloudless');
		expect(result.captureAllowed).toBe(false);
	});

	it('rejects missing satellite credits and redacts provider keys from failed fetches', async () => {
		const noCredits = vi
			.fn<typeof fetch>()
			.mockResolvedValue(response({ tiles: ['https://tiles.example/{z}/{x}/{y}.jpg'] }));
		await expect(
			loadBasemap('satellite', { fetchFn: noCredits, maptilerKey: 'secret' })
		).rejects.toThrow('attribution');
		const unauthorized = vi.fn<typeof fetch>().mockResolvedValue(response({}, 403));
		await expect(
			loadBasemap('satellite', { fetchFn: unauthorized, maptilerKey: 'secret' })
		).rejects.toThrow('HTTP 403');
		const rejected = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new Error('Failed https://example.test/?key=secret'));
		await expect(
			loadBasemap('satellite', { fetchFn: rejected, maptilerKey: 'secret' })
		).rejects.toThrow('Check your connection');
		await expect(
			loadBasemap('satellite', { fetchFn: rejected, maptilerKey: 'secret' })
		).rejects.not.toThrow('secret');
	});
});
