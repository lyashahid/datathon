import { patternIsValid } from './routing.ts';
import type {
	NumericRange,
	PlanningAssumptions,
	PlanningBaseline,
	PlanningCarbon,
	PlanningCosts,
	PlanningServicePattern
} from './types.ts';
import type { PlanningWorld } from './scenario.ts';

const zero = (): NumericRange => ({ low: 0, central: 0, high: 0 });
const add = (a: NumericRange, b: NumericRange): NumericRange => ({
	low: a.low + b.low,
	central: a.central + b.central,
	high: a.high + b.high
});
const multiply = (a: NumericRange, n: number): NumericRange => ({
	low: a.low * n,
	central: a.central * n,
	high: a.high * n
});
const signedMultiply = (a: NumericRange, n: number): NumericRange =>
	n >= 0 ? multiply(a, n) : { low: a.high * n, central: a.central * n, high: a.low * n };
const product = (a: NumericRange, b: NumericRange): NumericRange => ({
	low: a.low * b.low,
	central: a.central * b.central,
	high: a.high * b.high
});
export function validRange(value: unknown): value is NumericRange {
	if (!value || typeof value !== 'object') return false;
	const r = value as NumericRange;
	return (
		[r.low, r.central, r.high].every((v) => Number.isFinite(v) && v >= 0) &&
		r.low <= r.central &&
		r.central <= r.high
	);
}

interface Activity {
	km: number;
	hours: number;
	fleet: number;
	kind: 'diesel' | 'electric';
	pattern: PlanningServicePattern;
}

/** Vehicles cannot disappear at a terminus; missing repositioning must not be priced as zero. */
function hasFrequencyCirculation(group: PlanningServicePattern[]): boolean {
	if (group.some((pattern) => pattern.timing.kind !== 'frequency')) return true;
	const balance = new Map<string, number>();
	for (const pattern of group) {
		if (pattern.timing.kind !== 'frequency') continue;
		const trips = pattern.timing.windows.reduce(
			(sum, window) => sum + (window.endMinutes - window.startMinutes) / window.headwayMinutes,
			0
		);
		const from = pattern.stopIds[0],
			to = pattern.stopIds.at(-1)!;
		balance.set(from, (balance.get(from) ?? 0) + trips);
		balance.set(to, (balance.get(to) ?? 0) - trips);
	}
	return [...balance.values()].every((value) => Math.abs(value) < 1e-8);
}
function activity(
	patterns: PlanningServicePattern[],
	assumptions: PlanningAssumptions
): { routes: Map<string, Activity>; reasons: string[] } {
	const groups = new Map<string, PlanningServicePattern[]>();
	const reasons: string[] = [];
	for (const pattern of patterns) {
		if (pattern.mode !== 'bus' || pattern.enabled === false) continue;
		groups.set(pattern.routeId, [...(groups.get(pattern.routeId) ?? []), pattern]);
	}
	const routes = new Map<string, Activity>();
	for (const [id, group] of groups) {
		if (
			group.some((p) => !patternIsValid(p) || !Number.isFinite(p.distanceM) || !(p.distanceM! > 0))
		) {
			reasons.push(`${group[0].name}: routed distance/runtime missing for cost calculation.`);
			continue;
		}
		if (!hasFrequencyCirculation(group)) {
			reasons.push(`${group[0].name}: complete return/repositioning activity is unavailable.`);
			continue;
		}
		let km = 0;
		let hours = 0;
		let cycleMinutes = assumptions.layoverMinutes;
		let minimumHeadway = Infinity;
		let scheduledTrips = 0;
		for (const pattern of group) {
			let trips: number;
			let duration: number;
			if (pattern.timing.kind === 'frequency') {
				trips = pattern.timing.windows.reduce(
					(s, w) => s + (w.endMinutes - w.startMinutes) / w.headwayMinutes,
					0
				);
				duration = pattern.timing.segmentMinutes.reduce((s, n) => s + n, 0);
				minimumHeadway = Math.min(
					minimumHeadway,
					...pattern.timing.windows.map((w) => w.headwayMinutes)
				);
			} else {
				trips = pattern.timing.trips.length;
				duration = trips
					? pattern.timing.trips.reduce(
							(s, trip) =>
								s + trip.stopTimes.at(-1)!.arrivalMinutes - trip.stopTimes[0].departureMinutes,
							0
						) / trips
					: 0;
				scheduledTrips += trips;
			}
			km += (pattern.distanceM! / 1000) * trips * assumptions.annualOperatingDays;
			hours += (duration / 60) * trips * assumptions.annualOperatingDays;
			cycleMinutes += duration;
		}
		// Scheduled fleets require dispatch data. Do not infer them from partial captured trips.
		const fleet = Number.isFinite(minimumHeadway)
			? Math.ceil(Math.ceil(cycleMinutes / minimumHeadway) * (1 + assumptions.fleetReserveShare))
			: 0;
		if (scheduledTrips)
			reasons.push(
				`${group[0].name}: scheduled operations/fleet are a captured service snapshot, not verified annual dispatch.`
			);
		routes.set(id, { km, hours, fleet, kind: group[0].fleet ?? 'diesel', pattern: group[0] });
	}
	return { routes, reasons };
}

