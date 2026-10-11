/** Serializable contracts for the service-aware planning model. Distances are metres; time is MVT. */
export type PlanningPosition = { lon: number; lat: number };
export type PlanningFleet = 'diesel' | 'electric';
export interface PlanningSource {
	id: string;
	title?: string;
	url?: string;
	[key: string]: unknown;
}
export interface PlanningIsland {
	id: string;
	name: string;
	[key: string]: unknown;
}
export interface PlanningOrigin extends PlanningPosition {
	id: string;
	islandId: string;
	population2026: number;
	population2030?: number | null;
	[key: string]: unknown;
}
export interface PlanningNode extends PlanningPosition {
	id: string;
}
export interface PlanningEdge {
	id: string;
	from: string;
	to: string;
	distanceM: number;
	walkAllowed: boolean;
	driveAllowed: boolean;
	auditedWheelchairAllowed?: boolean;
	oneway?: boolean;
	sourceOsmWayId?: string | number;
	geometry?: [number, number][];
	/** Scenario-only directional permissions. Observed OSM permissions remain unchanged. */
	walkForwardAllowed?: boolean;
	walkReverseAllowed?: boolean;
	driveForwardAllowed?: boolean;
	driveReverseAllowed?: boolean;
	driveForwardDelayMinutes?: number;
	driveReverseDelayMinutes?: number;
}
export interface PlanningDisruption {
	id: string;
	name: string;
	kind: 'closure' | 'delay';
	edgeIds: string[];
	modes: ('bus' | 'walk')[];
	/** Forward follows the stored OSM edge's from→to direction. */
	direction: 'both' | 'forward' | 'reverse';
	startDate: string;
	endDate: string;
	startMinutes: number;
	endMinutes: number;
	delayMinutes?: number;
	provenance: 'observed' | 'assumed';
	sourceIds?: string[];
	sourceUrl?: string;
	evidenceNote?: string;
	enabled?: boolean;
}
export interface PlanningStressCase {
	id: string;
	name: string;
	disruptions: PlanningDisruption[];
}
export interface PlanningFleetFeedback {
	routeId: string;
	name: string;
	policy: 'maintain-frequency' | 'fixed-fleet';
	baselineCycleMinutes: number | null;
	scenarioCycleMinutes: number | null;
	baselineHeadwayMinutes: number | null;
	scenarioHeadwayMinutes: number | null;
	baselineFleet: number | null;
	requiredFleet: number | null;
	additionalFleet: number | null;
	/** Procurement requirement including the same reserve share used by investment economics. */
	baselineProcurementFleet: number | null;
	requiredProcurementFleet: number | null;
	additionalProcurementFleet: number | null;
	additionalCapitalMvr: NumericRange | null;
	eventOperatingMvr: NumericRange | null;
	/** Added transit operating emissions during the event; no inferred private mode shift. */
	eventCarbonKgCo2e: NumericRange | null;
	eventVehicleKm: number | null;
	eventVehicleHours: number | null;
	unavailableReasons: string[];
}
export interface PlanningDisruptionImpact {
	activeEventIds: string[];
	affectedPatternIds: string[];
	blockedPatternIds: string[];
	fleetFeedback: PlanningFleetFeedback[];
	lostAccessResidents: number;
	worsenedJourneyResidents: number;
	method: string;
}
export interface PlanningRobustnessCase {
	id: string;
	name: string;
	baselineReachableResidents: number;
	scenarioReachableResidents: number;
	retainedAccessResidents: number;
	gainedResidents: number;
	lostResidents: number;
	unknownResidents: number;
	additionalFleet: number | null;
	capitalMvr: NumericRange | null;
	annualOperatingMvr: NumericRange | null;
	carbonKgCo2e: NumericRange | null;
}
export interface PlanningFacility extends PlanningPosition {
	id: string;
	name: string;
	kind: 'hospital' | 'clinic' | 'school' | 'college';
	islandId: string;
	verification?: string | boolean;
	sourceIds?: string[];
	operatingStatus?: 'open' | 'closed' | 'relocated' | 'unverified';
	statusReviewedAt?: string;
	statusSourceIds?: string[];
	registryId?: string;
	statusNote?: string;
	careScope?: 'general' | 'specialist' | 'restricted' | 'unverified';
	suitability?: PlanningFacilitySuitability;
	/** Scenario proposals are conditional destinations, never observed facility records. */
	provenance?: 'observed' | 'assumed';
	planningStatus?: 'proposed';
	proposedOpeningDate?: string;
	[key: string]: unknown;
}
export interface PlanningFacilitySuitability {
	healthcareServices?: ('general' | 'emergency' | 'specialist')[];
	schoolLevels?: ('primary' | 'lower-secondary' | 'higher-secondary')[];
	publicAccess?: 'public' | 'restricted' | 'private';
	openingHours?: {
		weekdays: number[];
		startMinutes: number;
		endMinutes: number;
		startDate?: string;
		endDate?: string;
	}[];
	reviewedAt: string;
	sourceIds: string[];
}
export interface PlanningStop extends PlanningPosition {
	id: string;
	name: string;
	islandId: string;
	sourceIds: string[];
	mode?: 'bus' | 'ferry';
	disabled?: boolean;
	/** Explicit operator restriction: drop-off remains permitted but boarding is unavailable. */
	pickupAllowed?: boolean;
}
export interface ServiceCalendar {
	/** JavaScript weekday numbering: 0 Sunday, 6 Saturday. */
	weekdays: number[];
	startDate?: string;
	endDate?: string;
	excludedDates?: string[];
	includedDates?: string[];
}
export interface FrequencyWindow {
	startMinutes: number;
	endMinutes: number;
	headwayMinutes: number;
}
export interface ScheduledTrip {
	id: string;
	/** Minutes since service midnight; values over 1440 represent next-day arrivals. */
	stopTimes: { arrivalMinutes: number; departureMinutes: number }[];
	/** Scenario detour geometry can vary between departures as a road event starts/expires. */
	segmentGeometry?: [number, number][][];
}
export interface PlanningServicePattern {
	id: string;
	routeId: string;
	name: string;
	mode: 'bus' | 'ferry';
	stopIds: string[];
	calendar: ServiceCalendar;
	timing:
		| { kind: 'frequency'; windows: FrequencyWindow[]; segmentMinutes: number[] }
		| { kind: 'scheduled'; trips: ScheduledTrip[] };
	provenance: 'observed' | 'assumed';
	sourceIds: string[];
	fleet?: PlanningFleet;
	enabled?: boolean;
	/** The measured/routed length of this direction, used by operating-cost calculations. */
	distanceM?: number;
	/** Optional polyline produced by the driving graph, [longitude, latitude]. */
	geometry?: [number, number][];
	segmentGeometry?: [number, number][][];
	segmentDistanceM?: number[];
	[key: string]: unknown;
}
export interface NumericRange {
	low: number;
	central: number;
	high: number;
}
export interface PlanningDestinationRequirements {
	healthcareService?: 'general' | 'emergency' | 'specialist';
	schoolLevel?: 'primary' | 'lower-secondary' | 'higher-secondary';
	publicAccess?: 'any' | 'public';
	requireOpenAtDeparture?: boolean;
}
export interface PlanningCoverage {
	status: 'complete' | 'partial' | 'outside-snapshot' | 'unavailable';
	date: string;
	departureMinutes: number;
	observedPatternCount: number;
	assumedPatternCount: number;
	supportedStartMinutes: number | null;
	supportedEndMinutes: number | null;
	label: string;
	reasons: string[];
}
export interface PlanningCostAnchors {
	stopCapitalMvr?: NumericRange | null;
	dieselBusCapitalMvr?: NumericRange | null;
	electricBusCapitalMvr?: NumericRange | null;
	chargingInfrastructureMvr?: NumericRange | null;
	dieselOperatingMvrPerKm?: NumericRange | null;
	electricOperatingMvrPerKm?: NumericRange | null;
	dieselKgCo2ePerKm?: NumericRange | null;
	electricKgCo2ePerKm?: NumericRange | null;
	displacedKgCo2ePerPassengerKm?: NumericRange | null;
	[key: string]: unknown;
}
export interface PlanningBaseline {
	schemaVersion: 1;
	version: string;
	generatedAt: string;
	referenceDate: string;
	facilityAuditVersion?: string;
	sources: PlanningSource[];
	islands: PlanningIsland[];
	origins: PlanningOrigin[];
	network: { nodes: PlanningNode[]; edges: PlanningEdge[] };
	facilities: PlanningFacility[];
	transit: {
		stops: PlanningStop[];
		patterns: PlanningServicePattern[];
		gaps: string[];
		accessStatus?: string;
	};
	costAnchors?: PlanningCostAnchors;
	assumptions?: Record<string, unknown>;
	[key: string]: unknown;
}
export type PlanningAction =
	| { kind: 'add-stop'; stop: PlanningStop }
	| { kind: 'add-facility'; facility: PlanningFacility }
	| { kind: 'move-stop'; stopId: string; position: PlanningPosition; islandId?: string }
	| { kind: 'disable-stop'; stopId: string }
	| { kind: 'enable-stop'; stopId: string }
	| { kind: 'disable-service'; patternId: string }
	| { kind: 'enable-service'; patternId: string }
	| { kind: 'shift-timetable'; patternId: string; minutes: number }
	| {
			kind: 'add-route';
			pattern: PlanningServicePattern;
			returnPattern?: PlanningServicePattern;
			stops?: PlanningStop[];
	  }
	| {
			/** Atomic rerouting of existing directions; original IDs keep later controls valid. */
			kind: 'replace-route';
			patternId: string;
			patterns: PlanningServicePattern[];
			stops?: PlanningStop[];
	  }
	| {
			kind: 'extend-route';
			patternId: string;
			stop: PlanningStop;
			segmentMinutes: number;
			distanceM: number;
			geometry?: [number, number][];
			returnSegmentMinutes?: number;
			returnDistanceM?: number;
			returnGeometry?: [number, number][];
	  }
	| { kind: 'set-frequency'; patternId: string; headwayMinutes: number }
	| { kind: 'set-hours'; patternId: string; startMinutes: number; endMinutes: number }
	| { kind: 'set-fleet'; patternId: string; fleet: PlanningFleet };
