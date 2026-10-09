<!-- Central map region: the map plus unobtrusive status overlays. -->
<script lang="ts">
	import { MAP_STYLE_URL } from '$app/env/public';
	import MobilityMap from '#lib/map/MobilityMap.svelte';
	import CursorReadout from '#lib/map/CursorReadout.svelte';
	import InfrastructureLayers from '#lib/map/layers/InfrastructureLayers.svelte';
	import PointerToolController from '#lib/map/layers/PointerToolController.svelte';
	import H3Layers from '#lib/map/layers/H3Layers.svelte';
	import CandidateLayers from '#lib/map/layers/CandidateLayers.svelte';
	import { getCandidateSearch } from '#lib/stores/candidates.svelte.ts';
	import H3HoverCard from '#lib/components/map/H3HoverCard.svelte';
	import InfoViewLegend from '#lib/components/map/InfoViewLegend.svelte';
	import EnvironmentLegend from '#lib/components/map/EnvironmentLegend.svelte';
	import EnvironmentLayers from '#lib/map/layers/EnvironmentLayers.svelte';
	import CameraSync from '#lib/map/layers/CameraSync.svelte';
	import ObservationLayers from '#lib/map/layers/ObservationLayers.svelte';
	import { OBSERVATION_LAYER_ID } from '#lib/config/feedback.ts';
	import { getFeedbackState } from '#lib/stores/feedback.svelte.ts';
	import CompareOverlay from '#lib/components/compare/CompareOverlay.svelte';
	import SwipeHandle from '#lib/components/compare/SwipeHandle.svelte';
	import type { CameraPose } from '#lib/types/map.ts';
	import { getWeatherState } from '#lib/stores/weather.svelte.ts';
	import { getInfoView, INFO_VIEW_FADE } from '#lib/config/infoViews.ts';
	import { getAnalysisGrid } from '#lib/stores/h3.svelte.ts';
	import type { CellValueSource, H3Index } from '#lib/types/h3.ts';
	import MovePreview from '#lib/components/map/MovePreview.svelte';
	import PlacementPreview from '#lib/components/map/PlacementPreview.svelte';
	import { demoDensityForIsland, demoScoreCandidate } from '#lib/analysis/demoMetrics.ts';
	import { demoIslandAt } from '#lib/analysis/h3DemoData.ts';
	import { evaluateMove, type MoveEvaluation } from '#lib/simulator/move.ts';
	import {
		evaluatePlacement,
		proposedName,
		type PlacementEvaluation,
		type PlacementHover,
		type PointerHover,
		type RoadCheck
	} from '#lib/simulator/placement.ts';
	import type { Position } from '#lib/types/domain.ts';
	import { getAnalysisProvider } from '#lib/stores/analysis.ts';
	import { getScenarioStore } from '#lib/stores/scenario.svelte.ts';
	import { getMapState } from '#lib/stores/map.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';

	const mapState = getMapState();
	const ui = getUiState();
	const scenarios = getScenarioStore();
	const analysis = getAnalysisProvider();
	const analysisGrid = getAnalysisGrid();
	const candidateSearch = getCandidateSearch();
	const weather = getWeatherState();
	const feedback = getFeedbackState();
	const usingOfflineBasemap = $derived(mapState.basemap?.id === 'offline');

	// Compare mode: baseline overlay (left of the divider) over the scenario map.
	const comparing = $derived(ui.compare && scenarios.active !== null);
	let split = $state(0.5);
	let camera = $state.raw<CameraPose | null>(null);
	$effect(() => {
		if (ui.compare && !scenarios.active) ui.endCompare();
	});
	// Inputs on the left half would edit or inspect the hidden scenario map, so compare is view-only.
	const mapInteractive = $derived(!ui.pointerToolActive && !comparing);

	const infoView = $derived(ui.infoView ? getInfoView(ui.infoView) : null);
	const gridView = $derived(infoView?.layer === 'grid' ? infoView : null);
	const environmentView = $derived(infoView?.layer === 'environment' ? infoView : null);
	// Only the active view's external source is built, so criticality runs only when shown.
	const external = $derived.by((): CellValueSource | null => {
		if (gridView?.metric === 'closureExposure') {
			const exposure = analysisGrid.criticality.exposure;
			return (h) => exposure.get(h)?.drop ?? 0;
		}
		if (gridView?.metric === 'overallChange') {
			const impact =
				gridView.compare === 'disruption' ? analysisGrid.disruptionImpact : analysisGrid.impact;
			return (h) => impact?.get(h)?.delta.overall ?? 0;
		}
		return null;
	});
	const environmentSamples = $derived(
		environmentView?.sample === 'weather'
			? weather.weatherSamples
			: environmentView?.sample === 'marine'
				? weather.marineSamples
				: null
	);
	// Forecast grids are fetched lazily, only once a conditions view is opened.
	$effect(() => {
		if (environmentView) void weather.loadSamples(environmentView.sample);
	});
	const selectedCell = $derived(
		ui.selection?.kind === 'area' && ui.selection.cellIds.length === 1
			? ui.selection.cellIds[0]
			: null
	);
	let cellHover = $state.raw<{ h3Index: H3Index; point: { x: number; y: number } } | null>(null);
	let mapSize = $state({ width: 0, height: 0 });
	const hoveredCell = $derived(cellHover ? analysisGrid.grid.get(cellHover.h3Index) : undefined);

	function selectCell(h3Index: H3Index | null) {
		ui.select(h3Index ? { kind: 'area', cellIds: [h3Index], label: `H3 cell ${h3Index}` } : null);
	}
	const selectedAsset = $derived(
		ui.selection?.kind === 'infrastructure' || ui.selection?.kind === 'route' ? ui.selection : null
	);

	const placementType = $derived(ui.placement?.type ?? null);
	const movingFeature = $derived(
		ui.moving ? (scenarios.effective.getInfrastructure(ui.moving.featureId) ?? null) : null
	);
	let placementHover = $state.raw<PlacementHover | null>(null);
	let moveHover = $state.raw<PointerHover<MoveEvaluation> | null>(null);
	let editError = $state<string | null>(null);

	// Evaluators are rebuilt whenever the scenario changes, so previews reflect the current world.
	const evaluatePlace = $derived.by(() => {
		const type = placementType ?? 'bus_stop';
		const world = scenarios.effective;
		const scoreCandidate = demoScoreCandidate(world);
		return (position: Position, road: RoadCheck) =>
			evaluatePlacement({
				type,
				position,
				infrastructure: world.infrastructure,
				road,
				densityForIsland: demoDensityForIsland,
				islandAt: demoIslandAt,
				scoreCandidate
			});
	});

	const evaluateMoveTo = $derived.by(() => {
		const feature = movingFeature;
		const world = scenarios.effective;
		const scoreCandidate = demoScoreCandidate(world);
		const scoreBefore = feature
			? analysis.analyseInfrastructure(feature.id)?.accessibility
			: undefined;
		return (to: Position, road: RoadCheck): MoveEvaluation => {
			if (!feature || !scoreBefore) throw new Error('No facility is being moved');
			return evaluateMove({
				feature,
				to,
				infrastructure: world.infrastructure,
				road,
				densityForIsland: demoDensityForIsland,
				islandAt: demoIslandAt,
				scoreCandidate,
				scoreBefore
			});
		};
	});

	function commitPlacement(evaluation: PlacementEvaluation) {
		editError = null;
		scenarios.ensureScenario();
		const result = scenarios.addInfrastructure({
			name: proposedName(evaluation.type, scenarios.effective.infrastructure),
			type: evaluation.type,
			position: evaluation.position,
			metadata: {
				...(evaluation.island ? { island: evaluation.island } : {}),
				...(evaluation.atoll ? { atoll: evaluation.atoll } : {})
			}
		});
		if (result.ok) ui.select({ kind: 'infrastructure', id: result.id });
		else editError = result.reason;
	}

	function commitMove(evaluation: MoveEvaluation) {
		editError = null;
		scenarios.ensureScenario();
		const result = scenarios.moveInfrastructure(evaluation.featureId, evaluation.position);
		if (result.ok) ui.cancelMove();
		else editError = result.reason;
	}
