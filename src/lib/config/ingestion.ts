import type { InfrastructureType, TransportMode } from '#lib/types/domain.ts';

/**
 * OSM tag → canonical type, checked in order (first match wins). Only tags with a clear
 * meaning are mapped; anything else is rejected and counted, never guessed.
 */
export const OSM_TAG_RULES: readonly { type: InfrastructureType; key: string; value: string }[] = [
	{ type: 'bus_terminal', key: 'amenity', value: 'bus_station' },
	{ type: 'bus_stop', key: 'highway', value: 'bus_stop' },
	{ type: 'ferry_terminal', key: 'amenity', value: 'ferry_terminal' },
	{ type: 'airport', key: 'aeroway', value: 'aerodrome' },
	{ type: 'hospital', key: 'amenity', value: 'hospital' },
	{ type: 'school', key: 'amenity', value: 'school' },
	{ type: 'government_service', key: 'amenity', value: 'townhall' },
	{ type: 'government_service', key: 'office', value: 'government' }
];

/** Category labels accepted for essential services tables, normalised to lower case. */
export const SERVICE_CATEGORIES: Record<string, InfrastructureType> = {
	hospital: 'hospital',
	'regional hospital': 'hospital',
	school: 'school',
	'primary school': 'school',
	'secondary school': 'school',
	'government office': 'government_service',
	council: 'government_service'
};

export const ROUTE_MODES: Record<string, TransportMode> = {
	bus: 'bus',
	ferry: 'ferry',
	boat: 'ferry'
};

export const INGESTION_RULES = {
	/** Same-type facilities closer than this are one facility mapped twice (e.g. node + area). */
	duplicateDistanceM: 25,
	/** Allowed gap between age groups and total population before a record is inconsistent. */
	populationSumTolerance: 0.02,
	/** Coordinate precision kept in output (~1 m). */
	coordinateDecimals: 6
} as const;
