import { describe, expect, it } from 'vitest';
import manifestRaw from '../../../../data/fixtures/ingestion/manifest.json?raw';
import osmRaw from '../../../../data/fixtures/ingestion/osm-overpass.json?raw';
import servicesRaw from '../../../../data/fixtures/ingestion/services.csv?raw';
import routesRaw from '../../../../data/fixtures/ingestion/routes.geojson?raw';
import demographicsRaw from '../../../../data/fixtures/ingestion/demographics.csv?raw';
import processedInfraRaw from '../../../../data/processed/infrastructure.geojson?raw';
import processedRoutesRaw from '../../../../data/processed/routes.geojson?raw';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import { assertRouteStopsExist, decodeRouteCollection } from '#lib/data/routes.ts';
import { haversineM } from '../geo.ts';
import { demoIslandAt } from '../h3DemoData.ts';
import { toWgs84, wgs84ToUtm43 } from './crs.ts';
import { parseCsv } from './csv.ts';
import { ingestDemographics } from './demographics.ts';
import { ingestEssentialServices } from './essentialServices.ts';
import { ingestOsmInfrastructure } from './osmInfrastructure.ts';
import {
	infrastructureToGeoJSON,
	routesToGeoJSON,
	runIngestion,
	type IngestionManifest
} from './run.ts';
import { ingestTransportRoutes } from './transportRoutes.ts';
import type { AdapterOptions } from './types.ts';

const FILES: Record<string, string> = {
	'osm-overpass.json': osmRaw,
	'services.csv': servicesRaw,
	'routes.geojson': routesRaw,
	'demographics.csv': demographicsRaw
};
const manifest = JSON.parse(manifestRaw) as IngestionManifest;
const islandAt: AdapterOptions['islandAt'] = (p) => {
	const island = demoIslandAt(p);
	return island ? { island, atoll: null } : null;
};
const opts = (source: string, crs: AdapterOptions['crs'] = 'EPSG:4326'): AdapterOptions => ({
	source,
	crs,
	dataset: 'test',
	provenance: 'demo',
	islandAt
});

describe('CRS', () => {
	it('round-trips UTM 43N to well under a metre', () => {
		const male: [number, number] = [73.5093, 4.1755];
		const utm = wgs84ToUtm43(male);
		expect(utm[0]).toBeGreaterThan(334_000);
		expect(utm[0]).toBeLessThan(335_500);
		expect(haversineM(toWgs84(utm, 'EPSG:32643')!, male)).toBeLessThan(0.01);
	});

	it('converts Web Mercator and rejects non-numbers', () => {
		const [lng, lat] = toWgs84([8_183_000, 465_000], 'EPSG:3857')!;
		expect(lng).toBeCloseTo(73.51, 2);
		expect(lat).toBeCloseTo(4.17, 2);
		expect(toWgs84(['x', 1], 'EPSG:4326')).toBeNull();
	});
});

describe('parseCsv', () => {
	it('handles quotes, escaped quotes, CRLF and blank lines', () => {
		const rows = parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n\r\n1,\n');
		expect(rows).toEqual([
			{ a: 'x, y', b: 'say "hi"' },
			{ a: '1', b: '' }
		]);
	});
});

describe('OSM infrastructure adapter', () => {
	const { records, report } = ingestOsmInfrastructure(JSON.parse(osmRaw), opts('osm'));

	it('maps tags to canonical types and keeps OSM references', () => {
		const byId = new Map(records.map((r) => [r.id, r]));
		expect(byId.get('osm-node-1008')?.type).toBe('bus_terminal');
		expect(byId.get('osm-way-2002')?.type).toBe('airport');
		expect(byId.get('osm-node-1003')?.source.reference).toBe(
			'https://www.openstreetmap.org/node/1003'
		);
		expect(byId.get('osm-node-1003')?.metadata.island).toBe('Malé');
	});

	it('reports every rejection instead of failing', () => {
		expect(report).toMatchObject({ processed: 11, accepted: 7, rejected: 4 });
		expect(report.invalidGeometry).toBe(1); // latitude 95
		expect(report.invalidValues).toBe(1); // cafe
		expect(report.duplicates).toBe(1); // hospital node + its building outline
		expect(report.missingFields.tags).toBe(1);
		expect(report.accepted + report.rejected).toBe(report.processed);
	});

	it('names unnamed features descriptively and flags the gap', () => {
		expect(records.find((r) => r.id === 'osm-node-1002')?.name).toBe('Bus stop (OSM node 1002)');
		expect(report.missingFields.name).toBe(1);
	});

	it('reads OSM GeoJSON exports too', () => {
		const geojson = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					id: 'node/5',
					properties: { highway: 'bus_stop', name: 'Stop' },
					geometry: { type: 'Point', coordinates: [73.505, 4.1737] }
				}
			]
		};
		expect(ingestOsmInfrastructure(geojson, opts('geo')).records[0].id).toBe('osm-node-5');
	});
});

