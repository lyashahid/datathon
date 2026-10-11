import { analyzePlanning } from './engine.ts';
import { calculatePlanningEconomics } from './economics.ts';
import { createBusProposal } from './proposals.ts';
import { derivePlanningWorld } from './scenario.ts';
import type {
	PlanningAction,
	PlanningAnalysis,
	PlanningAssumptions,
	PlanningBaseline
} from './types.ts';

export interface InvestmentComparisonOptions {
	originId: string;
	actions?: readonly PlanningAction[];
	assumptions: PlanningAssumptions;
	capitalBudgetMvr: number;
	annualOperatingBudgetMvr: number;
	costBasis?: 'central' | 'high';
	/** Pass the same worker used for all other planning calculations. Calls are sequential. */
	analyze?: (
		actions: readonly PlanningAction[],
		assumptions: PlanningAssumptions
	) => Promise<PlanningAnalysis>;
	maxAlternatives?: number;
}
export interface InvestmentEvaluation {
	additionalResidents: number;
	lostResidents: number;
	netAdditionalResidents: number;
	worsenedJourneyResidents: number;
	unknownResidents: number;
	minutesSaved: number | null;
	capitalMvr: number;
	annualOperatingMvr: number;
	capitalPerAdditionalResident: number | null;
	evidence: 'complete' | 'conditional';
	lowValue: boolean;
	explanation: string;
}
export interface InvestmentAlternative {
	id: string;
	label: string;
	description: string;
	kind: 'connection' | 'route-extension' | 'frequency' | 'fleet';
	actions: PlanningAction[];
	result: PlanningAnalysis;
	evaluation: InvestmentEvaluation;
}
export interface InvestmentComparison {
	alternatives: InvestmentAlternative[];
	excluded: { label: string; reason: string }[];
	notes: string[];
	baseline: PlanningAnalysis;
	costBasis: 'central' | 'high';
}
interface Candidate {
	id: string;
	label: string;
	description: string;
	kind: InvestmentAlternative['kind'];
	additions: PlanningAction[];
}

function candidates(
	baseline: PlanningBaseline,
	options: InvestmentComparisonOptions
): { items: Candidate[]; excluded: InvestmentComparison['excluded'] } {
	const items: Candidate[] = [];
	const excluded: InvestmentComparison['excluded'] = [];
	const world = derivePlanningWorld(baseline, options.actions ?? [], options.assumptions);
	const addConnection = (headway: number, fleet: 'diesel' | 'electric', patternId?: string) => {
		const proposal = createBusProposal(baseline, {
			originId: options.originId,
			headwayMinutes: headway,
			fleet,
			patternId,
			actions: options.actions,
			assumptions: options.assumptions
		});
		const extension = proposal.ok && proposal.action.kind === 'extend-route';
		const label = extension
			? `Extend ${world.patterns.find((p) => p.id === patternId)?.name ?? 'a route'}`
			: `${fleet === 'electric' ? 'Electric' : 'Diesel'} connection · every ${headway} min`;
		if (!proposal.ok) {
			if (!excluded.some((e) => e.reason === proposal.reason))
				excluded.push({ label, reason: proposal.reason });
			return;
		}
		items.push({
			id: `connect:${patternId ?? 'new'}:${fleet}:${headway}`,
			label,
			description: extension
				? 'Extend an existing frequency service on permitted roads; runtime is an explicit speed assumption.'
				: 'An assumed two-way service on mapped bus roads. Expected waiting uses half the headway; operating days and unit costs are editable.',
			kind: extension ? 'route-extension' : 'connection',
			additions: [proposal.action]
		});
	};
	for (const headway of [10, 15, 20, 30, 45, 60]) addConnection(headway, 'diesel');
	for (const headway of [15, 30, 60]) addConnection(headway, 'electric');
	const routes = new Set<string>();
	for (const pattern of world.patterns) {
		if (
			pattern.mode !== 'bus' ||
			pattern.enabled === false ||
			pattern.timing.kind !== 'frequency' ||
			pattern.runtimeUnavailableReason ||
			routes.has(pattern.routeId)
		)
			continue;
		routes.add(pattern.routeId);
		const current = Math.min(...pattern.timing.windows.map((w) => w.headwayMinutes));
		addConnection(current, pattern.fleet ?? 'diesel', pattern.id);
		for (const headway of [
			Math.max(5, Math.round(current * 0.75)),
			Math.max(5, Math.round(current / 2))
		]) {
			if (headway >= current) continue;
			items.push({
				id: `frequency:${pattern.routeId}:${headway}`,
				label: `${pattern.name} · every ${headway} min`,
				description:
					'Reduce expected waiting on the existing frequency service. Extra vehicles and annual service kilometers are included.',
				kind: 'frequency',
				additions: [{ kind: 'set-frequency', patternId: pattern.id, headwayMinutes: headway }]
			});
		}
		if (pattern.fleet !== 'electric')
			items.push({
				id: `fleet:${pattern.routeId}`,
				label: `${pattern.name} · electric fleet`,
				description:
					'Retain the service pattern and compare electricity-related emissions, vehicles and charging costs.',
				kind: 'fleet',
				additions: [{ kind: 'set-fleet', patternId: pattern.id, fleet: 'electric' }]
			});
		// Bound interactive work. The picker is an exploration aid, not a network-wide optimizer.
		if (routes.size >= 3) break;
	}
	return {
		items: [...new Map(items.map((candidate) => [candidate.id, candidate])).values()],
		excluded
	};
}

