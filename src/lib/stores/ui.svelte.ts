import { createContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { DEFAULT_EXPANDED_GROUPS, defaultVisibleLayerIds } from '#lib/config/layers.ts';
import { PLACEABLE_TYPES } from '#lib/config/placement.ts';
import { DEFAULT_TOOL_ID } from '#lib/config/tools.ts';
import { OBSERVATION_LAYER_ID } from '#lib/config/feedback.ts';
import type { InfrastructureType, Position } from '#lib/types/domain.ts';
import type { InfoViewId } from '#lib/types/h3.ts';
import type {
	InspectorSelection,
	LayerGroupId,
	LayerId,
	PanelSide,
	SimulatorToolId
} from '#lib/types/ui.ts';

export interface UiStateInit {
	activeTool?: SimulatorToolId;
	leftPanelOpen?: boolean;
	rightPanelOpen?: boolean;
}

/**
 * Presentation state only (tool, panels, layer toggles, selection).
 * Scenario and analysis state live elsewhere and must not depend on this.
 */
export class UiState {
	activeTool = $state<SimulatorToolId>(DEFAULT_TOOL_ID);
	leftPanelOpen = $state(true);
	rightPanelOpen = $state(true);
	selection = $state<InspectorSelection | null>(null);
	/** Non-null while the user is placing a new facility on the map. */
	placement = $state<{ type: InfrastructureType } | null>(null);
	/** Analytical overlay currently shown over the map, if any. */
	infoView = $state<InfoViewId | null>(null);
	/** Non-null while the user is choosing a new position for an existing facility. */
	moving = $state<{ featureId: string } | null>(null);
	/** Baseline-vs-scenario swipe view. Read-only: it never edits either side. */
	compare = $state(false);
	/** Non-null while recording an observation; position is null until the map is clicked. */
	observationDraft = $state.raw<{ position: Position | null } | null>(null);

	/** True while placing, moving or locating an observation: map clicks belong to that tool. */
	get pointerToolActive(): boolean {
		return this.placement !== null || this.moving !== null || this.observationDraft !== null;
	}
	readonly expandedLayerGroups = new SvelteSet<LayerGroupId>(DEFAULT_EXPANDED_GROUPS);
	readonly visibleLayers = new SvelteSet<LayerId>(defaultVisibleLayerIds());

	constructor(init: UiStateInit = {}) {
		this.activeTool = init.activeTool ?? DEFAULT_TOOL_ID;
		this.leftPanelOpen = init.leftPanelOpen ?? true;
		this.rightPanelOpen = init.rightPanelOpen ?? true;
	}

	selectTool(id: SimulatorToolId): void {
		this.activeTool = id;
		if (this.placement && !PLACEABLE_TYPES[id]?.includes(this.placement.type)) {
			this.placement = null;
		}
		this.moving = null;
	}

	/** Enters placement mode, switching to the tool that owns the type. */
	startPlacement(type: InfrastructureType): void {
		const tool = (Object.keys(PLACEABLE_TYPES) as SimulatorToolId[]).find((t) =>
			PLACEABLE_TYPES[t]?.includes(type)
		);
		if (tool) this.activeTool = tool;
		this.moving = null;
		this.compare = false;
		this.observationDraft = null;
		this.placement = { type };
	}

	cancelPlacement(): void {
		this.placement = null;
	}

	/** Picks up a facility to move; it stays selected so the inspector keeps context. */
	startMove(featureId: string): void {
		this.placement = null;
		this.compare = false;
		this.observationDraft = null;
		this.moving = { featureId };
		this.select({ kind: 'infrastructure', id: featureId });
	}

	cancelMove(): void {
		this.moving = null;
	}

	/** Starts recording an observation; the next map click sets (or resets) its location. */
	startObservation(): void {
		this.placement = null;
		this.moving = null;
		this.compare = false;
		this.selection = null;
		this.visibleLayers.add(OBSERVATION_LAYER_ID);
		this.observationDraft = { position: null };
	}

	setObservationPosition(position: Position): void {
		if (this.observationDraft) this.observationDraft = { position };
	}

	cancelObservation(): void {
		this.observationDraft = null;
	}

	/** Compare is a viewing mode, so it leaves any editing tool and clears the selection. */
	startCompare(): void {
		this.placement = null;
		this.moving = null;
		this.selection = null;
		this.compare = true;
	}

	endCompare(): void {
		this.compare = false;
	}

	setInfoView(id: InfoViewId | null): void {
		this.infoView = id;
		// Cell selections only make sense while a grid view is showing.
		if (!id && this.selection?.kind === 'area') this.selection = null;
	}

	/** Esc: leave whichever pointer tool is active. Returns false if none was. */
	cancelPointerTool(): boolean {
		if (!this.pointerToolActive) return false;
		this.placement = null;
		this.moving = null;
		this.observationDraft = null;
		return true;
	}

	isPanelOpen(side: PanelSide): boolean {
		return side === 'left' ? this.leftPanelOpen : this.rightPanelOpen;
	}

	setPanelOpen(side: PanelSide, open: boolean): void {
		if (side === 'left') this.leftPanelOpen = open;
		else this.rightPanelOpen = open;
	}

	togglePanel(side: PanelSide): void {
		this.setPanelOpen(side, !this.isPanelOpen(side));
	}

	toggleLayerGroup(id: LayerGroupId): void {
		if (this.expandedLayerGroups.has(id)) this.expandedLayerGroups.delete(id);
		else this.expandedLayerGroups.add(id);
	}

	/** Opens the sidebar focused on one group — used by the collapsed icon rail. */
	revealLayerGroup(id: LayerGroupId): void {
		this.leftPanelOpen = true;
		this.expandedLayerGroups.add(id);
	}

	toggleLayer(id: LayerId): void {
		if (this.visibleLayers.has(id)) this.visibleLayers.delete(id);
		else this.visibleLayers.add(id);
	}

	select(selection: InspectorSelection | null): void {
		this.selection = selection;
		if (selection) this.rightPanelOpen = true;
	}
}

export const [getUiState, setUiState] = createContext<UiState>();