describe('essential services adapter', () => {
	const { records, report } = ingestEssentialServices(
		parseCsv(servicesRaw),
		opts('svc', 'EPSG:32643')
	);

	it('transforms UTM coordinates to WGS84', () => {
		const hospital = records.find((r) => r.id === 'svc-s1')!;
		expect(hospital.type).toBe('hospital');
		expect(hospital.geometry.coordinates[0]).toBeCloseTo(73.5405, 4);
		expect(hospital.geometry.coordinates[1]).toBeCloseTo(4.2155, 4);
	});

	it('rejects unsupported categories and incomplete rows', () => {
		expect(report).toMatchObject({ processed: 7, accepted: 4, rejected: 3, invalidValues: 1 });
		expect(report.missingFields).toMatchObject({ coordinates: 1, name: 1 });
	});
});

describe('demographics adapter', () => {
	const { records, report } = ingestDemographics(parseCsv(demographicsRaw), opts('demo'));

	it('accepts consistent areas and keeps optional gaps as nulls', () => {
		expect(records.map((r) => r.areaId)).toEqual(['A01', 'A02', 'A03', 'A04']);
		expect(records[1].households).toBeNull();
		expect(records[0].centroid).toEqual([73.5035, 4.1745]);
	});

	it('rejects inconsistent totals, negative counts, repeats and missing islands', () => {
		expect(report).toMatchObject({ rejected: 4, invalidValues: 2, duplicates: 1 });
		expect(report.missingFields).toMatchObject({ island: 1, households: 1 });
	});

	it('works with a different column layout through a column map', () => {
		const rows = parseCsv('ID,ISL,POP\nX1,Malé,120\n');
		const r = ingestDemographics(rows, opts('alt'), {
			areaId: 'ID',
			island: 'ISL',
			population: 'POP'
		});
		expect(r.records[0]).toMatchObject({ areaId: 'X1', population: 120, children: null });
	});
});

describe('routes adapter', () => {
	const { records, report } = ingestTransportRoutes(JSON.parse(routesRaw), opts('routes'));

	it('accepts lines, reads OSM route tags and rejects bad geometry, modes and copies', () => {
		expect(records.map((r) => [r.id, r.mode])).toEqual([
			['rt-male-loop', 'bus'],
			['rt-male-villimale-ferry', 'ferry']
		]);
		expect(report).toMatchObject({ invalidGeometry: 1, invalidValues: 1, duplicates: 1 });
		// The rejected copy's missing stops are not reported: only accepted records warn.
		expect(report.missingFields.stop_ids).toBeUndefined();
	});
});

describe('runIngestion', () => {
	const output = runIngestion(manifest, (f) => FILES[f], islandAt);

	it('merges sources, drops cross-source duplicates and unknown route stops', () => {
		expect(output.crossCheck.duplicatesAcrossSources).toHaveLength(1);
		expect(output.crossCheck.unknownRouteStops).toBe(1);
		const ids = new Set(output.infrastructure.features.map((f) => f.id));
		expect(ids.has('svc-s3')).toBe(false);
		for (const r of output.routes.routes) for (const s of r.stopIds) expect(ids.has(s)).toBe(true);
	});

	it('produces output the app decoders accept unchanged', () => {
		const infra = decodeInfrastructureCollection(
			JSON.parse(JSON.stringify(infrastructureToGeoJSON(output.infrastructure)))
		);
		const routes = decodeRouteCollection(
			JSON.parse(JSON.stringify(routesToGeoJSON(output.routes)))
		);
		expect(() => assertRouteStopsExist(routes.routes, infra.features)).not.toThrow();
		expect(infra.dataset.provenance).toBe('demo');
	});

	it('matches the committed data/processed output (run `npm run ingest` after changes)', () => {
		expect(JSON.parse(processedInfraRaw)).toEqual(
			JSON.parse(JSON.stringify(infrastructureToGeoJSON(output.infrastructure)))
		);
		expect(JSON.parse(processedRoutesRaw)).toEqual(
			JSON.parse(JSON.stringify(routesToGeoJSON(output.routes)))
		);
	});
});
