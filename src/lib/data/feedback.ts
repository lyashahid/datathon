import { FEEDBACK_RULES } from '#lib/config/feedback.ts';
import {
	FEEDBACK_KINDS,
	OBSERVATION_TYPES,
	type FeedbackSummary,
	type InfrastructureFeedback,
	type NewFeedback,
	type NewObservation,
	type Observation
} from '#lib/types/feedback.ts';

export type Validation<T> = { ok: true; value: T } | { ok: false; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const isPosition = (v: unknown): v is [number, number] =>
	Array.isArray(v) &&
	v.length === 2 &&
	v.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
	Math.abs(v[0]) <= 180 &&
	Math.abs(v[1]) <= 90;

/** Trims and checks user input before it reaches a repository. */
export function validateObservation(input: NewObservation): Validation<NewObservation> {
	if (!OBSERVATION_TYPES.includes(input.type)) return { ok: false, reason: 'Choose a type.' };
	if (!isPosition(input.position)) return { ok: false, reason: 'Pick a location on the map.' };
	const description = input.description.trim();
	if (description.length < FEEDBACK_RULES.descriptionMinLength) {
		return { ok: false, reason: 'Add a short description.' };
	}
	if (description.length > FEEDBACK_RULES.descriptionMaxLength) {
		return {
			ok: false,
			reason: `Keep it under ${FEEDBACK_RULES.descriptionMaxLength} characters.`
		};
	}
	return { ok: true, value: { ...input, position: [...input.position], description } };
}

export function validateFeedback(input: NewFeedback): Validation<NewFeedback> {
	if (!FEEDBACK_KINDS.includes(input.kind)) return { ok: false, reason: 'Unknown feedback type.' };
	if (!input.featureId) return { ok: false, reason: 'No facility selected.' };
	const text = input.text.trim();
	if (input.kind === 'comment' && text.length < FEEDBACK_RULES.descriptionMinLength) {
		return { ok: false, reason: 'Write a comment first.' };
	}
	if (text.length > FEEDBACK_RULES.descriptionMaxLength) {
		return {
			ok: false,
			reason: `Keep it under ${FEEDBACK_RULES.descriptionMaxLength} characters.`
		};
	}
	return { ok: true, value: { ...input, text } };
}

/** Reads stored records leniently: malformed entries are dropped, never fatal. */
export function decodeObservations(raw: unknown): Observation[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(o): o is Observation =>
			isObject(o) &&
			typeof o.id === 'string' &&
			typeof o.createdAt === 'string' &&
			typeof o.description === 'string' &&
			OBSERVATION_TYPES.includes(o.type as Observation['type']) &&
			isPosition(o.position)
	);
}

export function decodeFeedback(raw: unknown): InfrastructureFeedback[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(f): f is InfrastructureFeedback =>
			isObject(f) &&
			typeof f.id === 'string' &&
			typeof f.featureId === 'string' &&
			typeof f.text === 'string' &&
			typeof f.createdAt === 'string' &&
			FEEDBACK_KINDS.includes(f.kind as InfrastructureFeedback['kind'])
	);
}

export function summarizeFeedback(entries: readonly InfrastructureFeedback[]): FeedbackSummary {
	const count = (kind: InfrastructureFeedback['kind']) =>
		entries.filter((e) => e.kind === kind).length;
	const support = count('support');
	const concern = count('concern');
	return {
		support,
		concern,
		comment: count('comment'),
		supportShare: support + concern > 0 ? support / (support + concern) : null
	};
}
