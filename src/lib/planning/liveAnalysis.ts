import type { PlanningAction, PlanningAnalysis, PlanningAssumptions } from './types.ts';
import { SupersededPlanningRequest } from './workerClient.ts';

export interface PlanningAnalyzer {
	analyze(
		actions: readonly PlanningAction[],
		assumptions: PlanningAssumptions
	): Promise<PlanningAnalysis>;
}

export interface LivePlanningResult {
	analysis: PlanningAnalysis;
	preview: PlanningAnalysis | null;
}

interface Request {
	id: number;
	actions: readonly PlanningAction[];
	assumptions: PlanningAssumptions;
	draft: PlanningAction | null;
	candidateActions?: readonly PlanningAction[];
	resolve(result: LivePlanningResult): void;
	reject(error: Error): void;
}

/**
 * One active comparison and one replaceable pending snapshot, including during a drag.
 * Committed and draft results are delivered together only when both still match the latest edit.
 * This owns no scenario history and does not terminate its analyzer; dispose the worker separately.
 */
export class LiveAnalysisScheduler {
	readonly #analyzer: PlanningAnalyzer;
	readonly #coalesceMs: number;
	#latest = 0;
	#disposed = false;
	#active: Request | undefined;
	#queued: Request | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(analyzer: PlanningAnalyzer, options: { coalesceMs?: number } = {}) {
		this.#analyzer = analyzer;
		const interval = options.coalesceMs ?? 40;
		if (!Number.isFinite(interval) || interval < 0 || interval > 1000)
			throw new Error('Analysis coalescing interval must be between 0 and 1000 ms.');
		this.#coalesceMs = interval;
	}

	analyze(
		actions: readonly PlanningAction[],
		assumptions: PlanningAssumptions,
		draft: PlanningAction | null = null,
		candidateActions?: readonly PlanningAction[]
	): Promise<LivePlanningResult> {
		if (this.#disposed) return Promise.reject(new Error('Live analysis scheduler is disposed.'));
		// Pin each request before a caller changes a slider, draft position or history entry.
		let snapshot: Pick<Request, 'actions' | 'assumptions' | 'draft' | 'candidateActions'>;
		try {
			snapshot = structuredClone({ actions, assumptions, draft, candidateActions });
		} catch {
			return Promise.reject(new Error('Planning request could not be copied.'));
		}
		const id = ++this.#latest;
		this.#queued?.reject(new SupersededPlanningRequest());
		this.#active?.reject(new SupersededPlanningRequest());
		return new Promise((resolve, reject) => {
			this.#queued = { id, ...snapshot, resolve, reject };
			this.#schedule();
		});
	}

	/** Invalidate visible work without interrupting a useful in-flight worker calculation. */
	cancel() {
		++this.#latest;
		this.#queued?.reject(new SupersededPlanningRequest());
		this.#active?.reject(new SupersededPlanningRequest());
		this.#queued = undefined;
		// Keep an existing short deadline: effect cleanup followed by its replacement request
		// must not reset the window indefinitely during a continuous gesture.
	}

	dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		++this.#latest;
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
		const error = new Error('Live analysis scheduler is disposed.');
		this.#queued?.reject(error);
		this.#active?.reject(error);
		this.#queued = undefined;
	}

	#current(request: Request) {
		return !this.#disposed && request.id === this.#latest;
	}

	#schedule() {
		if (this.#disposed || this.#active || !this.#queued || this.#timer !== undefined) return;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			const request = this.#queued;
			if (!request || this.#disposed) return;
			this.#queued = undefined;
			this.#active = request;
			void this.#run(request);
		}, this.#coalesceMs);
	}

	async #run(request: Request) {
		try {
			const analysis = await this.#analyzer.analyze(request.actions, request.assumptions);
			if (!this.#current(request)) return;
			const previewActions =
				request.candidateActions ?? (request.draft ? [...request.actions, request.draft] : null);
			const preview = previewActions
				? await this.#analyzer.analyze(previewActions, request.assumptions)
				: null;
			if (this.#current(request)) request.resolve({ analysis, preview });
		} catch (error) {
			if (this.#current(request))
				request.reject(error instanceof Error ? error : new Error(String(error)));
		} finally {
			if (this.#active === request) this.#active = undefined;
			this.#schedule();
		}
	}
}
