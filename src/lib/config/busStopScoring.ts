/**
 * Bus-stop candidate scoring. Weights express planning priorities and are normalised to sum to
 * 1 before use, so any non-negative set is valid. Every normalisation reference and penalty is
 * here so the model can be audited in one place.
 */

export type BusStopCriterion =
	| 'underservedReached'
	| 'populationCoverage'
	| 'walkingImprovement'
	| 'networkSuitability'
	| 'essentialServices';

export type BusStopWeights = Record<BusStopCriterion, number>;

export const DEFAULT_BUS_STOP_WEIGHTS: BusStopWeights = {
	underservedReached: 0.3,
	populationCoverage: 0.25,
	walkingImprovement: 0.2,
	networkSuitability: 0.15,
	essentialServices: 0.1
};

export const BUS_STOP_CRITERIA: readonly { id: BusStopCriterion; label: string; hint: string }[] = [
	{
		id: 'populationCoverage',
		label: 'Population coverage',
		hint: 'Residents within walking distance who are not already near a stop'
	},
	{
		id: 'underservedReached',
		label: 'Underserved reached (weighted)',
		hint: 'Gap-weighted underserved residents within walking distance'
	},
	{
		id: 'walkingImprovement',
		label: 'Walking improvement',
		hint: 'Average reduction in straight-line distance to the nearest stop'
	},
	{
		id: 'networkSuitability',
		label: 'Network connectivity',
		hint: 'Closeness to an existing bus route, so it can be served without a new route'
	},
	{
		id: 'essentialServices',
		label: 'Essential-service connectivity',
		hint: 'Hospitals, schools and terminals within walking distance'
	}
];

export const BUS_STOP_SCORING = {
	/** Area of interest around the selected cell (same island only). */
	areaRadiusM: 600,
	/** Candidates returned after ranking. */
	topN: 3,
	/**
	 * Ranked candidates are kept at least this far apart, so the top results are distinct
	 * options rather than neighbouring cells of the same spot.
	 */
	minSeparationM: 250,
	/** Residents' walking catchment around a stop (≈ 5-minute walk, straight line). */
	catchmentRadiusM: 300,
	/** Raw values that earn a full 100 on each criterion. */
	fullScore: {
		underservedReached: 150,
		populationCoverage: 2500,
		walkingImprovementM: 300
	},
	/** Distance to an existing bus route: 100 within `fullM`, 0 beyond `zeroM`. */
	network: { fullM: 50, zeroM: 400 },
	/** Points per essential service type within `radiusM`, capped at 100. */
	essentialServices: {
		radiusM: 400,
		points: { hospital: 40, school: 30, ferry_terminal: 30, bus_terminal: 20 }
	},
	/** Assumed distance to a stop for residents whose island has none, so means stay finite. */
	noStopDistanceM: 1500,
	penalties: {
		/** Up to this many points when closer than `minSpacingM` to an existing stop. */
		nearbyStop: { maxPoints: 15, minSpacingM: 400 },
		/** When more than `fromShare` of catchment residents are already near a stop. */
		overlap: { maxPoints: 10, fromShare: 0.5 },
		/** When fewer than `belowResidents` live within the catchment. */
		lowPopulation: { points: 10, belowResidents: 300 }
	}
} as const;

/** Mandatory wording: candidates are scored under assumptions, never "best locations". */
export const CANDIDATE_LABELS = {
	top: 'Highest scoring candidate under selected assumptions',
	ranked: (rank: number) => `Ranked #${rank} under selected assumptions`,
	disclaimer:
		'Scores reflect the selected priorities and an approximate straight-line model. Field verification is required.'
} as const;
