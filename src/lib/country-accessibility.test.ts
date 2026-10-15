import { describe, expect, it } from 'vitest';
import {
	accessibilityExplorerIslands,
	residentialAtollAccessibility,
	summarizeResidentialAccessibility
} from './country-accessibility.js';
import type { Accessibility, MapFeatures } from './types.js';

const features: MapFeatures = {
	type: 'FeatureCollection',
	features: [
		['island:1', 'One', 'North', 'Residential Island'],
		['island:2', 'Two', 'North', 'Residential Island'],
		['island:3', 'Three', 'South', 'Residential Island'],
		['island:4', 'Four', 'South', 'Resort Island'],
		['island:5', 'Five', 'South', 'Uninhabited Island'],
		['island:6', 'Six', 'South', 'Residential Island'],
		['facility:1', 'School', 'North', 'school']
	].map(([id, name, atoll, category]) => ({
		type: 'Feature',
		geometry: null,
		properties: { id, name, atoll, category }
	}))
};

function score(island_id: string, value: number, population: number | null = null): Accessibility {
	return {
		island_id,
		score: value,
		confidence: 0.5,
		domains: {
			health: { score: value, missing_data: [] },
			education: { score: 0, missing_data: [] }
		},
		missing_data: [],
		explanation: [],
		config: {},
		population: { total: population, year: 2022 }
	};
}

describe('residential accessibility explorer', () => {
	it('uses an unweighted mean of scored residential islands and preserves actual zeros', () => {
		const rows = accessibilityExplorerIslands(features, [
			score('island:1', 0, 10000),
			score('island:2', 20, 10),
			score('island:3', 40),
			score('island:4', 100),
			score('island:5', 100),
			score('island:orphan', 100)
		]);
		const summary = summarizeResidentialAccessibility(rows);
		expect(summary.islandCount).toBe(4);
		expect(summary.scoredIslandCount).toBe(3);
		expect(summary.unscoredIslandCount).toBe(1);
		expect(summary.averageScore).toBe(20);
		expect(summary.components.health).toEqual({ averageScore: 20, scoredIslandCount: 3 });
		expect(summary.components.education).toEqual({ averageScore: 0, scoredIslandCount: 3 });
		expect(summary.components.transport).toEqual({ averageScore: null, scoredIslandCount: 0 });
		expect(rows).toHaveLength(6);
	});

	it('keeps absent and nonfinite scores out of the denominator without manufacturing a zero', () => {
		const summary = summarizeResidentialAccessibility(
			accessibilityExplorerIslands(features, [score('island:1', NaN), score('island:2', Infinity)])
		);
		expect(summary.averageScore).toBeNull();
		expect(summary.scoredIslandCount).toBe(0);
		expect(summary.unscoredIslandCount).toBe(4);
		expect(summary.populationAvailableIslandCount).toBe(0);
		expect(summary.populationUnknownIslandCount).toBe(4);
		expect(
			summarizeResidentialAccessibility(accessibilityExplorerIslands(null, null))
		).toMatchObject({
			islandCount: 0,
			averageScore: null
		});
	});

	it('counts backend mapped evidence explicitly and treats missing resident counts as unknown', () => {
		const mapped = score('island:1', 0, 0);
		mapped.assessment = {
			score: 0,
			out_of: 100,
			label: 'Limited evidence',
			summary: '',
			reasons: [],
			components: { health: { score: 0 } },
			coverage: {
				status: 'limited',
				label: 'Limited evidence',
				note: '',
				population_available: true,
				scored_domains: 1,
				total_domains: 3
			},
			limitations: []
		};
		const unmapped = score('island:2', 0);
		unmapped.assessment = {
			...mapped.assessment,
			coverage: { ...mapped.assessment.coverage, scored_domains: 0, population_available: false }
		};
		const summary = summarizeResidentialAccessibility(
			accessibilityExplorerIslands(features, [mapped, unmapped])
		);
		expect(summary.mappedEvidenceIslandCount).toBe(1);
		expect(summary.unknownEvidenceIslandCount).toBe(2);
		expect(summary.populationAvailableIslandCount).toBe(1);
		expect(summary.populationUnknownIslandCount).toBe(3);
	});

	it('groups only residential islands by atoll and shows each real scored denominator', () => {
		const rows = accessibilityExplorerIslands(features, [
			score('island:1', 0),
			score('island:2', 20),
			score('island:4', 100)
		]);
		const atolls = residentialAtollAccessibility(rows);
		expect(
			atolls.map((atoll) => [atoll.name, atoll.averageScore, atoll.scoredIslandCount])
		).toEqual([
			['North', 10, 2],
			['South', null, 0]
		]);
		expect(atolls[1].islands.map((island) => island.id)).toEqual(['island:6', 'island:3']);
	});
});
