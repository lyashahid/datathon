import type { CriticalityBand } from '#lib/types/criticality.ts';
import type { InfrastructureType } from '#lib/types/domain.ts';

/** Facility types the accessibility model uses; closing anything else changes no score. */
export const CRITICALITY_TYPES: readonly InfrastructureType[] = [
	'bus_stop',
	'bus_terminal',
	'ferry_terminal',
	'hospital',
	'school'
];

/** Bands on average points lost per study-area resident if the facility closed. */
export const CRITICALITY_BANDS: readonly {
	band: CriticalityBand;
	minPoints: number;
	label: string;
	color: string;
}[] = [
	{ band: 'critical', minPoints: 3, label: 'Critical', color: '#ef4444' },
	{ band: 'high', minPoints: 1, label: 'High', color: '#f97316' },
	{ band: 'moderate', minPoints: 0.25, label: 'Moderate', color: '#facc15' },
	{ band: 'low', minPoints: 0, label: 'Low', color: '#64748b' }
];

export const CRITICALITY_LABELS = {
	method:
		'Each facility is closed in turn, everything else unchanged, and accessibility is recalculated. The loss it causes is its criticality.',
	notResilience:
		'A single-closure test with the straight-line proximity model; it does not model crowding, capacity or knock-on failures.'
} as const;
