import type { LineString, Point, Position } from 'geojson';

export const INFRASTRUCTURE_TYPES = [
	'bus_stop',
	'bus_terminal',
	'ferry_terminal',
	'airport',
	'hospital',
	'school',
	'government_service'
] as const;
export type InfrastructureType = (typeof INFRASTRUCTURE_TYPES)[number];

/** Lifecycle of any baseline or scenario asset. */
export const ASSET_STATUSES = ['existing', 'proposed', 'disabled'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export type InfrastructureStatus = AssetStatus;
export type RouteStatus = AssetStatus;

export const TRANSPORT_MODES = ['bus', 'ferry'] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

/**
 * Where a value comes from. Kept on every record so the UI can always separate
 * real observations from demo data, assumptions and simulation output.
 */
export const PROVENANCES = ['observed', 'demo', 'assumed', 'simulated'] as const;
export type Provenance = (typeof PROVENANCES)[number];

export interface SourceInfo {
	provenance: Provenance;
	/** Dataset or system the record came from. */
	dataset: string;
	/** Metadata keys whose values are synthetic even if the record itself is plausible. */
	syntheticFields: readonly string[];
	note?: string;
	reference?: string;
}

export type MetadataValue = string | number | boolean | null;

/** Free-form descriptive attributes. Known keys are typed; others are allowed for extensibility. */
export interface AssetMetadata {
	island?: string;
	atoll?: string;
	operator?: string;
	[key: string]: MetadataValue | undefined;
}

/** Filled by the analysis module later; never authored by hand or by AI. */
export interface InfrastructureMetrics {
	catchmentPopulation?: number;
	nearestSameTypeDistanceM?: number;
	computedAt?: string;
}

export type InfrastructureId = string;
export type RouteId = string;

export interface InfrastructureFeature {
	id: InfrastructureId;
	name: string;
	type: InfrastructureType;
	status: InfrastructureStatus;
	geometry: Point;
	source: SourceInfo;
	metadata: AssetMetadata;
	metrics?: InfrastructureMetrics;
}

export interface TransportRoute {
	id: RouteId;
	name: string;
	mode: TransportMode;
	status: RouteStatus;
	geometry: LineString;
	/** Ordered infrastructure ids served by the route. */
	stopIds: readonly InfrastructureId[];
	source: SourceInfo;
	metadata: AssetMetadata;
}

export interface DatasetInfo {
	id: string;
	title: string;
	version: string;
	provenance: Provenance;
	description: string;
}

export interface InfrastructureCollection {
	dataset: DatasetInfo;
	features: readonly InfrastructureFeature[];
}

export interface RouteCollection {
	dataset: DatasetInfo;
	routes: readonly TransportRoute[];
}

/** Reference to any editable asset; used by scenario changes and selection. */
export type AssetRef =
	{ kind: 'infrastructure'; id: InfrastructureId } | { kind: 'route'; id: RouteId };

export type { Position };
