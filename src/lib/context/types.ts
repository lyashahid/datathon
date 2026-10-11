/** Auxiliary observations are kept outside the versioned policy routing model. */
export interface ContextSource {
	id: string;
	title: string;
	url: string;
	publisher: string;
	referencePeriod: string;
	retrievedAt: string;
	checksum: string;
	coverage: string;
	units: string;
	licenseStatus: string;
	transformationVersion: string;
}

export interface VesselObservation {
	id: string;
	name: string;
	type: string;
	operator?: string;
	coordinates: [number, number] | null;
	speedKnots: number | null;
	headingDeg: number | null;
	observedAtRaw: string | null;
	observedTimezone: string | null;
	lastSeenLabel?: string;
	locationLabel?: string;
	sourceUrl: string;
	retrievedAt: string;
}

export interface PortCall {
	id: string;
	vesselName: string;
	activity: string;
	date: string | null;
	berth: string | null;
	sourceId: string;
	rawDate?: string;
	timezoneStatus?: string;
	qualityFlags?: string[];
}

export interface TransportObservation {
	id: string;
	metric: string;
	value: number;
	unit: string;
	refPeriod: string;
	geography: string;
	sourceId: string;
	seriesId?: string;
	definition?: string;
	aggregation?: 'published-total' | 'reported-month';
}

export interface ContextDataset<T> {
	enabled: boolean;
	status: 'available' | 'partial' | 'unavailable' | 'disabled';
	version: string | null;
	generatedAt: string | null;
	stale: boolean;
	gapReasons: string[];
	sources: ContextSource[];
	records: T[];
}

export interface TransportContext {
	schemaVersion: 1;
	version: string;
	generatedAt: string;
	followme: ContextDataset<VesselObservation>;
	mpl: ContextDataset<PortCall> & { observations: TransportObservation[] };
	aviation: ContextDataset<TransportObservation>;
}
