import { analyzePlanning } from '../planning/engine.ts';
import { createDefaultAssumptions } from '../planning/defaults.ts';
import type {
	PlanningAction,
	PlanningAnalysis,
	PlanningAssumptions,
	PlanningBaseline,
	PlanningDisruption,
	PlanningServicePattern,
	PlanningEdge
} from '../planning/types.ts';

export interface PolicyComparison {
	reachableResidents: number;
	gainedResidents: number;
	lostResidents: number;
	unknownResidents: number;
	worsenedResidents: number;
	meanMinutesSaved: number | null;
	annualAdditionalMvr: number | null;
	capitalAdditionalMvr: number | null;
	additionalFleet: number | null;
	population: number;
	failedResidents: number;
	accessBounds: [number, number] | null;
	islands: {
		islandId: string;
		population: number;
		reachableResidents: number;
		failedResidents: number;
		resultUnknownResidents: number;
		coveredResidents: number;
		accessRate: number | null;
		gainedResidents: number;
		lostResidents: number;
		unknownResidents: number;
	}[];
}
export interface PolicyAlternative {
	id: 'keep' | 'coordinate' | 'restore';
	label: string;
	explanation: string;
	analysis: PlanningAnalysis;
	assumptions: PlanningAssumptions;
	actions: PlanningAction[];
	comparison: PolicyComparison;
	feasibility: 'needs-review';
	owner: string;
	conditions: string[];
}
export interface PolicyDecisionBundle {
	assumptions: PlanningAssumptions;
	current: PlanningAnalysis;
	alternatives: PolicyAlternative[];
	focalOriginId: string;
	roadEvent: PlanningDisruption | null;
	roadChoices: { id: string; name: string; dependentResidents: number }[];
	timingTrials: { minutes: number; patternName: string; comparison: PolicyComparison }[];
	qualification: string[];
	recommendation: string;
}
export interface PolicyMapContext {
	actions: readonly PlanningAction[];
	assumptions: PlanningAssumptions;
	originId: string;
}
export interface PolicyOptions {
	delayMinutes?: number;
	targetMinutes?: number;
	date?: string;
	departureMinutes?: number;
	roadEdgeId?: string | null;
	baseActions?: readonly PlanningAction[];
	assumptions?: PlanningAssumptions;
}
export type PolicyAnalyzer = (
	actions: PlanningAction[],
	assumptions: PlanningAssumptions
) => Promise<PlanningAnalysis>;

/** Potential residents whose normal modeled care journey uses a pattern, once per origin. */
export function policyPatternDependencies(analysis: PlanningAnalysis): Map<string, number> {
	const weights = new Map<string, number>();
	for (const origin of analysis.origins) {
		const used = new Set(
			origin.after.path
				.filter((leg) => leg.mode === 'bus' && leg.patternId)
				.map((leg) => leg.patternId!)
		);
		for (const id of used) weights.set(id, (weights.get(id) ?? 0) + origin.population);
	}
	return weights;
}

