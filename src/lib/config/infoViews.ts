import { IMPACT_COLORS, IMPACT_CONFIG } from './impact.ts';
import { SEA_STATES } from './weather.ts';
import type {
	CellValueSource,
	EnvironmentMetric,
	H3Cell,
	H3ExternalKey,
	InfoViewId,
	InfoViewMetric
} from '#lib/types/h3.ts';
import type { SampleKind } from '#lib/types/weather.ts';

export interface ColorScale {
	kind: 'sequential' | 'diverging';
	/** Ascending [value, colour] stops; values outside are clamped to the end colours. */
	stops: readonly (readonly [number, string])[];
}

interface InfoViewBase {
	id: InfoViewId;
	label: string;
	/** Compact label for the toolbar palette. */
	shortLabel: string;
	unit: string;
	description: string;
	scale: ColorScale;
	/** Higher values are better (accessibility) or worse (underserved); drives legend wording. */
	higherIs: 'better' | 'worse' | 'neutral';
}

/** Analytical views over the H3 grid: demo demographics and simulation outputs. */
export interface GridInfoView extends InfoViewBase {
	layer: 'grid';
	metric: InfoViewMetric;
	/** For change metrics: which comparison supplies the values. */
	compare?: 'scenario' | 'disruption';
}

/** Live forecast views over the coarse weather sample grid. Never feed accessibility scores. */
export interface EnvironmentInfoView extends InfoViewBase {
	layer: 'environment';
	metric: EnvironmentMetric;
	sample: SampleKind;
	/** Discrete classes (e.g. sea state); when present the map uses steps, not a ramp. */
	categories?: readonly { label: string; min: number; color: string }[];
}

export type InfoViewDefinition = GridInfoView | EnvironmentInfoView;

/** Red→yellow→blue diverging around the midpoint; distinguishable with common colour-vision deficiencies. */
const ACCESS_SCALE: ColorScale = {
	kind: 'diverging',
	stops: [
		[0, '#d73027'],
		[25, '#fc8d59'],
		[50, '#fee090'],
		[75, '#91bfdb'],
		[100, '#4575b4']
	]
};

