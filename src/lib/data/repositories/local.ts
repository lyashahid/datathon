import { FEEDBACK_STORAGE_KEYS } from '#lib/config/feedback.ts';
import { decodeFeedback, decodeObservations } from '#lib/data/feedback.ts';
import type { FeedbackRepository, ObservationRepository } from '#lib/types/feedback.ts';
import {
	createFeedbackRepository,
	createObservationRepository,
	defaultRepositoryDeps
} from './memory.ts';

/** Storage can be missing or throw (private mode, blocked site data); never let that break the app. */
function read(storage: Storage | null, key: string): unknown {
	try {
		const raw = storage?.getItem(key);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

function writer(storage: Storage | null, key: string) {
	return (records: readonly unknown[]) => {
		try {
			storage?.setItem(key, JSON.stringify(records));
		} catch {
			/* quota or blocked storage: keep working in memory */
		}
	};
}

function browserStorage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

export function createLocalObservationRepository(
	storage: Storage | null = browserStorage()
): ObservationRepository {
	const key = FEEDBACK_STORAGE_KEYS.observations;
	return createObservationRepository(decodeObservations(read(storage, key)), {
		...defaultRepositoryDeps,
		persist: writer(storage, key)
	});
}

export function createLocalFeedbackRepository(
	storage: Storage | null = browserStorage()
): FeedbackRepository {
	const key = FEEDBACK_STORAGE_KEYS.feedback;
	return createFeedbackRepository(decodeFeedback(read(storage, key)), {
		...defaultRepositoryDeps,
		persist: writer(storage, key)
	});
}
