<!-- Blocking (✕) and cautionary (!) issues for a pointer-tool preview card. -->
<script lang="ts">
	import { PLACEMENT_COLORS } from '#lib/config/placement.ts';
	import type { PlacementIssue } from '#lib/simulator/placement.ts';

	let { issues }: { issues: readonly PlacementIssue[] } = $props();
</script>

{#if issues.length > 0}
	<ul class="mt-2 flex flex-col gap-1 border-t border-hud-line pt-2">
		{#each issues as issue (issue.message)}
			<li
				class="flex gap-1.5 leading-snug"
				style:color={issue.severity === 'blocking'
					? PLACEMENT_COLORS.invalid
					: PLACEMENT_COLORS.warning}
			>
				<span aria-hidden="true">{issue.severity === 'blocking' ? '✕' : '!'}</span>
				<span>{issue.message}</span>
			</li>
		{/each}
	</ul>
{/if}