/** Compare the selected conditions, not the engine's implicit normal-network baseline. */
export function comparePolicyOutcomes(
	current: PlanningAnalysis,
	result: PlanningAnalysis,
	changed: boolean
): PolicyComparison {
	if (
		current.targetMinutes !== result.targetMinutes ||
		current.departureMinutes !== result.departureMinutes ||
		current.goal !== result.goal ||
		current.coverage?.date !== result.coverage?.date
	)
		throw new Error(
			'Policy alternatives must use the same journey goal, target, date and departure time.'
		);
	const old = new Map(current.origins.map((o) => [o.originId, o]));
	if (
		old.size !== current.origins.length ||
		new Set(result.origins.map((o) => o.originId)).size !== result.origins.length
	)
		throw new Error('Policy comparison has duplicate origins.');
	let reachableResidents = 0,
		gainedResidents = 0,
		lostResidents = 0,
		unknownResidents = 0,
		worsenedResidents = 0,
		failedResidents = 0,
		population = 0,
		savedMinutes = 0,
		matchedPopulation = 0;
	const islands = new Map<string, PolicyComparison['islands'][number]>();
	for (const o of result.origins) {
		const previous = old.get(o.originId);
		if (
			!previous ||
			previous.islandId !== o.islandId ||
			Math.abs(previous.population - o.population) > 0.00001
		)
			throw new Error('Policy alternatives must preserve the same population and origins.');
		population += o.population;
		const island = islands.get(o.islandId) ?? {
			islandId: o.islandId,
			population: 0,
			reachableResidents: 0,
			failedResidents: 0,
			resultUnknownResidents: 0,
			coveredResidents: 0,
			accessRate: null,
			gainedResidents: 0,
			lostResidents: 0,
			unknownResidents: 0
		};
		islands.set(o.islandId, island);
		island.population += o.population;
		const passes = (j: typeof o.after) =>
			j.status === 'reachable' && j.minutes !== null && j.minutes <= result.targetMinutes;
		if (o.after.status === 'unavailable') {
			unknownResidents += o.population;
			island.resultUnknownResidents += o.population;
		} else if (passes(o.after)) {
			reachableResidents += o.population;
			island.reachableResidents += o.population;
		} else {
			failedResidents += o.population;
			island.failedResidents += o.population;
		}
		island.coveredResidents = island.population - island.resultUnknownResidents;
		island.accessRate = island.population ? island.reachableResidents / island.population : null;
		if (previous.after.status === 'unavailable' || o.after.status === 'unavailable') {
			island.unknownResidents += o.population;
			continue;
		}
		if (!passes(previous.after) && passes(o.after)) {
			gainedResidents += o.population;
			island.gainedResidents += o.population;
		}
		if (passes(previous.after) && !passes(o.after)) {
			lostResidents += o.population;
			island.lostResidents += o.population;
		}
		if (
			previous.after.status === 'reachable' &&
			o.after.status === 'reachable' &&
			previous.after.minutes !== null &&
			o.after.minutes !== null
		) {
			const saved = previous.after.minutes - o.after.minutes;
			savedMinutes += saved * o.population;
			matchedPopulation += o.population;
			if (saved < -0.01) worsenedResidents += o.population;
		}
	}
	if (old.size !== result.origins.length) throw new Error('Policy alternative omitted an origin.');
	return {
		reachableResidents,
		gainedResidents,
		lostResidents,
		unknownResidents,
		worsenedResidents,
		meanMinutesSaved: matchedPopulation ? savedMinutes / matchedPopulation : null,
		// Shifting departures and removing a road event have real implementation costs
		// outside investment economics. An engine's zero investment cost is not a quote.
		annualAdditionalMvr: changed ? null : 0,
		capitalAdditionalMvr: changed ? null : 0,
		additionalFleet: changed ? null : 0,
		population,
		failedResidents,
		accessBounds: population
			? [reachableResidents / population, (reachableResidents + unknownResidents) / population]
			: null,
		islands: [...islands.values()]
	};
}

/** Preserve every trip, duration, dwell and order; reject a shift crossing the calendar-day boundary. */
export function shiftScheduledPattern(
	pattern: PlanningServicePattern,
	minutes: number
): PlanningServicePattern | null {
	if (pattern.timing.kind !== 'scheduled' || !Number.isFinite(minutes) || Math.abs(minutes) > 15)
		return null;
	const timing = pattern.timing;
	const trips = timing.trips
		.filter((trip) =>
			trip.stopTimes.every(
				(s) => s.arrivalMinutes + minutes >= 0 && s.departureMinutes + minutes < 1440
			)
		)
		.map((trip) => ({
			...trip,
			stopTimes: trip.stopTimes.map((s) => ({
				...s,
				arrivalMinutes: s.arrivalMinutes + minutes,
				departureMinutes: s.departureMinutes + minutes
			}))
		}));
	if (!trips.length || trips.length !== timing.trips.length) return null;
	return { ...pattern, provenance: 'assumed', timing: { ...timing, trips } };
}

/** Rank modeled road dependencies, not observed traffic volume or congestion severity. */
export function criticalPolicyRoads(
	baseline: PlanningBaseline,
	analysis: PlanningAnalysis
): { edge: PlanningEdge; dependentResidents: number }[] {
	const key = (lon: number, lat: number) => `${lon.toFixed(7)},${lat.toFixed(7)}`;
	const nodes = new Map(baseline.network.nodes.map((n) => [key(n.lon, n.lat), n.id]));
	const arcs = new Map<string, PlanningEdge>();
	for (const edge of baseline.network.edges)
		if (edge.driveAllowed) {
			arcs.set(`${edge.from}|${edge.to}`, edge);
			if (!edge.oneway) arcs.set(`${edge.to}|${edge.from}`, edge);
		}
	const weights = new Map<string, { edge: PlanningEdge; dependentResidents: number }>();
	for (const origin of analysis.origins) {
		const used = new Set<string>();
		for (const leg of origin.after.path)
			if (leg.mode === 'bus') {
				let previous: string | undefined;
				for (const p of leg.geometry ?? []) {
					const node = nodes.get(key(p[0], p[1]));
					if (!node) continue;
					const edge = previous ? arcs.get(`${previous}|${node}`) : undefined;
					if (edge) used.add(edge.id);
					previous = node;
				}
			}
		for (const id of used) {
			const edge = baseline.network.edges.find((e) => e.id === id)!;
			const row = weights.get(id) ?? { edge, dependentResidents: 0 };
			row.dependentResidents += origin.population;
			weights.set(id, row);
		}
	}
	return [...weights.values()].sort(
		(a, b) => b.dependentResidents - a.dependentResidents || a.edge.id.localeCompare(b.edge.id)
	);
}

