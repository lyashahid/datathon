import {
	INTERVENTION_RULES as R,
	INTERVENTION_TITLES,
	RELEVANCE_BANDS,
	RELEVANCE_WEIGHTS
} from '#lib/config/interventions.ts';
import type { ProximityComponent } from '#lib/types/analysis.ts';
import type { H3Cell } from '#lib/types/h3.ts';
import type {
	InterventionSuggestion,
	InterventionTrigger,
	InterventionType,
	RelevanceBand
} from '#lib/types/interventions.ts';
import { formatDistance, formatPopulation } from '#lib/utils/format.ts';

/**
 * Rule-based accessibility gap detection for one analytical cell. Deterministic: each rule
 * reads named metrics, compares them with thresholds in config/interventions.ts, and reports
 * the values that triggered it. Suggests intervention TYPES for evaluation, never sites.
 */

const people = (n: number) => formatPopulation(n);
const pts = (n: number) => `${Math.round(n)}/100`;

function component(cell: H3Cell, id: ProximityComponent['id']): ProximityComponent | undefined {
	for (const category of [cell.access.transport, cell.access.health, cell.access.education]) {
		const found = category.components.find((c) => c.id === id);
		if (found) return found;
	}
	return undefined;
}

export function relevanceBand(relevance: number): RelevanceBand {
	return (RELEVANCE_BANDS.find((b) => relevance >= b.min) ?? RELEVANCE_BANDS.at(-1)!).band;
}

/**
 * Relevance 0–100: how far the metric falls below its threshold (severity, 0–1) blended with
 * how many residents the cell represents (capped). Both parts are reported to the user.
 */
export function relevanceScore(score: number, threshold: number, population: number) {
	const severity = Math.max(0, Math.min(1, (threshold - score) / threshold));
	const populationShare = Math.min(1, population / R.relevancePopulationCap);
	const relevance = Math.round(
		100 * (RELEVANCE_WEIGHTS.severity * severity + RELEVANCE_WEIGHTS.population * populationShare)
	);
	return {
		relevance,
		basis: `${Math.round(severity * 100)}% shortfall below ${threshold} (weight ${RELEVANCE_WEIGHTS.severity}) + ${Math.round(populationShare * 100)}% of the ${R.relevancePopulationCap}-resident reference (weight ${RELEVANCE_WEIGHTS.population}).`
	};
}

function suggestion(
	type: InterventionType,
	score: number,
	threshold: number,
	population: number,
	reasons: string[],
	triggers: InterventionTrigger[]
): InterventionSuggestion {
	const { relevance, basis } = relevanceScore(score, threshold, population);
	return {
		type,
		title: INTERVENTION_TITLES[type],
		relevance,
		band: relevanceBand(relevance),
		reasons,
		triggers,
		relevanceBasis: basis
	};
}

/** Poor transport + far bus stop + enough residents → add a bus stop. */
function busStopRule(cell: H3Cell): InterventionSuggestion | null {
	const stop = component(cell, 'busStop');
	const stopDistance = stop?.distanceM ?? null;
	const far = stopDistance === null || stopDistance > R.farBusStopM;
	if (cell.transportAccessibility >= R.poorScore || !far) return null;
	if (cell.population < R.highPopulation) return null;
	return suggestion(
		'add_bus_stop',
		cell.transportAccessibility,
		R.poorScore,
		cell.population,
		[
			`About ${people(cell.population)} residents in this cell have poor transport access.`,
			stopDistance === null
				? 'No bus stop is reachable on this island.'
				: `The nearest bus stop is ${formatDistance(stopDistance)} away (straight line).`
		],
		[
			{ metric: 'Residents', value: people(cell.population), condition: `≥ ${R.highPopulation}` },
			{
				metric: 'Transport accessibility',
				value: pts(cell.transportAccessibility),
				condition: `< ${R.poorScore}`
			},
			{
				metric: 'Nearest bus stop',
				value: stopDistance === null ? 'none' : formatDistance(stopDistance),
				condition: `> ${formatDistance(R.farBusStopM)}`
			}
		]
	);
}

