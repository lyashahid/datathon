import type {
	AssetRef,
	AssetStatus,
	InfrastructureFeature,
	InfrastructureId,
	Position,
	RouteId,
	TransportRoute
} from '#lib/types/domain.ts';
import type {
	AssetDelta,
	EffectiveState,
	ScenarioChange,
	ScenarioIssue
} from '#lib/types/scenario.ts';
import { deepFreeze } from '#lib/utils/freeze.ts';

/** The read-only inputs the engine replays changes against. Satisfied by the Baseline store. */
export interface BaselineData {
	readonly infrastructure: readonly InfrastructureFeature[];
	readonly routes: readonly TransportRoute[];
}

type Asset = InfrastructureFeature | TransportRoute;

/** Working record for one asset during replay. Holds references; never mutates them. */
interface Entry<T extends Asset> {
	current: T;
	readonly baseline: T | null;
	statusBeforeDisable: AssetStatus | null;
	removed: boolean;
	changeIds: string[];
}

interface Working {
	infrastructure: Map<InfrastructureId, Entry<InfrastructureFeature>>;
	routes: Map<RouteId, Entry<TransportRoute>>;
}

function initialWorking(baseline: BaselineData): Working {
	const entry = <T extends Asset>(asset: T): Entry<T> => ({
		current: asset,
		baseline: asset,
		statusBeforeDisable: null,
		removed: false,
		changeIds: []
	});
	return {
		infrastructure: new Map(baseline.infrastructure.map((f) => [f.id, entry(f)])),
		routes: new Map(baseline.routes.map((r) => [r.id, entry(r)]))
	};
}

function lookup(work: Working, ref: AssetRef): Entry<Asset> | undefined {
	return ref.kind === 'infrastructure' ? work.infrastructure.get(ref.id) : work.routes.get(ref.id);
}

function isPosition(p: unknown): p is Position {
	return (
		Array.isArray(p) &&
		p.length >= 2 &&
		Number.isFinite(p[0]) &&
		Number.isFinite(p[1]) &&
		Math.abs(p[0]) <= 180 &&
		Math.abs(p[1]) <= 90
	);
}

const describe = (ref: AssetRef) => `${ref.kind} "${ref.id}"`;

/**
 * Applies one change to the working state. Returns an error message instead of applying
 * when the change is invalid against the current state.
 */
function applyChange(work: Working, change: ScenarioChange): string | null {
	switch (change.kind) {
		case 'add': {
			const id = change.feature.id;
			if (work.infrastructure.has(id)) return `infrastructure "${id}" already exists`;
			if (!isPosition(change.feature.geometry.coordinates)) return 'invalid position';
			work.infrastructure.set(id, {
				current: {
					...change.feature,
					status: 'proposed',
					geometry: { type: 'Point', coordinates: [...change.feature.geometry.coordinates] }
				},
				baseline: null,
				statusBeforeDisable: null,
				removed: false,
				changeIds: [change.id]
			});
			return null;
		}
		case 'move': {
			const entry = work.infrastructure.get(change.target.id);
			if (!entry || entry.removed) return `${describe(change.target)} does not exist`;
			if (!isPosition(change.to)) return 'invalid position';
			entry.current = {
				...entry.current,
				geometry: { type: 'Point', coordinates: [change.to[0], change.to[1]] }
			};
			entry.changeIds.push(change.id);
			return null;
		}
		case 'disable': {
			const entry = lookup(work, change.target);
			if (!entry || entry.removed) return `${describe(change.target)} does not exist`;
			if (entry.current.status === 'disabled')
				return `${describe(change.target)} is already disabled`;
			entry.statusBeforeDisable = entry.current.status;
			entry.current = { ...entry.current, status: 'disabled' };
			entry.changeIds.push(change.id);
			return null;
		}
		case 'remove': {
			const entry = lookup(work, change.target);
			if (!entry || entry.removed) return `${describe(change.target)} does not exist`;
			if (entry.baseline) {
				return `${describe(change.target)} is baseline infrastructure; disable it instead`;
			}
			entry.removed = true;
			entry.changeIds.push(change.id);
			return null;
		}
		case 'restore': {
			const entry = lookup(work, change.target);
			if (!entry) return `${describe(change.target)} does not exist`;
			if (entry.removed) {
				entry.removed = false;
			} else if (entry.current.status === 'disabled') {
				// Re-enable to the pre-disable status; an asset disabled in the baseline reopens.
				const fallback: AssetStatus = entry.baseline ? 'existing' : 'proposed';
				entry.current = { ...entry.current, status: entry.statusBeforeDisable ?? fallback };
				entry.statusBeforeDisable = null;
			} else {
				return `${describe(change.target)} has nothing to restore`;
			}
			entry.changeIds.push(change.id);
			return null;
		}
	}
}

