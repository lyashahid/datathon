import type { Feature, GeoJsonProperties } from 'geojson';
import type { PlanningOperation } from './planning-map.js';

type Cell = Feature | Record<string, unknown>;
export type ImpactCellExplanation = {
	title: string;
	summary: string;
	reasons: string[];
	qualification: string;
};

function numeric(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] {
	// MapLibre serializes array-valued GeoJSON properties in rendered feature queries.
	if (typeof value === 'string') {
		try {
			const parsed: unknown = JSON.parse(value);
			return Array.isArray(parsed)
				? parsed.filter((item): item is string => typeof item === 'string')
				: [];
		} catch {
			return [];
		}
	}
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

const number = (value: number) =>
	new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(value);
const minutes = (value: number) =>
	new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);

/** Explain evaluated cell evidence without claiming that a circle or nearby item caused a benefit. */
export function explainImpactCell(
	cell: Cell,
	options: { goalLabel?: string; targetMinutes?: number; operations?: PlanningOperation[] } = {}
): ImpactCellExplanation {
	const properties: GeoJsonProperties =
		cell.type === 'Feature' ? (cell as Feature).properties : cell;
	const values = properties ?? {};
	const goal = options.goalLabel?.trim() || 'services';
	const before = numeric(values.before);
	const after = numeric(values.after);
	const delta = numeric(values.delta);
	const target = numeric(options.targetMinutes) ?? numeric(values.target_minutes);
	const population = numeric(values.population);
	const audience = population === null ? 'Residents here' : `About ${number(population)} residents`;
	const reasons: string[] = [];
	let title = 'Impact needs more evidence';
	let summary =
		'Some residents do not have a complete before-and-after journey. Their improvement is unknown.';
	const view = values.view === 'before' || values.view === 'after' ? values.view : 'improvement';
	if (view !== 'improvement') {
		const phase = view === 'before' ? 'Current access' : 'With this proposal';
		const targetLabel = target !== null ? `${minutes(target)}-minute target` : 'journey target';
		const time = numeric(values.selected_minutes);
		switch (values.access) {
			case 'within_target':
				title = `${phase}: within reach`;
				summary = `${audience} are within the ${targetLabel} for ${goal}.`;
				break;
			case 'beyond_target':
				title = `${phase}: longer journeys`;
				summary = `${audience} are beyond the ${targetLabel} for ${goal}.`;
				break;
			case 'mixed':
				title = `${phase}: access varies`;
				summary = `Some residents meet the ${targetLabel} for ${goal}; others need longer journeys.`;
				break;
			case 'unavailable':
				title = `${phase}: no complete route`;
				summary = `At least some residents have no complete modeled journey to ${goal} under these settings.`;
				break;
			default:
				title = `${phase}: more evidence needed`;
				summary =
					'Journey or resident evidence is missing for part of this area. Missing data does not mean no access.';
		}
		if (time !== null && time >= 0)
			reasons.push(`Average modeled journey: ${minutes(time)} minutes.`);
		const within = numeric(values.residents_within_target);
		const beyond = numeric(values.residents_beyond_target);
		if (within !== null && beyond !== null && within > 0 && beyond > 0)
			reasons.push(
				`About ${number(within)} residents meet the target and ${number(beyond)} are beyond it.`
			);
	} else if (values.impact === 'unavailable' || values.impact === 'disrupted') {
		title =
			values.impact === 'disrupted'
				? 'A current journey becomes unavailable'
				: 'No complete route with this proposal';
		summary = `At least some residents have no complete modeled journey to ${goal} with these changes.`;
		if (before !== null)
			reasons.push(`Current average modeled journey: ${minutes(before)} minutes.`);
	} else if (before !== null && after !== null && delta !== null) {
		if (values.impact === 'gained') {
			title = 'More residents meet the target';
			summary = `Some modeled journeys to ${goal} now meet the selected journey target.`;
		} else if (values.impact === 'lost') {
			title = 'Some residents lose access within the target';
			summary = `At least some journeys to ${goal} move beyond the selected target.`;
		} else if (delta > 0.05) {
			title = 'Shorter journeys';
			summary = `The average modeled journey to ${goal} is ${minutes(delta)} minutes shorter.`;
		} else if (delta < -0.05) {
			title = 'Longer journeys';
			summary = `The average modeled journey to ${goal} is ${minutes(-delta)} minutes longer.`;
		} else {
			title = 'No meaningful journey-time change';
			summary = `The proposal does not materially change the modeled journey to ${goal} in this area.`;
		}
		reasons.push(`Current: ${minutes(before)} minutes. With proposal: ${minutes(after)} minutes.`);
	}
	if (view !== 'before' && values.impact !== 'uncomputed' && values.access !== 'unknown') {
		const destinations = strings(values.after_destination_ids);
		const used = [
			...new Set(
				(options.operations ?? []).flatMap((operation) => {
					const id = operation.metadata?.proposal_id;
					return typeof id === 'string' && destinations.includes(id) && operation.name
						? [operation.name]
						: [];
				})
			)
		];
		if (used.length)
			reasons.push(`At least one modeled journey ends at ${used.slice(0, 2).join(' or ')}.`);
		else if ((options.operations?.length ?? 0) > 0 && view === 'improvement')
			reasons.push(
				'These proposal changes are evaluated together; this result does not isolate each item’s contribution.'
			);
	}
	if (
		view === 'improvement' &&
		values.impact === 'unchanged' &&
		(options.operations ?? []).some(
			(operation) => operation.type === 'add_service' && operation.service?.mode === 'ferry'
		)
	)
		reasons.push(
			'A ferry service can improve island connections without shortening the walk to a boarding point.'
		);
	return {
		title,
		summary,
		reasons,
		qualification:
			'Modeled journeys and allocated resident estimates, not observed trips. A hexagon may combine several residential locations.'
	};
}

export type ServiceCalendar = {
	includedDates?: string[];
	excludedDates?: string[];
	weekdays?: number[];
	startDate?: string;
	endDate?: string;
};

/** Match the backend service-day calendar; a dated capture never becomes a recurring service. */
export function serviceCalendarRuns(
	calendar: ServiceCalendar | null | undefined,
	date: string
): boolean {
	if (!calendar || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')) return false;
	const parsed = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return false;
	if (calendar.excludedDates?.includes(date)) return false;
	if (calendar.includedDates?.includes(date)) return true;
	return (
		(!calendar.startDate || date >= calendar.startDate) &&
		(!calendar.endDate || date <= calendar.endDate) &&
		(calendar.weekdays?.includes(parsed.getUTCDay()) ?? false)
	);
}
