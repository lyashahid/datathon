import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { strict as assert } from 'node:assert';
import { createDefaultAssumptions, PLANNING_MODEL_VERSION } from '../src/lib/planning/defaults.ts';
import { analyzePlanning } from '../src/lib/planning/engine.ts';
import { buildNetworkGraph, nearestGraphNode } from '../src/lib/planning/graph.ts';
import { createRoadStressCases, shortestDrivingPath } from '../src/lib/planning/disruptions.ts';
import { createBusProposal } from '../src/lib/planning/proposals.ts';

/** @typedef {import('../src/lib/planning/types.ts').PlanningAssumptions} Assumptions */
/** @typedef {import('../src/lib/planning/types.ts').PlanningAction} Action */
/** @type {import('../src/lib/planning/types.ts').PlanningBaseline} */
const baseline = JSON.parse(
	readFileSync(new URL('../data/public/planning-baseline.json', import.meta.url), 'utf8')
);
const assumptions = createDefaultAssumptions(baseline);
/** @type {{name:string, milliseconds:number, summary:unknown}[]} */
const samples = [];

/** @param {string} name @param {Action[]} actions @param {Assumptions} inputs */
function sample(name, actions, inputs) {
	const start = performance.now();
	const analysis = analyzePlanning(baseline, actions, inputs);
	const milliseconds = Math.round((performance.now() - start) * 10) / 10;
	samples.push({
		name,
		milliseconds,
		summary: {
			reachableResidents: Math.round(analysis.summary.scenarioReachableResidents),
			unknownResidents: Math.round(analysis.summary.unknownResidents),
			gainedResidents: Math.round(analysis.summary.newlyReachedResidents),
			lostResidents: Math.round(analysis.summary.lostAccessResidents),
			affectedPatterns: analysis.disruptionImpact?.affectedPatternIds.length ?? 0,
			blockedPatterns: analysis.disruptionImpact?.blockedPatternIds.length ?? 0,
			fleet: analysis.disruptionImpact?.fleetFeedback.map((f) => ({
				routeId: f.routeId,
				additionalFleet: f.additionalFleet,
				additionalProcurementFleet: f.additionalProcurementFleet,
				unavailableInputCount: f.unavailableReasons.length
			})),
			worstStressedReachableResidents: analysis.robustness
				? Math.round(analysis.robustness.worstReachableResidents)
				: null
		}
	});
	return analysis;
}

const normal = sample('baseline cold initialization', [], assumptions);
sample('baseline cached', [], assumptions);

