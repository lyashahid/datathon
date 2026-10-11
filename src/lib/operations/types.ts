import type { Geometry } from 'geojson';
import type { FerryRuntimeEvidence } from '#lib/planning/ferryAssumption.ts';

export type OperationalStatus = 'ready' | 'partial' | 'unavailable';
export interface OperationalSource {
	id: string;
	title: string;
	publisher: string;
	url: string;
	retrievedAt: string | null;
	checksum: string | null;
	status: 'downloaded' | 'empty' | 'unavailable' | 'cached';
	coverage: string;
	referencePeriod: string;
	units: string;
	licenseStatus: string;
	transformationVersion: string;
	gapReasons: string[];
}

export interface WeatherAlert {
	id: string;
	sourceId: string;
	sourceUrl: string;
	sentAt: string;
	messageType: 'Alert' | 'Update' | 'Cancel';
	references: string[];
	status: 'Actual' | 'Exercise' | 'System' | 'Test' | 'Draft';
	scope: string;
	headline: string;
	description: string;
	instruction: string;
	severity: string;
	urgency: string;
	certainty: string;
	event: string;
	areaLabel: string;
	validFrom: string | null;
	validUntil: string | null;
	geometry: Geometry | null;
	evidenceStatus: 'publisher-issued';
	provenance: 'observed';
	routingEffect: 'advisory-only';
	qualification: string;
}

/** Public observations do not become blocked roads until a planner maps and applies them. */
export interface OperationalRoadEvent {
	id: string;
	sourceId: string;
	sourceUrl: string;
	title: string;
	description: string;
	validFrom: string | null;
	validUntil: string | null;
	geometry: Geometry | null;
	locationLabel: string;
	mode: 'road' | 'marine' | 'unknown';
	evidenceStatus: 'candidate';
	provenance: 'observed';
	routingEffect: 'candidate-only';
	qualification: string;
}

export interface OperationalNoticeCandidate extends OperationalRoadEvent {
	extractionMethod: 'structured-source' | 'rules' | 'ai-assisted';
	extractionStatus: 'needs-mapping-confirmation';
	geographyStatus: 'unmatched' | 'point-only' | 'publisher-polygon';
	supportingText: string;
	publishedAt: string | null;
	confidence: { extraction: 'low' | 'medium' | 'high'; geography: 'unmatched' | 'approximate' };
	missingFields: string[];
}

export interface NationalEvidenceReadiness {
	id: string;
	name: string;
	atoll: string;
	coordinates: [number, number] | null;
	census2022Population: number | null;
	population2026: number | null;
	population2030: number | null;
	sourceIds: string[];
	accessReadiness: 'flagship' | 'population-only';
	routingAvailable: boolean;
	qualification: string;
}

export interface ServiceEvidenceGap {
	id: string;
	mode: 'bus' | 'ferry';
	name: string;
	sourceUrl: string;
	status: 'partial' | 'unavailable';
	missingInputs: string[];
	qualification: string;
}

export interface AnnualImageryMosaic {
	id: string;
	year: 2020 | 2025;
	tileUrl: string;
	tileSize: 256;
	maxZoom: 14;
	sourceId: string;
	attribution: string;
	licenseUrl: string;
}

export interface AnnualImageryEvidence {
	mosaics: AnnualImageryMosaic[];
	interpretation: 'visual-context-only';
	qualification: string;
}

export interface OperationsBundle {
	schemaVersion: 1;
	version: string;
	generatedAt: string;
	status: OperationalStatus;
	stale: boolean;
	sources: OperationalSource[];
	weatherAlerts: WeatherAlert[];
	roadEvents: OperationalRoadEvent[];
	noticeCandidates: OperationalNoticeCandidate[];
	nationalReadiness: NationalEvidenceReadiness[];
	serviceEvidence: ServiceEvidenceGap[];
	ferryEvidence?: FerryRuntimeEvidence;
	earthObservation?: AnnualImageryEvidence;
	gaps: string[];
	profile: 'public-only';
	ai: { enabled: boolean; available: boolean; method: 'rules' | 'ai-assisted'; reason: string };
}
