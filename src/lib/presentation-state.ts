import type { FeatureCollection } from 'geojson';
import type { PresentationMapScene } from './presentation-map.js';
import type { PlanningOperation } from './planning-map.js';
import type { PolicyLens } from './policy-opportunities.js';
import type { SeaMapState } from './sea-connectivity.js';
import type { AirNetwork } from './air-connectivity.js';

export type PresentationView = {
	scene: PresentationMapScene;
	islandId: string;
	gaps: FeatureCollection;
	coverage: FeatureCollection;
	comparison: FeatureCollection;
	comparisonView: 'current' | 'proposal';
	operations: PlanningOperation[];
	lens: PolicyLens;
	seaState: SeaMapState | null;
	airNetwork: AirNetwork | null;
	showSea: boolean;
	showAir: boolean;
};
