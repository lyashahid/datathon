import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReturnJourneyWorkerClient, SupersededAppointmentRequest } from './returnJourneyClient.ts';
import type { PlanningBaseline, PlanningAssumptions } from './types.ts';

class FakeWorker {
	static instances: FakeWorker[] = [];
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: (() => void) | null = null;
	messages: Record<string, unknown>[] = [];
	terminated = false;
	constructor() {
		FakeWorker.instances.push(this);
	}
	postMessage(message: Record<string, unknown>) {
		this.messages.push(message);
	}
	terminate() {
		this.terminated = true;
	}
	result(id: number, result: unknown) {
		this.onmessage?.({ data: { id, result } } as MessageEvent);
	}
}
afterEach(() => {
	vi.unstubAllGlobals();
	FakeWorker.instances = [];
});
describe('on-demand appointment worker', () => {
	it('rejects superseded work and ignores its late response', async () => {
		vi.stubGlobal('Worker', FakeWorker);
		const client = new ReturnJourneyWorkerClient({ version: 'test' } as PlanningBaseline),
			worker = FakeWorker.instances[0];
		const options = { appointmentMinutes: 60, returnDeadlineMinutes: 1080 },
			assumptions = {} as PlanningAssumptions;
		const first = client.analyze([], 'origin', assumptions, options);
		const firstRejected = expect(first).rejects.toBeInstanceOf(SupersededAppointmentRequest);
		const second = client.scan([], 'origin', assumptions, options);
		await firstRejected;
		worker.result(1, { status: 'feasible' });
		worker.result(2, { samples: [], stepMinutes: 30, label: 'Test' });
		expect(await second).toMatchObject({ samples: [] });
		expect(worker.messages[1]).toMatchObject({
			kind: 'appointment',
			actions: [],
			originId: 'origin'
		});
		client.dispose();
		expect(worker.terminated).toBe(true);
	});
	it('rejects pending work when disposed', async () => {
		vi.stubGlobal('Worker', FakeWorker);
		const client = new ReturnJourneyWorkerClient({ version: 'test' } as PlanningBaseline);
		const pending = client.analyze([], 'origin', {} as PlanningAssumptions, {
			appointmentMinutes: 60,
			returnDeadlineMinutes: 1080
		});
		const rejection = expect(pending).rejects.toThrow('disposed');
		client.dispose();
		await rejection;
		await expect(
			client.analyze([], 'origin', {} as PlanningAssumptions, {
				appointmentMinutes: 60,
				returnDeadlineMinutes: 1080
			})
		).rejects.toThrow('disposed');
	});
});
