import type { FeedbackKind, ObservationType } from '#lib/types/feedback.ts';

export const OBSERVATION_STYLES: Record<ObservationType, { label: string; color: string }> = {
	congestion: { label: 'Congestion', color: '#f97316' },
	flooding: { label: 'Flooding', color: '#3b82f6' },
	unsafe_crossing: { label: 'Unsafe crossing', color: '#ef4444' },
	road_damage: { label: 'Road damage', color: '#a16207' },
	bus_overcrowding: { label: 'Bus overcrowding', color: '#eab308' },
	ferry_reliability: { label: 'Ferry reliability', color: '#14b8a6' },
	poor_pedestrian_access: { label: 'Poor pedestrian access', color: '#c084fc' },
	other: { label: 'Other', color: '#94a3b8' }
};

export const FEEDBACK_LABELS: Record<FeedbackKind, string> = {
	support: 'Support',
	concern: 'Concern',
	comment: 'Comment'
};

export const FEEDBACK_RULES = {
	descriptionMaxLength: 280,
	descriptionMinLength: 3
} as const;

export const FEEDBACK_STORAGE_KEYS = {
	observations: 'mobility-sandbox-mv:observations:v1',
	feedback: 'mobility-sandbox-mv:feedback:v1'
} as const;

/** Map layer id (sidebar toggle) for observations. */
export const OBSERVATION_LAYER_ID = 'observations';

export const FEEDBACK_DISCLAIMER =
	'Community feedback is shown next to the technical analysis, never combined with it. Stored only in this browser.';
