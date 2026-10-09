<!-- Key for scenario markers on the map: what rings, ghosts and slashes mean. -->
<script lang="ts">
	import { STATE_LABELS } from '#lib/config/infrastructure.ts';
	import { MAP_COLORS } from '#lib/config/map.ts';

	const ITEMS = [
		{
			label: STATE_LABELS.proposed,
			ring: MAP_COLORS.scenarioAdded,
			hint: 'Added in this scenario'
		},
		{
			label: STATE_LABELS.moved,
			ring: MAP_COLORS.scenarioMoved,
			hint: 'Ghost + dashed line to old spot'
		},
		{
			label: STATE_LABELS.disabled,
			ring: MAP_COLORS.scenarioDisabled,
			hint: 'Grey, slashed: out of service'
		}
	];
</script>

<section class="border-t border-hud-line px-3 py-2" aria-label="Scenario map key">
	<h3 class="mb-1.5 hud-label">Scenario key</h3>
	<ul class="flex flex-col gap-1">
		{#each ITEMS as item (item.label)}
			<li class="flex items-center gap-2 text-[11px]" title={item.hint}>
				<svg viewBox="0 0 14 14" class="size-3.5 shrink-0" aria-hidden="true">
					<circle cx="7" cy="7" r="5.5" fill="none" stroke={item.ring} stroke-width="1.5" />
					{#if item.label === STATE_LABELS.disabled}
						<line x1="3.5" y1="10.5" x2="10.5" y2="3.5" stroke={item.ring} stroke-width="1.5" />
					{:else if item.label === STATE_LABELS.moved}
						<circle cx="7" cy="7" r="2" fill={item.ring} opacity="0.4" />
					{/if}
				</svg>
				<span>{item.label}</span>
				<span class="ml-auto truncate text-[10px] text-hud-faint">{item.hint}</span>
			</li>
		{/each}
	</ul>
</section>
