import type { PlanningAssumptions, PlanningBaseline } from './types.ts';

export function planningPopulation(
	baseline: PlanningBaseline,
	assumptions: Pick<PlanningAssumptions, 'populationYear' | 'housingDistribution'>
): { byOrigin: Map<string, number>; warnings: string[] } {
	const byOrigin = new Map(
		baseline.origins.map((o) => [
			o.id,
			assumptions.populationYear === 2030
				? (o.population2030 ?? o.population2026)
				: o.population2026
		])
	);
	const warnings: string[] = [];
	if (assumptions.populationYear !== 2030) return { byOrigin, warnings };
	const handled = new Set<string>();
	for (const allocation of assumptions.housingDistribution ?? []) {
		const island = baseline.islands.find((i) => i.id === allocation.islandId);
		const rawTotal = island?.projection2030Population ?? island?.population2030;
		const total =
			typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal >= 0 ? rawTotal : null;
		const origins = baseline.origins.filter((o) => o.islandId === allocation.islandId);
		const selectedIds = new Set(allocation.originIds);
		const inside = origins.filter((o) => selectedIds.has(o.id));
		const outside = origins.filter((o) => !selectedIds.has(o.id));
		if (
			handled.has(allocation.islandId) ||
			total === null ||
			!inside.length ||
			!outside.length ||
			inside.length !== selectedIds.size ||
			!Number.isFinite(allocation.share) ||
			allocation.share < 0 ||
			allocation.share > 1
		) {
			warnings.push(
				`${island?.name ?? allocation.islandId}: housing distribution ignored; requires an official 2030 island total, unique same-island origins inside and outside, and a share between 0 and 1.`
			);
			continue;
		}
		handled.add(allocation.islandId);
		const insideTotal = total * allocation.share;
		for (const [group, groupTotal] of [
			[inside, insideTotal],
			[outside, total - insideTotal]
		] as const) {
			const sum = group.reduce((s, o) => s + (o.population2030 ?? o.population2026), 0);
			let assigned = 0;
			group.forEach((o, i) => {
				const value =
					i === group.length - 1
						? groupTotal - assigned
						: groupTotal * (sum ? (o.population2030 ?? o.population2026) / sum : 1 / group.length);
				byOrigin.set(o.id, value);
				assigned += value;
			});
		}
		warnings.push(
			`${island!.name}: conditional housing distribution allocates ${(allocation.share * 100).toFixed(1)}% of the official 2030 island total to the selected neighborhood. Completion, occupancy and buildable land are not observed.`
		);
	}
	return { byOrigin, warnings };
}
export function populationForOrigin(
	baseline: PlanningBaseline,
	originId: string,
	assumptions: Pick<PlanningAssumptions, 'populationYear' | 'housingDistribution'>
): number {
	return planningPopulation(baseline, assumptions).byOrigin.get(originId) ?? 0;
}
