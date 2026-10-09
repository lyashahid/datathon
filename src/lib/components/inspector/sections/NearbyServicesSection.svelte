<script lang="ts">
	import { INFRASTRUCTURE_TYPE_STYLES } from '#lib/config/infrastructure.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import type { NearbyFacility, NearbyServices } from '#lib/types/analysis.ts';
	import { formatDistance, formatMinutes } from '#lib/utils/format.ts';
	import MarkerGlyph from '#lib/components/legend/MarkerGlyph.svelte';
	import InspectorSection from '../InspectorSection.svelte';

	let { nearby }: { nearby: NearbyServices } = $props();

	const ui = getUiState();
	const groups = $derived([
		{ label: 'Hospitals', items: nearby.hospitals },
		{ label: 'Schools', items: nearby.schools },
		{ label: 'Transport', items: nearby.transport }
	]);

	function travel(f: NearbyFacility): string {
		return f.walkMinutes === null ? 'by sea' : `${formatMinutes(f.walkMinutes)} walk`;
	}
</script>

<InspectorSection
	title="Nearby services"
	provenance={nearby.provenance}
	provenanceNote="Straight-line distances over demo data"
>
	{#each groups as group (group.label)}
		<div>
			<h4 class="mb-0.5 text-[10px] font-medium text-hud-muted">{group.label}</h4>
			{#if group.items.length === 0}
				<p class="px-1 text-[11px] text-hud-faint">
					None within {formatDistance(nearby.searchRadiusM)}
				</p>
			{:else}
				<ul>
					{#each group.items as f (f.id)}
						{@const s = INFRASTRUCTURE_TYPE_STYLES[f.type]}
						<li>
							<button
								type="button"
								class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] hover:bg-hud-hover"
								onclick={() => ui.select({ kind: 'infrastructure', id: f.id })}
								title="Select {f.name}"
							>
								<MarkerGlyph shape={s.shape} color={s.color} size={10} />
								<span class="min-w-0 flex-1 truncate">{f.name}</span>
								<span class="shrink-0 font-mono text-[10px] text-hud-muted tabular-nums">
									{formatDistance(f.distanceM)}
								</span>
								<span
									class="w-14 shrink-0 text-right text-[10px] {f.walkMinutes === null
										? 'text-hud-warn'
										: 'text-hud-faint'}"
								>
									{travel(f)}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/each}
</InspectorSection>
