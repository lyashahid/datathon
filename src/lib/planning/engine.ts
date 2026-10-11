import { PLANNING_MODEL_VERSION } from './defaults.ts';
import { planningCoverage } from './coverage.ts';
import { planningPopulation } from './population.ts';
import { calculatePlanningEconomics } from './economics.ts';
import {
	applyPlanningDisruptions,
	disruptionIsActive,
	repricePlanningDisruptionImpact,
	type DisruptedPlanningWorld
} from './disruptions.ts';
import {
	createRoutingContext,
	originHasSpatialTransitAccess,
	routePlanningOrigin,
	type RoutingContext
} from './routing.ts';
import { derivePlanningWorld, type PlanningWorld } from './scenario.ts';
import type {
	PlanningAction,
	PlanningAnalysis,
	PlanningAssumptions,
	PlanningBaseline,
	PlanningJourney,
	PlanningRobustnessCase
} from './types.ts';

const baselineRoutingCache = new WeakMap<
	PlanningBaseline,
	Map<string, { context: RoutingContext; journeys: PlanningJourney[]; spatial: (boolean | null)[] }>
>();
type CachedRouting = {
	context: RoutingContext;
	journeys: PlanningJourney[];
	spatial: (boolean | null)[];
	disrupted?: DisruptedPlanningWorld;
};
const scenarioRoutingCache = new WeakMap<PlanningBaseline, Map<string, CachedRouting>>();
function routingKey(assumptions: PlanningAssumptions) {
	const {
		date,
		departureMinutes,
		goal,
		walkMPerMinute,
		maxJourneyMinutes,
		maxTransfers,
		maxAccessWalkMinutes,
		maxTransferWalkMinutes,
		maxSnapM,
		boardingBufferMinutes
	} = assumptions;
	return JSON.stringify({
		date,
		departureMinutes,
		goal,
		walkMPerMinute,
		maxJourneyMinutes,
		maxTransfers,
		maxAccessWalkMinutes,
		maxTransferWalkMinutes,
		maxSnapM,
		boardingBufferMinutes,
		targetMinutes: assumptions.targetMinutes,
		walkingRequirements: assumptions.walkingRequirements,
		destinationRequirements: assumptions.destinationRequirements,
		disruptions: assumptions.disruptions,
		fleetResponse: assumptions.fleetResponse
	});
}
function baselineRouting(
	baseline: PlanningBaseline,
	assumptions: PlanningAssumptions
): CachedRouting {
	// Population, finance and mode shift do not alter the journey search. Eight routing views
	// are retained per immutable data bundle; cached paths remain private to this engine.
	const key = routingKey(assumptions);
	let cache = baselineRoutingCache.get(baseline);
	if (!cache) {
		cache = new Map();
		baselineRoutingCache.set(baseline, cache);
	}
	let entry = cache.get(key);
	if (!entry) {
		const context = createRoutingContext(baseline, derivePlanningWorld(baseline, []), assumptions);
		entry = {
			context,
			journeys: baseline.origins.map((o) => routePlanningOrigin(context, o, assumptions)),
			spatial: baseline.origins.map((o) => originHasSpatialTransitAccess(context, o, assumptions))
		};
		if (cache.size >= 8) cache.delete(cache.keys().next().value!);
		cache.set(key, entry);
	}
	return entry;
}
function scenarioRouting(
	baseline: PlanningBaseline,
	actions: readonly PlanningAction[],
	world: PlanningWorld,
	assumptions: PlanningAssumptions
): CachedRouting {
	const key = `${routingKey(assumptions)}|${assumptions.busMovingKph}|${assumptions.busDwellMinutes}|${assumptions.layoverMinutes}|${JSON.stringify(actions)}`;
	let cache = scenarioRoutingCache.get(baseline);
	if (!cache) {
		cache = new Map();
		scenarioRoutingCache.set(baseline, cache);
	}
	let entry = cache.get(key);
	if (!entry) {
		const disrupted = applyPlanningDisruptions(baseline, world, assumptions);
		const walkingAffected = assumptions.disruptions?.some(
			(event) =>
				event.kind === 'closure' &&
				event.modes.includes('walk') &&
				disruptionIsActive(event, assumptions.date, assumptions.departureMinutes)
		);
		const context = createRoutingContext(
			walkingAffected ? { ...baseline, network: disrupted.network } : baseline,
			disrupted.world,
			assumptions,
			baseline.network
		);
		entry = {
			context,
			disrupted,
			journeys: baseline.origins.map((o) => routePlanningOrigin(context, o, assumptions)),
			spatial: baseline.origins.map((o) => originHasSpatialTransitAccess(context, o, assumptions))
		};
		if (cache.size >= 8) cache.delete(cache.keys().next().value!);
		cache.set(key, entry);
	}
	return entry;
}

