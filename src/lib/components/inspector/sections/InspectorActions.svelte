<script lang="ts">
	import type { InspectorAction, InspectorActionId } from '#lib/config/inspector.ts';

	let {
		actions,
		onaction
	}: { actions: readonly InspectorAction[]; onaction: (id: InspectorActionId) => void } = $props();
</script>

<div class="grid grid-cols-4 gap-1" role="toolbar" aria-label="Infrastructure actions">
	{#each actions as action (action.id)}
		{@const available = !action.unavailableReason}
		<button
			type="button"
			class="flex flex-col items-center gap-1 rounded border py-1.5 text-[10px] font-medium transition-colors {action.active
				? 'border-hud-accent/60 bg-hud-accent-dim text-hud-accent'
				: available
					? 'border-hud-line text-hud-text hover:border-hud-accent/50 hover:bg-hud-accent-dim hover:text-hud-accent'
					: 'cursor-not-allowed border-hud-line text-hud-faint'}"
			disabled={!available}
			aria-pressed={action.active ?? undefined}
			title={action.unavailableReason ?? action.label}
			onclick={() => onaction(action.id)}
		>
			<action.icon class="size-3.5" />
			{action.label}
		</button>
	{/each}
</div>
