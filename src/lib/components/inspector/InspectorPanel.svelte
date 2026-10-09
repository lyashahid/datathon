<script lang="ts">
	import { Crosshair, PanelRightClose, PanelRightOpen } from '@lucide/svelte';
	import { getAnalysisGrid } from '#lib/stores/h3.svelte.ts';
	import { getScenarioStore } from '#lib/stores/scenario.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import ImpactPanel from '#lib/components/impact/ImpactPanel.svelte';
	import DisruptionPanel from '#lib/components/disruption/DisruptionPanel.svelte';
	import ComparisonSummary from '#lib/components/compare/ComparisonSummary.svelte';
	import ObservationForm from '#lib/components/feedback/ObservationForm.svelte';
	import InspectorSelectionView from './InspectorSelectionView.svelte';

	const ui = getUiState();
	const scenarios = getScenarioStore();
	const analysisGrid = getAnalysisGrid();
</script>

{#if ui.rightPanelOpen}
	<aside
		class="relative z-20 flex w-(--hud-inspector-w) shrink-0 flex-col overflow-hidden border-l border-hud-line bg-hud-panel max-sm:absolute max-sm:inset-0 max-sm:w-full max-sm:border-l-0"
		aria-label="Inspector"
	>
		<div class="flex h-9 shrink-0 items-center border-b border-hud-line pr-1 pl-3">
			<span class="flex-1 hud-label">Inspector</span>
			<button
				type="button"
				class="grid size-7 place-items-center rounded text-hud-muted hover:bg-hud-hover hover:text-hud-text"
				onclick={() => ui.togglePanel('right')}
				aria-label="Collapse inspector"
				aria-expanded="true"
				title="Toggle inspector  ]"
			>
				<PanelRightClose class="size-4" />
			</button>
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if ui.observationDraft}
				<ObservationForm />
			{:else if ui.compare && scenarios.active}
				<div class="p-3">
					<ComparisonSummary
						summary={analysisGrid.impact.summary}
						scenarioName={scenarios.active.name}
						conditionsLabel={analysisGrid.disruptionImpact ? analysisGrid.disruption.label : null}
						onclose={() => ui.endCompare()}
					/>
				</div>
			{:else if ui.selection}
				<InspectorSelectionView selection={ui.selection} />
			{:else if analysisGrid.disruptionImpact || (scenarios.active && analysisGrid.impact.hasChanges)}
				<div class="flex flex-col gap-4 p-3">
					{#if analysisGrid.disruptionImpact}
						<DisruptionPanel
							disruption={analysisGrid.disruption}
							impact={analysisGrid.disruptionImpact}
							onshowmap={() => ui.setInfoView('disruptionImpact')}
						/>
					{/if}
					{#if scenarios.active && analysisGrid.impact.hasChanges}
						<ImpactPanel
							summary={analysisGrid.impact.summary}
							title="Scenario impact"
							subtitle="Baseline → {scenarios.active.name}{analysisGrid.disruptionImpact
								? `, both under ${analysisGrid.disruption.shortLabel.toLowerCase()} disruption`
								: ''}"
							onshowmap={() => ui.setInfoView('scenarioImpact')}
						/>
					{/if}
					<p class="flex items-center gap-1.5 text-[11px] text-hud-faint">
						<Crosshair class="size-3.5" /> Select a facility or cell for local detail.
					</p>
				</div>
			{:else}
				<div class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
					<Crosshair class="size-5 text-hud-faint" />
					<p class="text-xs text-hud-muted">Select an area or infrastructure</p>
					<p class="text-[11px] text-hud-faint">Use Inspect (1) and click on the map.</p>
				</div>
			{/if}
		</div>
	</aside>
{:else}
	<aside
		class="relative z-20 flex w-(--hud-rail-w) shrink-0 justify-center border-l border-hud-line bg-hud-panel"
		aria-label="Inspector (collapsed)"
	>
		<div class="flex h-9 items-center">
			<button
				type="button"
				class="grid size-7 place-items-center rounded text-hud-muted hover:bg-hud-hover hover:text-hud-text"
				onclick={() => ui.togglePanel('right')}
				aria-label="Expand inspector"
				aria-expanded="false"
				title="Toggle inspector  ]"
			>
				<PanelRightOpen class="size-4" />
			</button>
		</div>
	</aside>
{/if}
