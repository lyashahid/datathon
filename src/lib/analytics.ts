import { themeColors } from '#lib/theme.js';
import type { Accessibility, MapFeatures } from './types.js';

export interface NationalAccessibility {
	version: string;
	scores: Accessibility[];
	summary: {
		island_count: number;
		average_score: number;
		zero_score_count: number;
		missing_data_score_count: number;
	};
}

export interface IslandAnalytics {
	id: string;
	name: string;
	atoll: string;
	category: string;
	facilities: Record<string, number>;
	facilityCount: number;
	locatedCount: number;
	score: number | null;
	confidence: number | null;
	missingData: string[] | null;
	assessment: Accessibility['assessment'] | null;
	population: Accessibility['population'] | null;
}

export interface FacilityInventory {
	id: string;
	islandId: string | null;
	category: string;
	located: boolean;
	contextOnly: boolean;
}

export function hasMissingAccessibilityData(row: IslandAnalytics): boolean {
	return (
		row.missingData === null ||
		row.missingData.some(
			(flag) => flag !== 'population_pressure' && flag !== 'population_density_pressure'
		)
	);
}

export interface AtollInventory {
	name: string;
	islandCount: number;
	facilityCount: number;
	health: number;
	education: number;
	airports: number;
	averageScore: number | null;
}

export const facilityLabels: Record<string, string> = {
	clinic: 'Clinics',
	health_center: 'Health centres',
	hospital: 'Hospitals',
	school: 'Schools',
	airport: 'Airports'
};

export const facilityColors: Record<string, string> = {
	clinic: themeColors.color9072dd,
	health_center: themeColors.coloraf98e7,
	hospital: themeColors.colorcfc0ee,
	school: themeColors.color32ae89,
	airport: themeColors.colorefa84b
};

export function inventoryFromFeatures(collection: MapFeatures | null): FacilityInventory[] {
	if (!collection) return [];
	return collection.features.flatMap((feature) => {
		const properties = feature.properties ?? {};
		const id = String(feature.id ?? properties.id ?? '');
		if (!id.startsWith('facility:') && !id.startsWith('airport:')) return [];
		return [
			{
				id,
				islandId: typeof properties.island_id === 'string' ? properties.island_id : null,
				category: String(properties.category ?? 'other'),
				located: feature.geometry !== null,
				contextOnly: properties.geometry_quality === 'island_context_only'
			}
		];
	});
}

export function islandAnalytics(
	features: MapFeatures | null,
	inventory: FacilityInventory[],
	accessibility: NationalAccessibility | null
): IslandAnalytics[] {
	const scores = new Map(accessibility?.scores.map((score) => [score.island_id, score]) ?? []);
	const rows = new Map<string, IslandAnalytics>();
	for (const feature of features?.features ?? []) {
		const properties = feature.properties ?? {};
		const id = String(properties.id ?? feature.id ?? '');
		if (!id.startsWith('island:') || rows.has(id)) continue;
		const score = scores.get(id);
		rows.set(id, {
			id,
			name: String(properties.name ?? '').trim() || `Unnamed island (${id})`,
			atoll: String(properties.atoll ?? '').trim() || 'Unassigned atoll',
			category: String(properties.category ?? '').trim() || 'Unclassified',
			facilities: {},
			facilityCount: 0,
			locatedCount: 0,
			score: score && Number.isFinite(score.score) ? score.score : null,
			confidence: score && Number.isFinite(score.confidence) ? score.confidence : null,
			missingData: score?.missing_data ?? null,
			assessment: score?.assessment ?? null,
			population: score?.population ?? null
		});
	}
	for (const facility of inventory) {
		const row = facility.islandId ? rows.get(facility.islandId) : undefined;
		if (!row) continue;
		row.facilityCount++;
		row.locatedCount += Number(facility.located);
		row.facilities[facility.category] = (row.facilities[facility.category] ?? 0) + 1;
	}
	return [...rows.values()];
}

export function inventoryForScope(
	inventory: FacilityInventory[],
	rows: IslandAnalytics[],
	includeUnassigned: boolean
): FacilityInventory[] {
	const ids = new Set(rows.map((row) => row.id));
	return inventory.filter(
		(item) => includeUnassigned || (item.islandId !== null && ids.has(item.islandId))
	);
}

export function atollInventory(rows: IslandAnalytics[]): AtollInventory[] {
	const groups = new Map<string, IslandAnalytics[]>();
	for (const row of rows) {
		const group = groups.get(row.atoll) ?? [];
		group.push(row);
		groups.set(row.atoll, group);
	}
	return [...groups.entries()]
		.map(([name, islands]) => {
			const validScores = islands.flatMap((row) => (row.score === null ? [] : [row.score]));
			return {
				name,
				islandCount: islands.length,
				facilityCount: islands.reduce((sum, row) => sum + row.facilityCount, 0),
				health: islands.reduce(
					(sum, row) =>
						sum +
						(row.facilities.clinic ?? 0) +
						(row.facilities.health_center ?? 0) +
						(row.facilities.hospital ?? 0),
					0
				),
				education: islands.reduce((sum, row) => sum + (row.facilities.school ?? 0), 0),
				airports: islands.reduce((sum, row) => sum + (row.facilities.airport ?? 0), 0),
				averageScore: validScores.length
					? validScores.reduce((sum, value) => sum + value, 0) / validScores.length
					: null
			};
		})
		.sort((a, b) => b.facilityCount - a.facilityCount || a.name.localeCompare(b.name));
}

export function scoreDistribution(rows: IslandAnalytics[]) {
	const bins = [
		{ label: '0', low: 0, high: 0, count: 0 },
		{ label: '>0–<20', low: 0, high: 20, count: 0 },
		{ label: '20–39', low: 20, high: 40, count: 0 },
		{ label: '40–59', low: 40, high: 60, count: 0 },
		{ label: '60–79', low: 60, high: 80, count: 0 },
		{ label: '80–100', low: 80, high: 101, count: 0 }
	];
	let unavailable = 0;
	for (const row of rows) {
		if (row.score === null) {
			unavailable++;
			continue;
		}
		const value = row.score;
		const index =
			value === 0 ? 0 : bins.findIndex((bin, i) => i > 0 && value >= bin.low && value < bin.high);
		if (index >= 0) bins[index].count++;
		else unavailable++;
	}
	return { bins, unavailable };
}