/** Poor health access for a represented population → improve access (not "build a hospital"). */
function healthRule(cell: H3Cell): InterventionSuggestion | null {
	if (cell.healthAccessibility >= R.poorScore || cell.population < R.representedPopulation) {
		return null;
	}
	const hospital = component(cell, 'hospital');
	return suggestion(
		'improve_healthcare_access',
		cell.healthAccessibility,
		R.poorScore,
		cell.population,
		[
			`Health accessibility is ${pts(cell.healthAccessibility)} for about ${people(cell.population)} residents (${people(cell.olderPopulation)} aged 65+).`,
			hospital?.viaFerry
				? 'The nearest hospital is only reachable by ferry; options include ferry links, a clinic or outreach — evaluate before building.'
				: 'Options include better transport links to existing care or a smaller clinic — evaluate before building.'
		],
		[
			{
				metric: 'Health accessibility',
				value: pts(cell.healthAccessibility),
				condition: `< ${R.poorScore}`
			},
			{
				metric: 'Residents',
				value: people(cell.population),
				condition: `≥ ${R.representedPopulation}`
			},
			...(hospital?.distanceM != null
				? [
						{
							metric: 'Nearest hospital',
							value: `${formatDistance(hospital.distanceM)}${hospital.viaFerry ? ' incl. ferry' : ''}`,
							condition: 'reported'
						}
					]
				: [])
		]
	);
}

/** Poor education access with children present → improve school access. */
function educationRule(cell: H3Cell): InterventionSuggestion | null {
	if (cell.educationAccessibility >= R.poorScore || cell.population < R.representedPopulation) {
		return null;
	}
	const school = component(cell, 'school');
	return suggestion(
		'improve_school_access',
		cell.educationAccessibility,
		R.poorScore,
		cell.population,
		[
			`Education accessibility is ${pts(cell.educationAccessibility)}; about ${people(cell.children)} children live here.`,
			school?.viaFerry
				? 'The nearest school is only reachable by ferry.'
				: 'The nearest school is a long walk away.'
		],
		[
			{
				metric: 'Education accessibility',
				value: pts(cell.educationAccessibility),
				condition: `< ${R.poorScore}`
			},
			{ metric: 'Children', value: people(cell.children), condition: 'reported' }
		]
	);
}

/** Depends on marine transport for a service AND poor ferry-terminal access → investigate. */
function ferryRule(cell: H3Cell): InterventionSuggestion | null {
	const ferry = component(cell, 'ferryTerminal');
	const ferryDependent = [component(cell, 'hospital'), component(cell, 'school')].filter(
		(c) => c?.viaFerry
	);
	if (!ferry || ferryDependent.length === 0) return null;
	if (ferry.score >= R.poorFerryScore || cell.population < R.representedPopulation) return null;
	return suggestion(
		'investigate_ferry_connectivity',
		ferry.score,
		R.poorFerryScore,
		cell.population,
		[
			`Residents rely on ferries to reach ${ferryDependent.map((c) => c!.label.toLowerCase()).join(' and ')}.`,
			ferry.distanceM === null
				? 'No ferry terminal is reachable on this island.'
				: `The nearest ferry terminal is ${formatDistance(ferry.distanceM)} away, scoring ${pts(ferry.score)}.`
		],
		[
			{
				metric: 'Ferry terminal access',
				value: pts(ferry.score),
				condition: `< ${R.poorFerryScore}`
			},
			{
				metric: 'Services reached by ferry',
				value: ferryDependent.map((c) => c!.label).join(', '),
				condition: 'at least one'
			}
		]
	);
}

const RULES = [busStopRule, healthRule, educationRule, ferryRule];

/** All triggered suggestions, highest relevance first (ties broken by type for stability). */
export function suggestInterventions(cell: H3Cell): InterventionSuggestion[] {
	return RULES.map((rule) => rule(cell))
		.filter((s): s is InterventionSuggestion => s !== null)
		.sort((a, b) => b.relevance - a.relevance || a.type.localeCompare(b.type));
}
