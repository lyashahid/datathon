import {
	computeAppointmentJourney,
	findAppointmentDepartureWindows,
	type AppointmentOptions
} from './returnJourney.ts';
import { derivePlanningWorld } from './scenario.ts';
import type { PlanningAction, PlanningAssumptions, PlanningBaseline } from './types.ts';

let baseline: PlanningBaseline | undefined;
let scheduled: ReturnType<typeof setTimeout> | undefined;
const scope = self as unknown as {
	onmessage: ((event: MessageEvent) => void) | null;
	postMessage(value: unknown): void;
};
scope.onmessage = (
	event: MessageEvent<
		| { kind: 'init'; baseline: PlanningBaseline }
		| {
				kind: 'appointment' | 'scan';
				id: number;
				actions: PlanningAction[];
				originId: string;
				assumptions: PlanningAssumptions;
				options: AppointmentOptions;
				search?: { startMinutes?: number; endMinutes?: number; stepMinutes?: number };
		  }
	>
) => {
	const message = event.data;
	if (message.kind === 'init') {
		baseline = message.baseline;
		return;
	}
	if (scheduled !== undefined) clearTimeout(scheduled);
	scheduled = setTimeout(() => {
		scheduled = undefined;
		try {
			if (!baseline) throw new Error('Planning baseline is not initialized.');
			const world = derivePlanningWorld(baseline, message.actions, message.assumptions);
			const result =
				message.kind === 'scan'
					? findAppointmentDepartureWindows(
							baseline,
							world,
							message.originId,
							message.assumptions,
							message.options,
							message.search
						)
					: computeAppointmentJourney(
							baseline,
							world,
							message.originId,
							message.assumptions,
							message.options
						);
			scope.postMessage({ id: message.id, kind: message.kind, result });
		} catch (error) {
			scope.postMessage({
				id: message.id,
				error: error instanceof Error ? error.message : 'Return journey calculation failed.'
			});
		}
	}, 0);
};
