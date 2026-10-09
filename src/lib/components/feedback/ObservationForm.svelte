<!-- Records a local observation: location (map click), type, short description. -->
<script lang="ts">
	import { MapPin } from '@lucide/svelte';
	import { FEEDBACK_DISCLAIMER, FEEDBACK_RULES, OBSERVATION_STYLES } from '#lib/config/feedback.ts';
	import { CURSOR_COORDINATE_DECIMALS } from '#lib/config/map.ts';
	import { getFeedbackState } from '#lib/stores/feedback.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import { OBSERVATION_TYPES, type ObservationType } from '#lib/types/feedback.ts';
	import { formatLatLng } from '#lib/utils/format.ts';

	const ui = getUiState();
	const feedback = getFeedbackState();

	let type = $state<ObservationType | null>(null);
	let description = $state('');
	let error = $state<string | null>(null);
	let saving = $state(false);

	const position = $derived(ui.observationDraft?.position ?? null);
	const remaining = $derived(FEEDBACK_RULES.descriptionMaxLength - description.length);

	async function save(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		if (!position) return (error = 'Click the map to set the location.');
		if (!type) return (error = 'Choose a type.');
		saving = true;
		const result = await feedback.addObservation({ type, position, description });
		saving = false;
		if (!result.ok) return (error = result.reason);
		ui.cancelObservation();
		ui.select({ kind: 'observation', id: result.value.id });
	}
</script>

<form class="flex flex-col gap-3 p-3" onsubmit={save}>
	<header>
		<p class="hud-label">Add observation</p>
		<p class="mt-0.5 text-[11px] text-hud-muted">
			Record something you have seen on the ground. Esc to cancel.
		</p>
	</header>

	<div class="flex items-center gap-2 rounded border border-hud-line p-2 text-[11px]">
		<MapPin class="size-3.5 {position ? 'text-hud-accent' : 'text-hud-faint'}" />
		{#if position}
			<span class="font-mono text-hud-text tabular-nums">
				{formatLatLng(position[0], position[1], CURSOR_COORDINATE_DECIMALS)}
			</span>
			<span class="ml-auto text-[10px] text-hud-faint">click map to move</span>
		{:else}
			<span class="animate-pulse text-hud-muted">Click the map to set the location</span>
		{/if}
	</div>

	<fieldset>
		<legend class="mb-1 text-[10px] font-medium text-hud-muted">Type</legend>
		<div class="grid grid-cols-2 gap-1">
			{#each OBSERVATION_TYPES as t (t)}
				{@const style = OBSERVATION_STYLES[t]}
				<button
					type="button"
					aria-pressed={type === t}
					class="flex items-center gap-1.5 rounded border px-1.5 py-1 text-left text-[11px] {type ===
					t
						? 'border-hud-accent/60 bg-hud-accent-dim text-hud-text'
						: 'border-hud-line text-hud-muted hover:bg-hud-hover'}"
					onclick={() => (type = t)}
				>
					<span class="size-2 shrink-0 rounded-full" style:background-color={style.color}></span>
					{style.label}
				</button>
			{/each}
		</div>
	</fieldset>

	<label class="flex flex-col gap-1">
		<span class="text-[10px] font-medium text-hud-muted">Description</span>
		<textarea
			bind:value={description}
			rows="3"
			maxlength={FEEDBACK_RULES.descriptionMaxLength}
			placeholder="What did you see, and when?"
			class="resize-none rounded border border-hud-line bg-hud-raised px-2 py-1.5 text-xs text-hud-text select-text placeholder:text-hud-faint focus:border-hud-accent/60 focus:outline-none"
		></textarea>
		<span class="self-end font-mono text-[10px] text-hud-faint tabular-nums">{remaining}</span>
	</label>

	{#if error}<p class="text-[11px] text-hud-warn" role="alert">{error}</p>{/if}

	<div class="flex gap-2">
		<button
			type="submit"
			disabled={saving}
			class="flex-1 rounded bg-hud-accent px-3 py-1.5 text-xs font-medium text-hud-void hover:brightness-110 disabled:opacity-50"
			>Save observation</button
		>
		<button
			type="button"
			class="rounded border border-hud-line px-3 py-1.5 text-xs text-hud-muted hover:bg-hud-hover"
			onclick={() => ui.cancelObservation()}>Cancel</button
		>
	</div>
	<p class="text-[10px] leading-relaxed text-hud-faint">{FEEDBACK_DISCLAIMER}</p>
</form>
