import {
	Bus,
	CloudSun,
	GitBranch,
	Hospital,
	MousePointer2,
	Plane,
	ScanEye,
	Ship
} from '@lucide/svelte';
import type { SimulatorTool, SimulatorToolId } from '#lib/types/ui.ts';

export const SIMULATOR_TOOLS: readonly SimulatorTool[] = [
	{
		id: 'inspect',
		label: 'Inspect',
		hint: 'Click infrastructure or an area to inspect it',
		icon: MousePointer2,
		shortcut: '1'
	},
	{
		id: 'transport',
		label: 'Transport',
		hint: 'Bus stops, terminals and land routes',
		icon: Bus,
		shortcut: '2'
	},
	{
		id: 'marine',
		label: 'Marine',
		hint: 'Ferry terminals, jetties and sea routes',
		icon: Ship,
		shortcut: '3'
	},
	{
		id: 'air',
		label: 'Air',
		hint: 'Airports, seaplane bases and air links',
		icon: Plane,
		shortcut: '4'
	},
	{
		id: 'services',
		label: 'Services',
		hint: 'Hospitals, health centres and schools',
		icon: Hospital,
		shortcut: '5'
	},
	{
		id: 'weather',
		label: 'Weather',
		hint: 'Wind, waves and marine conditions',
		icon: CloudSun,
		shortcut: '6'
	},
	{
		id: 'infoViews',
		label: 'Info Views',
		hint: 'Accessibility and coverage overlays',
		icon: ScanEye,
		shortcut: '7'
	},
	{
		id: 'scenarios',
		label: 'Scenarios',
		hint: 'Create, compare and save scenarios',
		icon: GitBranch,
		shortcut: '8'
	}
];

export const DEFAULT_TOOL_ID: SimulatorToolId = 'inspect';

export function getTool(id: SimulatorToolId): SimulatorTool {
	const tool = SIMULATOR_TOOLS.find((t) => t.id === id);
	if (!tool) throw new Error(`Unknown simulator tool: ${id}`);
	return tool;
}

export function findToolByShortcut(key: string): SimulatorTool | undefined {
	return SIMULATOR_TOOLS.find((t) => t.shortcut === key);
}
