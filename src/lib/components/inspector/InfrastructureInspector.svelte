<!-- Structured planning view for one infrastructure feature. Pure presentation of analysis results. -->
<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { INFRASTRUCTURE_TYPE_STYLES } from '#lib/config/infrastructure.ts';
	import { infrastructureActions, type InspectorActionId } from '#lib/config/inspector.ts';
	import { CURSOR_COORDINATE_DECIMALS } from '#lib/config/map.ts';
	import { getAnalysisProvider } from '#lib/stores/analysis.ts';
	import { haversineM } from '#lib/analysis/geo.ts';
	import { assetStateLabels } from '#lib/simulator/assetState.ts';
	import { localImpact } from '#lib/analysis/impact.ts';
	import { IMPACT_CONFIG } from '#lib/config/impact.ts';
	import { getAnalysisGrid } from '#lib/stores/h3.svelte.ts';
	import { getScenarioStore } from '#lib/stores/scenario.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import type { InfrastructureFeature } from '#lib/types/domain.ts';
	import { formatDistance, formatLatLng } from '#lib/utils/format.ts';
	import MarkerGlyph from '#lib/components/legend/MarkerGlyph.svelte';
	import AssetBadges from './AssetBadges.svelte';
	import MetadataTable from './MetadataTable.svelte';
	import CoverageSection from './sections/CoverageSection.svelte';
	import FindingsSection from './sections/FindingsSection.svelte';
	import InspectorActions from './sections/InspectorActions.svelte';
	import NearbyServicesSection from './sections/NearbyServicesSection.svelte';
	import ScoreCard from './sections/ScoreCard.svelte';
	import ImpactPanel from '#lib/components/impact/ImpactPanel.svelte';
	import CriticalitySection from '#lib/components/criticality/CriticalitySection.svelte';
	import FeedbackSection from '#lib/components/feedback/FeedbackSection.svelte';

	let { feature }: { feature: InfrastructureFeature } = $props();

	const provider = getAnalysisProvider();
	const scenarios = getScenarioStore();
	const analysis = $derived(provider.analyseInfrastructure(feature.id));
	const style = $derived(INFRASTRUCTURE_TYPE_STYLES[feature.type]);
	const [lng, lat] = $derived(feature.geometry.coordinates);

	const ui = getUiState();
	const delta = $derived(scenarios.effective.infrastructureDeltas.get(feature.id));
	const states = $derived(assetStateLabels(feature.status, delta));
	const movedBy = $derived(
		delta?.originalPosition
			? haversineM(delta.originalPosition, feature.geometry.coordinates)
			: null
	);
	const isMoving = $derived(ui.moving?.featureId === feature.id);

	const analysisGrid = getAnalysisGrid();
	// Residents near the facility now, and near its baseline spot if it moved.
	const local = $derived.by(() => {
		if (!analysisGrid.impact.hasChanges) return null;
		const centres = [feature.geometry.coordinates];
		if (delta?.originalPosition) centres.push(delta.originalPosition);
		return localImpact(analysisGrid.impact, feature.id, centres);
	});
	// Disabled facilities are not assessed: closing them again changes nothing.
	const criticality = $derived(
		feature.status === 'disabled' ? undefined : analysisGrid.criticality.get(feature.id)
	);
	const actions = $derived(infrastructureActions({ status: feature.status, isMoving }));

	let actionError = $state<string | null>(null);
	let breakdownOpen = $state(false);
	let attributesOpen = $state(false);
	let scoreEl: HTMLDivElement | undefined = $state();

	function onAction(id: InspectorActionId) {
		actionError = null;
		const target = { kind: 'infrastructure', id: feature.id } as const;
		if (id === 'analyse') {
			breakdownOpen = true;
			scoreEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		} else if (id === 'move') {
			ui.startMove(feature.id);
		} else if (id === 'cancelMove') {
			ui.cancelMove();
		} else if (id === 'disable' || id === 'restore') {
			// Editing from the baseline view starts a scenario; the baseline itself never changes.
			scenarios.ensureScenario();
			const result =
				id === 'disable' ? scenarios.disableAsset(target) : scenarios.restoreAsset(target);
			if (!result.ok) actionError = result.reason;
		}
	}
