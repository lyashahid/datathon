import { describe, expect, it } from 'vitest';
import { derivePlanningWorld } from '#lib/planning/scenario.ts';
import type { PlanningBaseline, PlanningFacility } from '#lib/planning/types.ts';
import { stopCoverage, symbolData, visibleStops } from './atlasData.ts';

const facility = (id: string, patch: Partial<PlanningFacility> = {}): PlanningFacility => ({
	id,
	name: id,
	kind: 'clinic',
	islandId: 'male',
	lon: 73.51,
	lat: 4.17,
	verification: 'osm-mapped',
	operatingStatus: 'open',
	careScope: 'general',
	statusReviewedAt: '2026-10-10',
	statusSourceIds: ['registry'],
	...patch
});
const baseline = (): PlanningBaseline => ({
	schemaVersion: 1,
	version: 'audited',
	generatedAt: '2026-10-10T00:00:00Z',
	referenceDate: '2026-10-10',
	sources: [{ id: 'registry' }],
	islands: [{ id: 'male', name: 'Malé' }],
	origins: [],
	network: { nodes: [], edges: [] },
	facilities: [
		facility('general-clinic'),
		facility('hospital', { kind: 'hospital' }),
		facility('European', { operatingStatus: 'closed' }),
		facility('unmatched', { operatingStatus: 'unverified' }),
		facility('specialist', { careScope: 'specialist' }),
		facility('restricted', { verification: false })
	],
	transit: {
		stops: ['out', 'opposite', 'untimed'].map((id, i) => ({
			id,
			name: id,
			islandId: 'male',
			sourceIds: ['rtl'],
			lon: i === 2 ? 73.52 : 73.51,
			lat: 4.17
		})),
		patterns: [
			{
				id: 'bus',
				routeId: 'r1',
				name: 'R1',
				mode: 'bus',
				stopIds: ['out', 'opposite'],
				calendar: { weekdays: [6] },
				provenance: 'observed',
				sourceIds: ['rtl'],
				timing: {
					kind: 'frequency',
					windows: [{ startMinutes: 480, endMinutes: 1200, headwayMinutes: 15 }],
					segmentMinutes: [4]
				}
			}
		],
		gaps: []
	}
});

