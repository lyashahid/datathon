import { validRange } from './economics.ts';
import { patternIsValid } from './routing.ts';
import { isFacilityProposal } from './facilities.ts';
import type {
	PlanningAction,
	PlanningAssumptions,
	PlanningDisruption,
	PlanningServicePattern,
	PlanningStop
} from './types.ts';

const record = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const date = (v: unknown): v is string => {
	if (!id(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
	const parsed = new Date(`${v}T00:00:00Z`);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
};
export function validPlanningDisruptions(v: unknown): v is PlanningDisruption[] {
	if (!Array.isArray(v) || v.length > 100) return false;
	const seen = new Set<string>();
	return v.every((event) => {
		if (
			!record(event) ||
			!id(event.id) ||
			seen.has(event.id) ||
			!id(event.name) ||
			!['closure', 'delay'].includes(event.kind as string) ||
			!Array.isArray(event.edgeIds) ||
			!event.edgeIds.length ||
			event.edgeIds.length > 10000 ||
			!event.edgeIds.every(id) ||
			!Array.isArray(event.modes) ||
			!event.modes.length ||
			!event.modes.every((mode) => ['bus', 'walk'].includes(mode)) ||
			!['both', 'forward', 'reverse'].includes(event.direction as string) ||
			!date(event.startDate) ||
			!date(event.endDate) ||
			!finite(event.startMinutes) ||
			!finite(event.endMinutes) ||
			event.startMinutes < 0 ||
			event.startMinutes > 2880 ||
			event.endMinutes < 0 ||
			event.endMinutes > 2880 ||
			!['observed', 'assumed'].includes(event.provenance as string) ||
			(event.enabled !== undefined && typeof event.enabled !== 'boolean') ||
			(event.sourceIds !== undefined &&
				(!Array.isArray(event.sourceIds) || !event.sourceIds.every(id))) ||
			(event.sourceUrl !== undefined &&
				(typeof event.sourceUrl !== 'string' ||
					event.sourceUrl.length > 4000 ||
					!/^https?:\/\//.test(event.sourceUrl))) ||
			(event.evidenceNote !== undefined &&
				(typeof event.evidenceNote !== 'string' || event.evidenceNote.length > 5000))
		)
			return false;
		const duration =
			Date.parse(`${event.endDate}T00:00:00Z`) / 60000 +
			event.endMinutes -
			Date.parse(`${event.startDate}T00:00:00Z`) / 60000 -
			event.startMinutes;
		if (!(duration > 0) || duration > 366 * 1440) return false;
		if (
			event.kind === 'delay' &&
			(!finite(event.delayMinutes) ||
				event.delayMinutes <= 0 ||
				event.delayMinutes > 180 ||
				event.modes.includes('walk'))
		)
			return false;
		seen.add(event.id);
		return true;
	});
}
const position = (v: unknown) =>
	record(v) && finite(v.lon) && Math.abs(v.lon) <= 180 && finite(v.lat) && Math.abs(v.lat) <= 90;
const geometry = (v: unknown) =>
	v === undefined ||
	(Array.isArray(v) &&
		v.length <= 100000 &&
		v.every(
			(p) =>
				Array.isArray(p) &&
				p.length === 2 &&
				finite(p[0]) &&
				Math.abs(p[0]) <= 180 &&
				finite(p[1]) &&
				Math.abs(p[1]) <= 90
		));
const stop = (v: unknown): v is PlanningStop =>
	record(v) &&
	position(v) &&
	id(v.id) &&
	id(v.name) &&
	id(v.islandId) &&
	(v.mode === undefined || ['bus', 'ferry'].includes(v.mode as string)) &&
	(v.disabled === undefined || typeof v.disabled === 'boolean') &&
	(v.pickupAllowed === undefined || typeof v.pickupAllowed === 'boolean') &&
	Array.isArray(v.sourceIds) &&
	v.sourceIds.every(id);
function pattern(v: unknown): v is PlanningServicePattern {
	if (
		!record(v) ||
		!id(v.id) ||
		!id(v.routeId) ||
		!id(v.name) ||
		!['bus', 'ferry'].includes(v.mode as string) ||
		!Array.isArray(v.stopIds) ||
		!v.stopIds.every(id) ||
		!record(v.calendar) ||
		!Array.isArray(v.calendar.weekdays) ||
		!v.calendar.weekdays.every((d) => finite(d) && Number.isInteger(d) && d >= 0 && d <= 6) ||
		!record(v.timing) ||
		!Array.isArray(v.sourceIds)
	)
		return false;
	if (
		(v.calendar.startDate !== undefined && !date(v.calendar.startDate)) ||
		(v.calendar.endDate !== undefined && !date(v.calendar.endDate))
	)
		return false;
	if (
		['includedDates', 'excludedDates'].some(
			(key) =>
				v.calendar &&
				record(v.calendar) &&
				v.calendar[key] !== undefined &&
				!(Array.isArray(v.calendar[key]) && v.calendar[key].every(date))
		)
	)
		return false;
	if (
		!geometry(v.geometry) ||
		(v.timing.kind === 'scheduled' &&
			Array.isArray(v.timing.trips) &&
			v.timing.trips.some(
				(trip) =>
					!record(trip) ||
					(trip.segmentGeometry !== undefined &&
						(!Array.isArray(trip.segmentGeometry) ||
							trip.segmentGeometry.length !== (v.stopIds as string[]).length - 1 ||
							!trip.segmentGeometry.every(
								(segment) => Array.isArray(segment) && segment.length >= 2 && geometry(segment)
							)))
			)) ||
		(v.segmentGeometry !== undefined &&
			(!Array.isArray(v.segmentGeometry) ||
				v.segmentGeometry.length !== v.stopIds.length - 1 ||
				!v.segmentGeometry.every(
					(segment) => Array.isArray(segment) && segment.length >= 2 && geometry(segment)
				))) ||
		(v.segmentDistanceM !== undefined &&
			(!Array.isArray(v.segmentDistanceM) ||
				v.segmentDistanceM.length !== v.stopIds.length - 1 ||
				!v.segmentDistanceM.every((metres) => finite(metres) && metres > 0))) ||
		(v.distanceM !== undefined && (!finite(v.distanceM) || v.distanceM <= 0)) ||
		(v.fleet !== undefined && !['diesel', 'electric'].includes(v.fleet as string))
	)
		return false;
	try {
		return patternIsValid(v as unknown as PlanningServicePattern);
	} catch {
		return false;
	}
}
export function validSavedActions(v: unknown): v is PlanningAction[] {
	if (!Array.isArray(v) || v.length > 1000) return false;
	return v.every((a) => {
		if (!record(a)) return false;
		switch (a.kind) {
			case 'add-facility':
				return isFacilityProposal(a.facility);
			case 'add-stop':
				return stop(a.stop);
			case 'move-stop':
				return id(a.stopId) && position(a.position) && (a.islandId === undefined || id(a.islandId));
			case 'disable-stop':
			case 'enable-stop':
				return id(a.stopId);
			case 'disable-service':
			case 'enable-service':
				return id(a.patternId);
			case 'add-route':
				return (
					pattern(a.pattern) &&
					(a.returnPattern === undefined || pattern(a.returnPattern)) &&
					(a.stops === undefined || (Array.isArray(a.stops) && a.stops.every(stop)))
				);
			case 'shift-timetable':
				return (
					id(a.patternId) &&
					finite(a.minutes) &&
					Number.isInteger(a.minutes) &&
					Math.abs(a.minutes) <= 15
				);
			case 'replace-route':
				return (
					id(a.patternId) &&
					Array.isArray(a.patterns) &&
					a.patterns.length > 0 &&
					a.patterns.length <= 100 &&
					a.patterns.every(pattern) &&
					new Set(a.patterns.map((p) => p.id)).size === a.patterns.length &&
					(a.stops === undefined || (Array.isArray(a.stops) && a.stops.every(stop)))
				);
			case 'extend-route':
				return (
					id(a.patternId) &&
					stop(a.stop) &&
					finite(a.segmentMinutes) &&
					a.segmentMinutes > 0 &&
					finite(a.distanceM) &&
					a.distanceM > 0 &&
					geometry(a.geometry) &&
					geometry(a.returnGeometry) &&
					(a.returnDistanceM === undefined ||
						(finite(a.returnDistanceM) && a.returnDistanceM > 0)) &&
					(a.returnSegmentMinutes === undefined ||
						(finite(a.returnSegmentMinutes) && a.returnSegmentMinutes > 0))
				);
			case 'set-frequency':
				return (
					id(a.patternId) &&
					finite(a.headwayMinutes) &&
					a.headwayMinutes >= 1 &&
					a.headwayMinutes <= 240
				);
			case 'set-hours':
				return (
					id(a.patternId) &&
					finite(a.startMinutes) &&
					finite(a.endMinutes) &&
					a.startMinutes >= 0 &&
					a.endMinutes <= 2880 &&
					a.endMinutes > a.startMinutes
				);
			case 'set-fleet':
				return id(a.patternId) && ['diesel', 'electric'].includes(a.fleet as string);
			default:
				return false;
		}
	});
}
export function validPlanningAssumptions(v: unknown): v is PlanningAssumptions {
	if (
		!record(v) ||
		!date(v.date) ||
		!['healthcare', 'education'].includes(v.goal as string) ||
		![2026, 2030].includes(v.populationYear as number) ||
		!record(v.costs) ||
		!validRange(v.displacedPassengerKm)
	)
		return false;
	if (v.disruptions !== undefined && !validPlanningDisruptions(v.disruptions)) return false;
	if (
		v.fleetResponse !== undefined &&
		!['maintain-frequency', 'fixed-fleet'].includes(v.fleetResponse as string)
	)
		return false;
	if (
		v.robustnessStresses !== undefined &&
		(!Array.isArray(v.robustnessStresses) ||
			v.robustnessStresses.length > 3 ||
			!v.robustnessStresses.every(
				(stress) =>
					record(stress) &&
					id(stress.id) &&
					id(stress.name) &&
					validPlanningDisruptions(stress.disruptions)
			) ||
			new Set(v.robustnessStresses.map((stress) => (record(stress) ? stress.id : undefined)))
				.size !== v.robustnessStresses.length)
	)
		return false;
	const fields = [
		'departureMinutes',
		'targetMinutes',
		'walkMPerMinute',
		'maxJourneyMinutes',
		'maxTransfers',
		'maxAccessWalkMinutes',
		'maxTransferWalkMinutes',
		'maxSnapM',
		'boardingBufferMinutes',
		'busMovingKph',
		'busDwellMinutes',
		'annualOperatingDays',
		'layoverMinutes',
		'fleetReserveShare'
	];
	if (fields.some((key) => !finite(v[key]) || (v[key] as number) < 0)) return false;
	if (v.destinationRequirements !== undefined) {
		const requirements = v.destinationRequirements;
		if (
			!record(requirements) ||
			(requirements.healthcareService !== undefined &&
				!['general', 'emergency', 'specialist'].includes(
					requirements.healthcareService as string
				)) ||
			(requirements.schoolLevel !== undefined &&
				!['primary', 'lower-secondary', 'higher-secondary'].includes(
					requirements.schoolLevel as string
				)) ||
			(requirements.publicAccess !== undefined &&
				!['any', 'public'].includes(requirements.publicAccess as string)) ||
			(requirements.requireOpenAtDeparture !== undefined &&
				typeof requirements.requireOpenAtDeparture !== 'boolean')
		)
			return false;
	}
	if (
		v.walkingRequirements !== undefined &&
		(!record(v.walkingRequirements) ||
			(v.walkingRequirements.requireAuditedWheelchair !== undefined &&
				typeof v.walkingRequirements.requireAuditedWheelchair !== 'boolean'))
	)
		return false;
	if (v.housingDistribution !== undefined) {
		const seenIslands = new Set<string>();
		if (
			!Array.isArray(v.housingDistribution) ||
			v.housingDistribution.length > 100 ||
			!v.housingDistribution.every((allocation) => {
				if (
					!record(allocation) ||
					!id(allocation.islandId) ||
					seenIslands.has(allocation.islandId) ||
					!finite(allocation.share) ||
					allocation.share < 0 ||
					allocation.share > 1 ||
					!Array.isArray(allocation.originIds) ||
					!allocation.originIds.length ||
					allocation.originIds.length > 10000 ||
					!allocation.originIds.every(id) ||
					new Set(allocation.originIds).size !== allocation.originIds.length
				)
					return false;
				seenIslands.add(allocation.islandId);
				return true;
			})
		)
			return false;
	}
	if (v.policyDelivery !== undefined) {
		const delivery = v.policyDelivery;
		const text = (value: unknown) => typeof value === 'string' && value.length <= 2000;
		if (
			!record(delivery) ||
			!text(delivery.responsibleAgency) ||
			!Array.isArray(delivery.phases) ||
			delivery.phases.length > 20 ||
			!delivery.phases.every(text) ||
			!Array.isArray(delivery.outstandingVerification) ||
			delivery.outstandingVerification.length > 50 ||
			!delivery.outstandingVerification.every(text)
		)
			return false;
	}
	if (v.fareAffordability !== undefined) {
		const fare = v.fareAffordability;
		if (
			!record(fare) ||
			!finite(fare.oneWayFareMvr) ||
			fare.oneWayFareMvr < 0 ||
			!finite(fare.monthlyTrips) ||
			fare.monthlyTrips < 0 ||
			!finite(fare.monthlyHouseholdBudgetMvr) ||
			fare.monthlyHouseholdBudgetMvr < 0
		)
			return false;
	}
	if (v.privateTravelInputs !== undefined) {
		const travel = v.privateTravelInputs;
		if (
			!record(travel) ||
			!validRange(travel.dailyTrips) ||
			!finite(travel.distanceKm) ||
			travel.distanceKm <= 0 ||
			!finite(travel.occupancy) ||
			travel.occupancy < 1
		)
			return false;
		const annualMultiplier = travel.distanceKm * travel.occupancy * Number(v.annualOperatingDays);
		for (const part of ['low', 'central', 'high'] as const) {
			const expected = travel.dailyTrips[part] * annualMultiplier;
			if (
				!Number.isFinite(expected) ||
				Math.abs(v.displacedPassengerKm[part] - expected) > 1e-9 * Math.max(1, Math.abs(expected))
			)
				return false;
		}
	}
	if (!(
		Number(v.walkMPerMinute) > 0 &&
		Number(v.maxJourneyMinutes) > 0 &&
		Number(v.targetMinutes) > 0 &&
		Number(v.busMovingKph) > 0 &&
		Number(v.annualOperatingDays) > 0 &&
		Number(v.annualOperatingDays) <= 366 &&
		Number.isInteger(v.maxTransfers)
	))
		return false;
	if (
		Number(v.maxJourneyMinutes) > 180 ||
		Number(v.targetMinutes) > 180 ||
		Number(v.maxTransfers) > 2 ||
		Number(v.walkMPerMinute) > 300 ||
		Number(v.maxSnapM) > 500 ||
		Number(v.busMovingKph) > 300 ||
		Number(v.departureMinutes) > 2880 ||
		Number(v.fleetReserveShare) > 1
	)
		return false;
	const costRanges = [
		'stopCapitalMvr',
		'dieselBusCapitalMvr',
		'electricBusCapitalMvr',
		'chargingInfrastructureMvr',
		'dieselOperatingMvrPerKm',
		'electricOperatingMvrPerKm',
		'dieselKgCo2ePerKm',
		'electricKgCo2ePerKm',
		'displacedKgCo2ePerPassengerKm'
	];
	if (
		costRanges.some(
			(key) =>
				record(v.costs) &&
				v.costs[key] !== undefined &&
				v.costs[key] !== null &&
				!validRange(v.costs[key])
		)
	)
		return false;
	return [
		'dieselLitresPerVehicleKm',
		'dieselKgCo2ePerLitre',
		'electricKwhPerVehicleKm',
		'gridKgCo2ePerKwh'
	].every((key) => v[key] === undefined || validRange(v[key]));
}
