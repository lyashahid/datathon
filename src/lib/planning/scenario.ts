import type {
	PlanningAction,
	PlanningAssumptions,
	PlanningBaseline,
	PlanningFacility,
	PlanningServicePattern,
	PlanningStop
} from './types.ts';
import { buildNetworkGraph, nearestGraphNode, pathCoordinates, shortestPaths } from './graph.ts';
import { patternIsValid } from './routing.ts';
import { isFacilityProposal } from './facilities.ts';
import { shiftTimetable } from './shiftTimetable.ts';

export interface PlanningWorld {
	stops: PlanningStop[];
	patterns: PlanningServicePattern[];
	facilities: PlanningFacility[];
	warnings: string[];
}
/** Replay planning edits without mutating the observed baseline. Changes are explicitly assumed. */
export function derivePlanningWorld(
	baseline: PlanningBaseline,
	actions: readonly PlanningAction[],
	assumptions?: PlanningAssumptions
): PlanningWorld {
	let stops = baseline.transit.stops.map((s) => ({ ...s }));
	let patterns = baseline.transit.patterns.map((p) => structuredClone(p));
	const facilities = baseline.facilities.map((f) => structuredClone(f));
	const warnings: string[] = [];
	for (const action of actions) {
		if (action.kind === 'add-facility') {
			const facility = action.facility;
			if (
				!isFacilityProposal(facility) ||
				!baseline.islands.some((island) => island.id === facility.islandId)
			) {
				warnings.push('Invalid proposed facility ignored; observed destinations retained.');
				continue;
			}
			if (facilities.some((f) => f.id === facility.id)) {
				warnings.push(`Facility ${facility.id} already exists; duplicate ignored.`);
				continue;
			}
			const graph = buildNetworkGraph(baseline.network);
			const snap = nearestGraphNode(graph, facility, 'walk', assumptions?.maxSnapM ?? 100);
			const point = snap ? graph.nodes[snap.index] : null;
			const nodeIsland = point && 'islandId' in point ? point.islandId : undefined;
			if (!snap || (nodeIsland !== undefined && nodeIsland !== facility.islandId)) {
				warnings.push(`${facility.name}: a permitted walking connection on its island is missing.`);
				continue;
			}
			facilities.push(structuredClone(facility));
			warnings.push(
				`${facility.name}: a proposed ${facility.kind}, assumed open from ${facility.proposedOpeningDate}. Access measures location only; staffing, capacity, opening hours, investment and operating emissions require evidence.`
			);
			continue;
		}
		if (action.kind === 'add-stop' || action.kind === 'add-route') {
			const additions = action.kind === 'add-stop' ? [action.stop] : (action.stops ?? []);
			for (const stop of additions) {
				if (stops.some((s) => s.id === stop.id)) {
					warnings.push(`Stop ${stop.id} already exists; duplicate ignored.`);
					continue;
				}
				if (
					!Number.isFinite(stop.lon) ||
					!Number.isFinite(stop.lat) ||
					Math.abs(stop.lon) > 180 ||
					Math.abs(stop.lat) > 90
				) {
					warnings.push(`Stop ${stop.id} has invalid coordinates.`);
					continue;
				}
				stops.push(structuredClone(stop));
			}
			if (action.kind === 'add-route') {
				for (const pattern of [
					action.pattern,
					...(action.returnPattern ? [action.returnPattern] : [])
				]) {
					if (patterns.some((p) => p.id === pattern.id))
						warnings.push(`Service ${pattern.id} already exists; duplicate ignored.`);
					else patterns.push({ ...structuredClone(pattern), provenance: 'assumed' });
				}
			}
			continue;
		}
		if (action.kind === 'move-stop') {
			if (
				!Number.isFinite(action.position.lon) ||
				!Number.isFinite(action.position.lat) ||
				Math.abs(action.position.lon) > 180 ||
				Math.abs(action.position.lat) > 90
			) {
				warnings.push('Invalid stop position.');
				continue;
			}
			const previousStop = stops.find((s) => s.id === action.stopId);
			if (!previousStop) {
				warnings.push(`Stop ${action.stopId} does not exist.`);
				continue;
			}
			if (previousStop.lon === action.position.lon && previousStop.lat === action.position.lat)
				continue;
			if (action.islandId && !baseline.islands.some((island) => island.id === action.islandId)) {
				warnings.push('Moved stop island is outside the supported coverage.');
				continue;
			}
			stops = stops.map((s) =>
				s.id === action.stopId
					? {
							...s,
							lon: action.position.lon,
							lat: action.position.lat,
							...(action.islandId ? { islandId: action.islandId } : {})
						}
					: s
			);
			const graph = buildNetworkGraph(baseline.network);
			const maxSnapM = assumptions?.maxSnapM ?? 100;
			const busMovingKph = assumptions?.busMovingKph ?? 15;
			const busDwellMinutes = assumptions?.busDwellMinutes ?? 0.5;
			patterns = patterns.map((p) => {
				if (!p.stopIds.includes(action.stopId)) return p;
				if (p.mode !== 'bus' || p.timing.kind !== 'frequency' || p.provenance !== 'assumed') {
					warnings.push(
						`${p.name}: moving a published stop invalidates its published timing. Create an assumed service proposal before modeling its benefit.`
					);
					return {
						...p,
						enabled: false,
						runtimeUnavailableReason: 'Published timing does not apply to moved stops.'
					};
				}
				const segmentGeometry: [number, number][][] = [];
				const segmentDistanceM: number[] = [];
				for (let i = 0; i < p.stopIds.length - 1; i++) {
					const from = stops.find((s) => s.id === p.stopIds[i]);
					const to = stops.find((s) => s.id === p.stopIds[i + 1]);
					const fromSnap = from ? nearestGraphNode(graph, from, 'drive', maxSnapM) : null;
					const toSnap = to ? nearestGraphNode(graph, to, 'drive', maxSnapM) : null;
					if (!fromSnap || !toSnap) {
						warnings.push(
							`${p.name}: moved stop cannot connect to permitted bus roads; service disabled.`
						);
						return {
							...p,
							enabled: false,
							runtimeUnavailableReason: 'Moved stop has no permitted driving connection.'
						};
					}
					const tree = shortestPaths(graph, fromSnap.index, 'drive');
					const metres = tree.distances[toSnap.index];
					if (!Number.isFinite(metres) || metres <= 0) {
						warnings.push(`${p.name}: no directed bus path to the moved stop; service disabled.`);
						return {
							...p,
							enabled: false,
							runtimeUnavailableReason: 'Moved stop has no directed driving path.'
						};
					}
					segmentDistanceM.push(metres);
					segmentGeometry.push(pathCoordinates(graph, tree, toSnap.index));
				}
				warnings.push(
					`${p.name}: moved stop rerouted on OSM; runtime uses the explicit ${busMovingKph} km/h moving-speed and ${busDwellMinutes} minute dwell assumptions.`
				);
				return {
					...p,
					distanceM: segmentDistanceM.reduce((s, n) => s + n, 0),
					geometry: segmentGeometry.flatMap((g, i) => (i ? g.slice(1) : g)),
					segmentGeometry,
					segmentDistanceM,
					timing: {
						...p.timing,
						segmentMinutes: segmentDistanceM.map(
							(m) => m / ((busMovingKph * 1000) / 60) + busDwellMinutes
						)
					}
				};
			});
			continue;
		}
		if (action.kind === 'disable-stop' || action.kind === 'enable-stop') {
			stops = stops.map((s) =>
				s.id === action.stopId ? { ...s, disabled: action.kind === 'disable-stop' } : s
			);
			// A closed stop is skipped while the same service can continue through it.
			continue;
		}
		const target = patterns.find((p) => p.id === action.patternId);
		if (!target) {
			warnings.push(`Service ${action.patternId} does not exist.`);
			continue;
		}
		if (action.kind === 'disable-service' || action.kind === 'enable-service') {
			if (action.kind === 'enable-service' && target.runtimeUnavailableReason) {
				warnings.push(
					`${target.name}: invalidated timing cannot be restored; undo the move or rebuild an assumed service.`
				);
				continue;
			}
			patterns = patterns.map((p) =>
				p.id === action.patternId
					? { ...p, enabled: action.kind === 'enable-service', provenance: 'assumed' }
					: p
			);
			continue;
		}
		if (action.kind === 'shift-timetable') {
			const replacement = shiftTimetable(target, action.minutes);
			if (!replacement) {
				warnings.push(
					`${target.name}: timetable shift ignored; requires a valid scheduled bus pattern, whole minutes within 15, and no midnight crossing.`
				);
				continue;
			}
			patterns = patterns.map((p) => (p.id === target.id ? replacement : p));
			continue;
		}
		if (action.kind === 'replace-route') {
			const additions = action.stops ?? [];
			const availableStops = new Map(stops.map((s) => [s.id, s]));
			let valid = action.patterns.length > 0 && action.patterns.length <= 100;
			for (const stop of additions) {
				if (
					availableStops.has(stop.id) ||
					!Number.isFinite(stop.lon) ||
					!Number.isFinite(stop.lat) ||
					Math.abs(stop.lon) > 180 ||
					Math.abs(stop.lat) > 90
				)
					valid = false;
				availableStops.set(stop.id, stop);
			}
			const replacementIds = new Set(action.patterns.map((p) => p.id));
			if (replacementIds.size !== action.patterns.length || !replacementIds.has(target.id))
				valid = false;
			for (const replacement of action.patterns) {
				const current = patterns.find((p) => p.id === replacement.id);
				if (
					!current ||
					current.routeId !== target.routeId ||
					replacement.routeId !== target.routeId ||
					replacement.mode !== 'bus' ||
					replacement.provenance !== 'assumed' ||
					replacement.timing.kind !== 'frequency' ||
					!patternIsValid(replacement) ||
					!Number.isFinite(replacement.distanceM) ||
					!(replacement.distanceM! > 0) ||
					replacement.stopIds.some((id) => !availableStops.has(id))
				)
					valid = false;
			}
			if (!valid) {
				warnings.push(
					`${target.name}: incomplete route replacement ignored; existing connections retained.`
				);
				continue;
			}
			stops = [...stops, ...structuredClone(additions)];
			const replacements = new Map(action.patterns.map((p) => [p.id, p]));
			patterns = patterns.map((p) => structuredClone(replacements.get(p.id) ?? p));
			continue;
		}
		if (action.kind === 'extend-route') {
			if (
				target.timing.kind !== 'frequency' ||
				target.mode !== 'bus' ||
				!Number.isFinite(action.segmentMinutes) ||
				action.segmentMinutes <= 0 ||
				!Number.isFinite(action.distanceM) ||
				action.distanceM <= 0
			) {
				warnings.push(
					'Route extensions require a bus frequency pattern and positive routed duration/distance.'
				);
				continue;
			}
			const opposite = patterns.find(
				(p) =>
					p.id !== target.id &&
					p.routeId === target.routeId &&
					p.mode === 'bus' &&
					p.timing.kind === 'frequency' &&
					p.enabled !== false &&
					p.stopIds[0] === target.stopIds.at(-1) &&
					p.stopIds.at(-1) === target.stopIds[0]
			);
			if (
				!opposite ||
				!(action.returnSegmentMinutes! > 0) ||
				!(action.returnDistanceM! > 0) ||
				!action.returnGeometry?.length
			) {
				warnings.push(
					'A two-way route extension requires a matching return service and a permitted directed return path.'
				);
				continue;
			}
			if (!stops.some((s) => s.id === action.stop.id)) stops.push(structuredClone(action.stop));
			patterns = patterns.map((p) => {
				if (p.timing.kind !== 'frequency') return p;
				const segments =
					p.segmentGeometry ?? (p.stopIds.length === 2 && p.geometry ? [p.geometry] : []);
				if (p.id === target.id)
					return {
						...p,
						stopIds: [...p.stopIds, action.stop.id],
						timing: {
							...p.timing,
							segmentMinutes: [...p.timing.segmentMinutes, action.segmentMinutes]
						},
						distanceM: (p.distanceM ?? 0) + action.distanceM,
						geometry: [...(p.geometry ?? []), ...(action.geometry ?? []).slice(1)],
						segmentGeometry: [...segments, action.geometry ?? []],
						provenance: 'assumed'
					};
				if (p.id === opposite.id)
					return {
						...p,
						stopIds: [action.stop.id, ...p.stopIds],
						timing: {
							...p.timing,
							segmentMinutes: [action.returnSegmentMinutes!, ...p.timing.segmentMinutes]
						},
						distanceM: (p.distanceM ?? 0) + action.returnDistanceM!,
						geometry: [...action.returnGeometry!, ...(p.geometry ?? []).slice(1)],
						segmentGeometry: [action.returnGeometry!, ...segments],
						provenance: 'assumed'
					};
				return p;
			});
			continue;
		}
		if (action.kind === 'set-fleet') {
			patterns = patterns.map((p) =>
				p.routeId === target.routeId && p.mode === 'bus'
					? { ...p, fleet: action.fleet, provenance: 'assumed' }
					: p
			);
			continue;
		}
		if (target.timing.kind !== 'frequency' || target.mode !== 'bus') {
			warnings.push('Frequency/hours edits apply to bus frequency services only.');
			continue;
		}
		if (
			action.kind === 'set-frequency' &&
			(!Number.isFinite(action.headwayMinutes) ||
				action.headwayMinutes < 1 ||
				action.headwayMinutes > 240)
		) {
			warnings.push('Headway must be between 1 and 240 minutes.');
			continue;
		}
		if (
			action.kind === 'set-hours' &&
			(!Number.isFinite(action.startMinutes) ||
				!Number.isFinite(action.endMinutes) ||
				action.startMinutes < 0 ||
				action.endMinutes > 2880 ||
				action.endMinutes <= action.startMinutes)
		) {
			warnings.push('Operating hours must form a valid service-day interval.');
			continue;
		}
		patterns = patterns.map((p) => {
			if (p.routeId !== target.routeId || p.timing.kind !== 'frequency') return p;
			return {
				...p,
				provenance: 'assumed',
				timing: {
					...p.timing,
					windows:
						action.kind === 'set-frequency'
							? p.timing.windows.map((w) => ({ ...w, headwayMinutes: action.headwayMinutes }))
							: [
									{
										startMinutes: action.startMinutes,
										endMinutes: action.endMinutes,
										headwayMinutes: p.timing.windows[0].headwayMinutes
									}
								]
				}
			};
		});
	}
	return { stops, patterns, facilities, warnings };
}
