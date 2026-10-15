import { afterEach, describe, expect, it, vi } from 'vitest';
import { MovementSession, movementScope, type MovementState } from './movement.js';
import type { LiveSnapshot } from './types.js';

const snapshot = (id: string): LiveSnapshot => ({
	events: [],
	providers: [],
	retrieved_at: id,
	coverage: 'no_current_coverage',
	deterministic_data_affected: false
});
const male = movementScope('male', 'Malé', [73.5093, 4.1755]);
const addu = movementScope('addu', 'Hithadhoo', [73.09, -0.612]);
afterEach(() => vi.useRealTimers());

describe('visible nearby movement', () => {
	it('requests a bounded island scope, not every position nationally', () => {
		const params = new URLSearchParams(male.query);
		expect(params.get('island_name')).toBe('Malé');
		expect(params.get('discover_nearby')).toBe('true');
		expect(params.get('include_stale')).toBe('false');
		const [west, south, east, north] = params.get('bbox')!.split(',').map(Number);
		expect(east - west).toBeLessThan(0.4);
		expect(north - south).toBeLessThan(0.4);
		expect([west, south, east, north].every(Number.isFinite)).toBe(true);
		const edge = new URLSearchParams(addu.query).get('bbox')!.split(',').map(Number);
		expect(edge[1]).toBeGreaterThanOrEqual(-1);
		expect(edge[1]).toBeLessThan(-0.612);
		expect(() => movementScope('bad', 'Bad', [NaN, 4])).toThrow();
	});

	it('aborts old scope and rejects a late response even when the transport ignores abort', async () => {
		const pending: { signal: AbortSignal; resolve: (value: LiveSnapshot) => void }[] = [];
		let state: MovementState | undefined;
		const session = new MovementSession(
			(_, signal) => new Promise((resolve) => pending.push({ signal, resolve })),
			(value) => {
				state = value;
			}
		);
		session.configure(male);
		session.configure(addu);
		expect(pending[0].signal.aborted).toBe(true);
		pending[1].resolve(snapshot('addu'));
		await Promise.resolve();
		pending[0].resolve(snapshot('male'));
		await Promise.resolve();
		expect(state?.snapshot?.retrieved_at).toBe('addu');
		expect(state?.scopeKey).toBe(addu.key);
		session.dispose();
	});

	it('pauses requests while hidden and polls at the declared minimum cadence', async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn(async () => snapshot('now'));
		const session = new MovementSession(
			fetcher,
			() => {},
			() => 1
		);
		session.configure(male);
		await vi.advanceTimersByTimeAsync(59000);
		expect(fetcher).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetcher).toHaveBeenCalledTimes(2);
		session.configure(null);
		await vi.advanceTimersByTimeAsync(120000);
		expect(fetcher).toHaveBeenCalledTimes(2);
		session.configure(male);
		await Promise.resolve();
		expect(fetcher).toHaveBeenCalledTimes(3);
		session.dispose();
	});

	it('keeps the previous observed sample when a provider request fails and stops on dispose', async () => {
		let state: MovementState | undefined;
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(snapshot('first'))
			.mockRejectedValueOnce(new Error('Provider unavailable'));
		const session = new MovementSession(fetcher, (value) => {
			state = value;
		});
		session.configure(male);
		await Promise.resolve();
		await session.refresh();
		expect(state?.snapshot?.retrieved_at).toBe('first');
		expect(state?.error).toBe('Provider unavailable');
		expect(state?.loading).toBe(false);
		session.dispose();
		await session.refresh();
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
});
