import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { createDefaultAssumptions, PLANNING_MODEL_VERSION } from '../src/lib/planning/defaults.ts';
import { analyzePlanning } from '../src/lib/planning/engine.ts';
import { createBusProposal } from '../src/lib/planning/proposals.ts';
import { buildNetworkGraph, nearestGraphNode, distanceM } from '../src/lib/planning/graph.ts';
import { shortestDrivingPath } from '../src/lib/planning/disruptions.ts';
import { createFerryRuntimeAssumption } from '../src/lib/planning/ferryAssumption.ts';
import { derivePlanningWorld } from '../src/lib/planning/scenario.ts';
import { computeAppointmentJourney } from '../src/lib/planning/returnJourney.ts';
import { validSavedActions, validPlanningAssumptions } from '../src/lib/planning/validation.ts';

/** Cached inputs only: this script makes no network requests. */
const baselineBytes = readFileSync(
	new URL('../data/public/planning-baseline.json', import.meta.url)
);
/** @type {import('../src/lib/planning/types.ts').PlanningBaseline} */
const baseline = JSON.parse(baselineBytes.toString('utf8'));
/** @type {import('../src/lib/operations/types.ts').OperationsBundle} */
const operations = JSON.parse(
	readFileSync(new URL('../data/public/operations/bundle.json', import.meta.url), 'utf8')
);
const outputDirectory = new URL('../static/demo/', import.meta.url);
const check = process.argv.includes('--check');
const assumptions = createDefaultAssumptions(baseline);

// These illustrative inputs match the UI's editable cost preset. They are not
// route-specific procurement quotes, observed ridership, or verified grid factors.
assumptions.costs = {
	...assumptions.costs,
	stopCapitalMvr: { low: 150000, central: 250000, high: 450000 },
	dieselBusCapitalMvr: { low: 1500000, central: 2300000, high: 3200000 },
	electricBusCapitalMvr: { low: 2600000, central: 3600000, high: 5000000 },
	chargingInfrastructureMvr: { low: 100000, central: 300000, high: 500000 },
	dieselOperatingMvrPerKm: { low: 24, central: 36, high: 52 },
	electricOperatingMvrPerKm: { low: 18, central: 30, high: 46 },
	dieselKgCo2ePerKm: { low: 0.68, central: 0.85, high: 1.07 },
	electricKgCo2ePerKm: { low: 0.32, central: 0.66, high: 1.08 },
	displacedKgCo2ePerPassengerKm: { low: 0.06, central: 0.11, high: 0.18 }
};
assumptions.dieselLitresPerVehicleKm = { low: 0.25, central: 0.32, high: 0.4 };
assumptions.dieselKgCo2ePerLitre = { low: 2.65, central: 2.68, high: 2.72 };
assumptions.displacedPassengerKm = { low: 0, central: 0, high: 0 };
assumptions.policyDelivery = {
	responsibleAgency: 'MTCC / RTL, with the relevant local council',
	phases: ['Verify operations and walking connections', 'Pilot service', 'Measure and adjust'],
	outstandingVerification: [
		'Illustrative operating and procurement inputs require local quotes.',
		'Passenger demand and private-trip displacement have not been measured.',
		'Current full-day service calendars and pedestrian restrictions require confirmation.'
	]
};

