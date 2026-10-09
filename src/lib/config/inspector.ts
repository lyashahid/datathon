import { Ban, GitCompareArrows, Move, RotateCcw, ScanSearch, X } from '@lucide/svelte';
import type { AssetStatus } from '#lib/types/domain.ts';
import type { IconComponent } from '#lib/types/ui.ts';

export type InspectorActionId =
	'analyse' | 'move' | 'cancelMove' | 'disable' | 'restore' | 'compare';

export interface InspectorAction {
	id: InspectorActionId;
	label: string;
	icon: IconComponent;
	/** Present when the action is not available, explaining why. */
	unavailableReason?: string;
	/** Rendered as pressed (e.g. Move while the facility is being moved). */
	active?: boolean;
}

/**
 * The four inspector slots. Edits from the baseline view start a scenario automatically, so
 * Move and Disable are always offered; Disable flips to Restore for disabled assets.
 */
export function infrastructureActions(context: {
	status: AssetStatus;
	isMoving: boolean;
}): InspectorAction[] {
	return [
		{ id: 'analyse', label: 'Analyse', icon: ScanSearch },
		context.isMoving
			? { id: 'cancelMove', label: 'Cancel', icon: X, active: true }
			: { id: 'move', label: 'Move', icon: Move },
		context.status === 'disabled'
			? { id: 'restore', label: 'Restore', icon: RotateCcw }
			: { id: 'disable', label: 'Disable', icon: Ban },
		{
			id: 'compare',
			label: 'Compare',
			icon: GitCompareArrows,
			unavailableReason: 'Baseline comparison arrives in a later milestone'
		}
	];
}
