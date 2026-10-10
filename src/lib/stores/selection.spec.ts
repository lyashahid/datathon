import { describe, expect, it } from 'vitest';
import type { InspectorSelection } from '#lib/types/ui.ts';
import { reconcileSelection, type SelectionLookups } from './selection.ts';

const lookups = (present: Partial<Record<string, boolean>>, search = true): SelectionLookups => ({
	hasInfrastructure: (id) => !!present[id],
	hasRoute: (id) => !!present[id],
	hasCandidateSearch: () => search,
	hasCandidate: (id) => !!present[id],
	hasObservation: (id) => !!present[id]
});

describe('reconcileSelection', () => {
	it('keeps a selection that still exists, as the same object', () => {
		const sel: InspectorSelection = { kind: 'infrastructure', id: 'a' };
		expect(reconcileSelection(sel, lookups({ a: true }))).toBe(sel);
	});

	it('drops selections that vanished after undo, reset or a scenario switch', () => {
		for (const sel of [
			{ kind: 'infrastructure', id: 'gone' },
			{ kind: 'route', id: 'gone' },
			{ kind: 'observation', id: 'gone' }
		] as InspectorSelection[]) {
			expect(reconcileSelection(sel, lookups({}))).toBeNull();
		}
	});

	it('falls back from a vanished candidate to the list while the search is open', () => {
		const sel: InspectorSelection = { kind: 'candidate', id: 'c9' };
		expect(reconcileSelection(sel, lookups({}, true))).toEqual({ kind: 'candidates' });
		expect(reconcileSelection(sel, lookups({}, false))).toBeNull();
		expect(reconcileSelection({ kind: 'candidates' }, lookups({}, false))).toBeNull();
	});

	it('leaves cell selections alone and handles no selection', () => {
		const area: InspectorSelection = { kind: 'area', cellIds: ['x'], label: 'x' };
		expect(reconcileSelection(area, lookups({}))).toBe(area);
		expect(reconcileSelection(null, lookups({}))).toBeNull();
	});
});
