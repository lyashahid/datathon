<!-- Compact provenance marker for any value that is not an observation. -->
<script lang="ts">
	import { PROVENANCE_LABELS } from '#lib/config/infrastructure.ts';
	import type { Provenance } from '#lib/types/domain.ts';

	let { provenance = 'demo', title }: { provenance?: Provenance; title?: string } = $props();
</script>

{#if provenance !== 'observed'}
	<span
		class="shrink-0 rounded-sm bg-hud-warn/10 px-1 text-[9px] font-semibold tracking-wide text-hud-warn uppercase"
		title={title ?? PROVENANCE_LABELS[provenance]}
	>
		{provenance === 'demo' ? 'demo' : PROVENANCE_LABELS[provenance]}
	</span>
{/if}