</script>

<MobilityMap {mapState} styleUrl={MAP_STYLE_URL}>
	{#snippet layers(map)}
		{#if comparing}<CameraSync {map} onmove={(pose) => (camera = pose)} />{/if}
		<!-- Always the effective world: baseline plus the active scenario's changes. -->
		<InfrastructureLayers
			{map}
			infrastructure={scenarios.effective.infrastructure}
			routes={scenarios.effective.routes}
			deltas={scenarios.effective.infrastructureDeltas}
			selected={selectedAsset}
			visibleLayers={ui.visibleLayers}
			interactive={mapInteractive}
			movingId={movingFeature?.id ?? null}
			fade={infoView ? INFO_VIEW_FADE.infrastructureOpacity : 1}
			clearOnEmptyClick={!infoView}
			onpick={(asset) => ui.select(asset)}
		/>
		<EnvironmentLayers
			{map}
			view={environmentView}
			weatherSamples={weather.weatherSamples}
			marineSamples={weather.marineSamples}
		/>
		<H3Layers
			{map}
			grid={analysisGrid.grid}
			{external}
			view={gridView}
			selected={selectedCell}
			interactive={mapInteractive}
			onhover={(h) => (cellHover = h)}
			onselect={selectCell}
		/>
		<ObservationLayers
			{map}
			observations={feedback.observations}
			visible={ui.visibleLayers.has(OBSERVATION_LAYER_ID)}
			selectedId={ui.selection?.kind === 'observation' ? ui.selection.id : null}
			draft={ui.observationDraft?.position ?? null}
			picking={ui.observationDraft !== null}
			interactive={mapInteractive}
			onselect={(id) => ui.select({ kind: 'observation', id })}
			onlocate={(p) => ui.setObservationPosition(p)}
		/>
		{#if candidateSearch.result}
			<CandidateLayers
				{map}
				candidates={candidateSearch.result.candidates}
				selectedId={ui.selection?.kind === 'candidate' ? ui.selection.id : null}
				interactive={!ui.pointerToolActive}
				onselect={(id) => ui.select({ kind: 'candidate', id })}
			/>
		{/if}
		{#if placementType}
			<PointerToolController
				{map}
				evaluate={evaluatePlace}
				preview={(e) => ({
					type: e.type,
					position: e.position,
					validity: e.validity,
					catchmentRadiusM: e.impact?.catchmentRadiusM ?? null,
					origin: null
				})}
				onhover={(h) => (placementHover = h)}
				oncommit={commitPlacement}
			/>
		{:else if movingFeature}
			{#key movingFeature.id}
				<PointerToolController
					{map}
					evaluate={evaluateMoveTo}
					preview={(e) => ({
						type: e.type,
						position: e.position,
						validity: e.validity,
						catchmentRadiusM: e.catchmentRadiusM,
						origin: e.from
					})}
					onhover={(h) => (moveHover = h)}
					oncommit={commitMove}
				/>
			{/key}
		{/if}
	{/snippet}
</MobilityMap>

{#if comparing && scenarios.active}
	<CompareOverlay
		{split}
		{camera}
		infrastructure={scenarios.baseline.infrastructure}
		routes={scenarios.baseline.routes}
		grid={analysisGrid.baselineGrid}
		view={gridView}
		visibleLayers={ui.visibleLayers}
		fade={infoView ? INFO_VIEW_FADE.infrastructureOpacity : 1}
	/>
	<SwipeHandle bind:split leftLabel="Baseline" rightLabel={scenarios.active.name} />
{/if}

<div
	class="pointer-events-none absolute inset-0"
	bind:clientWidth={mapSize.width}
	bind:clientHeight={mapSize.height}
></div>

{#if gridView}
	<div class="absolute top-3 left-3 z-10">
		<InfoViewLegend
			view={gridView}
			grid={analysisGrid.grid}
			criticality={gridView.metric === 'closureExposure' ? analysisGrid.criticality : null}
			onselectfacility={(id) => ui.select({ kind: 'infrastructure', id })}
		/>
	</div>
{:else if environmentView}
	<div class="absolute top-3 left-3 z-10">
		<EnvironmentLegend
			view={environmentView}
			grid={environmentSamples}
			status={weather.sampleStatus[environmentView.sample]}
		/>
	</div>
{/if}

{#if placementType && placementHover}
	<PlacementPreview hover={placementHover} />
{:else if movingFeature && moveHover}
	<MovePreview hover={moveHover} name={movingFeature.name} />
{:else if gridView && cellHover && hoveredCell}
	<H3HoverCard
		cell={hoveredCell}
		{external}
		view={gridView}
		point={cellHover.point}
		container={mapSize}
	/>
{/if}
{#if editError}
	<div class="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
		<p class="hud-panel rounded px-3 py-1.5 text-xs text-hud-warn" role="alert">{editError}</p>
	</div>
{/if}

<div class="pointer-events-none absolute bottom-8 left-2 z-10 max-md:hidden">
	<CursorReadout cursor={mapState.cursor} />
</div>

{#if mapState.status === 'loading'}
	<div class="pointer-events-none absolute inset-0 z-10 grid place-items-center">
		<span class="animate-pulse hud-label">Loading map</span>
	</div>
{:else if mapState.status === 'error'}
	<div class="absolute inset-x-0 top-3 z-10 flex justify-center px-3">
		<p class="hud-panel rounded px-3 py-1.5 text-xs text-hud-warn" role="alert">
			Map unavailable: {mapState.errorMessage}
		</p>
	</div>
{:else if usingOfflineBasemap}
	<div class="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
		<p
			class="hud-panel rounded-full px-3 py-1 text-[11px] text-hud-warn"
			title={mapState.basemapFailures.map((f) => `${f.basemapId}: ${f.reason}`).join('\n')}
		>
			Basemap unreachable — showing offline background
		</p>
	</div>
{/if}
