import type {
	FeedbackRepository,
	InfrastructureFeedback,
	NewFeedback,
	NewObservation,
	Observation,
	ObservationRepository
} from '#lib/types/feedback.ts';

export interface RepositoryDeps {
	newId: () => string;
	now: () => string;
	/** Called with the full list after every write; browser storage plugs in here. */
	persist?: (records: readonly unknown[]) => void;
}

export const defaultRepositoryDeps: RepositoryDeps = {
	newId: () => crypto.randomUUID(),
	now: () => new Date().toISOString()
};

/** Records held in memory, optionally mirrored to a persistence hook after each write. */
export function createObservationRepository(
	initial: readonly Observation[] = [],
	deps: RepositoryDeps = defaultRepositoryDeps
): ObservationRepository {
	let records = [...initial];
	return {
		list: async () => records,
		add: async (input: NewObservation) => {
			const record: Observation = { ...input, id: deps.newId(), createdAt: deps.now() };
			records = [...records, record];
			deps.persist?.(records);
			return record;
		},
		remove: async (id) => {
			records = records.filter((r) => r.id !== id);
			deps.persist?.(records);
		}
	};
}

export function createFeedbackRepository(
	initial: readonly InfrastructureFeedback[] = [],
	deps: RepositoryDeps = defaultRepositoryDeps
): FeedbackRepository {
	let records = [...initial];
	return {
		list: async () => records,
		add: async (input: NewFeedback) => {
			const record: InfrastructureFeedback = { ...input, id: deps.newId(), createdAt: deps.now() };
			records = [...records, record];
			deps.persist?.(records);
			return record;
		}
	};
}
