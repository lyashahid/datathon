import { NEARBY } from '#lib/config/analysis.ts';
import type { NearbyFacility, NearbyServices } from '#lib/types/analysis.ts';
import type { InfrastructureFeature, InfrastructureType } from '#lib/types/domain.ts';
import { haversineM } from './geo.ts';
import { walkMinutes } from './walk.ts';

export const TRANSPORT_TYPES: readonly InfrastructureType[] = [
	'bus_stop',
	'bus_terminal',
	'ferry_terminal',
	'airport'
];

export function sameIsland(a: InfrastructureFeature, b: InfrastructureFeature): boolean {
	return a.metadata.island !== undefined && a.metadata.island === b.metadata.island;
}

/** Every other facility, nearest first, with straight-line distance and walk time. */
export function facilitiesByDistance(
	origin: InfrastructureFeature,
	all: readonly InfrastructureFeature[]
): NearbyFacility[] {
	return all
		.filter((f) => f.id !== origin.id && f.status !== 'disabled')
		.map((f) => {
			const distanceM = haversineM(origin.geometry.coordinates, f.geometry.coordinates);
			const island = sameIsland(origin, f);
			return {
				id: f.id,
				name: f.name,
				type: f.type,
				distanceM,
				sameIsland: island,
				walkMinutes: island ? walkMinutes(distanceM) : null
			};
		})
		.sort((a, b) => a.distanceM - b.distanceM || a.id.localeCompare(b.id));
}

export function findNearbyServices(
	origin: InfrastructureFeature,
	all: readonly InfrastructureFeature[]
): Omit<NearbyServices, 'provenance'> {
	const inRange = facilitiesByDistance(origin, all).filter(
		(f) => f.distanceM <= NEARBY.searchRadiusM
	);
	const pick = (types: readonly InfrastructureType[]) =>
		inRange.filter((f) => types.includes(f.type)).slice(0, NEARBY.maxPerCategory);
	return {
		hospitals: pick(['hospital']),
		schools: pick(['school']),
		transport: pick(TRANSPORT_TYPES),
		searchRadiusM: NEARBY.searchRadiusM
	};
}
