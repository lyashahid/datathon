import type { PlanningComparison, PlanningOperation } from './planning-map.js';
import { backendUrl } from './app-paths.js';
import type { TransportImpactData } from './transport-impact.js';

/** The report uses the same request and canonical evaluation as the map. */
export type PlanningReviewRequest = {
	island_id?: string | null;
	assumptions: Record<string, unknown>;
	operations: PlanningOperation[];
	scenario?: unknown;
};

/** Cost quotes depend on financial and service assumptions, not the resident-access display. */
export function planningFinancialKey(request: PlanningReviewRequest): string {
	return JSON.stringify({
		...request,
		assumptions: {
			...request.assumptions,
			goal: undefined,
			target_minutes: undefined,
			include_origin_geometry: undefined,
			include_journey_geometry: undefined,
			include_world: undefined
		}
	});
}

export type PlanningEconomics = {
	currency: string;
	basis: string;
	before: Record<string, number | null>;
	after: Record<string, number | null>;
	delta: Record<string, number | null>;
	budget: Record<string, number | boolean | null>;
	assumptions: Record<string, number>;
	warnings: string[];
	sensitivity?: {
		capital_mvr: { low: number; central: number; high: number };
		meaning: string;
	};
	calibration?: {
		factor_basis: Record<string, string>;
		meaning: string;
	};
	fleets?: {
		before: { required_fleet: number };
		after: { required_fleet: number };
	};
};

export type PlanningEvaluation = {
	status: string;
	origins?: (PlanningComparison & {
		island_id?: string;
		national_island_id?: string | null;
		geometry?: unknown;
	})[];
	summary: Record<string, number | null>;
	target_minutes?: number;
	travel_time_bands: {
		before: { label: string; residents: number | null }[];
		after: { label: string; residents: number | null }[];
	};
	economics: PlanningEconomics;
	transport_connectivity?: {
		before: TransportConnectivitySummary;
		after: TransportConnectivitySummary;
		impact?: TransportImpactData;
	};
	warnings: string[];
	coverage: { service_date?: string; bus_calendar?: string; meaning: string };
	assumptions: unknown;
	source_receipts: unknown;
	version_pins: unknown;
	population_basis: string | null;
	access_method: string;
};

export type TransportConnectivitySummary = {
	service_date: string;
	lines: {
		id: string;
		name: string;
		mode: string;
		route_id?: string;
		stop_ids?: string[];
		island_ids: string[];
		departure_count: number;
		proposed: boolean;
		inter_island: boolean;
	}[];
	inter_island_lines: number;
	ferry_lines: number;
	islands_connected: string[];
	qualification: string;
};

/** Group directional schedules, without mistaking duplicate departures or loops for a return journey. */
function proposedServiceGroups(
	summary: TransportConnectivitySummary | undefined,
	mode: 'bus' | 'ferry'
) {
	const routes = new Map<
		string,
		{
			key: string;
			name: string;
			mode: 'bus' | 'ferry';
			departures: number;
			returnService: boolean;
			directions: string[][];
		}
	>();
	for (const line of summary?.lines ?? []) {
		if (line.mode !== mode || !line.proposed) continue;
		const direction = line.stop_ids?.length ? line.stop_ids : line.island_ids;
		const key = `${mode}:${line.route_id || `${line.name}:${[...direction].sort().join(':')}`}`;
		const previous = routes.get(key);
		if (previous) {
			previous.departures += line.departure_count;
			previous.returnService ||= previous.directions.some(
				(existing) =>
					direction.length > 1 &&
					direction[0] !== direction.at(-1) &&
					existing.length === direction.length &&
					existing.every((stop, index) => stop === direction[direction.length - 1 - index])
			);
			previous.directions.push(direction);
		} else
			routes.set(key, {
				key,
				name: line.name,
				mode,
				departures: line.departure_count,
				returnService: false,
				directions: [direction]
			});
	}
	return [...routes.values()];
}

export function proposedFerryServiceGroups(summary: TransportConnectivitySummary | undefined) {
	return proposedServiceGroups(summary, 'ferry');
}

export function proposedBusServiceGroups(summary: TransportConnectivitySummary | undefined) {
	return proposedServiceGroups(summary, 'bus');
}

export function finiteValue(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const amountFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const compactAmountFormat = new Intl.NumberFormat('en-GB', {
	maximumFractionDigits: 1,
	notation: 'compact'
});

export function formatAmount(value: unknown, compact = false): string {
	const amount = finiteValue(value);
	return amount === null
		? 'Unavailable'
		: (compact ? compactAmountFormat : amountFormat).format(amount);
}

/** Undiscounted commitment illustration; it is not a demand or causal forecast. */
export function fiscalProjections(capital: unknown, annualOperating: unknown) {
	const oneTime = finiteValue(capital);
	const recurring = finiteValue(annualOperating);
	return [1, 5, 10].map((years) => ({
		years,
		capital: oneTime,
		operating: recurring === null ? null : recurring * years,
		total: oneTime === null || recurring === null ? null : oneTime + recurring * years
	}));
}

export function budgetUse(cost: unknown, budget: unknown): number | null {
	const expense = finiteValue(cost);
	const limit = finiteValue(budget);
	if (expense === null || limit === null || limit < 0) return null;
	if (limit === 0) return expense > 0 ? 100 : 0;
	return Math.min(100, Math.max(0, (expense / limit) * 100));
}

const operationLabels: Record<string, string> = {
	add_hospital: 'New hospital',
	add_school: 'New school',
	add_stop: 'New transport stop',
	use_existing_ferry_terminal: 'Use existing ferry landing place',
	move_stop: 'Move transport stop',
	add_service: 'New transport service',
	replace_service: 'Replace transport service',
	disable_facility: 'Close destination',
	disable_stop: 'Close transport stop',
	enable_stop: 'Restore transport stop',
	disable_service: 'Suspend transport service',
	enable_service: 'Restore transport service',
	shift_timetable: 'Change departure times',
	set_frequency: 'Change service frequency',
	set_hours: 'Change operating hours',
	set_fleet: 'Change vehicles',
	road_closure: 'Close road',
	pedestrian_connection: 'New walking connection',
	weather_disruption: 'Test weather disruption'
};

export function operationLabel(operation: PlanningOperation): string {
	return operationLabels[operation.type] ?? operation.type.replaceAll('_', ' ');
}

export function operationName(operation: PlanningOperation): string {
	return (
		operation.name ||
		(typeof operation.service?.name === 'string' ? operation.service.name : '') ||
		operationLabel(operation)
	);
}

export async function downloadProposalPdf(request: PlanningReviewRequest, title: string) {
	const response = await fetch(
		backendUrl(`planning/report.pdf?title=${encodeURIComponent(title.slice(0, 160))}`),
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/pdf' },
			body: JSON.stringify(request)
		}
	);
	if (!response.ok) {
		const problem = await response.json().catch(() => null);
		throw new Error(problem?.error?.message ?? `PDF export failed (${response.status})`);
	}
	if (!response.headers.get('content-type')?.includes('application/pdf'))
		throw new Error('The server did not return a PDF. Please retry.');
	const url = URL.createObjectURL(await response.blob());
	const link = document.createElement('a');
	link.href = url;
	link.download = `${title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'proposal'}-review.pdf`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
