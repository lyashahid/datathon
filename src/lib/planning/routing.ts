import { getFacilityEligibility } from './facilities.ts';
import { islandHasObservedSnapshotCoverage, planningCoverage } from './coverage.ts';
import {
	buildNetworkGraph,
	MinHeap,
	nearestGraphNode,
	pathCoordinates,
	shortestPaths,
	type NetworkGraph,
	type PathTree
} from './graph.ts';
import type {
	JourneyLeg,
	PlanningAssumptions,
	PlanningBaseline,
	PlanningFacility,
	PlanningJourney,
	PlanningOrigin,
	PlanningServicePattern,
	PlanningStop,
	ScheduledTrip,
	ServiceCalendar
} from './types.ts';
import type { PlanningWorld } from './scenario.ts';

export function calendarRuns(calendar: ServiceCalendar, date: string): boolean {
	const parsed = new Date(`${date}T00:00:00Z`);
	if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
		return false;
	if (calendar.excludedDates?.includes(date)) return false;
	if (calendar.includedDates?.includes(date)) return true;
	if (
		(calendar.startDate && date < calendar.startDate) ||
		(calendar.endDate && date > calendar.endDate)
	)
		return false;
	return calendar.weekdays.includes(parsed.getUTCDay());
}

export function patternIsValid(pattern: PlanningServicePattern): boolean {
	if (pattern.runtimeUnavailableReason) return false;
	if (pattern.stopIds.length < 2 || new Set(pattern.stopIds).size < 2) return false;
	if (pattern.timing.kind === 'frequency') {
		const windows = [...pattern.timing.windows].sort((a, b) => a.startMinutes - b.startMinutes);
		return (
			pattern.timing.segmentMinutes.length === pattern.stopIds.length - 1 &&
			pattern.timing.segmentMinutes.every((n) => Number.isFinite(n) && n > 0) &&
			windows.length > 0 &&
			windows.every(
				(w, i) =>
					Number.isFinite(w.startMinutes) &&
					Number.isFinite(w.endMinutes) &&
					Number.isFinite(w.headwayMinutes) &&
					w.startMinutes >= 0 &&
					w.endMinutes <= 2880 &&
					w.endMinutes > w.startMinutes &&
					w.headwayMinutes > 0 &&
					(i === 0 || w.startMinutes >= windows[i - 1].endMinutes)
			)
		);
	}
	return (
		pattern.timing.trips.length > 0 &&
		pattern.timing.trips.every(
			(trip) =>
				trip.stopTimes.length === pattern.stopIds.length &&
				trip.stopTimes.every(
					(t, i) =>
						Number.isFinite(t.arrivalMinutes) &&
						Number.isFinite(t.departureMinutes) &&
						t.departureMinutes >= t.arrivalMinutes &&
						(i === 0 || t.arrivalMinutes >= trip.stopTimes[i - 1].departureMinutes)
				)
		)
	);
}

