import type { Snippet } from 'svelte';
import type { FeatureCollection, Geometry, Position } from 'geojson';
import type { Coordinates } from './types.js';
import type { PlanningComparison, PlanningOperation, PlanningPlace } from './planning-map.js';
import type { PlanningEvaluation } from './proposal-review.js';
import type { ServiceCalendar } from './proposal-experience.js';
import { validPoint } from './planning-map.js';

const operationTypes = new Set([
	'add_hospital',
	'add_school',
	'add_stop',
	'move_stop',
	'disable_facility',
	'disable_stop',
	'enable_stop',
	'disable_service',
	'enable_service',
	'shift_timetable',
	'set_frequency',
	'set_hours',
	'set_fleet',
	'add_service',
	'use_existing_ferry_terminal',
	'replace_service',
	'road_closure',
	'pedestrian_connection',
	'weather_disruption'
]);

const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);

function validMapGeometry(value: unknown): boolean {
	if (!record(value)) return false;
	const position = (point: unknown) => validPoint(point) && point.every(Number.isFinite);
	const line = (points: unknown, minimum = 2) =>
		Array.isArray(points) && points.length >= minimum && points.every(position);
	const ring = (points: unknown) => {
		if (!Array.isArray(points) || !line(points, 4)) return false;
		const first = points[0];
		const last = points[points.length - 1];
		return first[0] === last[0] && first[1] === last[1];
	};
	const polygon = (rings: unknown) => Array.isArray(rings) && rings.length > 0 && rings.every(ring);
	const coordinates = value.coordinates;
	switch (value.type) {
		case 'Point':
			return position(coordinates);
		case 'MultiPoint':
			return line(coordinates, 1);
		case 'LineString':
			return line(coordinates);
		case 'MultiLineString':
			return (
				Array.isArray(coordinates) &&
				coordinates.length > 0 &&
				coordinates.every((part) => line(part))
			);
		case 'Polygon':
			return polygon(coordinates);
		case 'MultiPolygon':
			return Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(polygon);
		case 'GeometryCollection':
			return Array.isArray(value.geometries) && value.geometries.every(validMapGeometry);
		default:
			return false;
	}
}

/** Browser drafts may outlive an application version; never trust their operation shapes. */
export function restorePlanningOperations(value: unknown): {
	operations: PlanningOperation[];
	discarded: number;
} {
	if (!Array.isArray(value)) return { operations: [], discarded: value == null ? 0 : 1 };
	const valid = (operation: unknown): operation is PlanningOperation => {
		if (
			!record(operation) ||
			typeof operation.type !== 'string' ||
			!operationTypes.has(operation.type)
		)
			return false;
		if (operation.metadata !== undefined && !record(operation.metadata)) return false;
		if (operation.service !== undefined && operation.service !== null && !record(operation.service))
			return false;
		for (const key of ['name', 'target_id', 'island_id', 'opening_date'])
			if (operation[key] != null && typeof operation[key] !== 'string') return false;
		if (operation.coordinates != null && !validPoint(operation.coordinates)) return false;
		if (
			['add_hospital', 'add_school', 'add_stop', 'move_stop'].includes(operation.type) &&
			!validPoint(operation.coordinates)
		)
			return false;
		const display = record(operation.metadata) ? operation.metadata.ui_map_features : undefined;
		if (
			display !== undefined &&
			(!record(display) ||
				display.type !== 'FeatureCollection' ||
				!Array.isArray(display.features) ||
				display.features.some(
					(feature) =>
						!record(feature) ||
						feature.type !== 'Feature' ||
						(feature.properties != null && !record(feature.properties)) ||
						!validMapGeometry(feature.geometry)
				))
		)
			return false;
		return true;
	};
	// A route package is atomic: restoring half a return route misrepresents its service and cost.
	const rejectedPackages = new Set<string>();
	const candidates: PlanningOperation[] = [];
	for (const operation of value) {
		if (valid(operation)) candidates.push(operation);
		else if (
			record(operation) &&
			record(operation.metadata) &&
			typeof operation.metadata.ui_package === 'string' &&
			operation.metadata.ui_package.length > 0
		)
			rejectedPackages.add(operation.metadata.ui_package);
	}
	const operations = candidates.filter(
		(operation) => !rejectedPackages.has(String(operation.metadata?.ui_package ?? ''))
	);
	// Never truncate a routed package halfway at the API's 100-operation limit.
	if (operations.length > 100) return { operations: [], discarded: value.length };
	return { operations, discarded: value.length - operations.length };
}

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
	policyComparisonView?: 'current' | 'proposal';
	comparisonPreview?: boolean;
	/** Identity of the last accepted, complete evaluation; absent for stale/draft results. */
	policyEvaluationId?: string | null;
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

/** Number inputs can emit null when cleared; an empty limit is not a zero budget. */
export function planningBudgetNumber(value: unknown): number {
	if (typeof value === 'number') return value;
	if (typeof value === 'string' && value.trim() !== '') return Number(value);
	return NaN;
}

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