export function evaluateInvestment(
	current: PlanningAnalysis,
	result: PlanningAnalysis,
	costBasis: 'central' | 'high'
): InvestmentEvaluation {
	const old = new Map(current.origins.map((origin) => [origin.originId, origin]));
	let additionalResidents = 0,
		lostResidents = 0,
		worsenedJourneyResidents = 0,
		unknownResidents = 0,
		minutes = 0,
		matched = 0;
	for (const origin of result.origins) {
		const before = old.get(origin.originId)?.after;
		if (!before || before.status === 'unavailable' || origin.after.status === 'unavailable') {
			unknownResidents += origin.population;
			continue;
		}
		const beforeAccess = before.status === 'reachable' && before.minutes! <= result.targetMinutes;
		const afterAccess =
			origin.after.status === 'reachable' && origin.after.minutes! <= result.targetMinutes;
		if (!beforeAccess && afterAccess) additionalResidents += origin.population;
		if (beforeAccess && !afterAccess) lostResidents += origin.population;
		if (before.status === 'reachable' && origin.after.status === 'reachable') {
			const saved = before.minutes! - origin.after.minutes!;
			if (saved < -0.01) worsenedJourneyResidents += origin.population;
			minutes += saved * origin.population;
			matched += origin.population;
		}
	}
	const lowValue = additionalResidents < 10;
	const evidence =
		result.coverage.status === 'complete' && !unknownResidents ? 'complete' : 'conditional';
	const explanation =
		additionalResidents > 0
			? `${Math.round(additionalResidents).toLocaleString('en-US')} additional modeled residents meet the access target.${lowValue ? ' The measured gain is modest; compare cheaper service or walking options and verify the local access gap before committing capital.' : ''}${lostResidents ? ` ${Math.round(lostResidents).toLocaleString('en-US')} residents lose target access.` : ''}${evidence === 'conditional' ? ' Missing service or destination coverage may change this estimate.' : ''}`
			: 'No additional residents meet the access target. Any value comes from the measured journey or conditional carbon improvement; this is not an access expansion.';
	return {
		additionalResidents,
		lostResidents,
		netAdditionalResidents: additionalResidents - lostResidents,
		worsenedJourneyResidents,
		unknownResidents,
		minutesSaved: matched ? minutes / matched : null,
		capitalMvr: result.costs.capitalMvr![costBasis],
		annualOperatingMvr: result.costs.annualOperatingMvr![costBasis],
		capitalPerAdditionalResident: additionalResidents
			? Math.max(
					0,
					result.costs.capitalMvr![costBasis] - (current.costs.capitalMvr?.[costBasis] ?? 0)
				) / additionalResidents
			: null,
		evidence,
		lowValue,
		explanation
	};
}

