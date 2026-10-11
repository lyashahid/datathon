import type {
	PlanningAssumptions,
	PlanningDestinationRequirements,
	PlanningFacility,
	PlanningFacilitySuitability
} from './types.ts';

const validReviewDate = (value: unknown): value is string => {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** Separate import contract: proposed facilities must never impersonate an audited facility. */
export function isFacilityProposal(value: unknown): value is PlanningFacility & {
	provenance: 'assumed';
	planningStatus: 'proposed';
	proposedOpeningDate: string;
} {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const facility = value as PlanningFacility;
	return (
		[facility.id, facility.name, facility.islandId].every(
			(v) => typeof v === 'string' && v.trim().length > 0
		) &&
		Number.isFinite(facility.lon) &&
		Math.abs(facility.lon) <= 180 &&
		Number.isFinite(facility.lat) &&
		Math.abs(facility.lat) <= 90 &&
		(facility.kind === 'clinic' || facility.kind === 'school') &&
		facility.provenance === 'assumed' &&
		facility.planningStatus === 'proposed' &&
		facility.verification === 'scenario-proposal' &&
		facility.operatingStatus === 'open' &&
		(facility.kind !== 'clinic' || facility.careScope === 'general') &&
		validReviewDate(facility.proposedOpeningDate) &&
		Array.isArray(facility.sourceIds) &&
		facility.sourceIds.length === 1 &&
		facility.sourceIds[0] === 'scenario-proposal'
	);
}

export interface FacilityEligibility {
	status: 'eligible' | 'ineligible' | 'unavailable';
	reason: string | null;
}

const eligible = (): FacilityEligibility => ({ status: 'eligible', reason: null });
const ineligible = (reason: string): FacilityEligibility => ({ status: 'ineligible', reason });
const unavailable = (reason: string): FacilityEligibility => ({ status: 'unavailable', reason });
const validSources = (ids: unknown): ids is string[] =>
	Array.isArray(ids) &&
	ids.length > 0 &&
	ids.every((id) => typeof id === 'string' && id.trim().length > 0);

function reviewedSuitability(facility: PlanningFacility): PlanningFacilitySuitability | null {
	const value = facility.suitability;
	return value &&
		validReviewDate(value.reviewedAt) &&
		validSources(value.sourceIds) &&
		!value.sourceIds.includes('scenario-proposal') &&
		(value.healthcareServices === undefined ||
			(Array.isArray(value.healthcareServices) &&
				value.healthcareServices.every((service) =>
					['general', 'emergency', 'specialist'].includes(service)
				))) &&
		(value.schoolLevels === undefined ||
			(Array.isArray(value.schoolLevels) &&
				value.schoolLevels.every((level) =>
					['primary', 'lower-secondary', 'higher-secondary'].includes(level)
				))) &&
		(value.publicAccess === undefined ||
			['public', 'restricted', 'private'].includes(value.publicAccess))
		? value
		: null;
}

/** A published hours window may continue into the following day. No hours are inferred from facility category. */
function openAtDeparture(
	hours: PlanningFacilitySuitability['openingHours'],
	date: string,
	minutes: number
): boolean | null {
	if (
		!hours?.length ||
		!validReviewDate(date) ||
		!Number.isFinite(minutes) ||
		minutes < 0 ||
		minutes >= 1440
	)
		return null;
	if (
		hours.some(
			(window) =>
				!Array.isArray(window.weekdays) ||
				!window.weekdays.length ||
				window.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
				!Number.isFinite(window.startMinutes) ||
				!Number.isFinite(window.endMinutes) ||
				window.startMinutes < 0 ||
				window.startMinutes >= 1440 ||
				window.endMinutes <= window.startMinutes ||
				window.endMinutes > 2880 ||
				(window.startDate !== undefined && !validReviewDate(window.startDate)) ||
				(window.endDate !== undefined && !validReviewDate(window.endDate)) ||
				(window.startDate && window.endDate && window.endDate < window.startDate)
		)
	)
		return null;
	const day = new Date(`${date}T00:00:00Z`);
	const previous = new Date(day.getTime() - 86_400_000);
	return hours.some((window) =>
		[
			{ date, weekday: day.getUTCDay(), at: minutes },
			{
				date: previous.toISOString().slice(0, 10),
				weekday: previous.getUTCDay(),
				at: minutes + 1440
			}
		].some(
			(candidate) =>
				(!window.startDate || candidate.date >= window.startDate) &&
				(!window.endDate || candidate.date <= window.endDate) &&
				window.weekdays.includes(candidate.weekday) &&
				candidate.at >= window.startMinutes &&
				candidate.at < window.endMinutes
		)
	);
}

/** Unknown suitability stays unavailable; a current-listed clinic does not establish emergency, grades, admissions or hours. */
export function getFacilityEligibility(
	facility: PlanningFacility,
	assumptions: Pick<
		PlanningAssumptions,
		'goal' | 'date' | 'departureMinutes' | 'destinationRequirements'
	>,
	allowProposed = false
): FacilityEligibility {
	const { goal, date, destinationRequirements: requirements = {} } = assumptions;
	if (isFacilityProposal(facility)) {
		if (
			!allowProposed ||
			date < facility.proposedOpeningDate ||
			!(goal === 'healthcare' ? facility.kind === 'clinic' : facility.kind === 'school')
		)
			return ineligible('The proposed destination is not available in this scenario.');
		if (
			(goal === 'healthcare' &&
				requirements.healthcareService &&
				requirements.healthcareService !== 'general') ||
			(goal === 'education' && requirements.schoolLevel) ||
			requirements.publicAccess === 'public' ||
			requirements.requireOpenAtDeparture
		)
			return unavailable(
				'Proposed facility service, school level, eligibility and hours require a staffed operating plan.'
			);
		return eligible();
	}
	if (
		!Number.isFinite(facility.lon) ||
		Math.abs(facility.lon) > 180 ||
		!Number.isFinite(facility.lat) ||
		Math.abs(facility.lat) > 90 ||
		!(
			facility.verification === true ||
			facility.verification === 'official' ||
			facility.verification === 'osm-mapped'
		) ||
		!(goal === 'healthcare'
			? facility.kind === 'hospital' || facility.kind === 'clinic'
			: facility.kind === 'school')
	)
		return ineligible(
			'The facility identity or mapped position is not eligible for this destination goal.'
		);
	// Legacy model fixtures retain their coordinate policy. The public source loader
	// requires complete operating reviews for healthcare and education.
	if (
		facility.operatingStatus !== undefined &&
		!(
			facility.operatingStatus === 'open' &&
			validReviewDate(facility.statusReviewedAt) &&
			validSources(facility.statusSourceIds)
		)
	)
		return ineligible('The mapped facility does not have a complete current operating review.');
	const suitability = reviewedSuitability(facility);
	const unknown: string[] = [];
	if (goal === 'healthcare') {
		const service = requirements.healthcareService ?? 'general';
		if (service === 'general') {
			if (facility.careScope !== undefined && facility.careScope !== 'general')
				return ineligible('This facility does not provide verified general-care access.');
		} else if (!suitability || !Array.isArray(suitability.healthcareServices)) {
			unknown.push(`${service} care`);
		} else if (!suitability.healthcareServices.includes(service)) {
			return ineligible(`The reviewed service list does not include ${service} care.`);
		}
	} else if (requirements.schoolLevel) {
		if (facility.educationSuitability === 'preschool')
			return ineligible('This reviewed preschool does not provide the selected school level.');
		if (!suitability || !Array.isArray(suitability.schoolLevels)) unknown.push('school level');
		else if (!suitability.schoolLevels.includes(requirements.schoolLevel))
			return ineligible('The reviewed school levels do not include the selected level.');
	}
	if (requirements.publicAccess === 'public') {
		if (!suitability?.publicAccess) unknown.push('public eligibility');
		else if (suitability.publicAccess !== 'public')
			return ineligible('The reviewed facility has private or restricted eligibility.');
	}
	if (requirements.requireOpenAtDeparture) {
		const open = suitability
			? openAtDeparture(suitability.openingHours, date, assumptions.departureMinutes)
			: null;
		if (open === null) unknown.push('opening hours');
		else if (!open)
			return ineligible('The published facility hours do not cover the selected departure time.');
	}
	return unknown.length
		? unavailable(`Verified ${unknown.join(', ')} metadata is unavailable for ${facility.name}.`)
		: eligible();
}

/** Legacy callers retain the current-listed general destination policy. */
export function isEligibleFacility(
	facility: PlanningFacility,
	goal: PlanningAssumptions['goal'],
	date?: string,
	allowProposed = false,
	destinationRequirements?: PlanningDestinationRequirements,
	departureMinutes = 0
): boolean {
	return (
		getFacilityEligibility(
			facility,
			{ goal, date: date ?? '9999-12-31', departureMinutes, destinationRequirements },
			allowProposed
		).status === 'eligible'
	);
}
