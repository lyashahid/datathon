import type { InfrastructureType, Provenance, TransportMode } from '#lib/types/domain.ts';
import type { AssetStateLabel } from '#lib/simulator/assetState.ts';
import type { LayerId } from '#lib/types/ui.ts';
import type { MarkerShape } from '#lib/utils/markerShapes.ts';

export interface InfrastructureTypeStyle {
	label: string;
	/** Sidebar layer toggle controlling this type's visibility. */
	layerId: LayerId;
	shape: MarkerShape;
	color: string;
	/** Marker diameter in CSS pixels. */
	sizePx: number;
}

/** Shape and colour both differ per type so categories stay distinguishable without colour. */
export const INFRASTRUCTURE_TYPE_STYLES: Record<InfrastructureType, InfrastructureTypeStyle> = {
	bus_stop: {
		label: 'Bus stop',
		layerId: 'busStops',
		shape: 'circle',
		color: '#60a5fa',
		sizePx: 11
	},
	bus_terminal: {
		label: 'Bus terminal',
		layerId: 'busTerminals',
		shape: 'square',
		color: '#3b82f6',
		sizePx: 15
	},
	ferry_terminal: {
		label: 'Ferry terminal',
		layerId: 'ferryTerminals',
		shape: 'diamond',
		color: '#2dd4bf',
		sizePx: 17
	},
	airport: {
		label: 'Airport',
		layerId: 'airports',
		shape: 'triangle',
		color: '#c084fc',
		sizePx: 20
	},
	hospital: {
		label: 'Hospital',
		layerId: 'hospitals',
		shape: 'plus',
		color: '#f87171',
		sizePx: 18
	},
	school: { label: 'School', layerId: 'schools', shape: 'pentagon', color: '#fbbf24', sizePx: 15 },
	government_service: {
		label: 'Government service',
		layerId: 'governmentServices',
		shape: 'hexagon',
		color: '#a3e635',
		sizePx: 15
	}
};

export interface RouteModeStyle {
	label: string;
	layerId: LayerId;
	color: string;
	widthPx: number;
	/** MapLibre line-dasharray in line-width units; omitted for solid lines. */
	dash?: readonly number[];
}

export const ROUTE_MODE_STYLES: Record<TransportMode, RouteModeStyle> = {
	bus: { label: 'Bus route', layerId: 'busRoutes', color: '#60a5fa', widthPx: 2.5 },
	ferry: {
		label: 'Ferry route',
		layerId: 'ferryRoutes',
		color: '#2dd4bf',
		widthPx: 2,
		dash: [2, 1.5]
	}
};

export const STATE_LABELS: Record<AssetStateLabel, string> = {
	existing: 'Existing',
	proposed: 'Proposed',
	moved: 'Moved',
	disabled: 'Disabled'
};

export const PROVENANCE_LABELS: Record<Provenance, string> = {
	observed: 'Observed',
	demo: 'Demo data',
	assumed: 'Assumption',
	simulated: 'Simulated'
};

/** Display labels for known metadata keys; unknown keys are humanised automatically. */
export const METADATA_LABELS: Readonly<Record<string, string>> = {
	island: 'Island',
	atoll: 'Atoll / city',
	operator: 'Operator',
	road: 'Road',
	shelter: 'Shelter',
	dailyBoardings: 'Daily boardings',
	bays: 'Bays',
	dailyDepartures: 'Daily departures',
	berths: 'Berths',
	dailyPassengers: 'Daily passengers',
	iataCode: 'IATA code',
	icaoCode: 'ICAO code',
	annualPassengers: 'Annual passengers',
	beds: 'Beds',
	emergencyDepartment: 'Emergency dept.',
	level: 'Level',
	students: 'Students',
	services: 'Services',
	headwayMinutes: 'Headway (min)',
	crossingMinutes: 'Crossing (min)'
};
