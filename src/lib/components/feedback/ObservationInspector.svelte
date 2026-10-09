<!-- One local observation: what was reported, where and when. -->
<script lang="ts">
	import { Trash2 } from '@lucide/svelte';
	import { OBSERVATION_STYLES } from '#lib/config/feedback.ts';
	import { CURSOR_COORDINATE_DECIMALS } from '#lib/config/map.ts';
	import { getFeedbackState } from '#lib/stores/feedback.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import type { Observation } from '#lib/types/feedback.ts';
	import { formatLatLng } from '#lib/utils/format.ts';

	let { observation }: { observation: Observation } = $props();

	const feedback = getFeedbackState();
	const ui = getUiState();
	const style = $derived(OBSERVATION_STYLES[observation.type]);
	let confirming = $state(false);

	const reported = $derived(
		new Date(observation.createdAt).toLocaleString('en-GB', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: 'Indian/Maldives'
		})
	);

	async function remove() {
		await feedback.removeObservation(observation.id);
		ui.select(null);
	}
</script>

<div class="flex flex-col gap-3 p-3">
	<header>
		<div class="flex items-center gap-1.5">
			<span class="size-2.5 rounded-full" style:background-color={style.color}></span>
			<span class="hud-label">Local observation</span>
		</div>
		<h2 class="mt-1 text-sm font-semibold">{style.label}</h2>
		<p class="mt-0.5 font-mono text-[10px] text-hud-faint tabular-nums">
			{formatLatLng(observation.position[0], observation.position[1], CURSOR_COORDINATE_DECIMALS)}
		</p>
	</header>
	<p
		class="rounded border border-hud-line p-2 text-xs leading-relaxed whitespace-pre-wrap select-text"
	>
		{observation.description}
	</p>
	<p class="text-[10px] text-hud-faint">
		Reported {reported} MVT · unverified · stored in this browser · not used in any score
	</p>
	<div class="flex gap-2">
		{#if confirming}
			<button
				type="button"
				class="rounded bg-hud-warn/20 px-2.5 py-1 text-[11px] font-medium text-hud-warn hover:bg-hud-warn/30"
				onclick={remove}>Confirm delete</button
			>
			<button
				type="button"
				class="rounded px-2.5 py-1 text-[11px] text-hud-muted hover:bg-hud-hover"
				onclick={() => (confirming = false)}>Keep</button
			>
		{:else}
			<button
				type="button"
				class="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-hud-muted hover:bg-hud-hover hover:text-hud-warn"
				onclick={() => (confirming = true)}
			>
				<Trash2 class="size-3.5" /> Delete
			</button>
		{/if}
	</div>
</div>
