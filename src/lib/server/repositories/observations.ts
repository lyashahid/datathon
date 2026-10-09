/**
 * Server-side home for observation storage. The datathon MVP stores observations in the
 * browser (see data/repositories/local.ts); when a shared store is needed, implement
 * ObservationRepository here against it and expose it through an API route. Callers depend
 * only on the interface, so nothing else changes.
 *
 * Until then this provides a process-memory repository with the same validation, suitable
 * for tests and a single-instance demo server. It is deliberately not wired to any route.
 */
import { validateObservation } from '#lib/data/feedback.ts';
import { createObservationRepository } from '#lib/data/repositories/memory.ts';
import type { NewObservation, ObservationRepository } from '#lib/types/feedback.ts';

export function createServerObservationRepository(): ObservationRepository {
	const inner = createObservationRepository();
	return {
		list: inner.list,
		remove: inner.remove,
		add: async (input: NewObservation) => {
			const checked = validateObservation(input);
			if (!checked.ok) throw new Error(checked.reason);
			return inner.add(checked.value);
		}
	};
}