/** One engine drives preview, committed scenario and comparison; no UI-specific calculations. */
export function analyzePlanning(
	baseline: PlanningBaseline,
	actions: readonly PlanningAction[],
	assumptions: PlanningAssumptions
): PlanningAnalysis {
	const result = analyzePlanningCore(baseline, actions, assumptions);
	if (assumptions.robustnessStresses?.length) {
		const normalAssumptions = { ...assumptions, disruptions: [], robustnessStresses: undefined };
		const normal = assumptions.disruptions?.some((event) => event.enabled !== false)
			? analyzePlanningCore(baseline, actions, normalAssumptions)
			: result;
		const toCase = (
			analysis: PlanningAnalysis,
			base: PlanningAnalysis,
			id: string,
			name: string
		): PlanningRobustnessCase => ({
			id,
			name,
			baselineReachableResidents: base.summary.scenarioReachableResidents,
			scenarioReachableResidents: analysis.summary.scenarioReachableResidents,
			retainedAccessResidents: analysis.origins
				.filter(
					(origin, index) =>
						normal.origins[index].after.status === 'reachable' &&
						normal.origins[index].after.minutes! <= assumptions.targetMinutes &&
						origin.after.status === 'reachable' &&
						origin.after.minutes! <= assumptions.targetMinutes
				)
				.reduce((sum, origin) => sum + origin.population, 0),
			gainedResidents: analysis.origins
				.filter(
					(origin, index) =>
						base.origins[index].after.status !== 'unavailable' &&
						!(
							base.origins[index].after.status === 'reachable' &&
							base.origins[index].after.minutes! <= assumptions.targetMinutes
						) &&
						origin.after.status === 'reachable' &&
						origin.after.minutes! <= assumptions.targetMinutes
				)
				.reduce((sum, origin) => sum + origin.population, 0),
			lostResidents: analysis.origins
				.filter(
					(origin, index) =>
						base.origins[index].after.status === 'reachable' &&
						base.origins[index].after.minutes! <= assumptions.targetMinutes &&
						origin.after.status !== 'unavailable' &&
						!(
							origin.after.status === 'reachable' &&
							origin.after.minutes! <= assumptions.targetMinutes
						)
				)
				.reduce((sum, origin) => sum + origin.population, 0),
			unknownResidents: analysis.summary.unknownResidents,
			additionalFleet: analysis.disruptionImpact?.fleetFeedback.some(
				(item) => item.additionalFleet === null
			)
				? null
				: (analysis.disruptionImpact?.fleetFeedback.reduce(
						(sum, item) => sum + (item.additionalFleet ?? 0),
						0
					) ?? 0),
			capitalMvr: analysis.costs.capitalMvr,
			annualOperatingMvr: analysis.costs.annualOperatingMvr,
			carbonKgCo2e:
				analysis.carbon.low === null ||
				analysis.carbon.central === null ||
				analysis.carbon.high === null
					? null
					: {
							low: analysis.carbon.low,
							central: analysis.carbon.central,
							high: analysis.carbon.high
						}
		});
		const baseNormal = actions.length
			? analyzePlanningCore(baseline, [], normalAssumptions)
			: normal;
		const stresses = assumptions.robustnessStresses.slice(0, 3).map((stress) => {
			const stressAssumptions = { ...normalAssumptions, disruptions: stress.disruptions };
			const candidate = analyzePlanningCore(baseline, actions, stressAssumptions);
			return toCase(
				candidate,
				actions.length ? analyzePlanningCore(baseline, [], stressAssumptions) : candidate,
				stress.id,
				stress.name
			);
		});
		result.robustness = {
			normal: toCase(normal, baseNormal, 'normal', 'Normal service'),
			stresses,
			worstReachableResidents: Math.min(
				normal.summary.scenarioReachableResidents,
				...stresses.map((stress) => stress.scenarioReachableResidents)
			),
			method:
				'Identical population, destinations, reference timetables and intervention actions; only explicit disruption inputs vary. Stress tests are assumptions, not forecasts or probability estimates.'
		};
	}
	return result;
}

