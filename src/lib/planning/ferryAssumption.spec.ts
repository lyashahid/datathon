import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	createFerryRuntimeAssumption,
	type FerryRuntimeEvidence,
	type FerryCalendarEvidence
} from './ferryAssumption.ts';
import type { PlanningBaseline } from './types.ts';
import { servicePlaybackFrame } from './playback.ts';

const calendars = JSON.parse(
	readFileSync('data/public/policy-evidence/service-calendars.json', 'utf8')
) as { calendars: FerryCalendarEvidence[] };
const terminals: FerryRuntimeEvidence['terminals'] = [
	{
		id: 'rtl:101',
		name: 'Maafannu Ferry Terminal',
		coordinates: [73.50165235035352, 4.171891971552377],
		islandId: 'male'
	},
	{
		id: 'rtl:103',
		name: 'Villingili Ferry Terminal',
		coordinates: [73.48744708629184, 4.174914739012298],
		islandId: 'vilimale'
	}
];
const evidence: FerryRuntimeEvidence = {
	calendar: calendars.calendars.find((calendar) => calendar.route === 'vilimale')!,
	terminals,
	sourceUrl: 'https://mtcc.mv/wp-content/uploads/2025/12/Vili-male-Ferry-Schedule-2026-V1.pdf'
};
function fixture(): PlanningBaseline {
	const nodes = terminals.flatMap((terminal, index) => [
		{ id: `${index}-a`, lon: terminal.coordinates[0], lat: terminal.coordinates[1] },
		{ id: `${index}-b`, lon: terminal.coordinates[0] + 0.0001, lat: terminal.coordinates[1] }
	]);
	return {
		schemaVersion: 1,
		version: 'fixture',
		generatedAt: '2026-10-10T00:00:00Z',
		referenceDate: '2026-10-10',
		sources: [],
		islands: [
			{ id: 'male', name: 'Malé' },
			{ id: 'vilimale', name: 'Vilimalé' }
		],
		origins: [],
		facilities: [],
		network: {
			nodes,
			edges: [0, 1].map((index) => ({
				id: `path-${index}`,
				from: nodes[index * 2].id,
				to: nodes[index * 2 + 1].id,
				distanceM: 10,
				walkAllowed: true,
				driveAllowed: false
			}))
		},
		transit: { stops: [], patterns: [], gaps: [] }
	};
}
const propose = (date: string) =>
	createFerryRuntimeAssumption(fixture(), evidence, {
		date,
		crossingMinutes: 10,
		acknowledgeCalendarValidity: true
	});

describe('conditional ferry runtime', () => {
	it('uses official endpoints and headways but labels both directions assumed', () => {
		const baseline = fixture(),
			result = propose('2026-10-11');
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.action.pattern.provenance).toBe('assumed');
		expect(result.action.returnPattern?.stopIds).toEqual(
			[...result.action.pattern.stopIds].reverse()
		);
		expect(result.action.pattern.geometry).toBeUndefined();
		expect(result.action.pattern.distanceM).toBeUndefined();
		expect(result.action.pattern.calendar.includedDates).toEqual(['2026-10-11']);
		expect(baseline.transit.patterns).toEqual([]);
	});
	it('retains the Friday prayer break and Saturday unspecified ten-minute gap', () => {
		const friday = propose('2026-10-16'),
			saturday = propose('2026-10-10');
		expect(friday.ok).toBe(true);
		expect(saturday.ok).toBe(true);
		if (!friday.ok || !saturday.ok) return;
		const at = (result: typeof friday, minute: number) =>
			result.action.pattern.timing.kind === 'frequency' &&
			result.action.pattern.timing.windows.some(
				(window) => minute >= window.startMinutes && minute < window.endMinutes
			);
		expect(at(friday, 12 * 60 + 30)).toBe(false);
		expect(at(saturday, 17 * 60 + 25)).toBe(false);
		expect(at(saturday, 17 * 60 + 35)).toBe(true);
	});
	it('requires an explicit runtime and validity acknowledgement', () => {
		expect(
			createFerryRuntimeAssumption(fixture(), evidence, {
				date: '2026-10-10',
				crossingMinutes: 10,
				acknowledgeCalendarValidity: false
			}).ok
		).toBe(false);
		expect(
			createFerryRuntimeAssumption(fixture(), evidence, {
				date: '2026-10-10',
				crossingMinutes: NaN,
				acknowledgeCalendarValidity: true
			}).ok
		).toBe(false);
		expect(propose('2026-01-01').ok).toBe(false);
	});
	it('requires a permitted walking attachment at both terminals', () => {
		const baseline = fixture();
		baseline.network.edges = baseline.network.edges.slice(0, 1);
		expect(
			createFerryRuntimeAssumption(baseline, evidence, {
				date: '2026-10-10',
				crossingMinutes: 10,
				acknowledgeCalendarValidity: true
			}).ok
		).toBe(false);
	});
	it('never animates a made-up vessel trajectory', () => {
		const result = propose('2026-10-11');
		if (!result.ok) throw new Error(result.reason);
		const frame = servicePlaybackFrame({
			pattern: result.action.pattern,
			stops: result.action.stops!,
			date: '2026-10-11',
			clockMinutes: 8 * 60 + 3
		});
		expect(frame.status).toBe('unavailable');
		expect(frame.features.features).toEqual([]);
	});
});