</script>

<div class="flex min-h-full flex-col">
	<div class="flex flex-1 flex-col gap-4 p-3">
		<header class="flex flex-col gap-2">
			<div>
				<div class="flex items-center gap-1.5">
					<MarkerGlyph shape={style.shape} color={style.color} size={12} />
					<span class="hud-label">{style.label}</span>
				</div>
				<h2 class="mt-1 text-sm leading-snug font-semibold">{feature.name}</h2>
				<p class="mt-0.5 font-mono text-[10px] text-hud-faint tabular-nums">
					{formatLatLng(lng, lat, CURSOR_COORDINATE_DECIMALS)}
					{#if feature.metadata.island}· {feature.metadata.island}{/if}
				</p>
			</div>
			<AssetBadges {states} source={feature.source} />
			{#if delta?.origin === 'scenario'}
				<p class="text-[11px] text-hud-muted">Proposed in this scenario.</p>
			{:else if movedBy !== null}
				<p class="text-[11px] text-hud-muted">
					Moved {formatDistance(movedBy)} from its baseline position (dashed line on the map).
				</p>
			{/if}
			{#if isMoving}
				<p class="text-[11px] text-hud-accent">
					Click the map to choose a new position · Esc to cancel
				</p>
			{/if}
		</header>

		{#if analysis}
			{#if feature.status === 'disabled'}
				<p class="rounded border border-hud-line px-2 py-1.5 text-[11px] text-hud-muted">
					Out of service in this scenario. Figures below show it as if it were operating; other
					facilities' analyses already exclude it.
				</p>
			{/if}
			<div bind:this={scoreEl} class="scroll-mt-3">
				<ScoreCard
					breakdown={analysis.accessibility}
					method={analysis.method}
					provenance={analysis.provenance}
					bind:expanded={breakdownOpen}
				/>
			</div>
			{#if local}
				<ImpactPanel
					summary={local.summary}
					title="Local scenario impact"
					subtitle="Residents within {formatDistance(
						IMPACT_CONFIG.localImpactRadiusM
					)}{delta?.originalPosition ? ' of its old or new position' : ''}"
					compact
				/>
			{/if}
			{#if criticality}
				<CriticalitySection
					{criticality}
					assessedCount={analysisGrid.criticality.facilities.length}
					onshowmap={() => ui.setInfoView('closureExposure')}
				/>
			{/if}
			<CoverageSection coverage={analysis.coverage} />
			<NearbyServicesSection nearby={analysis.nearby} />
			<FindingsSection
				title="Potential strengths"
				tone="strength"
				findings={analysis.strengths}
				emptyText="No notable strengths from the current metrics."
			/>
			<FindingsSection
				title="Potential concerns"
				tone="concern"
				findings={analysis.concerns}
				emptyText="No concerns flagged by the current metrics."
			/>
		{:else}
			<p class="text-[11px] text-hud-faint">No analysis available for this feature.</p>
		{/if}

		<FeedbackSection
			featureId={feature.id}
			technicalScore={analysis?.accessibility.score ?? null}
		/>

		<section>
			<button
				type="button"
				class="flex w-full items-center gap-1 hud-label hover:text-hud-muted"
				aria-expanded={attributesOpen}
				onclick={() => (attributesOpen = !attributesOpen)}
			>
				<ChevronDown class="size-3 transition-transform {attributesOpen ? 'rotate-180' : ''}" />
				Attributes
			</button>
			{#if attributesOpen}
				<div class="mt-2 flex flex-col gap-2">
					<MetadataTable
						metadata={feature.metadata}
						syntheticFields={feature.source.syntheticFields}
					/>
					{#if feature.source.note}
						<p class="text-[10px] leading-relaxed text-hud-faint">{feature.source.note}</p>
					{/if}
				</div>
			{/if}
		</section>
	</div>

	<div class="sticky bottom-0 border-t border-hud-line bg-hud-panel p-2 backdrop-blur-md">
		{#if actionError}
			<p class="mb-1.5 text-[11px] text-hud-warn" role="alert">{actionError}</p>
		{/if}
		<InspectorActions {actions} onaction={onAction} />
	</div>
</div>