/** One mapped road used by modeled healthcare journeys. This is a what-if, not detected congestion. */
export function policyDelayEvent(
	baseline: PlanningBaseline,
	assumptions: PlanningAssumptions,
	delayMinutes: number,
	edgeId?: string
): PlanningDisruption | null {
	if (!Number.isFinite(delayMinutes) || delayMinutes < 0 || delayMinutes > 15)
		throw new Error('Use a what-if delay between 0 and 15 minutes.');
	if (!delayMinutes) return null;
	const nodes = new Map(baseline.network.nodes.map((n) => [n.id, n]));
	const edge = baseline.network.edges.find(
		(e) => e.id === edgeId && e.driveAllowed && nodes.has(e.from) && nodes.has(e.to)
	);
	if (!edge) return null;
	return {
		id: 'policy-assumed-critical-road-delay',
		name: `What-if delay: ${policyRoadLabels(baseline).get(edge.id) ?? policyRoadName(edge)}`,
		kind: 'delay',
		edgeIds: [edge.id],
		modes: ['bus'],
		direction: 'both',
		startDate: assumptions.date,
		endDate: assumptions.date,
		startMinutes: 0,
		endMinutes: 1439,
		delayMinutes,
		provenance: 'assumed',
		enabled: true,
		evidenceNote:
			'User-selected stress test on one mapped edge. Not a detected roadblock or measured congestion forecast.'
	};
}

export function policyRoadName(edge: PlanningEdge, section = 1): string {
	const name = (edge as PlanningEdge & { name?: string }).name;
	return `${name || 'Unnamed mapped road'} · section ${section}`;
}

/** Stable sections identify distinct mapped segments without exposing OSM IDs as labels. */
export function policyRoadLabels(baseline: PlanningBaseline): Map<string, string> {
	const counts = new Map<string, number>();
	const labels = new Map<string, string>();
	for (const edge of [...baseline.network.edges]
		.filter((edge) => edge.driveAllowed)
		.sort((a, b) => a.id.localeCompare(b.id))) {
		const name = (edge as PlanningEdge & { name?: string }).name || 'Unnamed mapped road';
		const section = (counts.get(name) ?? 0) + 1;
		counts.set(name, section);
		labels.set(edge.id, policyRoadName(edge, section));
	}
	return labels;
}

