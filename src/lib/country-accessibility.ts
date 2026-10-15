import type { Accessibility, MapFeatures } from './types.js';

export const accessibilityDomains = ['health', 'education', 'transport'] as const;
export type AccessibilityDomain = (typeof accessibilityDomains)[number];

export interface AccessibilityExplorerIsland {
	id: string;
	name: string;
	atoll: string;
	category: string;
	residential: boolean;
	score: number | null;
	assessment: Accessibility['assessment'] | null;
	population: Accessibility['population'] | null;
	source: Accessibility | null;
}

export interface ResidentialAccessibilitySummary {
	islandCount: number;
	scoredIslandCount: number;
	unscoredIslandCount: number;
	averageScore: number | null;
	components: Record<
		AccessibilityDomain,
		{ averageScore: number | null; scoredIslandCount: number }
	>;
	mappedEvidenceIslandCount: number;
	unknownEvidenceIslandCount: number;
	populationAvailableIslandCount: number;
	populationUnknownIslandCount: number;
}

const numeric = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

const mean = (values: number[]): number | null =>
	values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;

/** Join scores to canonical island metadata; facilities and orphan score rows are excluded. */
export function accessibilityExplorerIslands(
	features: MapFeatures | null,
	scores: Accessibility[] | null
): AccessibilityExplorerIsland[] {
	const byId = new Map(scores?.map((score) => [score.island_id, score]) ?? []);
	const islands = new Map<string, AccessibilityExplorerIsland>();
	for (const feature of features?.features ?? []) {
		const properties = feature.properties ?? {};
		const id = String(properties.id ?? feature.id ?? '');
		if (!id.startsWith('island:') || islands.has(id)) continue;
		const source = byId.get(id) ?? null;
		const category = String(properties.category ?? '').trim();
		islands.set(id, {
			id,
			name: String(properties.name ?? '').trim() || `Unnamed island (${id})`,
			atoll: String(properties.atoll ?? '').trim() || 'Unassigned atoll',
			category,
			residential: category.toLowerCase() === 'residential island',
			score: numeric(source?.score) ? source.score : null,
			assessment: source?.assessment ?? null,
			population: source?.population ?? null,
			source
		});
	}
	return [...islands.values()];
}

/** Each scored residential island contributes once, including an actual score of zero. */
export function summarizeResidentialAccessibility(
	islands: AccessibilityExplorerIsland[]
): ResidentialAccessibilitySummary {
	const residential = islands.filter((island) => island.residential);
	const scored = residential.filter((island) => island.score !== null);
	const components = Object.fromEntries(
		accessibilityDomains.map((domain) => {
			const values = scored.flatMap((island) => {
				const value =
					island.assessment?.components[domain]?.score ?? island.source?.domains[domain]?.score;
				return numeric(value) ? [value] : [];
			});
			return [domain, { averageScore: mean(values), scoredIslandCount: values.length }];
		})
	) as ResidentialAccessibilitySummary['components'];
	const mappedEvidenceIslandCount = residential.filter((island) => {
		const domains = island.assessment?.coverage.scored_domains;
		return numeric(domains) && domains > 0;
	}).length;
	const knownEvidence = residential.filter((island) =>
		numeric(island.assessment?.coverage.scored_domains)
	).length;
	const populationAvailableIslandCount = residential.filter(
		(island) => numeric(island.population?.total) && island.population.total >= 0
	).length;
	return {
		islandCount: residential.length,
		scoredIslandCount: scored.length,
		unscoredIslandCount: residential.length - scored.length,
		averageScore: mean(scored.map((island) => island.score as number)),
		components,
		mappedEvidenceIslandCount,
		unknownEvidenceIslandCount: residential.length - knownEvidence,
		populationAvailableIslandCount,
		populationUnknownIslandCount: residential.length - populationAvailableIslandCount
	};
}

export function residentialAtollAccessibility(islands: AccessibilityExplorerIsland[]) {
	const groups = new Map<string, AccessibilityExplorerIsland[]>();
	for (const island of islands) {
		if (!island.residential) continue;
		const group = groups.get(island.atoll) ?? [];
		group.push(island);
		groups.set(island.atoll, group);
	}
	return [...groups.entries()]
		.map(([name, rows]) => ({
			name,
			islands: rows.sort((a, b) => a.name.localeCompare(b.name)),
			...summarizeResidentialAccessibility(rows)
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}
