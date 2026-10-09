<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Provenance } from '#lib/types/domain.ts';
	import DemoTag from './DemoTag.svelte';

	let {
		title,
		provenance,
		provenanceNote,
		children
	}: {
		title: string;
		provenance?: Provenance;
		provenanceNote?: string;
		children: Snippet;
	} = $props();
</script>

<section class="flex flex-col gap-2">
	<div class="flex items-center gap-1.5">
		<h3 class="hud-label">{title}</h3>
		{#if provenance}
			<DemoTag {provenance} title={provenanceNote} />
		{/if}
	</div>
	{@render children()}
</section>
