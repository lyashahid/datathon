import type { Snippet } from 'svelte';
import type { FeatureCollection, Geometry, Position } from 'geojson';
import type { Coordinates } from './types.js';
import type { PlanningComparison, PlanningOperation, PlanningPlace } from './planning-map.js';
import type { PlanningEvaluation } from './proposal-review.js';
import type { ServiceCalendar } from './proposal-experience.js';

export type PlacementKind = 'add_school' | 'add_hospital' | 'add_stop';
export type PendingPlacementDecision = {
	label: string;
	capital: number | null;
	annual: number | null;
	allowed: boolean;
	reason?: string;
	remaining?: number | null;
	note?: string;
	checking?: boolean;
	actionLabel?: string;
	annualRemaining?: number | null;
	accessPreview?: { residents: number | null; label: string; approximate?: boolean };
};
export type MapServiceEditor = {
	id: string;
	coordinates: Coordinates;
	mode: 'bus' | 'ferry' | 'bus-connection';
	title?: string;
};
export type MapPolicyState = {
	serviceEditor?: MapServiceEditor | null;
	serviceEditorContent?: Snippet;
	operations: PlanningOperation[];
	pending: { coordinates: Coordinates; kind: PlacementKind } | null;
	pendingDecision: PendingPlacementDecision | null;
	gapFeatures: FeatureCollection;
	impactFeatures: FeatureCollection;
	serviceFeatures: FeatureCollection;
	calculating: boolean;
	stale: boolean;
	panelOpen: boolean;
	placementRoads?: { geometry?: number[][] }[];
};
export type MapEvaluation = PlanningEvaluation & { origins: PlanningComparison[] };
export type MapBaseline = {
	origins: PlanningPlace[];
	cost_defaults: Record<string, number>;
	graph_edges: { geometry?: number[][] }[];
	warnings: string[];
	stops?: PlanningPlace[];
	patterns?: {
		id: string;
		name: string;
		mode: string;
		stopIds: string[];
		geometry?: number[][];
		segmentGeometries?: number[][][];
		calendar?: ServiceCalendar;
	}[];
};
export const emptyFeatures = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

export type DraftBudgetDecision = {
	allowed: boolean;
	known: boolean;
	reason: string;
	capitalRemaining: number | null;
	annualRemaining: number | null;
};

/** Both limits are commitments: unknown costs cannot be treated as free additions. */
export function assessDraftBudget(
	costs: { capital: number | null; annual: number | null },
	capitalBudget: unknown,
	annualBudget: unknown
): DraftBudgetDecision {
	const validLimit = (value: unknown): value is number =>
		typeof value === 'number' && Number.isFinite(value) && value >= 0;
	const result = {
		allowed: false,
		known: false,
		reason: '',
		capitalRemaining: null as number | null,
		annualRemaining: null as number | null
	};
	if (!validLimit(capitalBudget) || !validLimit(annualBudget))
		return {
			...result,
			known: true,
			reason: 'Enter a valid capital budget and yearly running budget.'
		};
	if (costs.capital === null || costs.annual === null)
		return { ...result, reason: 'Checking the full cost before adding this change.' };
	if (![costs.capital, costs.annual].every(Number.isFinite))
		return { ...result, reason: 'A complete cost estimate is needed before adding this change.' };
	const capitalRemaining = Math.round((capitalBudget - costs.capital) * 100) / 100;
	const annualRemaining = Math.round((annualBudget - costs.annual) * 100) / 100;
	const format = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
	const reasons = [
		...(capitalRemaining < 0
			? [`MVR ${format.format(-capitalRemaining)} over your capital budget`]
			: []),
		...(annualRemaining < 0
			? [`MVR ${format.format(-annualRemaining)} over your yearly running budget`]
			: [])
	];
	return {
		allowed: reasons.length === 0,
		known: true,
		reason: reasons.length
			? `${reasons.join(' and ')}. Increase the budget or remove another change.`
			: '',
		capitalRemaining,
		annualRemaining
	};
}