/** Incremental scenario costs; annual costs are never added to one-time capital. */
export function calculatePlanningEconomics(
	baseline: PlanningBaseline,
	world: PlanningWorld,
	assumptions: PlanningAssumptions
): { costs: PlanningCosts; carbon: PlanningCarbon } {
	const before = activity(baseline.transit.patterns, assumptions);
	const after = activity(world.patterns, assumptions);
	const reasons: string[] = [];
	const carbonReasons: string[] = [];
	const baselineStops = new Set(baseline.transit.stops.map((s) => s.id));
	const newStops = world.stops.filter(
		(s) => s.disabled !== true && !baselineStops.has(s.id)
	).length;
	let capital = zero();
	let operating = zero();
	let addedEmissions = zero();
	let capitalAvailable = true;
	let operatingAvailable = true;
	let emissionsAvailable = true;
	let activityAvailable = true;
	let annualVehicleKm = 0;
	let annualVehicleHours = 0;
	let requiredFleet = 0;
	let newElectricFleet = false;
	const baselineFacilities = new Set(baseline.facilities.map((facility) => facility.id));
	if (world.facilities.some((facility) => !baselineFacilities.has(facility.id))) {
		capitalAvailable = false;
		operatingAvailable = false;
		emissionsAvailable = false;
		reasons.push(
			'Proposed facility investment and annual operations are unavailable; transport costs are only part of this intervention.'
		);
		carbonReasons.push(
			'Proposed facility construction and operating emissions are unavailable. Shorter access journeys do not establish emissions savings.'
		);
	}
	const routeGroups = (patterns: PlanningServicePattern[]) => {
		const groups = new Map<string, PlanningServicePattern[]>();
		for (const p of patterns.filter((p) => p.mode === 'bus' && p.enabled !== false))
			groups.set(p.routeId, [...(groups.get(p.routeId) ?? []), p]);
		return groups;
	};
	const oldGroups = routeGroups(baseline.transit.patterns);
	const newGroups = routeGroups(world.patterns);
	const physicalSignature = (
		group: PlanningServicePattern[] | undefined,
		stops: PlanningWorld['stops']
	) =>
		JSON.stringify(
			group?.map((p) => ({
				id: p.id,
				stops: p.stopIds.map((id) => {
					const s = stops.find((s) => s.id === id);
					return [id, s?.lon, s?.lat, s?.disabled === true];
				}),
				timing: p.timing,
				fleet: p.fleet ?? 'diesel',
				distanceM: p.distanceM
			})) ?? []
		);
	const changedIds = [...new Set([...oldGroups.keys(), ...newGroups.keys()])].filter(
		(id) =>
			physicalSignature(oldGroups.get(id), baseline.transit.stops) !==
			physicalSignature(newGroups.get(id), world.stops)
	);
	const ferryChanged =
		physicalSignature(
			baseline.transit.patterns.filter((p) => p.mode === 'ferry' && p.enabled !== false),
			baseline.transit.stops
		) !==
		physicalSignature(
			world.patterns.filter((p) => p.mode === 'ferry' && p.enabled !== false),
			world.stops
		);
	if (ferryChanged) {
		capitalAvailable = false;
		operatingAvailable = false;
		emissionsAvailable = false;
		activityAvailable = false;
		reasons.push(
			'Ferry operating/capital/fleet assumptions are unavailable in the bus cost model.'
		);
		carbonReasons.push('Ferry energy use and annual operations are unavailable.');
	}
	if (
		(changedIds.length || ferryChanged) &&
		(![
			assumptions.annualOperatingDays,
			assumptions.layoverMinutes,
			assumptions.fleetReserveShare
		].every(Number.isFinite) ||
			assumptions.annualOperatingDays < 1 ||
			assumptions.annualOperatingDays > 366 ||
			assumptions.layoverMinutes < 0 ||
			assumptions.fleetReserveShare < 0 ||
			assumptions.fleetReserveShare > 1)
	) {
		capitalAvailable = false;
		operatingAvailable = false;
		emissionsAvailable = false;
		activityAvailable = false;
		reasons.push('Annual days, layover or fleet reserve assumptions are invalid.');
		carbonReasons.push('Annual operations assumptions are invalid.');
	}
	// Validate changed groups before activity() drops incomplete patterns. An unknown baseline
	// is not a zero-cost baseline, and a partial schedule cannot determine annual fleet needs.
	for (const id of changedIds) {
		const oldGroup = oldGroups.get(id);
		const newGroup = newGroups.get(id);
		const missingCirculation = [oldGroup, newGroup].some(
			(group) => group && !hasFrequencyCirculation(group)
		);
		if (
			(oldGroup && !before.routes.has(id)) ||
			(newGroup && !after.routes.has(id)) ||
			world.patterns.some((p) => p.routeId === id && p.runtimeUnavailableReason) ||
			[...(oldGroup ?? []), ...(newGroup ?? [])].some((p) => p.timing.kind === 'scheduled')
		) {
			capitalAvailable = false;
			operatingAvailable = false;
			emissionsAvailable = false;
			activityAvailable = false;
			reasons.push(
				missingCirculation
					? `${newGroup?.[0].name ?? oldGroup![0].name}: complete return/repositioning activity is unavailable; a one-way service cannot determine feasible fleet or annual costs.`
					: `${newGroup?.[0].name ?? oldGroup![0].name}: changed service lacks a complete routed annual operations/fleet baseline.`
			);
			carbonReasons.push('Changed service lacks a complete annual vehicle-km baseline.');
		}
	}
	const rangeOrMissing = (range: unknown, explanation: string): NumericRange | null => {
		if (validRange(range)) return range;
		reasons.push(explanation);
		return null;
	};
	if (newStops) {
		const stopCost = rangeOrMissing(
			assumptions.costs.stopCapitalMvr,
			'Stop capital cost range is unavailable.'
		);
		if (stopCost) capital = add(capital, multiply(stopCost, newStops));
		else capitalAvailable = false;
	}
	const emissionFactor = (kind: 'diesel' | 'electric'): NumericRange | null => {
		if (
			kind === 'diesel' &&
			validRange(assumptions.dieselLitresPerVehicleKm) &&
			validRange(assumptions.dieselKgCo2ePerLitre)
		)
			return product(assumptions.dieselLitresPerVehicleKm, assumptions.dieselKgCo2ePerLitre);
		if (
			kind === 'electric' &&
			validRange(assumptions.electricKwhPerVehicleKm) &&
			validRange(assumptions.gridKgCo2ePerKwh)
		)
			return product(assumptions.electricKwhPerVehicleKm, assumptions.gridKgCo2ePerKwh);
		const factor =
			kind === 'diesel'
				? assumptions.costs.dieselKgCo2ePerKm
				: assumptions.costs.electricKgCo2ePerKm;
		return validRange(factor) ? factor : null;
	};
	const ids = new Set(changedIds);
	for (const id of ids) {
		const old = before.routes.get(id);
		const next = after.routes.get(id);
		if (
			old &&
			next &&
			old.km === next.km &&
			old.hours === next.hours &&
			old.fleet === next.fleet &&
			old.kind === next.kind
		)
			continue;
		if (!old && !next) continue;
		const sourcePattern = next?.pattern ?? old!.pattern;
		if (sourcePattern.timing.kind === 'scheduled' || old?.pattern.timing.kind === 'scheduled') {
			reasons.push(
				`${sourcePattern.name}: annual change cannot be calibrated from a partial published schedule.`
			);
			operatingAvailable = false;
			emissionsAvailable = false;
			carbonReasons.push('Changed published schedules lack a complete annual operations baseline.');
		}
		annualVehicleKm += (next?.km ?? 0) - (old?.km ?? 0);
		annualVehicleHours += (next?.hours ?? 0) - (old?.hours ?? 0);
		const newFleet = Math.max(
			0,
			(next?.fleet ?? 0) - (old && old.kind === next?.kind ? old.fleet : 0)
		);
		requiredFleet += newFleet;
		if (next && newFleet) {
			const busCost = rangeOrMissing(
				next.kind === 'electric'
					? assumptions.costs.electricBusCapitalMvr
					: assumptions.costs.dieselBusCapitalMvr,
				`${next.kind} bus capital cost range is unavailable.`
			);
			if (busCost) capital = add(capital, multiply(busCost, newFleet));
			else capitalAvailable = false;
			if (next.kind === 'electric') newElectricFleet = true;
		}
		// The same fleet uses one shared cost/emissions factor on incremental kilometres.
		// Fleet replacement uses separate factors and therefore reverses the subtracted bounds.
		const sides =
			old && next && old.kind === next.kind
				? ([[next, next.km - old.km]] as const)
				: ([
						[next, next?.km ?? 0],
						[old, -(old?.km ?? 0)]
					] as const);
		for (const [side, km] of sides) {
			if (!side || !km) continue;
			const perKm = rangeOrMissing(
				side.kind === 'electric'
					? assumptions.costs.electricOperatingMvrPerKm
					: assumptions.costs.dieselOperatingMvrPerKm,
				`${side.kind} total operating cost/km range is unavailable.`
			);
			if (perKm) {
				// For a subtraction, range bounds reverse to retain a true low/high interval.
				operating = add(operating, signedMultiply(perKm, km));
			} else operatingAvailable = false;
			const factor = emissionFactor(side.kind);
			if (factor) {
				addedEmissions = add(addedEmissions, signedMultiply(factor, km));
			} else {
				emissionsAvailable = false;
				carbonReasons.push(`${side.kind} energy use/emissions factor is unavailable.`);
			}
		}
	}
	for (const message of after.reasons) {
		const unchanged = before.reasons.includes(message);
		if (!unchanged) {
			reasons.push(message);
			if (message.includes('missing')) {
				operatingAvailable = false;
				emissionsAvailable = false;
			}
		}
	}
	if (newElectricFleet) {
		const charging = rangeOrMissing(
			assumptions.costs.chargingInfrastructureMvr,
			'Charging infrastructure capital range is unavailable.'
		);
		if (charging) capital = add(capital, charging);
		else capitalAvailable = false;
	}
	let displaced: NumericRange | null = null;
	const displacedFactor = assumptions.costs.displacedKgCo2ePerPassengerKm;
	if (!changedIds.length && !ferryChanged) displaced = zero();
	else if (validRange(displacedFactor) && validRange(assumptions.displacedPassengerKm))
		displaced = product(displacedFactor, assumptions.displacedPassengerKm);
	else if (
		validRange(assumptions.displacedPassengerKm) &&
		assumptions.displacedPassengerKm.high === 0
	)
		displaced = zero();
	else
		carbonReasons.push(
			'Displaced travel/emissions factor is unavailable. Accessibility gains do not predict mode shift.'
		);
	const available = emissionsAvailable && displaced !== null;
	const costs: PlanningCosts = {
		capitalMvr: capitalAvailable ? capital : null,
		annualOperatingMvr: operatingAvailable ? operating : null,
		annualVehicleKm: activityAvailable ? annualVehicleKm : null,
		annualVehicleHours: activityAvailable ? annualVehicleHours : null,
		requiredFleet: activityAvailable ? requiredFleet : null,
		newStops,
		unavailableReasons: [...new Set(reasons)]
	};
	const carbon: PlanningCarbon = {
		low: available ? addedEmissions.low - displaced!.high : null,
		central: available ? addedEmissions.central - displaced!.central : null,
		high: available ? addedEmissions.high - displaced!.low : null,
		addedKgCo2e: emissionsAvailable ? addedEmissions : null,
		displacedKgCo2e: displaced,
		breakEvenDisplacedPassengerKm:
			emissionsAvailable && validRange(displacedFactor) && displacedFactor.central > 0
				? Math.max(0, addedEmissions.central / displacedFactor.central)
				: null,
		unavailableReasons: [...new Set(carbonReasons)]
	};
	return { costs, carbon };
}
