import type {
	AppointmentDepartureScan,
	AppointmentJourney,
	AppointmentOptions
} from './returnJourney.ts';
import type { PlanningAction, PlanningAssumptions, PlanningBaseline } from './types.ts';

export class SupersededAppointmentRequest extends Error {
	constructor() {
		super('A newer appointment journey request replaced this result.');
		this.name = 'SupersededAppointmentRequest';
	}
}
type ReturnResult = AppointmentDepartureScan | AppointmentJourney;
/** On-demand calculation, with superseded result rejection before UI publication. */
export class ReturnJourneyWorkerClient {
	readonly #worker: Worker;
	#next = 0;
	#disposed = false;
	#pending = new Map<number, { resolve(result: ReturnResult): void; reject(error: Error): void }>();
	constructor(baseline: PlanningBaseline) {
		this.#worker = new Worker(new URL('./returnJourney.worker.ts', import.meta.url), {
			type: 'module'
		});
		this.#worker.onmessage = (
			event: MessageEvent<{ id: number; result?: ReturnResult; error?: string }>
		) => {
			const pending = this.#pending.get(event.data.id);
			this.#pending.delete(event.data.id);
			if (!pending) return;
			if (event.data.error || !event.data.result)
				pending.reject(new Error(event.data.error ?? 'No appointment journey result.'));
			else pending.resolve(event.data.result);
		};
		this.#worker.onerror = () => {
			this.#disposed = true;
			for (const pending of this.#pending.values())
				pending.reject(new Error('Appointment worker failed.'));
			this.#pending.clear();
		};
		this.#worker.postMessage({ kind: 'init', baseline });
	}
	#request(
		kind: 'appointment' | 'scan',
		actions: readonly PlanningAction[],
		originId: string,
		assumptions: PlanningAssumptions,
		options: AppointmentOptions,
		search?: { startMinutes?: number; endMinutes?: number; stepMinutes?: number }
	): Promise<ReturnResult> {
		if (this.#disposed)
			return Promise.reject(new Error('Appointment worker is unavailable or disposed.'));
		for (const pending of this.#pending.values())
			pending.reject(new SupersededAppointmentRequest());
		this.#pending.clear();
		const id = ++this.#next;
		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			this.#worker.postMessage({ kind, id, actions, originId, assumptions, options, search });
		});
	}
	analyze(
		actions: readonly PlanningAction[],
		originId: string,
		assumptions: PlanningAssumptions,
		options: AppointmentOptions
	): Promise<AppointmentJourney> {
		return this.#request(
			'appointment',
			actions,
			originId,
			assumptions,
			options
		) as Promise<AppointmentJourney>;
	}
	scan(
		actions: readonly PlanningAction[],
		originId: string,
		assumptions: PlanningAssumptions,
		options: AppointmentOptions,
		search?: { startMinutes?: number; endMinutes?: number; stepMinutes?: number }
	): Promise<AppointmentDepartureScan> {
		return this.#request(
			'scan',
			actions,
			originId,
			assumptions,
			options,
			search
		) as Promise<AppointmentDepartureScan>;
	}
	dispose() {
		this.#disposed = true;
		this.#worker.terminate();
		for (const pending of this.#pending.values())
			pending.reject(new Error('Appointment worker disposed.'));
		this.#pending.clear();
	}
}
