import { describe, expect, it } from 'vitest';
import { createDefaultAssumptions } from './defaults.ts';
import { analyzePlanning } from './engine.ts';
import { isEligibleFacility } from './facilities.ts';
import { createFacilityProposal } from './facilityProposals.ts';
import { derivePlanningWorld } from './scenario.ts';
import { PlanningScenarioState } from './scenarioState.svelte.ts';
import type { PlanningAction, PlanningBaseline } from './types.ts';
import { validSavedActions } from './validation.ts';
import { journeyData, symbolData } from '../components/planning/atlasData.ts';

function fixture(): PlanningBaseline {
	const nodes = [
		{ id: 'origin-node', lon: 73.5, lat: 4.17, islandId: 'island' },
		{ id: 'near-node', lon: 73.501, lat: 4.17, islandId: 'island' },
		{ id: 'far-node', lon: 73.52, lat: 4.17, islandId: 'island' }
	];
	return {
		schemaVersion: 1,
		version: 'facility-test',
		generatedAt: '2026-10-10T00:00:00Z',
		referenceDate: '2026-10-10',
		sources: [],
		islands: [{ id: 'island', name: 'Island' }],
		origins: [{ ...nodes[0], id: 'origin', population2026: 100 }],
		network: {
			nodes,
			edges: [
				{
					id: 'path-near',
					from: 'origin-node',
					to: 'near-node',
					distanceM: 400,
					walkAllowed: true,
					driveAllowed: false
				},
				{
					id: 'path-far',
					from: 'near-node',
					to: 'far-node',
					distanceM: 10000,
					walkAllowed: true,
					driveAllowed: false
				}
			]
		},
		facilities: [
			{
				...nodes[2],
				id: 'care',
				name: 'Existing hospital',
				kind: 'hospital',
				verification: 'official'
			},
			{
				...nodes[2],
				id: 'school',
				name: 'Existing school',
				kind: 'school',
				verification: 'official'
			}
		],
		transit: { stops: [], patterns: [], gaps: [], accessStatus: 'complete' }
	};
}

function proposal(baseline: PlanningBaseline, kind: 'clinic' | 'school' = 'clinic') {
	const result = createFacilityProposal(baseline, { coordinate: [73.501, 4.17], kind });
	if (!result.ok) throw new Error(result.reason);
	return result.action;
}

