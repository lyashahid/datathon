import type { InspectorSelection } from '#lib/types/ui.ts';

/** Lookups for whether each kind of selectable thing still exists. */
export interface SelectionLookups {
	hasInfrastructure(id: string): boolean;
	hasRoute(id: string): boolean;
	hasCandidateSearch(): boolean;
	hasCandidate(id: string): boolean;
	hasObservation(id: string): boolean;
}

/**
 * What the selection should become after the world changed (undo, reset, switching scenario,
 * re-ranking, deleting an observation). Returns the same object when it is still valid; a
 * vanished candidate falls back to the candidate list if the search is still open.
 */
export function reconcileSelection(
	selection: InspectorSelection | null,
	has: SelectionLookups
): InspectorSelection | null {
	if (!selection) return null;
	switch (selection.kind) {
		case 'infrastructure':
			return has.hasInfrastructure(selection.id) ? selection : null;
		case 'route':
			return has.hasRoute(selection.id) ? selection : null;
		case 'candidates':
			return has.hasCandidateSearch() ? selection : null;
		case 'candidate':
			if (has.hasCandidate(selection.id)) return selection;
			return has.hasCandidateSearch() ? { kind: 'candidates' } : null;
		case 'observation':
			return has.hasObservation(selection.id) ? selection : null;
		case 'area':
			return selection;
	}
}
