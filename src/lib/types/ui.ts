import type { Component } from 'svelte';
import type { AssetRef } from './domain.ts';

/** Lucide icons and any other icon component share this shape. */
export type IconComponent = Component<{ class?: string; size?: number | string }>;

export type SimulatorToolId =
	'inspect' | 'transport' | 'marine' | 'air' | 'services' | 'weather' | 'infoViews' | 'scenarios';

export interface SimulatorTool {
	id: SimulatorToolId;
	label: string;
	/** One-line hint shown while the tool is active. */
	hint: string;
	icon: IconComponent;
	/** Single keyboard key that activates the tool. */
	shortcut: string;
}

export type LayerGroupId =
	| 'mapLayers'
	| 'population'
	| 'transport'
	| 'health'
	| 'education'
	| 'weather'
	| 'localObservations';

export type LayerId = string;

export interface LayerDefinition {
	id: LayerId;
	label: string;
	defaultVisible: boolean;
}

export interface LayerGroup {
	id: LayerGroupId;
	label: string;
	icon: IconComponent;
	layers: readonly LayerDefinition[];
}

export type PanelSide = 'left' | 'right';

/** What the inspector is showing: a single asset, or (later) an area of H3 cells. */
export type InspectorSelection =
	| AssetRef
	| { kind: 'area'; cellIds: readonly string[]; label: string }
	/** The ranked list from the active bus-stop candidate search. */
	| { kind: 'candidates' }
	/** One candidate from that search, by its generating cell id. */
	| { kind: 'candidate'; id: string }
	/** A local observation, by id. */
	| { kind: 'observation'; id: string };