function replay(baseline: BaselineData, changes: readonly ScenarioChange[]) {
	const work = initialWorking(baseline);
	const issues: ScenarioIssue[] = [];
	for (const change of changes) {
		const message = applyChange(work, change);
		if (message) issues.push({ changeId: change.id, message });
	}
	return { work, issues };
}

const samePosition = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/**
 * Resolves an entry to its output asset and delta. Assets whose net effect is nil (e.g.
 * disabled then restored) collapse back to the identical baseline object.
 */
function resolve<T extends Asset>(entry: Entry<T>): { asset: T; delta: AssetDelta | null } {
	const { baseline, current } = entry;
	if (!baseline) {
		return {
			asset: current,
			delta: { origin: 'scenario', moved: false, statusChanged: false, changeIds: entry.changeIds }
		};
	}
	const statusChanged = current.status !== baseline.status;
	const moved =
		current.geometry.type === 'Point' &&
		baseline.geometry.type === 'Point' &&
		!samePosition(current.geometry.coordinates, baseline.geometry.coordinates);
	if (!statusChanged && !moved) return { asset: baseline, delta: null };
	return {
		asset: current,
		delta: {
			origin: 'baseline',
			moved,
			...(moved && baseline.geometry.type === 'Point'
				? { originalPosition: baseline.geometry.coordinates }
				: {}),
			statusChanged,
			changeIds: entry.changeIds
		}
	};
}

function collect<T extends Asset>(entries: Map<string, Entry<T>>) {
	const assets: T[] = [];
	const deltas = new Map<string, AssetDelta>();
	for (const entry of entries.values()) {
		if (entry.removed) continue;
		const { asset, delta } = resolve(entry);
		assets.push(asset);
		if (delta) deltas.set(asset.id, delta);
	}
	return { assets, deltas };
}

/**
 * baseline + ordered changes = effective state. Pure and deterministic: no clock, no
 * randomness, and baseline objects are never written to. New objects are frozen.
 * Output order is baseline order followed by additions in change order.
 */
export function deriveEffectiveState(
	baseline: BaselineData,
	changes: readonly ScenarioChange[]
): EffectiveState {
	const { work, issues } = replay(baseline, changes);
	const infra = collect(work.infrastructure);
	const routes = collect(work.routes);
	deepFreeze(infra.assets);
	deepFreeze(routes.assets);

	const infraById = new Map(infra.assets.map((f) => [f.id, f]));
	const routesById = new Map(routes.assets.map((r) => [r.id, r]));
	const routesByStop = new Map<InfrastructureId, TransportRoute[]>();
	for (const route of routes.assets) {
		if (route.status === 'disabled') continue;
		for (const stopId of new Set(route.stopIds)) {
			if (infraById.has(stopId))
				routesByStop.set(stopId, [...(routesByStop.get(stopId) ?? []), route]);
		}
	}

	return {
		infrastructure: infra.assets,
		routes: routes.assets,
		infrastructureDeltas: infra.deltas,
		routeDeltas: routes.deltas,
		issues,
		getInfrastructure: (id) => infraById.get(id),
		getRoute: (id) => routesById.get(id),
		routesServing: (id) => routesByStop.get(id) ?? []
	};
}

/** Whether `candidate` would apply cleanly after `changes`; returns the reason if not. */
export function checkChange(
	baseline: BaselineData,
	changes: readonly ScenarioChange[],
	candidate: ScenarioChange
): string | null {
	const { work } = replay(baseline, changes);
	return applyChange(work, candidate);
}
