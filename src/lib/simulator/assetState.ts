import type { AssetStatus } from '#lib/types/domain.ts';
import type { AssetDelta } from '#lib/types/scenario.ts';

/** The labels a planner sees for an asset in the active view. */
export type AssetStateLabel = 'existing' | 'proposed' | 'moved' | 'disabled';

/**
 * Lifecycle label first (existing / proposed / disabled), then "moved" when the asset sits
 * away from its baseline position. A disabled proposal reads as disabled.
 */
export function assetStateLabels(
	status: AssetStatus,
	delta: AssetDelta | undefined
): AssetStateLabel[] {
	const labels: AssetStateLabel[] = [status];
	if (delta?.moved) labels.push('moved');
	return labels;
}