/** @param {string} filename @param {unknown} value */
function save(filename, value) {
	const url = new URL(filename, outputDirectory);
	if (check)
		assert.deepEqual(JSON.parse(readFileSync(url, 'utf8')), value, `${filename} is stale.`);
	else writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`);
}
/** @param {import('../src/lib/planning/types.ts').PlanningAction[]} actions
 * @param {import('../src/lib/planning/types.ts').PlanningAssumptions} inputs */
function scenario(actions, inputs) {
	assert(validSavedActions(actions), 'Demo actions must pass the actual import validator.');
	assert(validPlanningAssumptions(inputs), 'Demo inputs must pass the actual import validator.');
	return {
		schemaVersion: 1,
		datasetVersion: baseline.version,
		modelVersion: PLANNING_MODEL_VERSION,
		actions,
		assumptions: inputs
	};
}
/** @param {import('../src/lib/planning/types.ts').PlanningAnalysis} analysis
 * @param {string} originId */
function summary(analysis, originId) {
	const origin = analysis.origins.find((origin) => origin.originId === originId);
	assert(origin);
	return {
		originId,
		originPopulation: origin.population,
		beforeJourneyMinutes: origin.before.minutes,
		afterJourneyMinutes: origin.after.minutes,
		newlyReachedResidents: analysis.summary.newlyReachedResidents,
		unknownResidents: analysis.summary.unknownResidents,
		capitalMvr: analysis.costs.capitalMvr,
		annualOperatingMvr: analysis.costs.annualOperatingMvr,
		annualVehicleKm: analysis.costs.annualVehicleKm,
		requiredFleet: analysis.costs.requiredFleet,
		carbonKgCo2e: {
			low: analysis.carbon.low,
			central: analysis.carbon.central,
			high: analysis.carbon.high
		},
		breakEvenDisplacedPassengerKm: analysis.carbon.breakEvenDisplacedPassengerKm,
		coverage: analysis.coverage,
		affectedPatternIds: analysis.disruptionImpact?.affectedPatternIds ?? []
	};
}
/** @param {import('../src/lib/planning/returnJourney.ts').AppointmentJourney} result */
function appointmentSummary(result) {
	return {
		status: result.status,
		reason: result.reason,
		destination: result.destination?.name ?? null,
		departAt: result.departAt,
		arriveAt: result.arriveAt,
		returnDepartAt: result.returnDepartAt,
		homeAt: result.homeAt,
		warnings: result.warnings
	};
}
const normal = analyzePlanning(baseline, [], assumptions);
let chosen;
for (const priority of normal.priorities.slice(0, 30)) {
	const proposal = createBusProposal(baseline, {
		originId: priority.originId,
		headwayMinutes: 10,
		assumptions
	});
	if (!proposal.ok || proposal.action.kind !== 'add-route') continue;
	const analysis = analyzePlanning(baseline, [proposal.action], assumptions);
	if (
		analysis.summary.newlyReachedResidents > 0 &&
		analysis.costs.capitalMvr &&
		analysis.costs.annualOperatingMvr &&
		(analysis.carbon.central ?? 0) > 0
	) {
		chosen = { originId: priority.originId, action: proposal.action, analysis };
		break;
	}
}
assert(chosen, 'No feasible, verified-destination, positive-access demo investment was found.');
const { originId, action, analysis } = chosen;
assert(analysis.costs.capitalMvr && analysis.costs.annualOperatingMvr);
assert(analysis.costs.annualVehicleKm !== null && analysis.costs.requiredFleet !== null);
assert(analysis.carbon.central !== null);
assert(action.stops && action.stops.length === 2);
const origin = baseline.origins.find((origin) => origin.id === originId);
assert(origin);
const appointmentOptions = { appointmentMinutes: 60, returnDeadlineMinutes: 1200 };
const appointment = computeAppointmentJourney(
	baseline,
	derivePlanningWorld(baseline, [action], assumptions),
	originId,
	assumptions,
	appointmentOptions
);
assert.equal(appointment.status, 'feasible', 'The appointment demo must have a usable return.');

// Independent arithmetic checks for the explicit new two-direction service.
assert(action.returnPattern && action.pattern.timing.kind === 'frequency');
assert(action.returnPattern.timing.kind === 'frequency');
const patterns = [action.pattern, action.returnPattern];
const calculatedKm = patterns.reduce((total, pattern) => {
	assert(pattern.timing.kind === 'frequency' && pattern.distanceM !== undefined);
	const trips = pattern.timing.windows.reduce(
		(total, window) => total + (window.endMinutes - window.startMinutes) / window.headwayMinutes,
		0
	);
	return total + (pattern.distanceM / 1000) * trips * assumptions.annualOperatingDays;
}, 0);
assert(Math.abs(calculatedKm - analysis.costs.annualVehicleKm) < 1e-6);
assert(Math.abs(calculatedKm * 36 - analysis.costs.annualOperatingMvr.central) < 1e-6);
assert(Math.abs(calculatedKm * 0.32 * 2.68 - analysis.carbon.central) < 1e-6);
assert.equal(
	analysis.costs.capitalMvr.central,
	analysis.costs.requiredFleet * 2300000 + action.stops.length * 250000
);

// Close a real OSM edge on the proposed path. The event itself is explicitly assumed.
const graph = buildNetworkGraph(baseline.network);
const [fromStop, toStop] = action.stops;
const from = nearestGraphNode(graph, fromStop, 'drive', assumptions.maxSnapM);
const to = nearestGraphNode(graph, toStop, 'drive', assumptions.maxSnapM);
assert(from && to);
const path = shortestDrivingPath(graph, from.index, to.index, assumptions.busMovingKph);
assert(path?.edgeIds.length);
let closureCase;
const edgeCandidates = [
	path.edgeIds[Math.floor(path.edgeIds.length / 2)],
	...path.edgeIds.slice(0, 10)
];
for (const edgeId of edgeCandidates) {
	/** @type {import('../src/lib/planning/types.ts').PlanningDisruption} */
	const event = {
		id: 'demo-assumed-road-closure',
		name: 'Assumed roadworks: test a detour',
		kind: 'closure',
		edgeIds: [edgeId],
		modes: ['bus'],
		direction: 'both',
		startDate: assumptions.date,
		endDate: assumptions.date,
		startMinutes: 900,
		endMinutes: 1080,
		provenance: 'assumed',
		evidenceNote: 'Offline demonstration only. This is not an observed road closure.'
	};
	/** @type {import('../src/lib/planning/types.ts').PlanningAssumptions} */
	const inputs = { ...assumptions, disruptions: [event], fleetResponse: 'maintain-frequency' };
	const closed = analyzePlanning(baseline, [action], inputs);
	if (closed.disruptionImpact?.affectedPatternIds.includes(action.pattern.id)) {
		closureCase = { inputs, analysis: closed, event };
		break;
	}
}
assert(closureCase, 'Demo closure must affect the selected route.');

// Ferry evidence is public, but the missing crossing duration is not silently filled.
assert(operations.ferryEvidence, 'Cached official ferry evidence is required for this demo.');
const ferryInputs = { ...assumptions, targetMinutes: 60 };
const ferryDraft = createFerryRuntimeAssumption(baseline, operations.ferryEvidence, {
	date: ferryInputs.date,
	crossingMinutes: 10,
	acknowledgeCalendarValidity: true
});
assert(ferryDraft.ok, ferryDraft.ok ? '' : ferryDraft.reason);
const ferryWorld = derivePlanningWorld(baseline, [ferryDraft.action], ferryInputs);
const terminal = operations.ferryEvidence.terminals.find(
	(terminal) => terminal.islandId === 'vilimale'
);
assert(terminal);
const ferryOrigins = baseline.origins
	.filter((origin) => origin.islandId === 'vilimale')
	.sort(
		(a, b) =>
			distanceM(a, { lon: terminal.coordinates[0], lat: terminal.coordinates[1] }) -
			distanceM(b, { lon: terminal.coordinates[0], lat: terminal.coordinates[1] })
	);
let ferryCase;
for (const origin of ferryOrigins) {
	const result = computeAppointmentJourney(
		baseline,
		ferryWorld,
		origin.id,
		ferryInputs,
		appointmentOptions
	);
	if (result.status === 'feasible') {
		ferryCase = { origin, result };
		break;
	}
}
assert(ferryCase, 'The explicit-runtime ferry demo must yield a conditional return journey.');
const unknownFerry = computeAppointmentJourney(
	baseline,
	derivePlanningWorld(baseline, [], ferryInputs),
	ferryCase.origin.id,
	ferryInputs,
	appointmentOptions
);
assert.equal(
	unknownFerry.status,
	'unavailable',
	'Missing baseline ferry runtime must stay unknown.'
);

if (!check) mkdirSync(outputDirectory, { recursive: true });
save('01-bus-investment.json', scenario([action], assumptions));
save('02-road-closure.json', scenario([action], closureCase.inputs));
save('03-ferry-unknown.json', scenario([], ferryInputs));
save('04-ferry-assumed-runtime.json', scenario([ferryDraft.action], ferryInputs));
const catalog = {
	schemaVersion: 1,
	datasetVersion: baseline.version,
	modelVersion: PLANNING_MODEL_VERSION,
	baselineSha256: createHash('sha256').update(baselineBytes).digest('hex'),
	operationsVersion: operations.version,
	planningDate: assumptions.date,
	departureMinutesMvt: assumptions.departureMinutes,
	inputQualification:
		'Public cached sources underpin the baseline. New service, road closure, costs, emissions factors and ferry crossing duration are editable scenario assumptions. No private-travel displacement or observed congestion is claimed.',
	appointmentOptions,
	cases: [
		{
			id: 'bus-investment',
			file: '/demo/01-bus-investment.json',
			title: 'Hulhumalé healthcare connection',
			mapCenter: [origin.lon, origin.lat],
			selectedPatternId: action.pattern.id,
			...summary(analysis, originId),
			appointment: appointmentSummary(appointment)
		},
		{
			id: 'road-closure',
			file: '/demo/02-road-closure.json',
			title: 'What if roadworks affect this investment?',
			mapCenter: [origin.lon, origin.lat],
			selectedPatternId: action.pattern.id,
			...summary(closureCase.analysis, originId),
			event: closureCase.event,
			fleetFeedback: closureCase.analysis.disruptionImpact?.fleetFeedback ?? []
		},
		{
			id: 'ferry-unknown',
			file: '/demo/03-ferry-unknown.json',
			title: 'Vilimalé: missing crossing time remains unknown',
			originId: ferryCase.origin.id,
			mapCenter: [ferryCase.origin.lon, ferryCase.origin.lat],
			appointment: appointmentSummary(unknownFerry)
		},
		{
			id: 'ferry-assumed-runtime',
			file: '/demo/04-ferry-assumed-runtime.json',
			title: 'Vilimalé: test an explicit 10-minute crossing',
			originId: ferryCase.origin.id,
			mapCenter: [ferryCase.origin.lon, ferryCase.origin.lat],
			selectedPatternId: ferryDraft.action.pattern.id,
			appointment: appointmentSummary(ferryCase.result),
			warnings: ferryDraft.warnings,
			sourceUrl: operations.ferryEvidence.sourceUrl
		}
	]
};
save('catalog.json', catalog);
console.info(
	JSON.stringify(
		{
			mode: check ? 'verified' : 'created',
			dataset: baseline.version,
			model: PLANNING_MODEL_VERSION,
			originId,
			gainedResidents: Math.round(analysis.summary.newlyReachedResidents),
			capitalMvr: analysis.costs.capitalMvr.central,
			annualOperatingMvr: Math.round(analysis.costs.annualOperatingMvr.central),
			addedCarbonTonnes: +(analysis.carbon.central / 1000).toFixed(1),
			closureEdge: closureCase.event.edgeIds[0],
			ferryOriginId: ferryCase.origin.id,
			output: 'static/demo/'
		},
		null,
		2
	)
);
