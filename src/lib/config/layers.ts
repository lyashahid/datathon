import {
	CloudSun,
	GraduationCap,
	HeartPulse,
	Layers,
	MessageSquareText,
	Ship,
	Users
} from '@lucide/svelte';
import type { LayerGroup, LayerGroupId, LayerId } from '#lib/types/ui.ts';
import { OBSERVATION_LAYER_ID } from './feedback.ts';

/**
 * Sidebar layer catalogue. Layers are UI toggles only at this stage;
 * map rendering binds to these ids once the map is integrated.
 */
export const LAYER_GROUPS: readonly LayerGroup[] = [
	{
		id: 'mapLayers',
		label: 'Map Layers',
		icon: Layers,
		layers: [
			{ id: 'basemap', label: 'Basemap', defaultVisible: true },
			{ id: 'islandOutlines', label: 'Island outlines', defaultVisible: true },
			{ id: 'atollLabels', label: 'Atoll labels', defaultVisible: true },
			{ id: 'h3Grid', label: 'H3 grid', defaultVisible: false },
			{ id: 'governmentServices', label: 'Government services', defaultVisible: true }
		]
	},
	{
		id: 'population',
		label: 'Population',
		icon: Users,
		layers: [
			{ id: 'populationDensity', label: 'Population density', defaultVisible: false },
			{ id: 'settlements', label: 'Inhabited islands', defaultVisible: true }
		]
	},
	{
		id: 'transport',
		label: 'Transport',
		icon: Ship,
		layers: [
			{ id: 'busStops', label: 'Bus stops', defaultVisible: true },
			{ id: 'busTerminals', label: 'Bus terminals', defaultVisible: true },
			{ id: 'busRoutes', label: 'Bus routes', defaultVisible: true },
			{ id: 'ferryTerminals', label: 'Ferry terminals', defaultVisible: true },
			{ id: 'ferryRoutes', label: 'Ferry routes', defaultVisible: true },
			{ id: 'airports', label: 'Airports', defaultVisible: true }
		]
	},
	{
		id: 'health',
		label: 'Health',
		icon: HeartPulse,
		layers: [
			{ id: 'hospitals', label: 'Hospitals', defaultVisible: true },
			{ id: 'healthCentres', label: 'Health centres', defaultVisible: false },
			{ id: 'healthAccess', label: 'Healthcare access', defaultVisible: false }
		]
	},
	{
		id: 'education',
		label: 'Education',
		icon: GraduationCap,
		layers: [
			{ id: 'schools', label: 'Schools', defaultVisible: true },
			{ id: 'schoolAccess', label: 'School access', defaultVisible: false }
		]
	},
	{
		id: 'weather',
		label: 'Weather',
		icon: CloudSun,
		layers: [
			{ id: 'wind', label: 'Wind', defaultVisible: false },
			{ id: 'waveHeight', label: 'Wave height', defaultVisible: false },
			{ id: 'rainfall', label: 'Rainfall', defaultVisible: false }
		]
	},
	{
		id: 'localObservations',
		label: 'Local Observations',
		icon: MessageSquareText,
		layers: [{ id: OBSERVATION_LAYER_ID, label: 'Observations', defaultVisible: true }]
	}
];

export const DEFAULT_EXPANDED_GROUPS: readonly LayerGroupId[] = ['mapLayers', 'transport'];

export function defaultVisibleLayerIds(): LayerId[] {
	return LAYER_GROUPS.flatMap((g) => g.layers.filter((l) => l.defaultVisible).map((l) => l.id));
}
