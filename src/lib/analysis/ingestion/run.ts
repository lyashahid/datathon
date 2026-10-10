import { INGESTION_RULES } from '#lib/config/ingestion.ts';
import type {
	DatasetInfo,
	InfrastructureCollection,
	InfrastructureFeature,
	RouteCollection
} from '#lib/types/domain.ts';
import { haversineM } from '../geo.ts';
import { parseCsv } from './csv.ts';
import { ingestDemographics, type DemographicColumns } from './demographics.ts';
import { ingestEssentialServices, type ServiceColumns } from './essentialServices.ts';
import { ingestOsmInfrastructure } from './osmInfrastructure.ts';
import { ingestTransportRoutes, pruneUnknownStops } from './transportRoutes.ts';
import type {
	AdapterOptions,
	Crs,
	DemographicCollection,
	IslandResolver,
	ValidationReport
} from './types.ts';

export type SourceSpec =
	| { adapter: 'osm-infrastructure'; file: string; crs: Crs }
	| { adapter: 'essential-services'; file: string; crs: Crs; columns?: ServiceColumns }
	| { adapter: 'transport-routes'; file: string; crs: Crs }
	| { adapter: 'census-style-demographics'; file: string; crs: Crs; columns?: DemographicColumns };

/** Declares what to import. Lives next to the raw files; see docs/data-model.md. */
export interface IngestionManifest {
	dataset: DatasetInfo;
	sources: SourceSpec[];
}

export interface CrossCheck {
	/** Same facility imported from two sources; the earlier source in the manifest wins. */
	duplicatesAcrossSources: string[];
	/** Route stop ids that matched no imported facility (removed from the route). */
	unknownRouteStops: number;
}

export interface IngestionOutput {
	infrastructure: InfrastructureCollection;
	routes: RouteCollection;
	demographics: DemographicCollection;
	reports: ValidationReport[];
	crossCheck: CrossCheck;
}

function mergeInfrastructure(groups: InfrastructureFeature[][]) {
	const merged: InfrastructureFeature[] = [];
	const duplicates: string[] = [];
	for (const group of groups) {
		for (const f of group) {
			const twin = merged.find(
				(m) =>
					m.id === f.id ||
					(m.type === f.type &&
						haversineM(m.geometry.coordinates, f.geometry.coordinates) <
							INGESTION_RULES.duplicateDistanceM)
			);
			if (twin) duplicates.push(`${f.name} [${f.id}] = ${twin.name} [${twin.id}]`);
			else merged.push(f);
		}
	}
	return { merged, duplicates };
}

/**
 * Runs every source in the manifest through its adapter and merges the results. Pure: file
 * access is injected, so the same code runs in the CLI and in tests.
 */
export function runIngestion(
	manifest: IngestionManifest,
	readFile: (file: string) => string,
	islandAt?: IslandResolver
): IngestionOutput {
	const reports: ValidationReport[] = [];
	const infrastructureGroups: InfrastructureFeature[][] = [];
	const routes: RouteCollection['routes'][number][] = [];
	const demographics: DemographicCollection['records'] = [];

	for (const spec of manifest.sources) {
		const opts: AdapterOptions = {
			source: spec.file,
			crs: spec.crs,
			dataset: manifest.dataset.id,
			provenance: manifest.dataset.provenance,
			islandAt
		};
		const content = readFile(spec.file);
		if (spec.adapter === 'osm-infrastructure') {
			const r = ingestOsmInfrastructure(JSON.parse(content), opts);
			infrastructureGroups.push(r.records);
			reports.push(r.report);
		} else if (spec.adapter === 'essential-services') {
			const r = ingestEssentialServices(parseCsv(content), opts, spec.columns);
			infrastructureGroups.push(r.records);
			reports.push(r.report);
		} else if (spec.adapter === 'transport-routes') {
			const r = ingestTransportRoutes(JSON.parse(content), opts);
			routes.push(...r.records);
			reports.push(r.report);
		} else {
			const r = ingestDemographics(parseCsv(content), opts, spec.columns);
			demographics.push(...r.records);
			reports.push(r.report);
		}
	}

	const { merged, duplicates } = mergeInfrastructure(infrastructureGroups);
	const pruned = pruneUnknownStops(routes, new Set(merged.map((f) => f.id)));
	return {
		infrastructure: { dataset: manifest.dataset, features: merged },
		routes: { dataset: manifest.dataset, routes: pruned.routes },
		demographics: { dataset: manifest.dataset, records: demographics },
		reports,
		crossCheck: { duplicatesAcrossSources: duplicates, unknownRouteStops: pruned.removed }
	};
}

/** Same FeatureCollection shape as data/sample, so the existing decoders read it unchanged. */
export function infrastructureToGeoJSON({ dataset, features }: InfrastructureCollection) {
	return {
		type: 'FeatureCollection',
		dataset,
		features: features.map(({ id, geometry, ...properties }) => ({
			type: 'Feature',
			id,
			geometry,
			properties
		}))
	};
}

export function routesToGeoJSON({ dataset, routes }: RouteCollection) {
	return {
		type: 'FeatureCollection',
		dataset,
		features: routes.map(({ id, geometry, ...properties }) => ({
			type: 'Feature',
			id,
			geometry,
			properties
		}))
	};
}
