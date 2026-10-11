import { getFacilityEligibility } from './facilities.ts';
import { planningCoverage } from './coverage.ts';
import { applyPlanningDisruptions } from './disruptions.ts';
import { calendarRuns, createRoutingContext, routePlanningOrigin } from './routing.ts';
import type { RoutingContext } from './routing.ts';
import type { PlanningWorld } from './scenario.ts';
import type {
	PlanningAssumptions,
	PlanningBaseline,
	PlanningCoverage,
	PlanningFacility,
	PlanningJourney,
	PlanningOrigin,
	PlanningServicePattern
} from './types.ts';

export interface AppointmentOptions {
	appointmentMinutes: number;
	/** Minutes after the outward service date's midnight, in Maldives time. */
	returnDeadlineMinutes: number;
	destinationId?: string;
	returnMaxJourneyMinutes?: number;
}
export interface AppointmentJourney {
	status: 'feasible' | 'deadline-missed' | 'unreachable' | 'unavailable';
	reason: string | null;
	destination: PlanningFacility | null;
	outward: PlanningJourney;
	returnJourney: PlanningJourney | null;
	departAt: number;
	arriveAt: number | null;
	returnDepartAt: number | null;
	homeAt: number | null;
	meetsDeadline: boolean | null;
	coverage: { outward: PlanningCoverage; return: PlanningCoverage | null };
	warnings: string[];
}

const failJourney = (reason: string): PlanningJourney => ({
	status: 'unavailable',
	minutes: null,
	destinationId: null,
	path: [],
	reason
});