function analyzePlanningCore(
	baseline: PlanningBaseline,
	actions: readonly PlanningAction[],
	assumptions: PlanningAssumptions
): PlanningAnalysis {
	const normalWorld = derivePlanningWorld(baseline, actions, assumptions);
	const normalAssumptions = { ...assumptions, disruptions: undefined };
	const beforeRouting = baselineRouting(baseline, normalAssumptions);
	const beforeContext = beforeRouting.context;
	const hasScenario =
		actions.length > 0 || !!assumptions.disruptions?.some((event) => event.enabled !== false);
	const afterRouting = hasScenario
		? scenarioRouting(baseline, actions, normalWorld, assumptions)
		: beforeRouting;
	const afterContext = afterRouting.context;
	const disruption =
		afterRouting.disrupted ?? applyPlanningDisruptions(baseline, normalWorld, normalAssumptions);
	const world = disruption.world;
	const target = assumptions.targetMinutes;
	const populationDistribution = planningPopulation(baseline, assumptions);
	const coverage = planningCoverage(baseline, assumptions);
	const beforeJourneys = structuredClone(beforeRouting.journeys);
	const afterJourneys = hasScenario ? structuredClone(afterRouting.journeys) : beforeJourneys;
	const origins = baseline.origins.map((origin, index) => {
		const before = beforeJourneys[index];
		const after = afterJourneys[index];
		const population = populationDistribution.byOrigin.get(origin.id)!;
		const beforeAccess = before.status === 'reachable' && before.minutes! <= target;
		const afterAccess = after.status === 'reachable' && after.minutes! <= target;
		return {
			originId: origin.id,
			islandId: origin.islandId,
			population,
			before,
			after,
			deltaMinutes:
				before.minutes !== null && after.minutes !== null ? before.minutes - after.minutes : null,
			newlyReachable: before.status !== 'unavailable' && !beforeAccess && afterAccess,
			lostAccess: after.status !== 'unavailable' && beforeAccess && !afterAccess,
			worsenedJourney:
				before.status === 'reachable' &&
				after.status === 'reachable' &&
				after.minutes! > before.minutes! + 0.01,
			becameUnavailable: before.status !== 'unavailable' && after.status === 'unavailable'
		};
	});
	let weightedMinutes = 0;
	let matchedPopulation = 0;
	for (const origin of origins)
		if (
			origin.deltaMinutes !== null &&
			origin.before.status === 'reachable' &&
			origin.before.minutes! <= target &&
			origin.after.status === 'reachable'
		) {
			weightedMinutes += origin.deltaMinutes * origin.population;
			matchedPopulation += origin.population;
		}
	const priorities = origins
		.filter(
			(o) =>
				o.population > 0 &&
				o.before.status !== 'unavailable' &&
				(o.before.status !== 'reachable' || o.before.minutes! > target)
		)
		.map((o) => ({
			originId: o.originId,
			population: o.population,
			minutesToHospital: o.before.minutes,
			reason: o.before.reason ?? `More than ${target} minutes from ${assumptions.goal}.`
		}))
		.sort((a, b) => b.population - a.population || a.originId.localeCompare(b.originId));
	const warnings = [
		...new Set([
			...beforeContext.warnings,
			...afterContext.warnings,
			...baseline.transit.gaps,
			...populationDistribution.warnings,
			...coverage.reasons
		])
	];
	if (baseline.transit.accessStatus !== 'complete')
		warnings.push(
			'The comparison includes only mapped walking paths and loaded service patterns. Missing published service data limits baseline completeness.'
		);
	if (assumptions.populationYear === 2030 && baseline.origins.some((o) => o.population2030 == null))
		warnings.push('Some origins lack 2030 population: the 2026 value is shown for those origins.');
	const spatial = baseline.origins.map((origin, i) => ({
		before: beforeRouting.spatial[i],
		after: afterRouting.spatial[i],
		population: origins[i].population
	}));
	const population = origins.reduce((s, o) => s + o.population, 0);
	const beforeResidents = spatial.filter((o) => o.before).reduce((s, o) => s + o.population, 0);
	const afterResidents = spatial.filter((o) => o.after).reduce((s, o) => s + o.population, 0);
	const islandSummaries = baseline.islands.map((island) => {
		const local = origins.filter((o) => o.islandId === island.id);
		const sum = (filter: (o: (typeof origins)[number]) => boolean) =>
			local.filter(filter).reduce((s, o) => s + o.population, 0);
		return {
			islandId: island.id,
			population: sum(() => true),
			baselineReachableResidents: sum(
				(o) => o.before.status === 'reachable' && o.before.minutes! <= target
			),
			scenarioReachableResidents: sum(
				(o) => o.after.status === 'reachable' && o.after.minutes! <= target
			),
			gainedResidents: sum((o) => o.newlyReachable),
			lostResidents: sum((o) => o.lostAccess),
			unknownResidents: sum(
				(o) => o.before.status === 'unavailable' || o.after.status === 'unavailable'
			),
			worsenedJourneyResidents: sum((o) => o.worsenedJourney),
			becameUnavailableResidents: sum((o) => o.becameUnavailable)
		};
	});
	// The cached impact is immutable. Resident consequences depend on population/target
	// assumptions and must not mutate a previous analysis or accumulate across reruns.
	const disruptionImpact = {
		...repricePlanningDisruptionImpact(disruption.impact, world, assumptions),
		lostAccessResidents: 0,
		worsenedJourneyResidents: 0
	};
	if (assumptions.disruptions?.length) {
		const normalRouting = actions.length
			? scenarioRouting(baseline, actions, normalWorld, normalAssumptions)
			: beforeRouting;
		for (const [index, origin] of origins.entries()) {
			const normalJourney = normalRouting.journeys[index];
			if (
				normalJourney.status === 'reachable' &&
				normalJourney.minutes! <= target &&
				origin.after.status !== 'unavailable' &&
				!(origin.after.status === 'reachable' && origin.after.minutes! <= target)
			)
				disruptionImpact.lostAccessResidents += origin.population;
			if (
				normalJourney.status === 'reachable' &&
				origin.after.status === 'reachable' &&
				origin.after.minutes! > normalJourney.minutes! + 0.01
			)
				disruptionImpact.worsenedJourneyResidents += origin.population;
		}
	}
	return {
		targetMinutes: target,
		departureMinutes: assumptions.departureMinutes,
		goal: assumptions.goal,
		coverage,
		islandSummaries,
		versionPins: {
			dataset: baseline.version,
			model: PLANNING_MODEL_VERSION,
			schema: baseline.schemaVersion
		},
		origins,
		priorities,
		summary: {
			population: origins.reduce((s, o) => s + o.population, 0),
			newlyReachedResidents: origins
				.filter((o) => o.newlyReachable)
				.reduce((s, o) => s + o.population, 0),
			lostAccessResidents: origins
				.filter((o) => o.lostAccess)
				.reduce((s, o) => s + o.population, 0),
			minutesSavedForAlreadyReachable: matchedPopulation
				? weightedMinutes / matchedPopulation
				: null,
			baselineReachableResidents: origins
				.filter((o) => o.before.status === 'reachable' && o.before.minutes! <= target)
				.reduce((s, o) => s + o.population, 0),
			scenarioReachableResidents: origins
				.filter((o) => o.after.status === 'reachable' && o.after.minutes! <= target)
				.reduce((s, o) => s + o.population, 0),
			unknownResidents: origins
				.filter((o) => o.before.status === 'unavailable' || o.after.status === 'unavailable')
				.reduce((s, o) => s + o.population, 0),
			worsenedJourneyResidents: origins
				.filter((o) => o.worsenedJourney)
				.reduce((s, o) => s + o.population, 0),
			becameUnavailableResidents: origins
				.filter((o) => o.becameUnavailable)
				.reduce((s, o) => s + o.population, 0)
		},
		world: { stops: world.stops, patterns: world.patterns, facilities: world.facilities },
		...calculatePlanningEconomics(baseline, normalWorld, assumptions),
		disruptionImpact,
		warnings,
		transportAccess: {
			beforeResidents,
			afterResidents,
			gainedResidents: spatial
				.filter((o) => o.before === false && o.after)
				.reduce((s, o) => s + o.population, 0),
			lostResidents: spatial
				.filter((o) => o.before && o.after === false)
				.reduce((s, o) => s + o.population, 0),
			unknownResidents: spatial
				.filter((o) => o.before === null || o.after === null)
				.reduce((s, o) => s + o.population, 0),
			population,
			beforePct: population ? (beforeResidents / population) * 100 : null,
			afterPct: population ? (afterResidents / population) * 100 : null,
			method:
				'Network walking within 500 m of boardable bus stops or 1,000 m of ferry stops on loaded calendar-valid patterns; modeled population, unique origins. Spatial estimate aligned with SDG 11.2.1 thresholds, not an official indicator or proof of affordable/accessible service.'
		}
	};
}
