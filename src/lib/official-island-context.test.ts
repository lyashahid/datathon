import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import OfficialIslandContext from './components/OfficialIslandContext.svelte';
import type { OfficialIslandContext as Context } from './types.js';

const bundle = JSON.parse(readFileSync('data/public/island-context.json', 'utf8'));
function context(islandId: string): Context {
	return {
		status: 'available',
		geography_grain: 'administrative_island',
		census_demographics: bundle.demographics.find(
			(row: { island_id: string }) => row.island_id === islandId
		),
		employment: bundle.employment.filter(
			(row: { island_id: string }) => row.island_id === islandId
		),
		projections: bundle.projections.filter(
			(row: { island_id: string }) => row.island_id === islandId
		),
		transform_version: bundle.transformVersion,
		sources: bundle.sources,
		qualifications: bundle.qualifications
	};
}

describe('official island context display', () => {
	it('shows Seenu Hithadhoo census and dated projections with nationality and source limits', () => {
		const html = render(OfficialIslandContext, {
			props: { context: context('island:1152'), islandId: 'island:1152' }
		}).body;
		expect(html).toContain('13,759');
		expect(html).toContain('14,812');
		expect(html).toContain('15,008');
		expect(html).toContain('Maldivian children');
		expect(html).toContain('Age counts cover Maldivians only');
		expect(html).toContain('Whole administrative island');
		expect(html).toContain('2022–2030 projections');
	});
	it('keeps Laamu Hithadhoo separate from the same-named Seenu island', () => {
		const html = render(OfficialIslandContext, {
			props: { context: context('island:697'), islandId: 'island:697' }
		}).body;
		expect(html).toContain('1,108');
		expect(html).toContain('1,156');
		expect(html).not.toContain('13,759');
	});
	it('does not show stale context for another island or fabricate an unavailable record', () => {
		const stale = render(OfficialIslandContext, {
			props: { context: context('island:1152'), islandId: 'island:697' }
		}).body;
		const absent = render(OfficialIslandContext, {
			props: { context: null, islandId: 'island:1443' }
		}).body;
		expect(stale).not.toContain('Official island context');
		expect(absent).not.toContain('Official island context');
	});
});