function dateOffset(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00Z`);
	return new Date(parsed.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Preserve service-day calendars across midnight. Previous-day trips are included only
 * where their published stop times actually extend into this clock day. */
function clockWorld(world: PlanningWorld, date: string): PlanningWorld {
	const patterns: PlanningServicePattern[] = [];
	for (const pattern of world.patterns) {
		if (calendarRuns(pattern.calendar, date)) patterns.push(pattern);
		if (!calendarRuns(pattern.calendar, dateOffset(date, -1))) continue;
		if (pattern.timing.kind === 'scheduled') {
			const trips = pattern.timing.trips
				.filter((trip) => trip.stopTimes.some((time) => time.departureMinutes >= 1440))
				.map((trip) => ({
					...trip,
					stopTimes: trip.stopTimes.map((time) => ({
						arrivalMinutes: time.arrivalMinutes - 1440,
						departureMinutes: time.departureMinutes - 1440
					}))
				}));
			if (trips.length)
				patterns.push({
					...pattern,
					id: `${pattern.id}:previous-day`,
					calendar: { weekdays: [], includedDates: [date] },
					timing: { kind: 'scheduled', trips }
				});
		} else {
			const windows = pattern.timing.windows
				.filter((window) => window.endMinutes > 1440)
				.map((window) => ({
					...window,
					startMinutes: Math.max(0, window.startMinutes - 1440),
					endMinutes: window.endMinutes - 1440
				}));
			if (windows.length)
				patterns.push({
					...pattern,
					id: `${pattern.id}:previous-day`,
					calendar: { weekdays: [], includedDates: [date] },
					timing: { ...pattern.timing, windows }
				});
		}
	}
	return { ...world, patterns };
}

/** A routing target is not a healthcare/school record. It exists only in this local
 * context so the established direction/calendar/transfer solver can route home. */
function contextToHome(
	context: RoutingContext,
	home: PlanningOrigin,
	assumptions: PlanningAssumptions
): RoutingContext {
	const target: PlanningFacility = { ...home, name: 'Return to this area', kind: 'hospital' };
	const snap = context.access.snap(home, assumptions.maxSnapM);
	const stopEgress: RoutingContext['stopEgress'] = new Map();
	if (snap)
		for (const stop of context.stops.values()) {
			const stopSnap = context.stopSnaps.get(stop.id);
			if (!stopSnap) continue;
			const tree = context.access.tree(
				stopSnap.index,
				assumptions.maxJourneyMinutes * assumptions.walkMPerMinute
			);
			const metres = stopSnap.distanceM + tree.distances[snap.index] + snap.distanceM;
			if (metres <= assumptions.maxAccessWalkMinutes * assumptions.walkMPerMinute)
				stopEgress.set(stop.id, { destination: target, snap, tree, metres });
		}
	return {
		...context,
		facilities: [target],
		facilitySnaps: new Map(snap ? [[target.id, snap]] : []),
		unknownFacilities: [],
		unknownFacilitySnaps: new Map(),
		unknownStopEgress: new Map(),
		unknownDestinationIslands: new Set(),
		localDestinationIslands: new Set([home.islandId]),
		stopEgress
	};
}

/** A single reproducible outward/appointment/return calculation. It never picks a
 * different destination for the return and never treats missing sailings as closure. */
export function computeAppointmentJourney(
	baseline: PlanningBaseline,
	world: PlanningWorld,
	originId: string,
	assumptions: PlanningAssumptions,
	options: AppointmentOptions
): AppointmentJourney {
	const coverage = planningCoverage(baseline, assumptions);
	const result: AppointmentJourney = {
		status: 'unavailable',
		reason: null,
		destination: null,
		outward: failJourney('Journey not evaluated.'),
		returnJourney: null,
		departAt: assumptions.departureMinutes,
		arriveAt: null,
		returnDepartAt: null,
		homeAt: null,
		meetsDeadline: null,
		coverage: { outward: coverage, return: null },
		warnings: []
	};
	const home = baseline.origins.find((origin) => origin.id === originId);
	if (!home)
		return { ...result, reason: 'Select a mapped resident area to evaluate the return journey.' };
	if (!calendarRuns({ weekdays: [0, 1, 2, 3, 4, 5, 6] }, assumptions.date))
		return { ...result, reason: 'Use a valid service date for the appointment journey.' };
	const maxReturn = options.returnMaxJourneyMinutes ?? 180;
	if (
		!Number.isFinite(options.appointmentMinutes) ||
		options.appointmentMinutes < 0 ||
		options.appointmentMinutes > 720 ||
		!Number.isFinite(options.returnDeadlineMinutes) ||
		options.returnDeadlineMinutes <= assumptions.departureMinutes ||
		options.returnDeadlineMinutes > 2880 ||
		!Number.isFinite(maxReturn) ||
		maxReturn <= 0 ||
		maxReturn > 180 ||
		!Number.isFinite(assumptions.departureMinutes) ||
		assumptions.departureMinutes < 0 ||
		assumptions.departureMinutes >= 1440
	)
		return {
			...result,
			reason:
				'Use an appointment of 0–720 minutes, a return horizon up to 180 minutes, and a deadline after departure within the next two days.'
		};
	const verified = world.facilities.filter(
		(facility) =>
			facility.provenance !== 'assumed' &&
			facility.planningStatus !== 'proposed' &&
			getFacilityEligibility(facility, assumptions).status === 'eligible' &&
			(!options.destinationId || facility.id === options.destinationId)
	);
	if (!verified.length)
		return {
			...result,
			reason:
				'A verified destination meeting the selected service requirements is required for an appointment journey.'
		};
	const outwardDisruption = applyPlanningDisruptions(
		baseline,
		clockWorld(world, assumptions.date),
		assumptions
	);
	const outwardContext = createRoutingContext(
		{ ...baseline, network: outwardDisruption.network },
		{ ...outwardDisruption.world, facilities: verified },
		assumptions,
		baseline.network
	);
	const outward = routePlanningOrigin(outwardContext, home, assumptions);
	result.outward = outward;
	if (outward.status !== 'reachable' || outward.minutes === null || !outward.destinationId)
		return {
			...result,
			status: outward.status === 'unreachable' ? 'unreachable' : 'unavailable',
			reason: outward.reason
		};
	const destination = verified.find((facility) => facility.id === outward.destinationId)!;
	const arriveAt = assumptions.departureMinutes + outward.minutes;
	const returnDepartAt = arriveAt + options.appointmentMinutes;
	const returnDayOffset = Math.floor(returnDepartAt / 1440);
	const returnAssumptions: PlanningAssumptions = {
		...assumptions,
		date: dateOffset(assumptions.date, returnDayOffset),
		departureMinutes: returnDepartAt % 1440,
		maxJourneyMinutes: maxReturn,
		// Home is an exact routing endpoint, with no admission/hours criteria.
		destinationRequirements: undefined
	};
	const returnDisruption = applyPlanningDisruptions(
		baseline,
		clockWorld(world, returnAssumptions.date),
		returnAssumptions
	);
	const returnContext = contextToHome(
		createRoutingContext(
			{ ...baseline, network: returnDisruption.network },
			{ ...returnDisruption.world, facilities: [] },
			returnAssumptions,
			baseline.network
		),
		home,
		returnAssumptions
	);
	const returnOrigin: PlanningOrigin = { ...destination, population2026: 0 };
	const returnJourney = routePlanningOrigin(returnContext, returnOrigin, returnAssumptions);
	const returnCoverage = planningCoverage(baseline, returnAssumptions);
	const warnings: string[] = [];
	if (coverage.status !== 'complete' || returnCoverage.status !== 'complete')
		warnings.push(
			'Partial service evidence: a confirmed journey may be shown, but these results do not establish all-day service availability or the last actual departure.'
		);
	if (
		world.patterns.some(
			(pattern) =>
				pattern.provenance === 'assumed' &&
				[...outward.path, ...returnJourney.path].some((leg) => leg.patternId === pattern.id)
		)
	)
		warnings.push(
			'This journey uses assumed scenario service. Frequency services use half-headway expected waits, not guaranteed connections.'
		);
	const details = {
		...result,
		destination,
		arriveAt,
		returnDepartAt,
		returnJourney,
		coverage: { outward: coverage, return: returnCoverage },
		warnings
	};
	if (returnJourney.status !== 'reachable' || returnJourney.minutes === null)
		return {
			...details,
			status: returnJourney.status === 'unreachable' ? 'unreachable' : 'unavailable',
			reason: returnJourney.reason
		};
	const homeAt = returnDepartAt + returnJourney.minutes;
	const meetsDeadline = homeAt <= options.returnDeadlineMinutes;
	return {
		...details,
		status: meetsDeadline ? 'feasible' : 'deadline-missed',
		reason: meetsDeadline
			? null
			: 'The modeled return reaches this area after the selected deadline.',
		homeAt,
		meetsDeadline
	};
}

export interface AppointmentDepartureSample {
	departureMinutes: number;
	status: AppointmentJourney['status'];
	homeAt: number | null;
	destinationId: string | null;
}
export interface AppointmentDepartureScan {
	samples: AppointmentDepartureSample[];
	stepMinutes: number;
	label: string;
}

/** Discrete checks, not a guarantee for every minute between them. A partial
 * snapshot limits the default search to its actual supported departure window. */
export function findAppointmentDepartureWindows(
	baseline: PlanningBaseline,
	world: PlanningWorld,
	originId: string,
	assumptions: PlanningAssumptions,
	options: AppointmentOptions,
	search: { startMinutes?: number; endMinutes?: number; stepMinutes?: number } = {}
): AppointmentDepartureScan {
	const coverage = planningCoverage(baseline, assumptions);
	const stepMinutes = search.stepMinutes ?? 30;
	if (!Number.isFinite(stepMinutes) || stepMinutes < 5 || stepMinutes > 120)
		return { samples: [], stepMinutes, label: 'Choose a sampling interval of 5–120 minutes.' };
	const start = Math.max(
		0,
		search.startMinutes ??
			(coverage.status === 'complete'
				? 360
				: (coverage.supportedStartMinutes ?? assumptions.departureMinutes))
	);
	const end = Math.min(
		1439,
		search.endMinutes ??
			(coverage.status === 'complete' ? 1080 : (coverage.supportedEndMinutes ?? start))
	);
	if (
		!Number.isFinite(start) ||
		!Number.isFinite(end) ||
		end < start ||
		(end - start) / stepMinutes > 288
	)
		return {
			samples: [],
			stepMinutes,
			label: 'No valid departure window in this source snapshot.'
		};
	const samples: AppointmentDepartureSample[] = [];
	for (let departureMinutes = start; departureMinutes <= end; departureMinutes += stepMinutes) {
		const journey = computeAppointmentJourney(
			baseline,
			world,
			originId,
			{ ...assumptions, departureMinutes },
			options
		);
		samples.push({
			departureMinutes,
			status: journey.status,
			homeAt: journey.homeAt,
			destinationId: journey.destination?.id ?? null
		});
	}
	return {
		samples,
		stepMinutes,
		label:
			coverage.status === 'complete'
				? `Departures checked every ${stepMinutes} minutes; intervening times are not certified.`
				: `Departures checked every ${stepMinutes} minutes in the partial observed window; missing return services remain unknown.`
	};
}