describe('audited map locations', () => {
	it('dims facilities with unknown selected services and excludes a confirmed mismatch', () => {
		const data = baseline();
		data.facilities = [
			facility('unknown-service'),
			facility('general-only', {
				suitability: {
					reviewedAt: '2026-10-10',
					sourceIds: ['registry-services'],
					healthcareServices: ['general']
				}
			}),
			facility('emergency', {
				kind: 'hospital',
				suitability: {
					reviewedAt: '2026-10-10',
					sourceIds: ['registry-services'],
					healthcareServices: ['general', 'emergency']
				}
			})
		];
		const symbols = symbolData(data, null, 'healthcare', false, {
			assumptions: {
				goal: 'healthcare',
				date: '2026-10-10',
				departureMinutes: 900,
				destinationRequirements: { healthcareService: 'emergency' }
			}
		});
		const facilities = symbols.features.filter(
			(feature) => feature.properties?.mapKind === 'facility'
		);
		expect(facilities.map((feature) => feature.properties?.id)).toEqual([
			'unknown-service',
			'emergency'
		]);
		expect(facilities[0].properties).toMatchObject({
			disabled: true,
			eligibilityStatus: 'unavailable',
			statusLabel: 'Existing clinic · suitability unverified'
		});
		expect(facilities[1].properties).toMatchObject({
			disabled: false,
			eligibilityStatus: 'eligible'
		});
	});
	it('uses the same explicit catalogue opt-in for map and editable stop choices', () => {
		const data = baseline();
		const world = derivePlanningWorld(data, []);
		expect(visibleStops(data, { world }).map((stop) => stop.id)).toEqual(['out', 'opposite']);
		expect(visibleStops(data, { world }, true).map((stop) => stop.id)).toContain('untimed');
		const unverified = symbolData(data, { world }, 'healthcare', true).features.find(
			(feature) => feature.properties?.id === 'untimed'
		);
		expect(unverified?.properties?.statusLabel).toBe('Operator listing · service unverified');
		expect(unverified?.properties?.description).toContain('physical condition are unverified');
	});
	it('retains new and moved scenario stops while hiding untouched untimed listings', () => {
		const data = baseline();
		const world = derivePlanningWorld(data, [
			{ kind: 'move-stop', stopId: 'untimed', position: { lon: 73.521, lat: 4.171 } },
			{ kind: 'add-stop', stop: { ...data.transit.stops[2], id: 'proposal', sourceIds: [] } }
		]);
		expect(visibleStops(data, { world }).map((stop) => stop.id)).toEqual([
			'out',
			'opposite',
			'untimed',
			'proposal'
		]);
	});
	it('shows conditional destinations as proposals and previews without changing baseline status', () => {
		const data = baseline();
		const proposal = facility('proposal', {
			provenance: 'assumed',
			planningStatus: 'proposed',
			verification: 'scenario-proposal',
			proposedOpeningDate: '2026-10-10',
			sourceIds: ['scenario-proposal']
		});
		const world = { ...derivePlanningWorld(data, []), facilities: [...data.facilities, proposal] };
		const symbol = symbolData(data, { world }, 'healthcare').features.find(
			(f) => f.properties?.id === 'proposal'
		);
		expect(symbol?.properties).toMatchObject({
			icon: 'clinic',
			investmentState: 'proposed',
			isBaselineAsset: false,
			statusLabel: 'Proposed · not built'
		});
		expect(symbol?.properties?.description).toContain('emissions are unestimated');
		expect(
			symbolData(data, { world }, 'healthcare', false, {
				draftFacilityIds: ['proposal', 'hospital']
			}).features.find((f) => f.properties?.id === 'proposal')?.properties?.investmentState
		).toBe('draft');
		expect(
			symbolData(data, { world }, 'healthcare', false, {
				draftFacilityIds: ['hospital']
			}).features.find((f) => f.properties?.id === 'hospital')?.properties?.investmentState
		).toBe('existing');
		expect(
			symbolData(data, { world }, 'education').features.some((f) => f.properties?.id === 'proposal')
		).toBe(false);
		expect(data.facilities.some((f) => f.id === 'proposal')).toBe(false);
	});
	it('excludes closed, unknown, specialist and restricted care from default map destinations', () => {
		const symbols = symbolData(baseline(), null, 'healthcare');
		expect(
			symbols.features
				.filter((f) => f.properties?.mapKind === 'facility')
				.map((f) => f.properties?.id)
		).toEqual(['general-clinic', 'hospital']);
		expect(symbols.features[0].properties?.icon).toBe('clinic');
		expect(symbols.features[1].properties?.icon).toBe('hospital');
	});
	it('groups co-located directional codes visually without merging the routing identities', () => {
		const data = baseline();
		const stops = symbolData(data, null, 'healthcare').features.filter(
			(f) => f.properties?.mapKind === 'stop'
		);
		expect(stops).toHaveLength(1);
		expect(stops[0].properties?.count).toBe(2);
		expect(data.transit.stops.map((s) => s.id)).toEqual(['out', 'opposite', 'untimed']);
		expect(stopCoverage(data)).toEqual({ listed: 3, sites: 2, timed: 2, untimed: 1 });
	});
	it('only reveals missing-timetable catalogue entries with the explicit secondary control', () => {
		const data = baseline();
		expect(
			symbolData(data, null, 'healthcare').features.some((f) => f.properties?.state === 'untimed')
		).toBe(false);
		const untimed = symbolData(data, null, 'healthcare', true).features.find(
			(f) => f.properties?.id === 'untimed'
		);
		expect(untimed?.properties?.state).toBe('untimed');
		expect(untimed?.properties?.description).toContain('does not establish closure');
	});
	it('distinguishes proposed and disabled boarding points from existing timetable-linked stops', () => {
		const data = baseline();
		const world = derivePlanningWorld(data, [
			{ kind: 'disable-stop', stopId: 'out' },
			{
				kind: 'add-stop',
				stop: {
					id: 'proposal',
					name: 'Proposal',
					islandId: 'male',
					sourceIds: [],
					lon: 73.53,
					lat: 4.17
				}
			}
		]);
		const symbols = symbolData(data, { world }, 'healthcare');
		expect(symbols.features.find((f) => f.properties?.id === 'out')?.properties?.state).toBe(
			'disabled'
		);
		expect(symbols.features.find((f) => f.properties?.id === 'proposal')?.properties?.state).toBe(
			'proposed'
		);
		const existing = symbols.features.find((f) => f.properties?.id === 'out')?.properties;
		expect(existing).toMatchObject({
			investmentState: 'paused',
			iconState: 'paused',
			isBaselineAsset: true,
			serviceState: 'paused',
			statusLabel: 'Existing · paused in scenario'
		});
		const proposed = symbols.features.find((f) => f.properties?.id === 'proposal')?.properties;
		expect(proposed).toMatchObject({
			investmentState: 'proposed',
			iconState: 'proposed',
			isBaselineAsset: false,
			serviceState: 'untimed',
			statusLabel: 'Proposed · not built'
		});
		expect(proposed?.description).toContain('does not add transit access');
	});
	it('keeps existing facilities and stops built when only a service assumption changes', () => {
		const data = baseline();
		const world = derivePlanningWorld(data, [
			{ kind: 'set-frequency', patternId: 'bus', headwayMinutes: 10 }
		]);
		const symbols = symbolData(data, { world }, 'healthcare');
		expect(world.patterns[0].provenance).toBe('assumed');
		expect(symbols.features.every((f) => f.properties?.isBaselineAsset === true)).toBe(true);
		expect(symbols.features.every((f) => f.properties?.investmentState === 'existing')).toBe(true);
		expect(symbols.features.find((f) => f.properties?.id === 'hospital')?.properties).toMatchObject(
			{
				icon: 'hospital',
				iconState: 'existing',
				statusLabel: 'Existing hospital'
			}
		);
	});
	it('labels a moved published stop as an existing asset even when its timetable is invalidated', () => {
		const data = baseline();
		const world = derivePlanningWorld(data, [
			{ kind: 'move-stop', stopId: 'out', position: { lon: 73.511, lat: 4.171 } }
		]);
		const stop = symbolData(data, { world }, 'healthcare').features.find(
			(f) => f.properties?.id === 'out'
		);
		expect(stop?.properties).toMatchObject({
			state: 'disabled',
			investmentState: 'moved',
			iconState: 'moved',
			isBaselineAsset: true,
			serviceState: 'paused',
			disabled: true,
			statusLabel: 'Existing · proposed move'
		});
		expect(stop?.geometry.coordinates).toEqual([73.511, 4.171]);
		expect(data.transit.stops[0].lon).toBe(73.51);
		expect(stop?.properties?.description).toContain('scenario assumption');
	});
	it('distinguishes uncommitted placement from a saved proposal without rewriting baseline status', () => {
		const data = baseline();
		const world = derivePlanningWorld(data, [
			{
				kind: 'add-stop',
				stop: {
					id: 'placement',
					name: 'Placement',
					islandId: 'male',
					sourceIds: [],
					lon: 73.53,
					lat: 4.17
				}
			}
		]);
		const preview = symbolData(data, { world }, 'healthcare', false, {
			draftStopIds: ['placement', 'out']
		});
		expect(
			preview.features.find((f) => f.properties?.id === 'placement')?.properties
		).toMatchObject({
			state: 'proposed',
			investmentState: 'draft',
			iconState: 'draft',
			statusLabel: 'Placement preview · not built',
			isBaselineAsset: false
		});
		expect(
			preview.features.find((f) => f.properties?.id === 'out')?.properties?.investmentState
		).toBe('existing');
		expect(
			symbolData(data, { world }, 'healthcare').features.find(
				(f) => f.properties?.id === 'placement'
			)?.properties?.investmentState
		).toBe('proposed');
	});
	it('retains unbuilt status for a proposed stop when its modeled service is paused', () => {
		const data = baseline();
		const world = derivePlanningWorld(data, [
			{
				kind: 'add-stop',
				stop: {
					id: 'proposal',
					name: 'Proposal',
					islandId: 'male',
					sourceIds: [],
					lon: 73.53,
					lat: 4.17
				}
			},
			{ kind: 'disable-stop', stopId: 'proposal' }
		]);
		expect(
			symbolData(data, { world }, 'healthcare').features.find(
				(f) => f.properties?.id === 'proposal'
			)?.properties
		).toMatchObject({
			investmentState: 'proposed',
			isBaselineAsset: false,
			serviceState: 'paused',
			disabled: true,
			statusLabel: 'Proposed · not built'
		});
	});
});
