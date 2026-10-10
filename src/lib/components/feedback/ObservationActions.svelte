<!-- Sidebar entry point for recording observations. -->
<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { getFeedbackState } from '#lib/stores/feedback.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';

	const ui = getUiState();
	const feedback = getFeedbackState();
</script>

<div class="mt-0.5 mb-1 ml-[1.375rem] flex items-center gap-2 pl-1.5">
	<button
		type="button"
		class="flex h-7 items-center gap-1 rounded border border-hud-line px-2 text-[11px] hover:border-hud-accent/50 hover:bg-hud-accent-dim hover:text-hud-accent {ui.observationDraft
			? 'border-hud-accent/50 bg-hud-accent-dim text-hud-accent'
			: ''}"
		onclick={() => (ui.observationDraft ? ui.cancelObservation() : ui.startObservation())}
	>
		<Plus class="size-3.5" />
		{ui.observationDraft ? 'Cancel' : 'Add observation'}
	</button>
	{#if feedback.status === 'error'}
		<span class="text-[10px] text-hud-warn" title="Browser storage is unavailable or blocked"
			>Not saved in this browser</span
		>
	{:else}
		<span class="text-[10px] text-hud-faint tabular-nums">{feedback.observations.length} saved</span
		>
	{/if}
</div>
