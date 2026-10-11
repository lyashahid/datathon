import type { PlanningBaseline } from '#lib/planning/types.ts';
import type { MonthlyForecast } from '#lib/prediction/types.ts';

export type WorkspaceView = 'map' | 'forecasts' | 'decisions' | 'evidence';
export function workspaceView(pathname: string): WorkspaceView {
	if (pathname === '/forecasts') return 'forecasts';
	if (pathname === '/decisions') return 'decisions';
	if (pathname === '/evidence') return 'evidence';
	return 'map';
}
export interface MapSelection {
	originId?: string;
	roadEdgeId?: string;
	islandId?: string;
	overview?: boolean;
}
/** Published endpoint categories have island context, not measured terminal coordinates. */
export function forecastMapSelection(
	series: MonthlyForecast,
	baseline: PlanningBaseline
): MapSelection {
	const islandId =
		series.seriesId === 'ferry-male-vm'
			? 'male'
			: series.seriesId === 'ferry-villigili-vm'
				? 'vilimale'
				: undefined;
	return islandId && baseline.origins.some((origin) => origin.islandId === islandId)
		? { islandId }
		: { overview: true };
}
export function validMonth(value: string | null): string | undefined {
	return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;
}