/** Source-boundary screen only: being on mapped land does not establish a suitable building site. */
export function pointWithinIsland(
	point: Coordinates,
	features: FeatureCollection<Geometry | null> | null | undefined,
	islandId: string
): boolean | null {
	if (!point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)
		return false;
	let knownBoundary = false;
	for (const feature of features?.features ?? []) {
		const id = feature.properties?.island_id ?? feature.properties?.id ?? feature.id;
		if (id !== islandId) continue;
		const geometry = feature.geometry;
		const polygons =
			geometry?.type === 'Polygon'
				? [geometry.coordinates]
				: geometry?.type === 'MultiPolygon'
					? geometry.coordinates
					: [];
		for (const polygon of polygons) {
			const outer = ringPosition(point, polygon[0]);
			if (outer === null) continue;
			knownBoundary = true;
			if (outer === 'outside') continue;
			let inHole = false;
			let holesKnown = true;
			for (const hole of polygon.slice(1)) {
				const position = ringPosition(point, hole);
				if (position === null) holesKnown = false;
				else if (position !== 'outside') inHole = true;
			}
			if (!inHole && holesKnown) return true;
			if (!holesKnown) return null;
		}
	}
	return knownBoundary ? false : null;
}

function ringPosition(
	point: Coordinates,
	ring: Position[] | undefined
): 'inside' | 'outside' | 'boundary' | null {
	if (
		!ring ||
		ring.length < 4 ||
		ring.some((position) => position.length < 2 || !position.slice(0, 2).every(Number.isFinite))
	)
		return null;
	let inside = false;
	const [x, y] = point;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [ax, ay] = ring[j];
		const [bx, by] = ring[i];
		const dx = bx - ax;
		const dy = by - ay;
		const epsilon = 1e-10;
		if (
			Math.abs((x - ax) * dy - (y - ay) * dx) <=
				epsilon * Math.max(1, Math.abs(dx), Math.abs(dy)) &&
			x >= Math.min(ax, bx) - epsilon &&
			x <= Math.max(ax, bx) + epsilon &&
			y >= Math.min(ay, by) - epsilon &&
			y <= Math.max(ay, by) + epsilon
		)
			return 'boundary';
		if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
	}
	return inside ? 'inside' : 'outside';
}

/** Draft arithmetic uses the backend's current factors; route packages carry server cost estimates. */
export function draftCosts(operations: PlanningOperation[], defaults: Record<string, number>) {
	let capital = 0;
	let annual = 0;
	let capitalComplete = true;
	let annualComplete = true;
	const known = (value: unknown): value is number =>
		typeof value === 'number' && Number.isFinite(value) && value >= 0;
	for (const operation of operations) {
		if (typeof operation.metadata?.ui_package === 'string' && operation.metadata.ui_package) {
			const upfront = operation.metadata.ui_capital;
			const recurring = operation.metadata.ui_annual;
			if (known(upfront)) capital += upfront;
			else capitalComplete = false;
			if (known(recurring)) annual += recurring;
			else annualComplete = false;
			continue;
		}
		const keys =
			operation.type === 'add_hospital'
				? ['hospital_capital_mvr', 'hospital_annual_operating_mvr']
				: operation.type === 'add_school'
					? ['school_capital_mvr', 'school_annual_operating_mvr']
					: operation.type === 'add_stop'
						? ['stop_capital_mvr', '']
						: null;
		if (!keys) {
			capitalComplete = false;
			annualComplete = false;
			continue;
		}
		const overrides = operation.type === 'add_stop' ? undefined : operation.metadata?.costs;
		const costs =
			overrides && typeof overrides === 'object' && !Array.isArray(overrides)
				? (overrides as Record<string, unknown>)
				: {};
		const upfront = Object.hasOwn(costs, 'capital_mvr') ? costs.capital_mvr : defaults[keys[0]];
		const recurring = Object.hasOwn(costs, 'annual_operating_mvr')
			? costs.annual_operating_mvr
			: keys[1]
				? defaults[keys[1]]
				: 0;
		if (known(upfront)) capital += upfront;
		else capitalComplete = false;
		if (known(recurring)) annual += recurring;
		else annualComplete = false;
	}
	return { capital: capitalComplete ? capital : null, annual: annualComplete ? annual : null };
}
