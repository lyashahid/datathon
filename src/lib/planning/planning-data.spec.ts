import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDefaultAssumptions } from './defaults.ts';
import { analyzePlanning } from './engine.ts';
import { createBusProposal } from './proposals.ts';
import type { PlanningBaseline } from './types.ts';

const baseline = JSON.parse(
	readFileSync(new URL('../../../data/public/planning-baseline.json', import.meta.url), 'utf8')
) as PlanningBaseline;

describe('acquired public planning snapshot', () => {
	it('reconciles allocated population to each available official island projection', () => {
		expect(baseline.origins.length).toBeGreaterThan(0);
		for (const island of baseline.islands) {
			const origins = baseline.origins.filter((o) => o.islandId === island.id);
			for (const year of [2026, 2030] as const) {
				const official = island[`projection${year}Population`];
				if (typeof official === 'number')
					expect(origins.reduce((sum, o) => sum + (o[`population${year}`] ?? 0), 0)).toBeCloseTo(
						official,
						5
					);
				else expect(origins).toHaveLength(0);
			}
		}
	});
	// This integration case runs four comparisons; its timeout is not a per-preview performance target.
	it('runs source-backed snapshots and reproducible service previews without treating unknowns as gaps', () => {
		const a = createDefaultAssumptions(baseline);
		const start = performance.now();
		const morning = analyzePlanning(baseline, [], a);
		const morningMs = performance.now() - start;
		expect(morning.origins).toHaveLength(baseline.origins.length);
		expect(morning.summary.unknownResidents).toBeGreaterThan(0);
		expect(
			morning.origins
				.filter((o) => o.islandId === 'vilimale')
				.every((o) => o.before.status === 'unavailable')
		).toBe(true);
		const selected = baseline.origins.find((o) => o.id === 'wp:hulhumale:3443:1085')!;
		const proposal = createBusProposal(baseline, { originId: selected.id, headwayMinutes: 15 });
		expect(proposal.ok).toBe(true);
		if (!proposal.ok) return;
		const previewStart = performance.now();
		const preview = analyzePlanning(baseline, [proposal.action], a);
		const previewMs = performance.now() - previewStart;
		const repeatStart = performance.now();
		const committed = analyzePlanning(baseline, [proposal.action], a);
		const repeatMs = performance.now() - repeatStart;
		expect(committed).toEqual(preview);
		expect(preview.origins.find((o) => o.originId === selected.id)?.deltaMinutes).toBeGreaterThan(
			0
		);
		expect(preview.summary.newlyReachedResidents).toBeGreaterThan(0);
		expect(
			preview.origins
				.filter((o) => o.before.status === 'unavailable')
				.every((o) => !o.newlyReachable)
		).toBe(true);
		const afternoonStart = performance.now();
		const afternoon = analyzePlanning(baseline, [], { ...a, departureMinutes: 16 * 60 });
		const afternoonMs = performance.now() - afternoonStart;
		expect(afternoon.origins.some((o) => o.before.path.some((l) => l.mode === 'bus'))).toBe(true);
		expect(afternoon.costs.capitalMvr?.central).toBe(0);
		console.info(
			'Planning snapshot timings (Node, ms):',
			JSON.stringify({
				dataset: baseline.version,
				morning: Math.round(morningMs),
				preview: Math.round(previewMs),
				repeatedPreview: Math.round(repeatMs),
				afternoon: Math.round(afternoonMs),
				unknownResidents: morning.summary.unknownResidents
			})
		);
	}, 15_000);
});
