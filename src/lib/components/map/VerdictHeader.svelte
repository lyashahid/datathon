<!-- Verdict line at the top of a pointer-tool preview card. -->
<script lang="ts">
	import { Ban, CircleCheck, TriangleAlert } from '@lucide/svelte';
	import { PLACEMENT_COLORS } from '#lib/config/placement.ts';
	import type { PlacementValidity } from '#lib/simulator/placement.ts';

	let { validity, subtitle }: { validity: PlacementValidity; subtitle: string } = $props();

	const VERDICTS: Record<PlacementValidity, string> = {
		valid: 'Good spot',
		warning: 'Caution',
		invalid: 'Blocked'
	};
</script>

<div class="flex items-center gap-1.5" style:color={PLACEMENT_COLORS[validity]}>
	{#if validity === 'valid'}
		<CircleCheck class="size-3.5 shrink-0" />
	{:else if validity === 'warning'}
		<TriangleAlert class="size-3.5 shrink-0" />
	{:else}
		<Ban class="size-3.5 shrink-0" />
	{/if}
	<span class="shrink-0 font-semibold whitespace-nowrap">{VERDICTS[validity]}</span>
	<span class="ml-auto min-w-0 truncate text-hud-faint">{subtitle}</span>
</div>