/** Walking caches are pinned to the immutable network object, not scenario infrastructure. */
class WalkingAccess {
	readonly graph: NetworkGraph;
	readonly #trees = new Map<string, PathTree>();
	readonly #snaps = new Map<string, Snapped | null>();
	constructor(baseline: PlanningBaseline) {
		this.graph = buildNetworkGraph(baseline.network);
	}
	snap(position: { lon: number; lat: number }, maxM: number) {
		const key = `${position.lon}:${position.lat}:${maxM}`;
		if (this.#snaps.has(key)) return this.#snaps.get(key)!;
		const snap = nearestGraphNode(this.graph, position, 'walk', maxM);
		if (this.#snaps.size >= 10000) this.#snaps.delete(this.#snaps.keys().next().value!);
		this.#snaps.set(key, snap);
		return snap;
	}
	tree(start: number, maxM: number) {
		const key = `${start}:${maxM}`;
		let tree = this.#trees.get(key);
		if (!tree) {
			tree = shortestPaths(this.graph, start, 'walk', maxM);
			// Keep bounded: long pointer sessions must not retain a tree for every cursor location.
			if (this.#trees.size >= 768) this.#trees.delete(this.#trees.keys().next().value!);
			this.#trees.set(key, tree);
		}
		return tree;
	}
}
const walkingCache = new WeakMap<PlanningBaseline['network'], WalkingAccess>();
function walkingAccess(baseline: PlanningBaseline) {
	let access = walkingCache.get(baseline.network);
	if (!access) {
		access = new WalkingAccess(baseline);
		walkingCache.set(baseline.network, access);
	}
	return access;
}
interface Snapped {
	index: number;
	distanceM: number;
}
type RoutingLeg = JourneyLeg & { makeGeometry?: () => [number, number][] };
interface Label {
	key: string;
	at: number;
	kind: 'off' | 'frequency' | 'scheduled';
	stopId: string;
	boardings: number;
	index?: number;
	pattern?: PlanningServicePattern;
	trip?: ScheduledTrip;
	walked?: boolean;
	parent?: Label;
	leg?: RoutingLeg;
}
export interface RoutingContext {
	access: WalkingAccess;
	stops: Map<string, PlanningStop>;
	stopSnaps: Map<string, Snapped>;
	facilities: PlanningFacility[];
	facilitySnaps: Map<string, Snapped>;
	unknownFacilities: PlanningFacility[];
	unknownFacilitySnaps: Map<string, Snapped>;
	unknownStopEgress: Map<string, number>;
	patterns: PlanningServicePattern[];
	boarding: Map<string, { pattern: PlanningServicePattern; index: number }[]>;
	warnings: string[];
	transitUnavailable: boolean;
	outsideSnapshot: boolean;
	outsideSnapshotIslands: Set<string>;
	unknownDestinationIslands: Set<string>;
	invalidatedTransitIslands: Set<string>;
	localDestinationIslands: Set<string>;
	observedCrossingIslands: Set<string>;
	stopEgress: Map<
		string,
		{ destination: PlanningFacility; snap: Snapped; tree: PathTree; metres: number }
	>;
	transferLinks: Map<
		string,
		{ stop: PlanningStop; snap: Snapped; tree: PathTree; metres: number }[]
	>;
}

export function createRoutingContext(
	baseline: PlanningBaseline,
	world: PlanningWorld,
	assumptions: PlanningAssumptions
): RoutingContext {
	const access = walkingAccess(baseline);
	const activeStops = world.stops.filter((s) => s.disabled !== true);
	const stops = new Map(activeStops.map((s) => [s.id, s]));
	const stopSnaps = new Map<string, Snapped>();
	for (const stop of activeStops) {
		const snap = access.snap(stop, assumptions.maxSnapM);
		if (snap) stopSnaps.set(stop.id, snap);
	}
	const eligibility = world.facilities.map((facility) => ({
		facility,
		result: getFacilityEligibility(facility, assumptions, true)
	}));
	const facilities = eligibility
		.filter((item) => item.result.status === 'eligible')
		.map((item) => item.facility);
	const unknownDestinationIslands = new Set(
		eligibility
			.filter((item) => item.result.status === 'unavailable')
			.map((item) => item.facility.islandId)
	);
	const unknownFacilities = eligibility
		.filter((item) => item.result.status === 'unavailable')
		.map((item) => item.facility);
	const facilitySnaps = new Map<string, Snapped>();
	for (const facility of facilities) {
		const snap = access.snap(facility, assumptions.maxSnapM);
		if (snap) facilitySnaps.set(facility.id, snap);
	}
	const unknownFacilitySnaps = new Map<string, Snapped>();
	for (const facility of unknownFacilities) {
		const snap = access.snap(facility, assumptions.maxSnapM);
		if (snap) unknownFacilitySnaps.set(facility.id, snap);
	}
	const warnings = [...world.warnings];
	const patterns = world.patterns.filter((p) => {
		if (p.runtimeUnavailableReason) {
			warnings.push(`${p.name}: ${p.runtimeUnavailableReason}`);
			return false;
		}
		if (p.enabled === false) return false;
		if (!patternIsValid(p)) {
			warnings.push(`${p.name}: incomplete service timing; excluded from routing.`);
			return false;
		}
		return calendarRuns(p.calendar, assumptions.date);
	});
	const boarding = new Map<string, { pattern: PlanningServicePattern; index: number }[]>();
	for (const pattern of patterns) {
		pattern.stopIds.forEach((stopId, index) => {
			if (
				index < pattern.stopIds.length - 1 &&
				stopSnaps.has(stopId) &&
				stops.get(stopId)?.pickupAllowed !== false
			)
				boarding.set(stopId, [...(boarding.get(stopId) ?? []), { pattern, index }]);
		});
	}
	const transitUnavailable = baseline.transit.accessStatus === 'unavailable' && !patterns.length;
	const coverage = planningCoverage(baseline, assumptions);
	const outsideSnapshot =
		coverage.status === 'outside-snapshot' || coverage.status === 'unavailable';
	const outsideSnapshotIslands = new Set(
		baseline.islands
			.filter(
				(island) =>
					!islandHasObservedSnapshotCoverage(
						baseline,
						assumptions,
						island.id,
						assumptions.targetMinutes
					)
			)
			.map((island) => island.id)
	);
	const invalidatedTransitIslands = new Set(
		world.patterns
			.filter((p) => p.runtimeUnavailableReason && p.provenance === 'observed')
			.flatMap((p) => p.stopIds.flatMap((id) => (stops.has(id) ? [stops.get(id)!.islandId] : [])))
	);
	const localDestinationIslands = new Set(facilities.map((f) => f.islandId));
	const observedCrossingIslands = new Set<string>();
	for (const p of patterns.filter((p) => p.provenance === 'observed')) {
		const islands = new Set(
			p.stopIds.flatMap((id) => (stops.has(id) ? [stops.get(id)!.islandId] : []))
		);
		if (islands.size > 1) for (const id of islands) observedCrossingIslands.add(id);
	}
	// Every origin explores the same stop egress and transfers. Resolve their graph distances
	// once per world, keeping the journey search independent of the destination count.
	const stopEgress: RoutingContext['stopEgress'] = new Map();
	const unknownStopEgress: RoutingContext['unknownStopEgress'] = new Map();
	const transferLinks: RoutingContext['transferLinks'] = new Map();
	for (const stop of stops.values()) {
		const snap = stopSnaps.get(stop.id);
		if (!snap) continue;
		const tree = access.tree(
			snap.index,
			assumptions.maxJourneyMinutes * assumptions.walkMPerMinute
		);
		for (const destination of facilities) {
			const targetSnap = facilitySnaps.get(destination.id);
			if (!targetSnap) continue;
			const metres = snap.distanceM + tree.distances[targetSnap.index] + targetSnap.distanceM;
			if (
				metres <= assumptions.maxAccessWalkMinutes * assumptions.walkMPerMinute &&
				metres < (stopEgress.get(stop.id)?.metres ?? Infinity)
			)
				stopEgress.set(stop.id, { destination, snap: targetSnap, tree, metres });
		}
		for (const destination of unknownFacilities) {
			const targetSnap = unknownFacilitySnaps.get(destination.id);
			if (!targetSnap) continue;
			const metres = snap.distanceM + tree.distances[targetSnap.index] + targetSnap.distanceM;
			if (
				metres <= assumptions.maxAccessWalkMinutes * assumptions.walkMPerMinute &&
				metres < (unknownStopEgress.get(stop.id) ?? Infinity)
			)
				unknownStopEgress.set(stop.id, metres);
		}
		const links: NonNullable<ReturnType<RoutingContext['transferLinks']['get']>> = [];
		for (const other of stops.values()) {
			const targetSnap = stopSnaps.get(other.id);
			if (!targetSnap || other.id === stop.id) continue;
			const metres = snap.distanceM + tree.distances[targetSnap.index] + targetSnap.distanceM;
			if (metres <= assumptions.maxTransferWalkMinutes * assumptions.walkMPerMinute)
				links.push({ stop: other, snap: targetSnap, tree, metres });
		}
		transferLinks.set(stop.id, links);
	}
	return {
		access,
		stops,
		stopSnaps,
		facilities,
		facilitySnaps,
		unknownFacilities,
		unknownFacilitySnaps,
		unknownStopEgress,
		patterns,
		boarding,
		warnings,
		transitUnavailable,
		outsideSnapshot,
		outsideSnapshotIslands,
		unknownDestinationIslands,
		invalidatedTransitIslands,
		localDestinationIslands,
		observedCrossingIslands,
		stopEgress,
		transferLinks
	};
}

function reconstruct(label: Label | undefined, finalLeg?: RoutingLeg): JourneyLeg[] {
	const legs: RoutingLeg[] = [];
	for (let current = label; current; current = current.parent)
		if (current.leg) legs.push(current.leg);
	legs.reverse();
	if (finalLeg) legs.push(finalLeg);
	const merged: JourneyLeg[] = [];
	for (const pendingLeg of legs) {
		// Most candidate walks are discarded. Build their street geometry only for the final
		// chosen journey; geometry never participates in travel-time or label comparisons.
		const { makeGeometry, ...properties } = pendingLeg;
		const leg: JourneyLeg = {
			...properties,
			geometry: makeGeometry ? makeGeometry() : properties.geometry
		};
		const last = merged.at(-1);
		if (
			last &&
			leg.mode !== 'walk' &&
			last.mode === leg.mode &&
			last.patternId === leg.patternId &&
			last.tripId === leg.tripId
		) {
			last.to = leg.to;
			last.minutes += leg.minutes;
			last.waitMinutes += leg.waitMinutes;
			last.geometry = [
				...(last.geometry ?? []),
				...(leg.geometry ?? []).slice(last.geometry?.length ? 1 : 0)
			];
		} else merged.push({ ...leg, geometry: leg.geometry ? [...leg.geometry] : undefined });
	}
	return merged;
}

const failed = (status: 'unavailable' | 'unreachable', reason: string): PlanningJourney => ({
	status,
	minutes: null,
	reason,
	destinationId: null,
	path: []
});

export function routePlanningOrigin(
	context: RoutingContext,
	origin: PlanningOrigin,
	assumptions: PlanningAssumptions
): PlanningJourney {
	if (assumptions.walkingRequirements?.requireAuditedWheelchair)
		return failed(
			'unavailable',
			'Audited continuous wheelchair routes, crossings and boarding/facility entrances are not supplied. Ordinary walking geometry cannot certify an accessible journey.'
		);
	if (!context.access.graph.nodes.length)
		return failed('unavailable', 'Walking topology is unavailable.');
	if (!context.facilities.length)
		return failed(
			'unavailable',
			`No verified ${assumptions.goal} destinations satisfying the selected service requirements in the snapshot.`
		);
	if (!context.facilitySnaps.size)
		return failed('unavailable', 'Destinations could not be connected to the walking network.');
	if (
		!(assumptions.walkMPerMinute > 0) ||
		!(assumptions.maxJourneyMinutes > 0) ||
		!Number.isFinite(assumptions.departureMinutes)
	)
		return failed('unavailable', 'Invalid routing assumptions.');
	const access = context.access;
	const originSnap = access.snap(origin, assumptions.maxSnapM);
	if (!originSnap)
		return failed('unavailable', 'Origin could not be connected to an accessible walking segment.');
	const startAt = assumptions.departureMinutes;
	const endAt = startAt + assumptions.maxJourneyMinutes;
	const maxWalkM = assumptions.maxJourneyMinutes * assumptions.walkMPerMinute;
	const originTree = access.tree(originSnap.index, maxWalkM);
	let possibleSuitableAt = Infinity;
	for (const destination of context.unknownFacilities) {
		const snap = context.unknownFacilitySnaps.get(destination.id);
		if (!snap) continue;
		const metres = originSnap.distanceM + originTree.distances[snap.index] + snap.distanceM;
		possibleSuitableAt = Math.min(
			possibleSuitableAt,
			startAt + metres / assumptions.walkMPerMinute
		);
	}
	let best: { at: number; destinationId: string; label?: Label; finalLeg: RoutingLeg } | null =
		null;
	const walkLeg = (
		fromId: string,
		toId: string,
		from: { lon: number; lat: number },
		to: { lon: number; lat: number },
		fromSnap: Snapped,
		toSnap: Snapped,
		tree: PathTree
	): RoutingLeg | null => {
		const metres = fromSnap.distanceM + tree.distances[toSnap.index] + toSnap.distanceM;
		if (!Number.isFinite(metres)) return null;
		return {
			mode: 'walk',
			from: fromId,
			to: toId,
			minutes: metres / assumptions.walkMPerMinute,
			waitMinutes: 0,
			makeGeometry: () => [
				[from.lon, from.lat],
				...pathCoordinates(access.graph, tree, toSnap.index),
				[to.lon, to.lat]
			]
		};
	};
	for (const destination of context.facilities) {
		const snap = context.facilitySnaps.get(destination.id);
		if (!snap) continue;
		const leg = walkLeg(
			origin.id,
			destination.id,
			origin,
			destination,
			originSnap,
			snap,
			originTree
		);
		if (
			leg &&
			leg.minutes <= assumptions.maxJourneyMinutes &&
			(!best || startAt + leg.minutes < best.at)
		)
			best = { at: startAt + leg.minutes, destinationId: destination.id, finalLeg: leg };
	}
	const queue = new MinHeap<Label>();
	const distances = new Map<string, number>();
	const push = (label: Label) => {
		if (label.at > endAt || label.at >= (distances.get(label.key) ?? Infinity)) return;
		distances.set(label.key, label.at);
		queue.push(label, label.at);
	};
	for (const stop of context.stops.values()) {
		const snap = context.stopSnaps.get(stop.id);
		if (!snap) continue;
		const leg = walkLeg(origin.id, stop.id, origin, stop, originSnap, snap, originTree);
		if (leg && leg.minutes <= assumptions.maxAccessWalkMinutes)
			push({
				key: `off:${stop.id}:0:0`,
				at: startAt + leg.minutes,
				kind: 'off',
				stopId: stop.id,
				boardings: 0,
				walked: false,
				leg
			});
	}
	const transitGeometry = (
		pattern: PlanningServicePattern,
		index: number,
		fromId: string,
		toId: string
	): [number, number][] => {
		const from = context.stops.get(fromId);
		const to = context.stops.get(toId);
		if (Array.isArray(pattern.segmentGeometry) && pattern.segmentGeometry[index]?.length)
			return pattern.segmentGeometry[index];
		if (pattern.stopIds.length === 2 && pattern.geometry) return pattern.geometry;
		return from && to
			? [
					[from.lon, from.lat],
					[to.lon, to.lat]
				]
			: [];
	};
	while (queue.size) {
		const current = queue.pop()!.value;
		if (current.at !== distances.get(current.key) || current.at >= (best?.at ?? Infinity)) continue;
		if (current.kind !== 'off') {
			const pattern = current.pattern!;
			const index = current.index!;
			if (context.stopSnaps.has(current.stopId))
				push({
					key: `off:${current.stopId}:${current.boardings}:0`,
					at: current.at,
					kind: 'off',
					stopId: current.stopId,
					boardings: current.boardings,
					walked: false,
					parent: current
				});
			if (index < pattern.stopIds.length - 1) {
				const nextStop = pattern.stopIds[index + 1];
				const at =
					current.kind === 'frequency' && pattern.timing.kind === 'frequency'
						? current.at + pattern.timing.segmentMinutes[index]
						: current.trip!.stopTimes[index + 1].arrivalMinutes;
				push({
					...current,
					key: `${current.kind}:${pattern.id}:${current.trip?.id ?? ''}:${index + 1}:${current.boardings}`,
					at,
					stopId: nextStop,
					index: index + 1,
					parent: current,
					leg: {
						mode: pattern.mode,
						from: current.stopId,
						to: nextStop,
						minutes: at - current.at,
						waitMinutes: 0,
						patternId: pattern.id,
						tripId: current.trip?.id,
						geometry: transitGeometry(pattern, index, current.stopId, nextStop)
					}
				});
			}
			continue;
		}
		const stop = context.stops.get(current.stopId)!;
		const snap = context.stopSnaps.get(current.stopId)!;
		const egress = context.stopEgress.get(stop.id);
		const unknownEgress = context.unknownStopEgress.get(stop.id);
		if (unknownEgress !== undefined)
			possibleSuitableAt = Math.min(
				possibleSuitableAt,
				current.at + unknownEgress / assumptions.walkMPerMinute
			);
		if (egress) {
			const leg = walkLeg(
				stop.id,
				egress.destination.id,
				stop,
				egress.destination,
				snap,
				egress.snap,
				egress.tree
			)!;
			if (current.at + leg.minutes <= endAt && (!best || current.at + leg.minutes < best.at))
				best = {
					at: current.at + leg.minutes,
					destinationId: egress.destination.id,
					label: current,
					finalLeg: leg
				};
		}
		if (current.boardings > 0 && !current.walked)
			for (const link of context.transferLinks.get(stop.id) ?? []) {
				const leg = walkLeg(stop.id, link.stop.id, stop, link.stop, snap, link.snap, link.tree)!;
				push({
					key: `off:${link.stop.id}:${current.boardings}:1`,
					at: current.at + leg.minutes,
					kind: 'off',
					stopId: link.stop.id,
					boardings: current.boardings,
					walked: true,
					parent: current,
					leg
				});
			}
		if (current.boardings >= assumptions.maxTransfers + 1) continue;
		for (const option of context.boarding.get(current.stopId) ?? []) {
			const { pattern, index } = option;
			const boardings = current.boardings + 1;
			if (pattern.timing.kind === 'frequency') {
				const ready = current.at + (current.boardings ? assumptions.boardingBufferMinutes : 0);
				const downstreamOffset = pattern.timing.segmentMinutes
					.slice(0, index)
					.reduce((sum, value) => sum + value, 0);
				let at = Infinity;
				for (const window of pattern.timing.windows) {
					const departure =
						Math.max(ready, window.startMinutes + downstreamOffset) + window.headwayMinutes / 2;
					if (departure <= window.endMinutes + downstreamOffset) at = Math.min(at, departure);
				}
				if (!Number.isFinite(at)) continue;
				push({
					key: `frequency:${pattern.id}::${index}:${boardings}`,
					at,
					kind: 'frequency',
					stopId: stop.id,
					boardings,
					index,
					pattern,
					parent: current,
					leg: {
						mode: pattern.mode,
						from: stop.id,
						to: stop.id,
						minutes: 0,
						waitMinutes: at - current.at,
						patternId: pattern.id,
						geometry: [[stop.lon, stop.lat]]
					}
				});
			} else {
				for (const trip of pattern.timing.trips) {
					const at = trip.stopTimes[index].departureMinutes;
					if (at < current.at + assumptions.boardingBufferMinutes || at > endAt) continue;
					push({
						key: `scheduled:${pattern.id}:${trip.id}:${index}:${boardings}`,
						at,
						kind: 'scheduled',
						stopId: stop.id,
						boardings,
						index,
						pattern,
						trip,
						parent: current,
						leg: {
							mode: pattern.mode,
							from: stop.id,
							to: stop.id,
							minutes: 0,
							waitMinutes: at - current.at,
							patternId: pattern.id,
							tripId: trip.id,
							geometry: [[stop.lon, stop.lat]]
						}
					});
				}
			}
		}
	}
	if (
		(!best || best.at - startAt > assumptions.targetMinutes) &&
		possibleSuitableAt - startAt <= assumptions.targetMinutes
	)
		return failed(
			'unavailable',
			'A network-reachable destination could meet the access target, but its selected service, admission eligibility or opening hours are unverified. Missing suitability cannot establish an access gap.'
		);
	if (
		!best &&
		!context.localDestinationIslands.has(origin.islandId) &&
		!context.observedCrossingIslands.has(origin.islandId)
	)
		return failed(
			'unavailable',
			'Local destination coverage incomplete: no mapped eligible destination on this island and no verified crossing service in the loaded snapshot. This does not establish lack of actual access.'
		);
	if (
		context.unknownDestinationIslands.has(origin.islandId) &&
		(!best || best.at - startAt > assumptions.targetMinutes)
	)
		return failed(
			'unavailable',
			'Suitable destination services, admission eligibility or opening hours are unverified for this island; missing metadata does not establish an access gap.'
		);
	if (
		(context.outsideSnapshot || context.outsideSnapshotIslands.has(origin.islandId)) &&
		(!best || best.at - startAt > assumptions.targetMinutes)
	)
		return failed(
			'unavailable',
			'The selected journey window is not covered by this island’s observed service snapshot. No confirmed journey meets the access target; unobserved transit may serve this area.'
		);
	if (
		context.invalidatedTransitIslands.has(origin.islandId) &&
		(!best || best.at - startAt > assumptions.targetMinutes)
	)
		return failed(
			'unavailable',
			'A service connection or published timetable was invalidated by this edit. Supply a valid assumed service before interpreting a loss of access.'
		);
	if (!best)
		return failed(
			context.transitUnavailable ? 'unavailable' : 'unreachable',
			context.transitUnavailable
				? 'Published transit timing is unavailable; no connected walking journey within the model horizon.'
				: 'No connected journey within the model horizon and transfer limits.'
		);
	const path = reconstruct(best.label, best.finalLeg);
	return {
		status: 'reachable',
		minutes: best.at - startAt,
		destinationId: best.destinationId,
		reason: null,
		path,
		geometry: path.flatMap((leg) => leg.geometry ?? [])
	};
}

/** SDG-aligned spatial estimate: no destination assumptions and no double-counted origins. */
export function originHasSpatialTransitAccess(
	context: RoutingContext,
	origin: PlanningOrigin,
	assumptions: PlanningAssumptions
): boolean | null {
	if (assumptions.walkingRequirements?.requireAuditedWheelchair) return null;
	const originSnap = context.access.snap(origin, assumptions.maxSnapM);
	if (!originSnap) return null;
	const tree = context.access.tree(originSnap.index, 1000);
	const outsideSnapshot =
		context.outsideSnapshot || context.outsideSnapshotIslands.has(origin.islandId);
	for (const [stopId, options] of context.boarding) {
		const usable = outsideSnapshot
			? options.filter((option) => option.pattern.provenance === 'assumed')
			: options;
		if (!usable.length) continue;
		const snap = context.stopSnaps.get(stopId);
		if (!snap) continue;
		const limit = usable.some((o) => o.pattern.mode === 'ferry') ? 1000 : 500;
		if (originSnap.distanceM + tree.distances[snap.index] + snap.distanceM <= limit) return true;
	}
	return outsideSnapshot || context.invalidatedTransitIslands.has(origin.islandId) ? null : false;
}
