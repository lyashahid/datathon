import { createContext } from 'svelte';
import {
	summarizeFeedback,
	validateFeedback,
	validateObservation,
	type Validation
} from '#lib/data/feedback.ts';
import type {
	FeedbackRepository,
	FeedbackSummary,
	InfrastructureFeedback,
	NewFeedback,
	NewObservation,
	Observation,
	ObservationRepository
} from '#lib/types/feedback.ts';

/**
 * Local observations and community feedback. Deliberately separate from scenario and analysis
 * state: nothing here feeds a score.
 */
export class FeedbackState {
	readonly #observations: ObservationRepository;
	readonly #feedback: FeedbackRepository;

	observations = $state.raw<readonly Observation[]>([]);
	feedback = $state.raw<readonly InfrastructureFeedback[]>([]);
	status = $state<'loading' | 'ready' | 'error'>('loading');

	constructor(observations: ObservationRepository, feedback: FeedbackRepository) {
		this.#observations = observations;
		this.#feedback = feedback;
	}

	async load(): Promise<void> {
		try {
			[this.observations, this.feedback] = await Promise.all([
				this.#observations.list(),
				this.#feedback.list()
			]);
			this.status = 'ready';
		} catch {
			this.status = 'error';
		}
	}

	getObservation(id: string): Observation | undefined {
		return this.observations.find((o) => o.id === id);
	}

	async addObservation(input: NewObservation): Promise<Validation<Observation>> {
		const checked = validateObservation(input);
		if (!checked.ok) return checked;
		const record = await this.#observations.add(checked.value);
		this.observations = [...this.observations, record];
		return { ok: true, value: record };
	}

	async removeObservation(id: string): Promise<void> {
		await this.#observations.remove(id);
		this.observations = this.observations.filter((o) => o.id !== id);
	}

	feedbackFor(featureId: string): readonly InfrastructureFeedback[] {
		return this.feedback.filter((f) => f.featureId === featureId);
	}

	summaryFor(featureId: string): FeedbackSummary {
		return summarizeFeedback(this.feedbackFor(featureId));
	}

	async addFeedback(input: NewFeedback): Promise<Validation<InfrastructureFeedback>> {
		const checked = validateFeedback(input);
		if (!checked.ok) return checked;
		const record = await this.#feedback.add(checked.value);
		this.feedback = [...this.feedback, record];
		return { ok: true, value: record };
	}
}

export const [getFeedbackState, setFeedbackState] = createContext<FeedbackState>();