/** Affordable options from a bounded search; unknown costs never count as zero. */
export async function compareAffordableInvestments(
	baseline: PlanningBaseline,
	options: InvestmentComparisonOptions
): Promise<InvestmentComparison> {
	if (
		![options.capitalBudgetMvr, options.annualOperatingBudgetMvr].every(
			(n) => Number.isFinite(n) && n >= 0
		)
	)
		throw new RangeError(
			'Capital and annual operating limits must be finite nonnegative MVR amounts.'
		);
	const analyze =
		options.analyze ??
		(async (actions, assumptions) => analyzePlanning(baseline, actions, assumptions));
	const currentActions = [...(options.actions ?? [])];
	const current = await analyze(currentActions, options.assumptions);
	const basis = options.costBasis ?? 'high';
	if (
		currentActions.some((action) => action.kind === 'shift-timetable') ||
		options.assumptions.disruptions?.length
	) {
		const reason =
			'Timetable changes or road interventions have unestimated implementation costs. Obtain operator and engineering cost estimates before comparing the whole proposal against capital and annual operating limits.';
		return {
			alternatives: [],
			excluded: [{ label: 'Whole-proposal affordability', reason }],
			notes: [
				'Whole-proposal affordability is not established; no affordable options are certified.',
				reason,
				'You can still inspect access and journey changes. To compare a separate fully costed proposal, remove these timetable or road assumptions from that comparison.'
			],
			baseline: current,
			costBasis: basis
		};
	}
	const generated = candidates(baseline, options);
	const excluded = generated.excluded;
	const alternatives: InvestmentAlternative[] = [];
	for (const candidate of generated.items) {
		const actions = [...currentActions, ...candidate.additions];
		const costs = calculatePlanningEconomics(
			baseline,
			derivePlanningWorld(baseline, actions, options.assumptions),
			options.assumptions
		).costs;
		if (!costs.capitalMvr || !costs.annualOperatingMvr) {
			excluded.push({
				label: candidate.label,
				reason: `Costs unavailable: ${costs.unavailableReasons.join(' ')}`
			});
			continue;
		}
		if (
			costs.capitalMvr[basis] > options.capitalBudgetMvr ||
			costs.annualOperatingMvr[basis] > options.annualOperatingBudgetMvr
		) {
			excluded.push({
				label: candidate.label,
				reason: `Exceeds the ${basis} capital or annual operating limit.`
			});
			continue;
		}
		const result = await analyze(actions, options.assumptions);
		const evaluation = evaluateInvestment(current, result, basis);
		const carbonImprovement =
			result.carbon.central !== null &&
			current.carbon.central !== null &&
			result.carbon.central < current.carbon.central;
		if (
			evaluation.netAdditionalResidents <= 0 &&
			!(evaluation.minutesSaved !== null && evaluation.minutesSaved > 0.05) &&
			!carbonImprovement
		) {
			excluded.push({
				label: candidate.label,
				reason: 'No measured access, journey-time or carbon improvement on these inputs.'
			});
			continue;
		}
		alternatives.push({
			id: candidate.id,
			label: candidate.label,
			description: candidate.description,
			kind: candidate.kind,
			actions,
			result,
			evaluation
		});
	}
	alternatives.sort(
		(a, b) =>
			b.evaluation.netAdditionalResidents - a.evaluation.netAdditionalResidents ||
			a.evaluation.lostResidents - b.evaluation.lostResidents ||
			(b.evaluation.minutesSaved ?? -Infinity) - (a.evaluation.minutesSaved ?? -Infinity) ||
			Number(b.evaluation.evidence === 'complete') - Number(a.evaluation.evidence === 'complete') ||
			a.evaluation.capitalMvr - b.evaluation.capitalMvr ||
			a.evaluation.annualOperatingMvr - b.evaluation.annualOperatingMvr ||
			a.id.localeCompare(b.id)
	);
	return {
		alternatives: alternatives.slice(0, options.maxAlternatives ?? 3),
		excluded,
		notes: [
			'Ranked by net additional access, losses, journey improvement, evidence coverage, then cost; no demand forecast or global optimum is claimed.',
			`All shown options fit both ${basis}-estimate budget limits. Unit costs and annual operations remain editable planning assumptions.`,
			'Walking improvements need verified entrances, crossings, barriers and construction costs. Missing paths are audit tasks, not scored speculative shortcuts.',
			...(alternatives.length
				? []
				: [
						'No affordable beneficial option was found in this bounded search. Change the limits or collect missing service, destination or walking evidence.'
					])
		],
		baseline: current,
		costBasis: basis
	};
}
