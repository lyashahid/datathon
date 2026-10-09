<script lang="ts">
	import { CircleCheck, TriangleAlert } from '@lucide/svelte';
	import type { Finding } from '#lib/types/analysis.ts';
	import InspectorSection from '../InspectorSection.svelte';

	let {
		title,
		tone,
		findings,
		emptyText
	}: {
		title: string;
		tone: 'strength' | 'concern';
		findings: readonly Finding[];
		emptyText: string;
	} = $props();
</script>

<InspectorSection {title}>
	{#if findings.length === 0}
		<p class="text-[11px] text-hud-faint">{emptyText}</p>
	{:else}
		<ul class="flex flex-col gap-1.5">
			{#each findings as finding (finding.id)}
				<li class="flex gap-1.5 text-[11px] leading-snug">
					{#if tone === 'strength'}
						<CircleCheck class="mt-px size-3 shrink-0 text-emerald-400" />
					{:else}
						<TriangleAlert class="mt-px size-3 shrink-0 text-hud-warn" />
					{/if}
					<span>{finding.text}</span>
				</li>
			{/each}
		</ul>
	{/if}
</InspectorSection>
