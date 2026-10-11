import type {
	PlanningAction,
	PlanningAnalysis,
	PlanningBaseline,
	PlanningServicePattern,
	PlanningStop
} from '#lib/planning/types.ts';

/** Coordinate/stop-order replay only; route solving remains in the analysis worker. */
function locations(baseline: PlanningBaseline, actions: readonly PlanningAction[]) {
	const stops = new Map(baseline.transit.stops.map((stop) => [stop.id, stop]));
	const patterns = new Map(baseline.transit.patterns.map((pattern) => [pattern.id, pattern]));
	const addStop = (stop: PlanningStop) => {
		if (!stops.has(stop.id)) stops.set(stop.id, stop);
	};
	for (const action of actions) {
		if (action.kind === 'add-stop') addStop(action.stop);
		else if (action.kind === 'move-stop') {
			const current = stops.get(action.stopId);
			if (current) stops.set(current.id, { ...current, ...action.position });
		} else if (action.kind === 'add-route') {
			for (const stop of action.stops ?? []) addStop(stop);
			patterns.set(action.pattern.id, action.pattern);
			if (action.returnPattern) patterns.set(action.returnPattern.id, action.returnPattern);
		} else if (action.kind === 'replace-route') {
			for (const stop of action.stops ?? []) addStop(stop);
			for (const pattern of action.patterns) patterns.set(pattern.id, pattern);
		} else if (action.kind === 'extend-route') {
			addStop(action.stop);
			const current = patterns.get(action.patternId);
			if (!current) continue;
			const opposite = [...patterns.values()].find(
				(pattern) =>
					pattern.id !== current.id &&
					pattern.routeId === current.routeId &&
					pattern.stopIds[0] === current.stopIds.at(-1) &&
					pattern.stopIds.at(-1) === current.stopIds[0]
			);
			patterns.set(current.id, { ...current, stopIds: [...current.stopIds, action.stop.id] });
			if (opposite)
				patterns.set(opposite.id, {
					...opposite,
					stopIds: [action.stop.id, ...opposite.stopIds]
				});
		}
	}
	return { stops, patterns };
}

/** Locate edited assets, including removed actions, without claiming which residents benefit. */
export function waveTriggerCoordinates(
	baseline: PlanningBaseline,
	before: readonly PlanningAction[],
	after: readonly PlanningAction[],
	world?: PlanningAnalysis['world']
): [number, number][] {
	let common = 0;
	while (
		common < Math.min(before.length, after.length) &&
		JSON.stringify(before[common]) === JSON.stringify(after[common])
	)
		common++;
	const changed = [...before.slice(common), ...after.slice(common)];
	if (!changed.length) return [];
	const old = locations(baseline, before);
	const next = locations(baseline, after);
	const baselineStopIds = new Set(baseline.transit.stops.map((stop) => stop.id));
	const explicitlyMoved = new Set(
		before.filter((action) => action.kind === 'move-stop').map((action) => action.stopId)
	);
	// A published result can supplement a proposed stop whose older payload was
	// rewritten in place. It must not replace baseline locations or explicit move
	// history: that result may still be stale during rapid edits, undo, or redo.
	for (const stop of world?.stops ?? []) {
		if (!baselineStopIds.has(stop.id) && !explicitlyMoved.has(stop.id))
			old.stops.set(stop.id, stop);
	}
	for (const pattern of world?.patterns ?? []) {
		if (!old.patterns.has(pattern.id)) old.patterns.set(pattern.id, pattern);
	}
	const points: [number, number][] = [];
	const position = (point: { lon: number; lat: number } | undefined) => {
		if (point) points.push([point.lon, point.lat]);
	};
	const stop = (id: string) => {
		position(old.stops.get(id));
		position(next.stops.get(id));
	};
	const route = (pattern: PlanningServicePattern | undefined) => {
		for (const id of pattern?.stopIds ?? []) stop(id);
	};
	const relatedRoutes = (id: string, wholeRoute: boolean) => {
		for (const snapshot of [old, next]) {
			const pattern = snapshot.patterns.get(id);
			route(pattern);
			if (pattern && wholeRoute) {
				for (const other of snapshot.patterns.values()) {
					if (other.routeId === pattern.routeId && other.id !== pattern.id) route(other);
				}
			}
		}
	};
	for (const action of changed) {
		if ('stop' in action) position(action.stop);
		if ('stopId' in action) stop(action.stopId);
		if (action.kind === 'move-stop') position(action.position);
		if ('stops' in action) for (const stop of action.stops ?? []) position(stop);
		if ('patternId' in action)
			relatedRoutes(
				action.patternId,
				['set-frequency', 'set-hours', 'set-fleet', 'extend-route'].includes(action.kind)
			);
		if (action.kind === 'add-route') {
			route(action.pattern);
			route(action.returnPattern);
		} else if (action.kind === 'replace-route') {
			for (const pattern of action.patterns) route(pattern);
		} else if (action.kind === 'add-facility') position(action.facility);
	}
	const unique = new Map<string, [number, number]>();
	for (const point of points) {
		if (point.every(Number.isFinite)) unique.set(`${point[0]}:${point[1]}`, point);
	}
	return [...unique.values()];
}
