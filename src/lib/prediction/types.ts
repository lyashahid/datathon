export type MonthlyModel = 'last-month' | 'seasonal-naive' | 'mean-3-months' | 'mean-6-months';
export interface PassengerSeries {
	id: string;
	name: string;
	mode: 'bus' | 'ferry';
	geography: string;
	lastActualMonth: string;
	unit: 'passenger movements';
	sourceUrl: string;
	points: Array<{ month: string; value: number }>;
	qualification: string;
}
export interface BusPosition {
	id: string;
	latitude: number;
	longitude: number;
}
export interface BusSnapshot {
	receivedAt: string;
	vehicles: BusPosition[];
	repeatedPayload?: boolean;
}
export interface BusObservationReplay {
	sourceUrl: string;
	routeId: string;
	routeName?: string;
	measurementTimestampAvailable: false;
	snapshots: BusSnapshot[];
	qualification: string;
}
export interface BusCaptureReceipt {
	status: 'collecting' | 'completed';
	sourceUrl: string;
	routeId: string;
	startedAt: string;
	completedAt?: string;
	firstReceivedAt?: string;
	lastReceivedAt?: string;
	snapshots: number;
	vehicles: number;
	observedDays: number;
	changedPositionIntervals: number;
	measurementTimestampAvailable: false;
	qualification: string;
	redistributionLicence: string;
}
export interface PredictionSource {
	version: 1;
	asOf: string;
	sourceIds: string[];
	dataQualityNotes: string[];
	series: PassengerSeries[];
	audit: Record<string, unknown>;
	busObservationReplay?: BusObservationReplay;
}
export interface EvaluationMetrics {
	mae: number;
	wape: number | null;
	n: number;
	firstTargetMonth: string;
	lastTargetMonth: string;
	horizonMonths: number;
	qualification: string;
}
export interface ModelCard {
	target: string;
	intendedUse: string;
	excludedUses: string[];
	trainingCutoff: string | null;
	evaluation: string;
	limitations: string[];
}
export interface MonthlyForecast {
	seriesId: string;
	name: string;
	mode: 'bus' | 'ferry';
	geography: string;
	unit: 'passenger movements';
	sourceUrl: string;
	lastActualMonth: string;
	forecastMonth: string;
	horizonMonths: number;
	status: 'exploratory' | 'unavailable';
	estimate: number | null;
	empiricalRange: {
		lower: number;
		upper: number;
		label: string;
		residualCount: number;
		historicalCoverage: number;
	} | null;
	model: MonthlyModel | null;
	evaluation: EvaluationMetrics | null;
	benchmarks: Array<{ model: MonthlyModel; metrics: EvaluationMetrics; estimate?: number | null }>;
	history: Array<{ month: string; value: number }>;
	backtest: Array<{
		trainingCutoff: string;
		targetMonth: string;
		estimate: number;
		actual: number;
		error: number;
	}>;
	projections: Array<{ month: string; estimate: number }>;
	qualification: string;
	unavailableReason: string | null;
	modelCard: ModelCard;
}
export interface BusReadiness {
	status: 'unavailable' | 'collecting' | 'dated-replay';
	qualification: string;
	coverage: {
		snapshots: number;
		vehicles: number;
		observedDays: number;
		changedPositionIntervals: number;
		firstReceivedAt: string | null;
		lastReceivedAt: string | null;
		sourceMeasurementTimestampAvailable: false;
	};
	replay: BusObservationReplay | null;
	modelCard: ModelCard;
}
export interface ForecastBundle {
	generatedAt: string;
	sourceAsOf: string;
	sourceIds: string[];
	dataQualityNotes: string[];
	monthly: MonthlyForecast[];
	bus: BusReadiness;
	target?: ForecastTarget;
	provenance?: ForecastProvenance;
}
export interface ForecastTarget {
	month: string;
	currentMonthMvt: string;
	kind: 'nowcast' | 'future' | 'retrospective-preview';
}
export interface ForecastProvenance {
	modelVersion: string;
	transformVersion: string;
	checkedAt: string;
	latestPublicationDate: string;
	revisionQualification: string;
	sources: Array<{ id: string; url: string; sha256: string; publicationSheet: string }>;
}
export interface ForecastIssue {
	version: 1;
	id: string;
	issuedAt: string;
	issueDateMvt: string;
	target: ForecastTarget;
	sourceFingerprint: string;
	sourceAsOf: string;
	provenance: ForecastProvenance;
	forecasts: MonthlyForecast[];
	integritySha256: string;
}
export interface ForecastScore {
	seriesId: string;
	status: 'pending' | 'later-vintage-score' | 'ineligible';
	actual: number | null;
	absoluteError: number | null;
	benchmarkErrors: Array<{ model: MonthlyModel; absoluteError: number }>;
	rangeCovered: boolean | null;
	qualification: string;
}
export interface ForecastIssueView {
	issue: ForecastIssue;
	scoredAgainst: { sourceFingerprint: string; publicationDate: string; checkedAt: string };
	scores: ForecastScore[];
	recordedScores?: Array<{
		recordedAt: string;
		scoredAgainst: ForecastIssueView['scoredAgainst'];
		scores: ForecastScore[];
	}>;
}