describe('conditional school and healthcare destinations', () => {
	it('models a proposed general clinic via a permitted walking path and preserves observed data', () => {
		const baseline = fixture();
		const original = structuredClone(baseline);
		const action = proposal(baseline);
		const analysis = analyzePlanning(baseline, [action], createDefaultAssumptions(baseline));
		expect(analysis.origins[0].before.status).toBe('unreachable');
		expect(analysis.origins[0].after).toMatchObject({
			status: 'reachable',
			minutes: 5,
			destinationId: action.facility.id,
			path: [{ mode: 'walk', minutes: 5 }]
		});
		expect(analysis.summary.newlyReachedResidents).toBe(100);
		expect(analysis.world.facilities).toHaveLength(3);
		expect(analysis.transportAccess.afterResidents).toBe(0);
		expect(analysis.world.stops).toHaveLength(0);
		expect(baseline).toEqual(original);
		expect(analysis.warnings).toContainEqual(expect.stringContaining('staffing, capacity'));
	});

	it('only a proposed school changes education access; it grants no healthcare benefit', () => {
		const baseline = fixture();
		const action = proposal(baseline, 'school');
		const assumptions = createDefaultAssumptions(baseline);
		const healthcare = analyzePlanning(baseline, [action], assumptions);
		expect(healthcare.origins[0].after).toEqual(healthcare.origins[0].before);
		const education = analyzePlanning(baseline, [action], { ...assumptions, goal: 'education' });
		expect(education.summary.newlyReachedResidents).toBe(100);
		expect(education.origins[0].after.minutes).toBe(5);
	});

	it('does not treat a scenario proposal as a verified baseline or infer it open before its date', () => {
		const baseline = fixture();
		const action = proposal(baseline);
		expect(isEligibleFacility(action.facility, 'healthcare', baseline.referenceDate)).toBe(false);
		expect(isEligibleFacility(action.facility, 'healthcare', '2026-10-09', true)).toBe(false);
		expect(isEligibleFacility(action.facility, 'healthcare', '2026-10-10', true)).toBe(true);
	});

	it('shows draft and committed destination icons as unbuilt, with existing destinations unchanged', () => {
		const baseline = fixture();
		const action = proposal(baseline);
		const analysis = analyzePlanning(baseline, [action], createDefaultAssumptions(baseline));
		const previewSymbols = symbolData(baseline, analysis, 'healthcare', false, {
			draftFacilityIds: [action.facility.id]
		});
		expect(
			previewSymbols.features.find((feature) => feature.properties?.id === action.facility.id)
				?.properties
		).toMatchObject({
			mapKind: 'facility',
			icon: 'clinic',
			investmentState: 'draft',
			isBaselineAsset: false,
			statusLabel: 'Placement preview · not built'
		});
		const committedSymbols = symbolData(baseline, analysis, 'healthcare');
		expect(
			committedSymbols.features.find((feature) => feature.properties?.id === action.facility.id)
				?.properties
		).toMatchObject({ investmentState: 'proposed', statusLabel: 'Proposed · not built' });
		expect(
			committedSymbols.features.find((feature) => feature.properties?.id === 'care')?.properties
		).toMatchObject({ investmentState: 'existing', isBaselineAsset: true });
		expect(
			symbolData(baseline, analysis, 'education').features.map((feature) => feature.properties?.id)
		).toEqual(['school']);
	});

	it('draws the selected journey to a scenario school instead of looking only in baseline facilities', () => {
		const baseline = fixture();
		const action = proposal(baseline, 'school');
		const analysis = analyzePlanning(baseline, [action], {
			...createDefaultAssumptions(baseline),
			goal: 'education'
		});
		const journey = analysis.origins[0].after;
		const routes = journeyData(baseline, analysis, baseline.origins[0], {
			...journey,
			// Exercise the map's endpoint lookup as well as the routed-geometry path.
			path: journey.path.map((leg) => ({ ...leg, geometry: undefined }))
		});
		expect(routes.features).toHaveLength(1);
		expect(routes.features[0].geometry.coordinates).toEqual([
			[baseline.origins[0].lon, baseline.origins[0].lat],
			[action.facility.lon, action.facility.lat]
		]);
	});

	it('keeps unsupported facility investment, operations and carbon unknown rather than zero', () => {
		const baseline = fixture();
		const analysis = analyzePlanning(
			baseline,
			[proposal(baseline)],
			createDefaultAssumptions(baseline)
		);
		expect(analysis.costs.capitalMvr).toBeNull();
		expect(analysis.costs.annualOperatingMvr).toBeNull();
		expect(analysis.costs.annualVehicleKm).toBe(0);
		expect(analysis.costs.unavailableReasons).toContainEqual(
			expect.stringContaining('facility investment')
		);
		expect(analysis.carbon.central).toBeNull();
		expect(analysis.carbon.addedKgCo2e).toBeNull();
		expect(analysis.carbon.breakEvenDisplacedPassengerKm).toBeNull();
		expect(analysis.carbon.unavailableReasons).toContainEqual(
			expect.stringContaining('facility construction')
		);
	});

	it('snaps onto pedestrian paths even when no driving road exists, and rejects remote locations', () => {
		const baseline = fixture();
		const result = createFacilityProposal(baseline, {
			coordinate: [73.50101, 4.17001],
			kind: 'school'
		});
		expect(result).toMatchObject({ ok: true, action: { facility: { lon: 73.501, lat: 4.17 } } });
		expect(
			createFacilityProposal(baseline, { coordinate: [73.55, 4.2], kind: 'clinic' })
		).toMatchObject({
			ok: false,
			reason: expect.stringContaining('walking path')
		});
	});

	it.each([null, 'outside'])('rejects a walking node explicitly classified %s', (islandId) => {
		const baseline = fixture();
		baseline.network.nodes[1] = { ...baseline.network.nodes[1], ...{ islandId } };
		expect(
			createFacilityProposal(baseline, { coordinate: [73.501, 4.17], kind: 'clinic' })
		).toMatchObject({
			ok: false,
			reason: expect.stringContaining('supported land island')
		});
	});

	it('prevents duplicate proposals and ignores duplicate replay without changing observed facilities', () => {
		const baseline = fixture();
		const action = proposal(baseline);
		expect(
			createFacilityProposal(baseline, {
				coordinate: [73.501, 4.17],
				kind: 'clinic',
				actions: [action]
			})
		).toMatchObject({ ok: false });
		expect(derivePlanningWorld(baseline, [action, action]).facilities).toHaveLength(3);
	});

	it('rejects spoofed observed metadata and off-network imported proposals', () => {
		const baseline = fixture();
		const action = proposal(baseline);
		const spoofed: PlanningAction = {
			...action,
			facility: { ...action.facility, verification: 'official' }
		};
		expect(validSavedActions([spoofed])).toBe(false);
		expect(derivePlanningWorld(baseline, [spoofed]).facilities).toHaveLength(2);
		const remote: PlanningAction = { ...action, facility: { ...action.facility, lon: 73.55 } };
		expect(derivePlanningWorld(baseline, [remote]).facilities).toHaveLength(2);
		const wrongIsland: PlanningAction = {
			...action,
			facility: { ...action.facility, islandId: 'other' }
		};
		expect(derivePlanningWorld(baseline, [wrongIsland]).facilities).toHaveLength(2);
	});

	it('undo, redo and version-pinned JSON restore the same school destination and result', () => {
		const baseline = fixture();
		const state = new PlanningScenarioState(baseline);
		state.setAssumptions({ goal: 'education' });
		state.clearHistory();
		state.addAction(proposal(baseline, 'school'));
		const applied = state.analysis;
		const saved = state.exportJson();
		expect(state.undo()).toBe(true);
		expect(state.analysis.world.facilities).toEqual(baseline.facilities);
		expect(state.redo()).toBe(true);
		expect(state.analysis).toEqual(applied);
		const restored = new PlanningScenarioState(baseline);
		expect(restored.importJson(saved)).toEqual({ ok: true });
		expect(restored.analysis).toEqual(applied);
	});
});
