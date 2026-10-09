<script lang="ts">
	import { INFRASTRUCTURE_TYPE_STYLES, ROUTE_MODE_STYLES } from '#lib/config/infrastructure.ts';
	import { getScenarioStore } from '#lib/stores/scenario.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import type { TransportRoute } from '#lib/types/domain.ts';
	import LineGlyph from '#lib/components/legend/LineGlyph.svelte';
	import MarkerGlyph from '#lib/components/legend/MarkerGlyph.svelte';
	import { assetStateLabels } from '#lib/simulator/assetState.ts';
	import AssetBadges from './AssetBadges.svelte';
	import MetadataTable from './MetadataTable.svelte';

	let { route }: { route: TransportRoute } = $props();

	const scenarios = getScenarioStore();
	const ui = getUiState();
	const style = $derived(ROUTE_MODE_STYLES[route.mode]);
	const stops = $derived(
		route.stopIds.map((id) => ({ id, feature: scenarios.effective.getInfrastructure(id) }))
	);
</script>

<header class="flex flex-col gap-2">
	<div>
		<div class="flex items-center gap-1.5">
			<LineGlyph color={style.color} dashed={!!style.dash} size={12} />
			<span class="hud-label">{style.label}</span>
		</div>
		<h2 class="mt-1 text-sm leading-snug font-semibold">{route.name}</h2>
	</div>
	<AssetBadges
		states={assetStateLabels(route.status, scenarios.effective.routeDeltas.get(route.id))}
		source={route.source}
	/>
</header>

<section>
	<h3 class="mb-1.5 hud-label">Details</h3>
	<MetadataTable metadata={route.metadata} syntheticFields={route.source.syntheticFields} />
</section>

<section>
	<h3 class="mb-1.5 hud-label">Stops · {stops.length}</h3>
	<ol class="flex flex-col">
		{#each stops as stop, i (stop.id)}
			<li>
				{#if stop.feature}
					{@const s = INFRASTRUCTURE_TYPE_STYLES[stop.feature.type]}
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[11px] hover:bg-hud-hover"
						onclick={() => ui.select({ kind: 'infrastructure', id: stop.id })}
					>
						<span class="w-3 font-mono text-[10px] text-hud-faint">{i + 1}</span>
						<MarkerGlyph shape={s.shape} color={s.color} size={10} />
						<span class="truncate">{stop.feature.name}</span>
					</button>
				{:else}
					<span class="px-1 text-[11px] text-hud-warn">Unknown stop {stop.id}</span>
				{/if}
			</li>
		{/each}
	</ol>
</section>
