<script lang="ts">
	import type { SimulatorTool } from '#lib/types/ui.ts';

	let { tool, active, onselect }: { tool: SimulatorTool; active: boolean; onselect: () => void } =
		$props();
</script>

<button
	type="button"
	class="group relative flex h-full min-w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-2 transition-colors {active
		? 'bg-hud-accent-dim text-hud-accent'
		: 'text-hud-muted hover:bg-hud-hover hover:text-hud-text'}"
	aria-pressed={active}
	title="{tool.label} ({tool.shortcut})"
	onclick={onselect}
>
	<tool.icon class="size-4" />
	<span class="text-[10px] leading-none font-medium whitespace-nowrap max-md:hidden">
		{tool.label}
	</span>
	<span
		class="absolute top-0.5 right-1 font-mono text-[8px] text-hud-faint group-hover:text-hud-muted max-md:hidden"
		aria-hidden="true">{tool.shortcut}</span
	>
	{#if active}
		<span class="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-hud-accent" aria-hidden="true"
		></span>
	{/if}
</button>