/** Runs sequentially so the existing latest-request-only worker can be used safely. */
export async function evaluatePolicyOptions(
	baseline: PlanningBaseline,
	options: PolicyOptions = {},
	analyze: PolicyAnalyzer = async (actions, assumptions) =>
		analyzePlanning(baseline, actions, assumptions)
): Promise<PolicyDecisionBundle> {
	const assumptions = structuredClone(options.assumptions ?? createDefaultAssumptions(baseline));
	const baseActions = structuredClone([...(options.baseActions ?? [])]);
	const originalDisruptions = (assumptions.disruptions ?? []).filter(
		(d) => d.id !== 'policy-assumed-critical-road-delay'
	);
	assumptions.disruptions = originalDisruptions;
	const target = options.targetMinutes ?? assumptions.targetMinutes;
	if (!Number.isFinite(target) || target < 10 || target > 60)
		throw new Error('Journey target must be between 10 and 60 minutes.');
	assumptions.targetMinutes = target;
	assumptions.date = options.date ?? assumptions.date;
	assumptions.departureMinutes = options.departureMinutes ?? assumptions.departureMinutes;
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(assumptions.date) ||
		!Number.isFinite(Date.parse(assumptions.date))
	)
		throw new Error('Select a valid service date.');
	if (
		!Number.isFinite(assumptions.departureMinutes) ||
		assumptions.departureMinutes < 0 ||
		assumptions.departureMinutes >= 1440
	)
		throw new Error('Select a departure time within this day.');
	assumptions.fleetResponse ??= 'fixed-fleet';
	const normal = await analyze(baseActions, assumptions);
	const critical = criticalPolicyRoads(baseline, normal);
	const roadLabels = policyRoadLabels(baseline);
	const selectedRoad = baseline.network.edges.find(
		(edge) => edge.id === options.roadEdgeId && edge.driveAllowed
	);
	if (selectedRoad && !critical.some(({ edge }) => edge.id === selectedRoad.id))
		critical.push({ edge: selectedRoad, dependentResidents: 0 });
	const roadEvent = policyDelayEvent(
		baseline,
		assumptions,
		options.delayMinutes ?? 5,
		options.roadEdgeId === null ? undefined : (options.roadEdgeId ?? critical[0]?.edge.id)
	);
	assumptions.disruptions = [...originalDisruptions, ...(roadEvent ? [roadEvent] : [])];
	const current = await analyze(baseActions, assumptions);
	const service = assumptions.goal === 'education' ? 'schools' : 'healthcare';
	const sharedConditions = [
		`One-way potential access to mapped ${service}; return trips, capacity and opening hours are not established.`,
		'Population is an allocation of official island projections, not observed passengers.',
		'The loaded timetable is a dated partial snapshot. Missing journeys remain unknown.',
		'Hulhulé and harbour-dependent islands are excluded from the resident-access comparison. Results describe the modeled residential islands, not all Maldives.',
		'Costs below are additional to the existing map proposal. No change means zero additional cost, not a free existing service.'
	];
	const alternatives: PolicyAlternative[] = [
		{
			id: 'keep',
			label: baseActions.length ? 'Keep map proposal' : 'Keep current service',
			explanation: 'Keep the existing map proposal and timetable under the same selected delay.',
			analysis: current,
			assumptions,
			actions: baseActions,
			comparison: comparePolicyOutcomes(current, current, false),
			feasibility: 'needs-review',
			owner: 'Transport operator',
			conditions: sharedConditions
		}
	];
	const affectedPatternIds = new Set(current.disruptionImpact?.affectedPatternIds ?? []);
	const dependencies = policyPatternDependencies(normal);
	const r1 = normal.world.patterns
		.filter(
			(p) =>
				p.timing.kind === 'scheduled' &&
				affectedPatternIds.has(p.id) &&
				(dependencies.get(p.id) ?? 0) > 0
		)
		.sort(
			(a, b) =>
				(dependencies.get(b.id) ?? 0) - (dependencies.get(a.id) ?? 0) || a.id.localeCompare(b.id)
		)[0];
	let coordinated = current;
	let coordinationActions: PlanningAction[] = baseActions;
	let selectedShift = 0;
	const timingTrials: PolicyDecisionBundle['timingTrials'] = [];
	if (r1) {
		// Small, declared candidate set. This is a schedule stress comparison, not a global optimizer.
		for (const shift of [-5, 5]) {
			const pattern = shiftScheduledPattern(r1, shift);
			if (!pattern) continue;
			const actions: PlanningAction[] = [
				...baseActions,
				{ kind: 'shift-timetable', patternId: r1.id, minutes: shift }
			];
			const candidate = await analyze(actions, assumptions);
			const comparison = comparePolicyOutcomes(current, candidate, true);
			timingTrials.push({ minutes: shift, patternName: r1.name, comparison });
			const best = comparePolicyOutcomes(current, coordinated, true);
			if (
				comparison.gainedResidents - comparison.lostResidents >
					best.gainedResidents - best.lostResidents ||
				(comparison.gainedResidents - comparison.lostResidents ===
					best.gainedResidents - best.lostResidents &&
					(comparison.meanMinutesSaved ?? -Infinity) > (best.meanMinutesSaved ?? -Infinity))
			) {
				coordinated = candidate;
				coordinationActions = actions;
				selectedShift = shift;
			}
		}
	}
	alternatives.push({
		id: 'coordinate',
		label: selectedShift ? 'Adjust bus times' : 'Retain bus timing',
		explanation: selectedShift
			? `Test ${r1?.name ?? 'bus'} departures ${Math.abs(selectedShift)} minutes ${selectedShift < 0 ? 'earlier' : 'later'}. Bus running speed is unchanged.`
			: r1
				? 'Neither tested five-minute departure shift improves the selected access comparison; retain current timing.'
				: 'No affected loaded direction supports a relevant departure-shift test under these conditions.',
		analysis: coordinated,
		assumptions,
		actions: coordinationActions,
		comparison: comparePolicyOutcomes(current, coordinated, selectedShift !== 0),
		feasibility: 'needs-review',
		owner: 'MTCC / RTL',
		conditions: [
			...sharedConditions,
			`Test five minutes earlier/later for the affected loaded direction used by the most modeled residents in normal journeys to ${service}. This is a bounded comparison, not a global schedule optimization. Operator duties, vehicle circulation, passenger information and costs need confirmation.`
		]
	});
	const restoredAssumptions = { ...assumptions, disruptions: originalDisruptions };
	const restored = roadEvent ? await analyze(baseActions, restoredAssumptions) : current;
	alternatives.push({
		id: 'restore',
		label: 'Test removing this delay',
		explanation: roadEvent
			? 'Remove only the assumed delay at this location. Ordinary timetable travel time is retained.'
			: 'No road delay is selected. This option makes no change.',
		analysis: restored,
		assumptions: restoredAssumptions,
		actions: baseActions,
		comparison: comparePolicyOutcomes(current, restored, !!roadEvent),
		feasibility: 'needs-review',
		owner: 'Road authority and transport operator',
		conditions: [
			...sharedConditions,
			'This is a conditional delay-removal scenario, not proof that reopening a road or parking enforcement produces this time saving.',
			'No active reviewed road closure is established by this example. Implementation costs and legal feasibility are unknown.'
		]
	});
	const focal =
		[...current.origins]
			.filter(
				(o) => o.after.status === 'reachable' && o.after.path.some((leg) => leg.mode === 'bus')
			)
			.sort((a, b) => {
				const improved = (id: string) => {
					const before = current.origins.find((o) => o.originId === id)?.after.minutes;
					const after = restored.origins.find((o) => o.originId === id)?.after.minutes;
					return before == null || after == null ? 0 : before - after;
				};
				return (
					(improved(b.originId) || 0) - (improved(a.originId) || 0) || b.population - a.population
				);
			})[0] ?? current.origins.find((o) => o.after.status === 'reachable');
	return {
		assumptions,
		current,
		alternatives,
		roadEvent,
		timingTrials,
		roadChoices: critical.map(({ edge, dependentResidents }) => ({
			id: edge.id,
			name: roadLabels.get(edge.id) ?? policyRoadName(edge),
			dependentResidents
		})),
		focalOriginId: focal?.originId ?? '',
		recommendation:
			'Compare the modeled benefits first. Costs, complete service data and operating feasibility are needed before choosing an option.',
		qualification: [
			...sharedConditions,
			`The example road is selected by population depending on it in modeled bus journeys to ${service}, not by measured road traffic or severity.`,
			'Road delay is an adjustable what-if assumption; it is not an observed or validated near-term traffic prediction.',
			'Monthly passenger forecasts support system-level capacity planning and do not determine neighborhood demand or road speeds.'
		]
	};
}