export interface PlanningAssumptions {
	date: string;
	departureMinutes: number;
	targetMinutes: number;
	goal: 'healthcare' | 'education';
	destinationRequirements?: PlanningDestinationRequirements;
	walkingRequirements?: { requireAuditedWheelchair?: boolean };
	populationYear: 2026 | 2030;
	disruptions?: PlanningDisruption[];
	fleetResponse?: 'maintain-frequency' | 'fixed-fleet';
	/** Up to three explicit stress cases evaluated with identical population/service inputs. */
	robustnessStresses?: PlanningStressCase[];
	/** Conditional 2030 neighborhood allocation, preserving the official island total. */
	housingDistribution?: { islandId: string; originIds: string[]; share: number }[];
	policyDelivery?: {
		responsibleAgency: string;
		phases: string[];
		outstandingVerification: string[];
	};
	/** User-defined affordability context; never an observed income or demand model. */
	fareAffordability?: {
		oneWayFareMvr: number;
		monthlyTrips: number;
		monthlyHouseholdBudgetMvr: number;
	};
	walkMPerMinute: number;
	maxJourneyMinutes: number;
	maxTransfers: number;
	maxAccessWalkMinutes: number;
	maxTransferWalkMinutes: number;
	maxSnapM: number;
	boardingBufferMinutes: number;
	busMovingKph: number;
	busDwellMinutes: number;
	annualOperatingDays: number;
	layoverMinutes: number;
	fleetReserveShare: number;
	/** Annual displaced passenger-km are user assumptions, independent of accessibility gains. */
	displacedPassengerKm: NumericRange;
	/** Optional editable inputs that reproduce annual displaced passenger-km in saved scenarios. */
	privateTravelInputs?: {
		dailyTrips: NumericRange;
		distanceKm: number;
		occupancy: number;
	};
	costs: PlanningCostAnchors;
	dieselLitresPerVehicleKm?: NumericRange;
	dieselKgCo2ePerLitre?: NumericRange;
	electricKwhPerVehicleKm?: NumericRange;
	gridKgCo2ePerKwh?: NumericRange;
}
export interface JourneyLeg {
	mode: 'walk' | 'bus' | 'ferry';
	from: string;
	to: string;
	minutes: number;
	waitMinutes: number;
	patternId?: string;
	tripId?: string;
	geometry?: [number, number][];
}
export interface PlanningJourney {
	status: 'reachable' | 'unreachable' | 'unavailable';
	minutes: number | null;
	reason: string | null;
	destinationId: string | null;
	path: JourneyLeg[];
	geometry?: [number, number][];
}
export interface OriginComparison {
	originId: string;
	islandId: string;
	population: number;
	before: PlanningJourney;
	after: PlanningJourney;
	/** Positive means time saved; only defined when both journeys are reachable. */
	deltaMinutes: number | null;
	newlyReachable: boolean;
	lostAccess: boolean;
	/** Reachable before and after, but the best modeled journey becomes slower. */
	worsenedJourney: boolean;
	/** A previously computable origin now has unavailable evidence. Not a measured loss. */
	becameUnavailable: boolean;
}
export interface PlanningIslandSummary {
	islandId: string;
	population: number;
	baselineReachableResidents: number;
	scenarioReachableResidents: number;
	gainedResidents: number;
	lostResidents: number;
	unknownResidents: number;
	worsenedJourneyResidents: number;
	becameUnavailableResidents: number;
}
export interface PlanningCosts {
	capitalMvr: NumericRange | null;
	annualOperatingMvr: NumericRange | null;
	annualVehicleKm: number | null;
	annualVehicleHours: number | null;
	requiredFleet: number | null;
	newStops: number;
	unavailableReasons: string[];
}
export interface PlanningCarbon {
	/** Added emissions minus displaced emissions: positive is an increase. */
	low: number | null;
	central: number | null;
	high: number | null;
	addedKgCo2e: NumericRange | null;
	displacedKgCo2e: NumericRange | null;
	breakEvenDisplacedPassengerKm: number | null;
	unavailableReasons: string[];
}
export interface PlanningAnalysis {
	targetMinutes: number;
	departureMinutes: number;
	goal: PlanningAssumptions['goal'];
	coverage: PlanningCoverage;
	islandSummaries: PlanningIslandSummary[];
	versionPins: { dataset: string; model: string; schema: number };
	origins: OriginComparison[];
	priorities: {
		originId: string;
		population: number;
		minutesToHospital: number | null;
		reason: string;
	}[];
	summary: {
		population: number;
		newlyReachedResidents: number;
		lostAccessResidents: number;
		minutesSavedForAlreadyReachable: number | null;
		baselineReachableResidents: number;
		scenarioReachableResidents: number;
		unknownResidents: number;
		worsenedJourneyResidents: number;
		becameUnavailableResidents: number;
	};
	world: {
		stops: PlanningStop[];
		patterns: PlanningServicePattern[];
		facilities: PlanningFacility[];
	};
	costs: PlanningCosts;
	carbon: PlanningCarbon;
	warnings: string[];
	disruptionImpact?: PlanningDisruptionImpact;
	robustness?: {
		normal: PlanningRobustnessCase;
		stresses: PlanningRobustnessCase[];
		worstReachableResidents: number;
		method: string;
	};
	transportAccess: {
		beforeResidents: number;
		afterResidents: number;
		gainedResidents: number;
		lostResidents: number;
		unknownResidents: number;
		population: number;
		beforePct: number | null;
		afterPct: number | null;
		method: string;
	};
}
