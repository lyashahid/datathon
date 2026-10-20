/** Editable funding envelope for a local transport pilot, not an official appropriation. */
export const TRANSPORT_PILOT_BUDGET = { capital: 50_000_000, annual: 12_000_000 } as const;

export const TRANSPORT_PILOT_BUDGET_NOTE =
	'Default: MVR 50 million upfront and MVR 12 million per year for a local transport pilot. Editable planning envelope, not an official appropriation.';

/** Replace only the previous default pair; retain all other saved budget choices. */
export function restorePlanningBudget(capital: unknown, annual: unknown) {
	if (capital === 150_000_000 && annual === 25_000_000) return { ...TRANSPORT_PILOT_BUDGET };
	const valid = (value: unknown): value is number =>
		typeof value === 'number' && Number.isFinite(value) && value >= 0;
	return {
		capital: valid(capital) ? capital : TRANSPORT_PILOT_BUDGET.capital,
		annual: valid(annual) ? annual : TRANSPORT_PILOT_BUDGET.annual
	};
}