export function policyBriefSnapshot(
	bundle: PolicyDecisionBundle,
	baseline: PlanningBaseline,
	selectedId: PolicyAlternative['id']
) {
	const chosen = bundle.alternatives.find((a) => a.id === selectedId) ?? bundle.alternatives[0];
	return {
		schemaVersion: 1,
		title: `Helping people reach ${bundle.assumptions.goal === 'education' ? 'schools' : 'healthcare'}`,
		generatedAt: new Date().toISOString(),
		datasetVersion: baseline.version,
		modelVersion: chosen.analysis.versionPins.model,
		date: bundle.assumptions.date,
		departureMinutesMvt: bundle.assumptions.departureMinutes,
		criterion: `One-way modeled ${bundle.assumptions.goal} access within ${bundle.assumptions.targetMinutes} minutes`,
		selectedOption: chosen.label,
		recommendation: bundle.recommendation,
		comparison: chosen.comparison,
		alternatives: bundle.alternatives.map((a) => ({
			id: a.id,
			label: a.label,
			explanation: a.explanation,
			comparison: a.comparison,
			owner: a.owner,
			feasibility: a.feasibility,
			conditions: a.conditions
		})),
		assumptions: chosen.assumptions,
		actions: chosen.actions,
		timingTrials: bundle.timingTrials,
		qualification: bundle.qualification,
		sources: baseline.sources,
		boundsMeaning: 'Unknown-information access bounds; not forecast confidence intervals.'
	};
}
