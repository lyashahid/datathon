import { describe, expect, it } from 'vitest';
import infrastructureRaw from '../../../data/sample/infrastructure.geojson?raw';
import {
	DISRUPTION_LABELS,
	DISRUPTION_SCENARIOS,
	getDisruption,
	NORMAL_CONDITIONS
} from '#lib/config/disruptionScenarios.ts';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import { createDemoBaseCells } from './h3DemoData.ts';
import { buildAccessibilityGrid } from './h3Grid.ts';
import { compareGrids } from './impact.ts';

const infrastructure = decodeInfrastructureCollection(JSON.parse(infrastructureRaw)).features;
const base = createDemoBaseCells();
const gridUnder = (id: Parameters<typeof getDisruption>[0]) =>
	buildAccessibilityGrid(base, infrastructure, getDisruption(id).conditions);

const normal = buildAccessibilityGrid(base, infrastructure);
const moderate = gridUnder('moderateMarine');
const severe = gridUnder('severeMarine');

describe('disruption scenarios', () => {
	it('declares explicit assumptions for every preset', () => {
		expect(getDisruption('normal').conditions).toBe(NORMAL_CONDITIONS);
		for (const d of DISRUPTION_SCENARIOS) {
			expect(d.assumptions.length).toBeGreaterThan(0);
			expect(d.label).not.toMatch(/forecast|predict/i);
		}
		expect(DISRUPTION_LABELS.disclaimer).toMatch(/not a forecast/i);
	});

	it('normal operations reproduce the default grid exactly', () => {
		expect(gridUnder('normal').cells).toEqual(normal.cells);
	});

	it('is deterministic', () => {
		expect(gridUnder('severeMarine').cells).toEqual(severe.cells);
	});

	it('never improves accessibility, and severe is never better than moderate', () => {
		for (let i = 0; i < normal.cells.length; i++) {
			for (const key of [
				'transportAccessibility',
				'healthAccessibility',
				'educationAccessibility',
				'overallAccessibility'
			] as const) {
				expect(moderate.cells[i][key]).toBeLessThanOrEqual(normal.cells[i][key]);
				expect(severe.cells[i][key]).toBeLessThanOrEqual(moderate.cells[i][key]);
			}
		}
	});

	it('moderate disruption leaves on-island transport untouched', () => {
		moderate.cells.forEach((c, i) =>
			expect(c.transportAccessibility).toBe(normal.cells[i].transportAccessibility)
		);
	});

	it('severe disruption removes every ferry trip and ferry-terminal access', () => {
		for (const c of severe.cells) {
			for (const comp of [...c.access.health.components, ...c.access.education.components]) {
				expect(comp.viaFerry).toBe(false);
			}
			const ferry = c.access.transport.components.find((x) => x.id === 'ferryTerminal');
			expect(ferry?.score).toBe(0);
		}
	});

	it('reports affected population against normal operations', () => {
		const impact = compareGrids(normal, severe);
		expect(impact.summary.losing.total).toBeGreaterThan(0);
		expect(impact.summary.benefiting.total).toBe(0);
		expect(impact.summary.underservedPopulation.after).toBeGreaterThan(
			impact.summary.underservedPopulation.before
		);
		const mild = compareGrids(normal, moderate).summary.losing.total;
		expect(mild).toBeLessThanOrEqual(impact.summary.losing.total);
	});
});