export const INFO_VIEWS: readonly InfoViewDefinition[] = [
	{
		id: 'populationDensity',
		layer: 'grid',
		label: 'Population Density',
		shortLabel: 'Density',
		metric: 'populationDensity',
		unit: 'residents/km²',
		description: 'Demo residents per km², spread over each island with denser interiors.',
		higherIs: 'neutral',
		scale: {
			kind: 'sequential',
			stops: [
				[0, '#2a1b3d'],
				[5_000, '#5b2a6e'],
				[20_000, '#a3376b'],
				[35_000, '#e8684a'],
				[50_000, '#fbd46d']
			]
		}
	},
	{
		id: 'transportAccessibility',
		layer: 'grid',
		label: 'Transport Accessibility',
		shortLabel: 'Transport',
		metric: 'transportAccessibility',
		unit: 'score',
		description:
			'Straight-line proximity to bus stops, ferry and bus terminals on the same island (0–100).',
		higherIs: 'better',
		scale: ACCESS_SCALE
	},
	{
		id: 'healthAccessibility',
		layer: 'grid',
		label: 'Health Accessibility',
		shortLabel: 'Health',
		metric: 'healthAccessibility',
		unit: 'score',
		description:
			'Straight-line proximity to the nearest hospital; other islands via ferry (0–100).',
		higherIs: 'better',
		scale: ACCESS_SCALE
	},
	{
		id: 'educationAccessibility',
		layer: 'grid',
		label: 'Education Accessibility',
		shortLabel: 'Education',
		metric: 'educationAccessibility',
		unit: 'score',
		description: 'Straight-line proximity to the nearest school; other islands via ferry (0–100).',
		higherIs: 'better',
		scale: ACCESS_SCALE
	},
	{
		id: 'underservedPopulation',
		layer: 'grid',
		label: 'Underserved Population',
		shortLabel: 'Underserved',
		metric: 'underservedPopulation',
		unit: 'residents',
		description: 'Residents weighted by how far overall access falls below the threshold.',
		higherIs: 'worse',
		scale: {
			kind: 'sequential',
			stops: [
				[0, '#1f2933'],
				[1, '#7c2d12'],
				[3, '#c2410c'],
				[6, '#f97316'],
				[12, '#fde68a']
			]
		}
	},
	{
		id: 'scenarioImpact',
		layer: 'grid',
		label: 'Scenario Impact',
		shortLabel: 'Impact',
		metric: 'overallChange',
		compare: 'scenario',
		unit: 'points',
		description: `Change in overall accessibility versus baseline. Grey = within ±${IMPACT_CONFIG.changeThresholdPoints} points (effectively unchanged).`,
		higherIs: 'better',
		scale: {
			kind: 'diverging',
			// Flat grey across ± the threshold so sub-threshold noise never reads as change.
			stops: [
				[-30, IMPACT_COLORS.strongLoss],
				[-10, IMPACT_COLORS.loss],
				[-IMPACT_CONFIG.changeThresholdPoints, IMPACT_COLORS.neutral],
				[IMPACT_CONFIG.changeThresholdPoints, IMPACT_COLORS.neutral],
				[10, IMPACT_COLORS.gain],
				[30, IMPACT_COLORS.strongGain]
			]
		}
	},
	{
		id: 'disruptionImpact',
		layer: 'grid',
		label: 'Disruption Impact',
		shortLabel: 'Disruption',
		metric: 'overallChange',
		compare: 'disruption',
		unit: 'points',
		description: `Change in overall accessibility under the selected planning disruption versus normal operations. Grey = within ±${IMPACT_CONFIG.changeThresholdPoints} points.`,
		higherIs: 'better',
		scale: {
			kind: 'diverging',
			stops: [
				[-60, IMPACT_COLORS.strongLoss],
				[-15, IMPACT_COLORS.loss],
				[-IMPACT_CONFIG.changeThresholdPoints, IMPACT_COLORS.neutral],
				[IMPACT_CONFIG.changeThresholdPoints, IMPACT_COLORS.neutral],
				[15, IMPACT_COLORS.gain],
				[60, IMPACT_COLORS.strongGain]
			]
		}
	},
	{
		id: 'closureExposure',
		layer: 'grid',
		label: 'Closure Exposure',
		shortLabel: 'Exposure',
		metric: 'closureExposure',
		unit: 'points lost',
		description:
			'Largest drop in overall accessibility this area would suffer if any one facility closed. High values mark single points of failure.',
		higherIs: 'worse',
		scale: {
			kind: 'sequential',
			stops: [
				[0, '#1e293b'],
				[5, '#facc15'],
				[15, '#f97316'],
				[30, '#ef4444'],
				[60, '#7f1d1d']
			]
		}
	},
	{
		id: 'rain',
		layer: 'environment',
		sample: 'weather',
		label: 'Rain',
		shortLabel: 'Rain',
		metric: 'precipitationMm',
		unit: 'mm (current)',
		description: 'Forecast precipitation for the current interval, on a coarse ~9 km sample grid.',
		higherIs: 'neutral',
		scale: {
			kind: 'sequential',
			stops: [
				[0, '#1e293b'],
				[0.1, '#7dd3fc'],
				[1, '#38bdf8'],
				[4, '#2563eb'],
				[10, '#7c3aed']
			]
		}
	},
	{
		id: 'wind',
		layer: 'environment',
		sample: 'weather',
		label: 'Wind',
		shortLabel: 'Wind',
		metric: 'windSpeedKph',
		unit: 'km/h',
		description: 'Forecast 10 m wind; arrows point downwind, colour shows speed.',
		higherIs: 'neutral',
		scale: {
			kind: 'sequential',
			stops: [
				[0, '#94a3b8'],
				[10, '#5eead4'],
				[25, '#facc15'],
				[40, '#f97316'],
				[60, '#dc2626']
			]
		}
	},
	{
		id: 'marineConditions',
		layer: 'environment',
		sample: 'marine',
		label: 'Marine Conditions',
		shortLabel: 'Marine',
		metric: 'waveHeightM',
		unit: 'm wave height',
		description: 'Forecast significant wave height by Douglas sea state, ~9 km sample grid.',
		higherIs: 'neutral',
		scale: { kind: 'sequential', stops: SEA_STATES.map((s) => [s.minM, s.color] as const) },
		categories: SEA_STATES.map((s) => ({ label: s.label, min: s.minM, color: s.color }))
	}
];

export function getInfoView(id: InfoViewId): InfoViewDefinition {
	const view = INFO_VIEWS.find((v) => v.id === id);
	if (!view) throw new Error(`Unknown info view: ${id}`);
	return view;
}

/** How strongly ordinary map content recedes while an info view is active. */
export const INFO_VIEW_FADE = {
	basemapDimOpacity: 0.55,
	infrastructureOpacity: 0.35,
	cellFillOpacity: 0.78
} as const;

export function isExternalMetric(metric: InfoViewMetric): metric is H3ExternalKey {
	return metric === 'overallChange' || metric === 'closureExposure';
}

/** Value a grid view shows for a cell; external metrics come from the supplied source. */
export function infoViewValue(
	view: GridInfoView,
	cell: H3Cell,
	external: CellValueSource | null
): number {
	return isExternalMetric(view.metric) ? (external?.(cell.h3Index) ?? 0) : cell[view.metric];
}
