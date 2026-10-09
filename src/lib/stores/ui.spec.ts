import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_ID, SIMULATOR_TOOLS, findToolByShortcut } from '#lib/config/tools.ts';
import { UiState } from './ui.svelte.ts';

describe('UiState', () => {
	it('starts on the default tool with both panels open', () => {
		const ui = new UiState();
		expect(ui.activeTool).toBe(DEFAULT_TOOL_ID);
		expect(ui.leftPanelOpen).toBe(true);
		expect(ui.rightPanelOpen).toBe(true);
	});

	it('selects tools', () => {
		const ui = new UiState();
		ui.selectTool('marine');
		expect(ui.activeTool).toBe('marine');
	});

	it('toggles panels independently', () => {
		const ui = new UiState();
		ui.togglePanel('left');
		expect(ui.leftPanelOpen).toBe(false);
		expect(ui.rightPanelOpen).toBe(true);
		ui.togglePanel('left');
		expect(ui.leftPanelOpen).toBe(true);
	});

	it('reveals a layer group by opening the sidebar and expanding it', () => {
		const ui = new UiState({ leftPanelOpen: false });
		ui.revealLayerGroup('health');
		expect(ui.leftPanelOpen).toBe(true);
		expect(ui.expandedLayerGroups.has('health')).toBe(true);
	});

	it('toggles layer visibility', () => {
		const ui = new UiState();
		const before = ui.visibleLayers.has('h3Grid');
		ui.toggleLayer('h3Grid');
		expect(ui.visibleLayers.has('h3Grid')).toBe(!before);
	});

	it('enters and leaves placement mode', () => {
		const ui = new UiState();
		ui.startPlacement('bus_stop');
		expect(ui.activeTool).toBe('transport');
		expect(ui.placement).toEqual({ type: 'bus_stop' });
		ui.selectTool('transport');
		expect(ui.placement).not.toBeNull();
		ui.selectTool('inspect');
		expect(ui.placement).toBeNull();
	});

	it('keeps placing and moving mutually exclusive', () => {
		const ui = new UiState();
		ui.startPlacement('bus_stop');
		ui.startMove('a');
		expect(ui.placement).toBeNull();
		expect(ui.moving).toEqual({ featureId: 'a' });
		expect(ui.selection).toEqual({ kind: 'infrastructure', id: 'a' });
		ui.startPlacement('bus_stop');
		expect(ui.moving).toBeNull();
		expect(ui.cancelPointerTool()).toBe(true);
		expect(ui.cancelPointerTool()).toBe(false);
	});

	it('opens the inspector when something is selected', () => {
		const ui = new UiState({ rightPanelOpen: false });
		ui.select({ kind: 'infrastructure', id: 'x' });
		expect(ui.rightPanelOpen).toBe(true);
	});
});

describe('compare mode', () => {
	it('is view-only: entering clears tools and selection, editing tools leave it', () => {
		const ui = new UiState();
		ui.startPlacement('bus_stop');
		ui.select({ kind: 'infrastructure', id: 'hp-igmh' });
		ui.startCompare();
		expect(ui.compare).toBe(true);
		expect(ui.pointerToolActive).toBe(false);
		expect(ui.selection).toBeNull();

		ui.startPlacement('bus_stop');
		expect(ui.compare).toBe(false);
		ui.startCompare();
		ui.startMove('hp-igmh');
		expect(ui.compare).toBe(false);
		ui.startCompare();
		ui.endCompare();
		expect(ui.compare).toBe(false);
	});
});

describe('simulator tool config', () => {
	it('has unique ids and shortcuts', () => {
		expect(new Set(SIMULATOR_TOOLS.map((t) => t.id)).size).toBe(SIMULATOR_TOOLS.length);
		expect(new Set(SIMULATOR_TOOLS.map((t) => t.shortcut)).size).toBe(SIMULATOR_TOOLS.length);
	});

	it('resolves shortcuts', () => {
		expect(findToolByShortcut('3')?.id).toBe('marine');
		expect(findToolByShortcut('x')).toBeUndefined();
	});
});
