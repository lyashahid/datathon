import { describe, expect, it } from 'vitest';
import { shiftTimetable } from './shiftTimetable.ts';
import { derivePlanningWorld } from './scenario.ts';
import { validSavedActions } from './validation.ts';
import { analyzePlanning } from './engine.ts';
import { createDefaultAssumptions } from './defaults.ts';
import { PlanningScenarioState } from './scenarioState.svelte.ts';
import type { PlanningBaseline, PlanningServicePattern } from './types.ts';

const pattern = (): PlanningServicePattern => ({
	id: 'bus',
	routeId: 'route',
	name: 'Bus',
	mode: 'bus',
	stopIds: ['sa', 'sb'],
	calendar: { weekdays: [0, 1, 2, 3, 4, 5, 6] },
	timing: {
		kind: 'scheduled',
		trips: [
			{
				id: 'trip',
				stopTimes: [
					{ arrivalMinutes: 483, departureMinutes: 485 },
					{ arrivalMinutes: 495, departureMinutes: 497 }
				],
				segmentGeometry: [
					[
						[73.5, 4.17],
						[73.51, 4.17]
					]
				]
			}
		]
	},
	provenance: 'observed',
	sourceIds: [],
	distanceM: 6000,
	geometry: [
		[73.5, 4.17],
		[73.51, 4.17]
	],
	segmentGeometry: [
		[
			[73.5, 4.17],
			[73.51, 4.17]
		]
	],
	segmentDistanceM: [6000]
});
const fixture = (): PlanningBaseline => ({
	schemaVersion: 1,
	version: 'shift-test',
	generatedAt: '2026-10-11T00:00:00Z',
	referenceDate: '2026-10-11',
	sources: [],
	islands: [{ id: 'island', name: 'Island' }],
	origins: [{ id: 'origin', lon: 73.5, lat: 4.17, islandId: 'island', population2026: 100 }],
	network: {
		nodes: [
			{ id: 'a', lon: 73.5, lat: 4.17 },
			{ id: 'b', lon: 73.51, lat: 4.17 }
		],
		edges: [
			{ id: 'road', from: 'a', to: 'b', distanceM: 6000, walkAllowed: true, driveAllowed: true }
		]
	},
	facilities: [
		{
			id: 'hospital',
			name: 'Hospital',
			kind: 'hospital',
			lon: 73.51,
			lat: 4.17,
			islandId: 'island',
			verification: 'official'
		}
	],
	transit: {
		stops: [
			{ id: 'sa', name: 'A', lon: 73.5, lat: 4.17, islandId: 'island', sourceIds: [] },
			{ id: 'sb', name: 'B', lon: 73.51, lat: 4.17, islandId: 'island', sourceIds: [] }
		],
		patterns: [pattern()],
		gaps: [],
		accessStatus: 'complete'
	}
});

describe('bounded timetable action', () => {
	it('survives scenario export/import and produces the same routed outcome', () => {
		const b = fixture(),
			original = new PlanningScenarioState(b);
		original.setAssumptions({ departureMinutes: 480 });
		original.addAction({ kind: 'shift-timetable', patternId: 'bus', minutes: 5 });
		const restored = new PlanningScenarioState(b);
		expect(restored.importJson(original.exportJson())).toEqual({ ok: true });
		expect(restored.actions).toEqual(original.actions);
		expect(restored.analysis.origins[0].after.minutes).toBe(
			original.analysis.origins[0].after.minutes
		);
		const invalid = JSON.parse(original.exportJson());
		invalid.actions[0].minutes = 1.5;
		expect(restored.importJson(JSON.stringify(invalid)).ok).toBe(false);
	});
	it('preserves identities, calendar, geometry, runtime and dwell without mutating evidence', () => {
		const original = pattern(),
			shifted = shiftTimetable(original, 5)!;
		expect(shifted.provenance).toBe('assumed');
		expect(shifted.calendar).toEqual(original.calendar);
		expect(shifted.geometry).toEqual(original.geometry);
		expect(shifted.segmentGeometry).toEqual(original.segmentGeometry);
		expect(shifted.stopIds).toEqual(original.stopIds);
		if (shifted.timing.kind !== 'scheduled' || original.timing.kind !== 'scheduled')
			throw new Error('Wrong timing');
		expect(shifted.timing.trips[0].id).toBe(original.timing.trips[0].id);
		expect(shifted.timing.trips[0].segmentGeometry).toEqual(
			original.timing.trips[0].segmentGeometry
		);
		expect(shifted.timing.trips[0].stopTimes).toEqual([
			{ arrivalMinutes: 488, departureMinutes: 490 },
			{ arrivalMinutes: 500, departureMinutes: 502 }
		]);
		expect(original.timing.trips[0].stopTimes[0].departureMinutes).toBe(485);
		expect(shiftTimetable(original, 0)?.provenance).toBe('observed');
	});
	it('rejects fractional, unbounded, invalid or cross-midnight edits without dropping trips', () => {
		for (const shift of [NaN, 1.5, 16, -16]) expect(shiftTimetable(pattern(), shift)).toBeNull();
		const nearMidnight = pattern();
		if (nearMidnight.timing.kind !== 'scheduled') throw new Error('Wrong timing');
		nearMidnight.timing.trips.push({
			id: 'late',
			stopTimes: [
				{ arrivalMinutes: 1425, departureMinutes: 1427 },
				{ arrivalMinutes: 1437, departureMinutes: 1439 }
			]
		});
		expect(shiftTimetable(nearMidnight, 5)).toBeNull();
		expect(
			shiftTimetable({ ...pattern(), runtimeUnavailableReason: 'Invalid path' }, 5)
		).toBeNull();
		expect(validSavedActions([{ kind: 'shift-timetable', patternId: 'bus', minutes: 5 }])).toBe(
			true
		);
		expect(validSavedActions([{ kind: 'shift-timetable', patternId: 'bus', minutes: 1.5 }])).toBe(
			false
		);
	});
	it('actually applies the saved action and subsequent road delay in end-to-end routing', () => {
		const b = fixture(),
			assumptions = { ...createDefaultAssumptions(b), departureMinutes: 480, targetMinutes: 30 };
		const action = { kind: 'shift-timetable' as const, patternId: 'bus', minutes: 5 };
		const world = derivePlanningWorld(b, [action]);
		expect(world.warnings).toEqual([]);
		const normal = analyzePlanning(b, [], assumptions),
			shifted = analyzePlanning(b, [action], assumptions);
		expect(shifted.origins[0].after.minutes).toBeCloseTo(normal.origins[0].after.minutes! + 5);
		const stressed = analyzePlanning(b, [action], {
			...assumptions,
			disruptions: [
				{
					id: 'delay',
					name: 'Delay',
					kind: 'delay',
					edgeIds: ['road'],
					modes: ['bus'],
					direction: 'both',
					startDate: assumptions.date,
					endDate: assumptions.date,
					startMinutes: 0,
					endMinutes: 1439,
					delayMinutes: 5,
					provenance: 'assumed',
					enabled: true
				}
			]
		});
		expect(stressed.origins[0].after.minutes).toBeCloseTo(shifted.origins[0].after.minutes! + 5);
		expect(stressed.disruptionImpact?.affectedPatternIds).toContain('bus');
	});
	it('reports a rejected timetable edit instead of silently altering service', () => {
		const b = fixture();
		const world = derivePlanningWorld(b, [
			{ kind: 'shift-timetable', patternId: 'bus', minutes: 20 }
		]);
		expect(world.warnings.join(' ')).toContain('shift ignored');
		expect(world.patterns[0]).toEqual(b.transit.patterns[0]);
	});
});
