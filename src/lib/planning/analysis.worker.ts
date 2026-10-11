import { analyzePlanning } from './engine.ts';
import type { PlanningAction, PlanningAssumptions, PlanningBaseline } from './types.ts';

let baseline: PlanningBaseline | undefined;
let scheduled: ReturnType<typeof setTimeout> | undefined;
const workerScope = self as unknown as {
	onmessage: ((event: MessageEvent) => void) | null;
	postMessage(value: unknown): void;
};
workerScope.onmessage = (
	event: MessageEvent<
		| { kind: 'init'; baseline: PlanningBaseline }
		| { kind: 'analyze'; id: number; actions: PlanningAction[]; assumptions: PlanningAssumptions }
	>
) => {
	const message = event.data;
	if (message.kind === 'init') {
		baseline = message.baseline;
		return;
	}
	if (scheduled !== undefined) clearTimeout(scheduled);
	// Coalesce queued edits after a busy calculation; the client already rejects superseded IDs.
	scheduled = setTimeout(() => {
		scheduled = undefined;
		try {
			if (!baseline) throw new Error('Planning data is not loaded.');
			workerScope.postMessage({
				id: message.id,
				result: analyzePlanning(baseline, message.actions, message.assumptions)
			});
		} catch (error) {
			workerScope.postMessage({
				id: message.id,
				error: error instanceof Error ? error.message : 'Planning analysis failed.'
			});
		}
	}, 0);
};
