import { describe, expect, it } from 'vitest';
import infrastructureRaw from '../../../data/sample/infrastructure.geojson?raw';
import { INTERVENTION_RULES } from '#lib/config/interventions.ts';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import type { Position } from '#lib/types/domain.ts';
import type { H3BaseCell, H3Cell } from '#lib/types/h3.ts';
import { buildAccessibilityGrid } from './h3Grid.ts';
import { relevanceBand, relevanceScore, suggestInterventions } from './interventions.ts';

const infrastructure = decodeInfrastructureCollection(JSON.parse(infrastructureRaw)).features;

/** A single analytical cell scored against the real sample infrastructure. */
function cellAt(position: Position, island: string, population: number): H3Cell {
	const base: H3BaseCell = {
		h3Index: 'test',
		centroid: position,
		areaKm2: 0.015,
		island,
		population,
		children: population * 0.25,
		workingAge: population * 0.68,
		olderPopulation: population * 0.07,
		provenance: 'demo'
	};
	return buildAccessibilityGrid([base], infrastructure).cells[0];
}

/** North-east of the airport island: far from stops, terminals, hospital and school. */
const REMOTE: Position = [73.5385, 4.197];
/** Next to Indira Gandhi Memorial Hospital in central Malé. */
const CENTRAL_MALE: Position = [73.505, 4.1745];

const types = (cell: H3Cell) => suggestInterventions(cell).map((s) => s.type);

describe('suggestInterventions', () => {
	it('suggests a bus stop for a dense, poorly served cell far from any stop', () => {
		const cell = cellAt(REMOTE, 'Hulhulé', 600);
		const stop = suggestInterventions(cell).find((s) => s.type === 'add_bus_stop');
		expect(stop).toBeDefined();
		expect(stop!.triggers.map((t) => t.metric)).toEqual([
			'Residents',
			'Transport accessibility',
			'Nearest bus stop'
		]);
		expect(stop!.reasons.length).toBeGreaterThan(0);
	});

	it('does not suggest a bus stop where few people live', () => {
		expect(types(cellAt(REMOTE, 'Hulhulé', INTERVENTION_RULES.highPopulation - 1))).not.toContain(
			'add_bus_stop'
		);
	});

	it('suggests improving healthcare access, never building a hospital outright', () => {
		const health = suggestInterventions(cellAt(REMOTE, 'Hulhulé', 600)).find(
			(s) => s.type === 'improve_healthcare_access'
		);
		expect(health?.title).toBe('Improve healthcare access');
		expect(health!.reasons.join(' ')).toMatch(/evaluate before building/);
	});

	it('flags ferry connectivity when services depend on ferries and the terminal is far', () => {
		const ferry = suggestInterventions(cellAt(REMOTE, 'Hulhulé', 600)).find(
			(s) => s.type === 'investigate_ferry_connectivity'
		);
		expect(ferry).toBeDefined();
		expect(ferry!.triggers[1].value).toMatch(/Hospital|School/);
	});

	it('suggests nothing for a well-served central cell', () => {
		expect(suggestInterventions(cellAt(CENTRAL_MALE, 'Malé', 900))).toEqual([]);
	});

	it('ignores cells below the represented-population floor', () => {
		expect(suggestInterventions(cellAt(REMOTE, 'Hulhulé', 10))).toEqual([]);
	});

	it('ranks by relevance and is deterministic', () => {
		const cell = cellAt(REMOTE, 'Hulhulé', 600);
		const a = suggestInterventions(cell);
		expect(a).toEqual(suggestInterventions(cell));
		const scores = a.map((s) => s.relevance);
		expect([...scores].sort((x, y) => y - x)).toEqual(scores);
	});
});

describe('relevance', () => {
	it('blends shortfall and represented population', () => {
		expect(relevanceScore(0, 50, 800).relevance).toBe(100);
		expect(relevanceScore(50, 50, 0).relevance).toBe(0);
		expect(relevanceScore(25, 50, 400).relevance).toBe(50);
		expect(relevanceBand(70)).toBe('high');
		expect(relevanceBand(40)).toBe('medium');
		expect(relevanceBand(10)).toBe('low');
	});
});
