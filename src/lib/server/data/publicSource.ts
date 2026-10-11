import type {
	InfrastructureCollection,
	InfrastructureFeature,
	RouteCollection,
	TransportRoute
} from '#lib/types/domain.ts';
import { loadPlanningBaseline } from './planningSource.ts';
import type { BaselineSource } from './baselineSource.ts';

/** Compatibility projection of the versioned bundle; no synthetic records are introduced. */
async function load() {
	const { bundle } = await loadPlanningBaseline();
	const source = {
		provenance: 'observed' as const,
		dataset: bundle.version,
		syntheticFields: [],
		note: 'Public source snapshot; map positions are operator / OSM-derived. Read the planning manifest for coverage and validity.'
	};
	const features: InfrastructureFeature[] = [
		...bundle.transit.stops.map((stop) => ({
			id: stop.id,
			name: stop.name,
			type: 'bus_stop' as const,
			status: 'existing' as const,
			geometry: { type: 'Point' as const, coordinates: [stop.lon, stop.lat] as [number, number] },
			source,
			metadata: { island: stop.islandId, operator: 'RTL / MTCC' }
		})),
		...bundle.facilities.map((facility) => ({
			id: facility.id,
			name: facility.name,
			type:
				facility.kind === 'school' || facility.kind === 'college'
					? ('school' as const)
					: ('hospital' as const),
			status: 'existing' as const,
			geometry: {
				type: 'Point' as const,
				coordinates: [facility.lon, facility.lat] as [number, number]
			},
			source,
			metadata: {
				island: facility.islandId,
				category: facility.kind,
				verification: String(facility.verification ?? 'OSM')
			}
		}))
	];
	const rawRoutes = (
		'routes' in bundle.transit ? bundle.transit.routes : bundle.transit.patterns
	) as {
		id: string;
		name: string;
		mode: 'bus' | 'ferry';
		geometry: [number, number][];
		stopIds: string[];
	}[];
	const routes: TransportRoute[] = rawRoutes
		.filter((route) => Array.isArray(route.geometry) && route.geometry.length > 1)
		.map((route) => ({
			id: route.id,
			name: route.name,
			mode: route.mode,
			status: 'existing',
			geometry: { type: 'LineString', coordinates: route.geometry },
			stopIds: route.stopIds,
			source,
			metadata: {
				operator: 'RTL / MTCC',
				timetable:
					'See planning service patterns; a displayed route does not establish scheduled service.'
			}
		}));
	const dataset = {
		id: bundle.version,
		title: 'Greater Malé public planning snapshot',
		version: bundle.version,
		provenance: 'observed' as const,
		description:
			'Public infrastructure / routes projection. Population allocation, assumptions and gaps are in /api/planning-baseline.'
	};
	return {
		infrastructure: { dataset, features } satisfies InfrastructureCollection,
		routes: { dataset, routes } satisfies RouteCollection
	};
}

export const publicBaselineSource: BaselineSource = {
	getInfrastructure: async () => (await load()).infrastructure,
	getRoutes: async () => (await load()).routes
};
