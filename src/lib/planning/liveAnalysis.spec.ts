import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveAnalysisScheduler, type PlanningAnalyzer } from './liveAnalysis.ts';
import { SupersededPlanningRequest } from './workerClient.ts';
import type { PlanningAction, PlanningAnalysis, PlanningAssumptions } from './types.ts';

// Deferred responses let these coordination tests reproduce a busy worker without routing fixtures.
class DeferredAnalyzer implements PlanningAnalyzer {
	calls: {
		actions: readonly PlanningAction[];
		assumptions: PlanningAssumptions;
		resolve(value: PlanningAnalysis): void;
		reject(error: Error): void;
	}[] = [];
	analyze(actions: readonly PlanningAction[], assumptions: PlanningAssumptions) {
		return new Promise<PlanningAnalysis>((resolve, reject) => {
			this.calls.push({ actions, assumptions, resolve, reject });
		});
	}
}
const assumptions = { date: '2026-10-10', departureMinutes: 480 } as PlanningAssumptions;
const result = (name: string) =>
	({ versionPins: { schema: 1, model: 'coordination-test', dataset: name } }) as PlanningAnalysis;
const action = (stopId: string): PlanningAction => ({ kind: 'disable-stop', stopId });
const microtasks = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

describe('bounded live planning comparisons', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('bounds a 200-edit storm to one active calculation and its latest pending replacement', async () => {
		const analyzer = new DeferredAnalyzer();
		const scheduler = new LiveAnalysisScheduler(analyzer);
		const first = scheduler.analyze([], assumptions).catch((error) => error);
		await vi.advanceTimersByTimeAsync(40);
		expect(analyzer.calls).toHaveLength(1);
		const edits = Array.from({ length: 200 }, (_, i) =>
			scheduler.analyze([action(String(i))], assumptions).catch((error) => error)
		);
		await expect(first).resolves.toBeInstanceOf(SupersededPlanningRequest);
		await vi.advanceTimersByTimeAsync(500);
		expect(analyzer.calls).toHaveLength(1);
		analyzer.calls[0].resolve(result('old'));
		await microtasks();
		await vi.advanceTimersByTimeAsync(40);
		expect(analyzer.calls).toHaveLength(2);
		expect(analyzer.calls[1].actions).toEqual([action('199')]);
		const latest = result('latest');
		analyzer.calls[1].resolve(latest);
		await expect(edits.at(-1)).resolves.toEqual({ analysis: latest, preview: null });
		const rejected = await Promise.all(edits.slice(0, -1));
		expect(rejected.every((error) => error instanceof SupersededPlanningRequest)).toBe(true);
		scheduler.dispose();
	});

	it('publishes committed and preview results atomically from the same input snapshot', async () => {
		const analyzer = new DeferredAnalyzer();
		const scheduler = new LiveAnalysisScheduler(analyzer, { coalesceMs: 0 });
		const actions = [action('committed')];
		const draft = action('draft');
		const input = { ...assumptions };
		const promise = scheduler.analyze(actions, input, draft);
		const published = vi.fn();
		void promise.then(published);
		actions.push(action('later'));
		input.departureMinutes = 960;
		await vi.advanceTimersByTimeAsync(0);
		expect(analyzer.calls[0].actions).toEqual([action('committed')]);
		expect(analyzer.calls[0].assumptions.departureMinutes).toBe(480);
		const committed = result('committed');
		analyzer.calls[0].resolve(committed);
		await microtasks();
		expect(published).not.toHaveBeenCalled();
		expect(analyzer.calls[1].actions).toEqual([action('committed'), draft]);
		expect(analyzer.calls[1].assumptions).toEqual(analyzer.calls[0].assumptions);
		const preview = result('preview');
		analyzer.calls[1].resolve(preview);
		await expect(promise).resolves.toEqual({ analysis: committed, preview });
		expect(actions).toEqual([action('committed'), action('later')]);
		scheduler.dispose();
	});

	it('skips an obsolete draft before spending a second worker calculation on it', async () => {
		const analyzer = new DeferredAnalyzer();
		const scheduler = new LiveAnalysisScheduler(analyzer, { coalesceMs: 0 });
		const obsolete = scheduler.analyze([], assumptions, action('obsolete')).catch((e) => e);
		await vi.advanceTimersByTimeAsync(0);
		const current = scheduler.analyze([action('current')], assumptions);
		await expect(obsolete).resolves.toBeInstanceOf(SupersededPlanningRequest);
		analyzer.calls[0].resolve(result('obsolete-baseline'));
		await microtasks();
		await vi.advanceTimersByTimeAsync(0);
		expect(analyzer.calls).toHaveLength(2);
		expect(analyzer.calls[1].actions).toEqual([action('current')]);
		analyzer.calls[1].resolve(result('current'));
		await expect(current).resolves.toEqual({ analysis: result('current'), preview: null });
		scheduler.dispose();
	});
	it.each([
		{ name: 'replacing an existing action', candidateActions: [action('replacement')] },
		{ name: 'removing all committed edits', candidateActions: [] }
	])('previews a replacement history when $name', async ({ candidateActions }) => {
		const analyzer = new DeferredAnalyzer();
		const scheduler = new LiveAnalysisScheduler(analyzer, { coalesceMs: 0 });
		const promise = scheduler.analyze(
			[action('existing')],
			assumptions,
			action('must-not-append'),
			candidateActions
		);
		await vi.advanceTimersByTimeAsync(0);
		expect(analyzer.calls[0].actions).toEqual([action('existing')]);
		analyzer.calls[0].resolve(result('committed'));
		await microtasks();
		expect(analyzer.calls[1].actions).toEqual(candidateActions);
		analyzer.calls[1].resolve(result('replacement-preview'));
		await expect(promise).resolves.toEqual({
			analysis: result('committed'),
			preview: result('replacement-preview')
		});
		scheduler.dispose();
	});

	it('suppresses a stale preview that finishes after a newer edit and resumes the latest pair', async () => {
		const analyzer = new DeferredAnalyzer();
		const scheduler = new LiveAnalysisScheduler(analyzer, { coalesceMs: 0 });
		const obsolete = scheduler.analyze([], assumptions, action('old')).catch((e) => e);
		await vi.advanceTimersByTimeAsync(0);
		analyzer.calls[0].resolve(result('old-committed'));
		await microtasks();
		expect(analyzer.calls).toHaveLength(2);
		const current = scheduler.analyze([], assumptions, action('latest'));
		analyzer.calls[1].resolve(result('old-preview'));
		await expect(obsolete).resolves.toBeInstanceOf(SupersededPlanningRequest);
		await vi.advanceTimersByTimeAsync(0);
		analyzer.calls[2].resolve(result('latest-committed'));
		await microtasks();
		expect(analyzer.calls[3].actions).toEqual([action('latest')]);
		analyzer.calls[3].resolve(result('latest-preview'));
		await expect(current).resolves.toEqual({
			analysis: result('latest-committed'),
			preview: result('latest-preview')
		});
		scheduler.dispose();
	});

	it('does not postpone its first live update indefinitely when effect cleanup replaces a gesture', async () => {
		const analyzer = new DeferredAnalyzer();
		const scheduler = new LiveAnalysisScheduler(analyzer);
		const first = scheduler.analyze([action('first')], assumptions).catch((e) => e);
		await vi.advanceTimersByTimeAsync(20);
		scheduler.cancel();
		const replacement = scheduler.analyze([action('replacement')], assumptions);
		await vi.advanceTimersByTimeAsync(20);
		expect(analyzer.calls).toHaveLength(1);
		expect(analyzer.calls[0].actions).toEqual([action('replacement')]);
		analyzer.calls[0].resolve(result('replacement'));
		await expect(first).resolves.toBeInstanceOf(SupersededPlanningRequest);
		await expect(replacement).resolves.toEqual({ analysis: result('replacement'), preview: null });
		scheduler.dispose();
	});

	it('rejects disposed active and pending requests, swallowing obsolete worker errors', async () => {
		const analyzer = new DeferredAnalyzer();
		const scheduler = new LiveAnalysisScheduler(analyzer, { coalesceMs: 0 });
		const first = scheduler.analyze([], assumptions).catch((e) => e);
		await vi.advanceTimersByTimeAsync(0);
		const pending = scheduler.analyze([action('next')], assumptions).catch((e) => e);
		scheduler.dispose();
		analyzer.calls[0].reject(new Error('An obsolete worker failed'));
		await expect(first).resolves.toBeInstanceOf(SupersededPlanningRequest);
		await expect(pending).resolves.toHaveProperty(
			'message',
			'Live analysis scheduler is disposed.'
		);
		await expect(scheduler.analyze([], assumptions)).rejects.toThrow('disposed');
		await vi.runAllTimersAsync();
		expect(analyzer.calls).toHaveLength(1);
	});

	it('returns a current worker error and can accept the next request afterward', async () => {
		const analyzer = new DeferredAnalyzer();
		const scheduler = new LiveAnalysisScheduler(analyzer, { coalesceMs: 0 });
		const failed = scheduler.analyze([], assumptions).catch((e) => e);
		await vi.advanceTimersByTimeAsync(0);
		analyzer.calls[0].reject(new Error('Worker unavailable'));
		await expect(failed).resolves.toHaveProperty('message', 'Worker unavailable');
		const next = scheduler.analyze([], assumptions);
		await vi.advanceTimersByTimeAsync(0);
		analyzer.calls[1].resolve(result('recovered'));
		await expect(next).resolves.toEqual({ analysis: result('recovered'), preview: null });
		scheduler.dispose();
	});
});