// Pick an actual modeled service path, never an arbitrary unused road edge.
const graph = buildNetworkGraph(baseline.network);
const stops = new Map(baseline.transit.stops.map((stop) => [stop.id, stop]));
/** @type {Map<string, number>} */
const usage = new Map();
for (const pattern of baseline.transit.patterns) {
	if (pattern.mode !== 'bus' || pattern.enabled === false || pattern.runtimeUnavailableReason)
		continue;
	for (let i = 0; i < pattern.stopIds.length - 1; i++) {
		const from = stops.get(pattern.stopIds[i]);
		const to = stops.get(pattern.stopIds[i + 1]);
		if (!from || !to) continue;
		const a = nearestGraphNode(graph, from, 'drive', assumptions.maxSnapM);
		const b = nearestGraphNode(graph, to, 'drive', assumptions.maxSnapM);
		if (!a || !b) continue;
		const path = shortestDrivingPath(graph, a.index, b.index, assumptions.busMovingKph);
		for (const edgeId of path?.edgeIds ?? []) usage.set(edgeId, (usage.get(edgeId) ?? 0) + 1);
	}
}
const mostUsed = [...usage].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
assert(mostUsed, 'No mapped bus connection is available for a meaningful disruption profile.');
const [edgeId, modeledSegmentUses] = mostUsed;
/** @type {import('../src/lib/planning/types.ts').PlanningDisruption} */
const event = {
	id: 'profile-road-delay',
	name: 'Profile assumed road delay',
	kind: 'delay',
	edgeIds: [edgeId],
	modes: ['bus'],
	direction: 'both',
	startDate: assumptions.date,
	endDate: assumptions.date,
	startMinutes: 0,
	endMinutes: 1440,
	delayMinutes: 5,
	provenance: 'assumed',
	evidenceNote: 'Performance exercise only; not an observed road event.'
};
const delayInputs = { ...assumptions, disruptions: [event] };
const delay = sample('bus delay first analysis after initialization', [], delayInputs);
assert(delay.disruptionImpact?.affectedPatternIds.length, 'Chosen edge must affect a bus pattern.');
assert.deepEqual(sample('bus delay cached', [], delayInputs), delay);
const closure = { ...event, id: 'profile-road-closure', kind: /** @type {const} */ ('closure') };
const closureInputs = { ...assumptions, disruptions: [closure] };
const closed = sample('bus closure first analysis after initialization', [], closureInputs);
assert(
	closed.disruptionImpact?.affectedPatternIds.length,
	'Chosen closure must affect a bus pattern.'
);
assert.deepEqual(sample('bus closure cached', [], closureInputs), closed);
const fixedFleetInputs = { ...delayInputs, fleetResponse: /** @type {const} */ ('fixed-fleet') };
const fixed = sample('bus delay fixed fleet first analysis', [], fixedFleetInputs);
assert.deepEqual(sample('bus delay fixed fleet cached', [], fixedFleetInputs), fixed);
const pedestrianClosure = {
	...closure,
	id: 'profile-road-walk-closure',
	modes: /** @type {('bus'|'walk')[]} */ (['bus', 'walk'])
};
const pedestrianInputs = { ...assumptions, disruptions: [pedestrianClosure] };
const pedestrian = sample('bus and walking closure first analysis', [], pedestrianInputs);
assert.deepEqual(sample('bus and walking closure cached', [], pedestrianInputs), pedestrian);

const stresses = createRoadStressCases([edgeId], assumptions);
const robustInputs = { ...assumptions, robustnessStresses: stresses };
const robust = sample('normal plus two stress comparisons first analysis', [], robustInputs);
assert.deepEqual(sample('normal plus two stress comparisons cached', [], robustInputs), robust);

let proposal;
for (const origin of normal.priorities.slice(0, 10)) {
	proposal = createBusProposal(baseline, {
		originId: origin.originId,
		headwayMinutes: 15,
		assumptions
	});
	if (proposal.ok) break;
}
assert(proposal?.ok, 'No legal priority-area intervention is available for the profile.');
const proposed = sample('bus investment first analysis', [proposal.action], assumptions);
assert.deepEqual(sample('bus investment cached', [proposal.action], assumptions), proposed);
const robustProposed = sample(
	'bus investment normal plus two stresses',
	[proposal.action],
	robustInputs
);
assert.deepEqual(
	sample('bus investment normal plus two stresses cached', [proposal.action], robustInputs),
	robustProposed
);

console.info(
	JSON.stringify(
		{
			profiledAt: new Date().toISOString(),
			node: process.version,
			platform: `${process.platform}/${process.arch}`,
			model: PLANNING_MODEL_VERSION,
			dataset: baseline.version,
			date: assumptions.date,
			departureMinutesMvt: assumptions.departureMinutes,
			counts: {
				nodes: baseline.network.nodes.length,
				edges: baseline.network.edges.length,
				origins: baseline.origins.length,
				patterns: baseline.transit.patterns.length
			},
			edgeId,
			modeledSegmentUses,
			interpretation:
				'Node model timings on the cached public bundle. Browser worker initialization, rendering and device performance must be measured separately. Multi-case comparisons run multiple complete analyses. Cached results are checked for deep equality.',
			samples
		},
		null,
		2
	)
);
