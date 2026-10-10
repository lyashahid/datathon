<!-- HUD control for the planning disruption every accessibility score is computed under. -->
<script lang="ts">
	import { Check, ChevronDown, Waves } from '@lucide/svelte';
	import { DISRUPTION_LABELS, DISRUPTION_SCENARIOS } from '#lib/config/disruptionScenarios.ts';
	import { getAnalysisGrid } from '#lib/stores/h3.svelte.ts';
	import { getScenarioStore } from '#lib/stores/scenario.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import type { DisruptionId } from '#lib/types/disruption.ts';

	const scenarios = getScenarioStore();
	const analysisGrid = getAnalysisGrid();
	const ui = getUiState();

	let open = $state(false);
	let root: HTMLDivElement | undefined = $state();
	const current = $derived(analysisGrid.disruption);
	const disrupted = $derived(current.id !== 'normal');

	function choose(id: DisruptionId) {
		scenarios.setAnalysisSettings({ disruption: id });
		if (id === 'normal' && ui.infoView === 'disruptionImpact') ui.setInfoView(null);
		ui.select(null);
		open = false;
	}

	function onWindowPointerDown(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window
	onpointerdown={onWindowPointerDown}
	onkeydowncapture={(e) => {
		if (open && e.key === 'Escape') {
			e.preventDefault();
			open = false;
		}
	}}
/>

<div class="relative shrink-0" bind:this={root}>
	<button
		type="button"
		class="flex h-7 items-center gap-2 rounded border px-2 text-xs transition-colors {disrupted
			? 'border-hud-warn/50 bg-hud-warn/10 text-hud-warn'
			: 'border-hud-line bg-hud-raised hover:border-hud-line-strong'}"
		aria-haspopup="menu"
		aria-expanded={open}
		data-demo="conditions"
		title="{DISRUPTION_LABELS.kind}: {current.label}"
		onclick={() => (open = !open)}
	>
		<Waves class="size-3.5 {disrupted ? '' : 'text-hud-muted'}" />
		<span class="hud-label max-xl:hidden">Conditions</span>
		<span class="font-medium">{current.shortLabel}</span>
		<ChevronDown class="size-3.5 text-hud-faint" />
	</button>

	{#if open}
		<div
			class="absolute top-full right-0 z-50 mt-1 w-72 hud-panel p-1 text-hud-text"
			role="menu"
			tabindex="-1"
			onkeydown={(e) => e.key === 'Escape' && (open = false)}
		>
			<p class="px-2 pt-1 pb-0.5 hud-label">{DISRUPTION_LABELS.kind}</p>
			{#each DISRUPTION_SCENARIOS as d (d.id)}
				<button
					type="button"
					role="menuitemradio"
					aria-checked={d.id === current.id}
					class="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-hud-hover"
					onclick={() => choose(d.id)}
				>
					<span class="flex-1">
						{d.label}
						<span class="block text-[10px] text-hud-faint">{d.summary}</span>
					</span>
					{#if d.id === current.id}<Check class="mt-0.5 size-3.5 text-hud-accent" />{/if}
				</button>
			{/each}
			<p class="border-t border-hud-line px-2 pt-1.5 pb-1 text-[10px] leading-snug text-hud-faint">
				{DISRUPTION_LABELS.disclaimer}
			</p>
		</div>
	{/if}
</div>
