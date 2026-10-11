import type {
	PlanningAction,
	PlanningAnalysis,
	PlanningAssumptions,
	PlanningBaseline
} from './types.ts';

export class SupersededPlanningRequest extends Error {
	constructor() {
		super('A newer planning request replaced this result.');
		this.name = 'SupersededPlanningRequest';
	}
}
/** One worker owns the pinned network. Old results are rejected before UI consumers see them. */
export class AnalysisWorkerClient {
	readonly #worker: Worker;
	#next = 0;
	#latest = 0;
	#disposed = false;
	#pending = new Map<
		number,
		{ resolve(result: PlanningAnalysis): void; reject(error: Error): void }
	>();
	constructor(baseline: PlanningBaseline) {
		this.#worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
		this.#worker.onmessage = (
			event: MessageEvent<{ id: number; result?: PlanningAnalysis; error?: string }>
		) => {
			const pending = this.#pending.get(event.data.id);
			this.#pending.delete(event.data.id);
			if (!pending) return;
			if (event.data.id !== this.#latest) pending.reject(new SupersededPlanningRequest());
			else if (event.data.error || !event.data.result)
				pending.reject(new Error(event.data.error ?? 'No analysis result.'));
			else pending.resolve(event.data.result);
		};
		this.#worker.onerror = () => {
			this.#disposed = true;
			for (const pending of this.#pending.values())
				pending.reject(new Error('Planning worker failed.'));
			this.#pending.clear();
		};
		this.#worker.postMessage({ kind: 'init', baseline });
	}
	analyze(
		actions: readonly PlanningAction[],
		assumptions: PlanningAssumptions
	): Promise<PlanningAnalysis> {
		if (this.#disposed)
			return Promise.reject(new Error('Planning worker is unavailable or disposed.'));
		const id = ++this.#next;
		this.#latest = id;
		for (const pending of this.#pending.values()) pending.reject(new SupersededPlanningRequest());
		this.#pending.clear();
		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			this.#worker.postMessage({ kind: 'analyze', id, actions, assumptions });
		});
	}
	dispose() {
		this.#disposed = true;
		this.#worker.terminate();
		for (const pending of this.#pending.values())
			pending.reject(new Error('Planning worker disposed.'));
		this.#pending.clear();
	}
}
