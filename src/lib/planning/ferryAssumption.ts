import { buildNetworkGraph, nearestGraphNode } from './graph.ts';
import type {
	PlanningAction,
	PlanningBaseline,
	PlanningServicePattern,
	PlanningStop
} from './types.ts';

export interface FerryCalendarEvidence {
	id: string;
	route: string;
	sourceId: string;
	timezone: string;
	effectiveFrom: string;
	validUntil: string | null;
	dayTypes: {
		label: string;
		isoWeekdays: number[];
		includesPublicHolidays: boolean | null;
		frequencyWindows?: { start: string; end: string; headwayMinutes: number }[];
		noServiceWindows?: { start: string; end: string; reason: string }[];
		unknownWindows?: { start: string; end: string; reason: string }[];
	}[];
	limitations?: string[];
	crossingMinutes: number | null;
	routingEligible: boolean;
}
export interface FerryRuntimeEvidence {
	calendar: FerryCalendarEvidence;
	terminals: { id: string; name: string; coordinates: [number, number]; islandId: string }[];
	sourceUrl: string;
	fareMvr?: number | null;
}
export interface FerryRuntimeOptions {
	date: string;
	crossingMinutes: number;
	publicHoliday?: boolean;
	acknowledgeCalendarValidity: boolean;
}
export type FerryRuntimeProposal =
	| { ok: true; action: PlanningAction & { kind: 'add-route' }; warnings: string[] }
	| { ok: false; reason: string };

function parseClock(value: string): number | null {
	if (!/^\d{2}:\d{2}$/.test(value)) return null;
	const [hours, minutes] = value.split(':').map(Number);
	return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}
function validDate(value: string): boolean {
	const parsed = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Public headways and terminal coordinates plus a user-supplied crossing time.
 * All resulting service is an assumed scenario; the observed baseline is untouched. */
export function createFerryRuntimeAssumption(
	baseline: PlanningBaseline,
	evidence: FerryRuntimeEvidence,
	options: FerryRuntimeOptions
): FerryRuntimeProposal {
	if (
		!validDate(options.date) ||
		options.date < evidence.calendar.effectiveFrom ||
		(evidence.calendar.validUntil && options.date > evidence.calendar.validUntil)
	)
		return {
			ok: false,
			reason: 'The planning date falls outside this published calendar’s stated validity.'
		};
	if (!options.acknowledgeCalendarValidity)
		return {
			ok: false,
			reason:
				'Acknowledge that the calendar has no verified cancellation or holiday exceptions and may need operator confirmation.'
		};
	if (
		!Number.isFinite(options.crossingMinutes) ||
		options.crossingMinutes < 2 ||
		options.crossingMinutes > 120
	)
		return { ok: false, reason: 'Enter an explicit crossing-time assumption of 2–120 minutes.' };
	if (
		evidence.calendar.route !== 'vilimale' ||
		evidence.calendar.timezone !== 'Indian/Maldives' ||
		evidence.terminals.length !== 2 ||
		!/^https:\/\//.test(evidence.sourceUrl)
	)
		return {
			ok: false,
			reason: 'Verified Vilimalé calendar and two terminal locations are required.'
		};
	const weekday = new Date(`${options.date}T00:00:00Z`).getUTCDay() || 7;
	const day = evidence.calendar.dayTypes.find((type) =>
		options.publicHoliday
			? type.includesPublicHolidays === true
			: type.isoWeekdays.includes(weekday)
	);
	if (!day?.frequencyWindows?.length)
		return { ok: false, reason: 'No published frequency intervals match the selected day type.' };
	const windows = day.frequencyWindows
		.map((window) => {
			const startMinutes = parseClock(window.start),
				end = parseClock(window.end);
			return startMinutes === null ||
				end === null ||
				!Number.isFinite(window.headwayMinutes) ||
				window.headwayMinutes <= 0
				? null
				: {
						startMinutes,
						endMinutes: end === 0 && startMinutes > 0 ? 1440 : end,
						headwayMinutes: window.headwayMinutes
					};
		})
		.filter((window) => window !== null)
		.sort((a, b) => a.startMinutes - b.startMinutes);
	if (
		windows.length !== day.frequencyWindows.length ||
		windows.some(
			(window, index) =>
				window.endMinutes <= window.startMinutes ||
				(index > 0 && window.startMinutes < windows[index - 1].endMinutes)
		)
	)
		return {
			ok: false,
			reason:
				'Published frequency intervals are invalid or overlap; no service has been synthesized.'
		};
	const graph = buildNetworkGraph(baseline.network);
	const stops: PlanningStop[] = [];
	for (const terminal of evidence.terminals) {
		const [lon, lat] = terminal.coordinates;
		if (
			!Number.isFinite(lon) ||
			!Number.isFinite(lat) ||
			!baseline.islands.some((island) => island.id === terminal.islandId) ||
			!nearestGraphNode(graph, { lon, lat }, 'walk', 100)
		)
			return {
				ok: false,
				reason: `${terminal.name} needs a verified walking-network attachment before using this crossing.`
			};
		stops.push({
			id: `ferry-terminal:${terminal.id}`,
			name: terminal.name,
			lon,
			lat,
			islandId: terminal.islandId,
			mode: 'ferry',
			sourceIds: ['rtl-terminal-catalog', evidence.calendar.sourceId]
		});
	}
	const routeId = `scenario:vilimale-ferry:${options.date}:${options.crossingMinutes}`;
	const makePattern = (ordered: PlanningStop[], direction: string): PlanningServicePattern => ({
		id: `${routeId}:${direction}`,
		routeId,
		name: `${ordered[0].name} → ${ordered[1].name} · assumed crossing`,
		mode: 'ferry',
		stopIds: ordered.map((stop) => stop.id),
		calendar: {
			weekdays: [],
			includedDates: [options.date],
			startDate: options.date,
			endDate: options.date
		},
		timing: { kind: 'frequency', windows, segmentMinutes: [options.crossingMinutes] },
		provenance: 'assumed',
		sourceIds: [evidence.calendar.sourceId, 'rtl-terminal-catalog', 'user-crossing-runtime'],
		calendarDayType: day.label,
		sourceUrl: evidence.sourceUrl,
		crossingRuntimeAssumed: true
		// No distance or geometry: no verified vessel track is available, and bus
		// energy/cost anchors cannot stand in for ferry operation.
	});
	return {
		ok: true,
		action: {
			kind: 'add-route',
			pattern: makePattern(stops, 'out'),
			returnPattern: makePattern([...stops].reverse(), 'back'),
			stops
		},
		warnings: [
			`Crossing time ${options.crossingMinutes} minutes is a user assumption. Headways follow ${day.label}; expected wait is half the headway, not a guaranteed sailing.`,
			'No cancellation/public-holiday exception calendar, verified sailing trajectory, ferry cost or ferry emissions model is supplied.',
			...(day.unknownWindows ?? []).map(
				(window) => `${window.start}–${window.end} remains unavailable: ${window.reason}.`
			),
			...(day.noServiceWindows ?? []).map(
				(window) => `${window.start}–${window.end}: ${window.reason}.`
			)
		]
	};
}
