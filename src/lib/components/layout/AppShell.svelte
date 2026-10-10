<script lang="ts">
	import { onMount } from 'svelte';
	import { APP_CONFIG } from '#lib/config/app.ts';
	import { findToolByShortcut } from '#lib/config/tools.ts';
	import { createDemoAnalysisProvider } from '#lib/analysis/demoMetrics.ts';
	import { setAnalysisProvider } from '#lib/stores/analysis.ts';
	import type { Baseline } from '#lib/stores/baseline.ts';
	import { ScenarioStore, setScenarioStore } from '#lib/stores/scenario.svelte.ts';
	import { AnalysisGridState, setAnalysisGrid } from '#lib/stores/h3.svelte.ts';
	import { createDemoBaseCells, demoIslandAt } from '#lib/analysis/h3DemoData.ts';
	import { DEFAULT_BUS_STOP_WEIGHTS } from '#lib/config/busStopScoring.ts';
	import { CandidateSearchState, setCandidateSearch } from '#lib/stores/candidates.svelte.ts';
	import { MapState, setMapState } from '#lib/stores/map.svelte.ts';
	import { WeatherState, setWeatherState } from '#lib/stores/weather.svelte.ts';
	import { FeedbackState, setFeedbackState } from '#lib/stores/feedback.svelte.ts';
	import { DemoState, setDemoState } from '#lib/stores/demo.svelte.ts';
	import {
		createLocalFeedbackRepository,
		createLocalObservationRepository
	} from '#lib/data/repositories/local.ts';
	import { UiState, setUiState } from '#lib/stores/ui.svelte.ts';
	import { reconcileSelection } from '#lib/stores/selection.ts';
	import { isTypingTarget } from '#lib/utils/dom.ts';
	import TopHud from '#lib/components/hud/TopHud.svelte';
	import LayerSidebar from '#lib/components/sidebar/LayerSidebar.svelte';
	import InspectorPanel from '#lib/components/inspector/InspectorPanel.svelte';
	import SimulatorToolbar from '#lib/components/toolbar/SimulatorToolbar.svelte';
	import MapStage from './MapStage.svelte';

	let { baseline }: { baseline: Baseline } = $props();

	// The baseline is loaded once per page and never replaced, so reading the initial prop is intended.
	// svelte-ignore state_referenced_locally
	const scenarios = setScenarioStore(new ScenarioStore(baseline));

	// Analysis always runs on the effective (baseline + active scenario) world. Swap the demo
	// provider for a real one once the accessibility engine exists; consumers are unaffected.
	const analysis = $derived(createDemoAnalysisProvider(scenarios.effective));
	setAnalysisProvider({ analyseInfrastructure: (id) => analysis.analyseInfrastructure(id) });
	// svelte-ignore state_referenced_locally
	const analysisGrid = setAnalysisGrid(
		new AnalysisGridState(
			createDemoBaseCells(),
			baseline.infrastructure,
			() => scenarios.effective.infrastructure,
			() => scenarios.analysisSettings.disruption ?? 'normal'
		)
	);
	const ui = setUiState(new UiState());
	const candidateSearch = setCandidateSearch(
		new CandidateSearchState({
			grid: () => analysisGrid.grid,
			infrastructure: () => scenarios.effective.infrastructure,
			routes: () => scenarios.effective.routes,
			weights: () => scenarios.analysisSettings.busStopWeights ?? DEFAULT_BUS_STOP_WEIGHTS,
			islandAt: demoIslandAt
		})
	);
	const mapState = setMapState(new MapState());
	const weather = setWeatherState(new WeatherState());
	// Browser-local for the MVP; swap the repositories for server-backed ones without UI changes.
	setDemoState(new DemoState({ ui, scenarios, analysisGrid, candidateSearch, mapState }));
	const feedback = setFeedbackState(
		new FeedbackState(createLocalObservationRepository(), createLocalFeedbackRepository())
	);

	// Undo, reset, switching scenarios or re-ranking can remove what is selected; drop it then.
	$effect(() => {
		const sel = ui.selection;
		const next = reconcileSelection(sel, {
			hasInfrastructure: (id) => !!scenarios.effective.getInfrastructure(id),
			hasRoute: (id) => !!scenarios.effective.getRoute(id),
			hasCandidateSearch: () => candidateSearch.result !== null,
			hasCandidate: (id) => !!candidateSearch.get(id),
			hasObservation: (id) => !!feedback.getObservation(id)
		});
		if (next !== sel) ui.select(next);
	});

	onMount(() => {
		if (window.innerWidth < APP_CONFIG.panelAutoCollapseWidthPx) {
			ui.setPanelOpen('left', false);
			ui.setPanelOpen('right', false);
		}
		void feedback.load();
		return weather.start();
	});

	function onKeydown(event: KeyboardEvent) {
		// Open menus claim Escape first (they mark it handled during capture).
		if (event.defaultPrevented || isTypingTarget(event.target)) return;
		const mod = event.metaKey || event.ctrlKey;
		const key = event.key.toLowerCase();
		if (mod && !event.altKey && (key === 'z' || key === 'y')) {
			event.preventDefault();
			if (key === 'y' || event.shiftKey) scenarios.redo();
			else scenarios.undo();
			return;
		}
		if (mod || event.altKey) return;

		const tool = findToolByShortcut(event.key);
		if (tool) {
			ui.selectTool(tool.id);
			return;
		}
		if (event.key === '[') ui.togglePanel('left');
		else if (event.key === ']') ui.togglePanel('right');
		else if (event.key === 'Escape') {
			// Step back one layer at a time: tool, selection, compare, candidate search, info view.
			if (ui.cancelPointerTool()) return;
			if (ui.selection) ui.select(null);
			else if (ui.compare) ui.endCompare();
			else if (candidateSearch.origin) candidateSearch.close();
			else ui.setInfoView(null);
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="flex h-dvh w-full flex-col overflow-hidden bg-hud-void text-hud-text select-none">
	<TopHud />
	<div class="relative flex min-h-0 flex-1">
		<LayerSidebar />
		<!-- The map owns exactly the space between the docked panels and resizes with them. -->
		<main class="relative min-w-0 flex-1">
			<MapStage />
			<SimulatorToolbar />
		</main>
		<InspectorPanel />
	</div>
</div>
