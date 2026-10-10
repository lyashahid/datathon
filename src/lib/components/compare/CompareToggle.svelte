<!-- HUD button that opens the baseline-vs-scenario swipe view. -->
<script lang="ts">
	import { Columns2 } from '@lucide/svelte';
	import { getScenarioStore } from '#lib/stores/scenario.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import { getInfoView } from '#lib/config/infoViews.ts';

	const scenarios = getScenarioStore();
	const ui = getUiState();
	const DEFAULT_COMPARE_VIEW = 'transportAccessibility';

	function toggle() {
		if (ui.compare) return ui.endCompare();
		ui.startCompare();
		// Swiping is only meaningful over a grid view; keep the user's if they have one.
		if (!ui.infoView || getInfoView(ui.infoView).layer !== 'grid') {
			ui.setInfoView(DEFAULT_COMPARE_VIEW);
		}
	}
</script>

<button
	type="button"
	class="flex h-7 shrink-0 items-center gap-1.5 rounded border px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 {ui.compare
		? 'border-hud-accent/50 bg-hud-accent-dim text-hud-accent'
		: 'border-hud-line bg-hud-raised hover:border-hud-line-strong'}"
	aria-pressed={ui.compare}
	data-demo="compare"
	disabled={!scenarios.active}
	title={scenarios.active
		? 'Compare baseline (left) with this scenario (right)'
		: 'Select a scenario to compare with the baseline'}
	onclick={toggle}
>
	<Columns2 class="size-3.5" />
	<span class="max-xl:hidden">Compare</span>
</button>
