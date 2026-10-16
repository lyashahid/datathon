import {
	bestTransportWaitChange,
	changedIslandConnections,
	changedTransportLines,
	comparableWaitSaving,
	impactNumber,
	transportImpactHeadline,
	type TransportImpactData
} from './transport-impact.js';

export type ProposalBenefit = {
	label: string;
	value: number | null;
	unit: string;
	detail: string | null;
	reduced: boolean;
	guardrail: string | null;
};

/** Keep walking coverage, route waits and dated connections in their own units. */
export function proposalBenefit(
	gainedResidents: number | null | undefined,
	impact?: TransportImpactData | null
): ProposalBenefit {
	const gained = impactNumber(gainedResidents);
	const detail = transportImpactHeadline(impact);
	const changedRows = [...changedTransportLines(impact), ...changedIslandConnections(impact)];
	const departuresBefore = impactNumber(impact?.summary?.departures_before);
	const departuresAfter = impactNumber(impact?.summary?.departures_after);
	const hasReduction =
		changedRows.some((row) => {
			const waitSaved = comparableWaitSaving(row);
			const before = impactNumber(row.before?.departure_count);
			const after = impactNumber(row.after?.departure_count);
			return (
				row.change === 'worsened' ||
				row.change === 'removed' ||
				(waitSaved !== null && waitSaved < -0.05) ||
				(before !== null && after !== null && after < before)
			);
		}) ||
		(departuresBefore !== null && departuresAfter !== null && departuresAfter < departuresBefore);
	// A service and its directed connections can describe the same reduction; do not sum them.
	const complete = (benefit: Omit<ProposalBenefit, 'guardrail'>): ProposalBenefit => ({
		...benefit,
		guardrail:
			hasReduction && !benefit.reduced && benefit.value !== null && benefit.value > 0
				? 'Also includes reduced or removed service. Review timetables.'
				: null
	});
	if (gained !== null && gained > 0)
		return complete({ label: 'Gaining access', value: gained, unit: '', detail, reduced: false });
	const wait = bestTransportWaitChange(impact);
	if (wait)
		return complete({
			label: wait.saved > 0 ? 'Wait saved' : 'Wait increase',
			value: Math.abs(wait.saved),
			unit: 'min',
			detail,
			reduced: wait.saved < 0
		});
	const connections = changedIslandConnections(impact);
	const added = connections.filter((row) => row.change === 'added').length;
	const removed = connections.filter((row) => row.change === 'removed').length;
	if (added || removed)
		return complete({
			label: added ? 'New directions' : 'Directions lost',
			value: added || removed,
			unit: '',
			detail,
			reduced: !added
		});
	const before = impactNumber(impact?.summary?.departures_before);
	const after = impactNumber(impact?.summary?.departures_after);
	if (before !== null && after !== null && before !== after)
		return complete({
			label: after > before ? 'More departures' : 'Fewer departures',
			value: Math.abs(after - before),
			unit: '',
			detail,
			reduced: after < before
		});
	const newLine = changedTransportLines(impact).find((line) => line.change === 'added');
	const expectedWait = impactNumber(newLine?.after?.expected_wait_minutes);
	if (expectedWait !== null)
		return complete({
			label: 'New service wait',
			value: expectedWait,
			unit: 'min',
			detail: `${newLine!.name} · no previous wait to compare`,
			reduced: false
		});
	return complete({ label: 'Gaining access', value: gained, unit: '', detail, reduced: false });
}
