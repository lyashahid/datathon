<script lang="ts">
	import { APP_CONFIG } from '#lib/config/app.ts';
	import LocationSearch from './LocationSearch.svelte';
	import ScenarioSelector from './ScenarioSelector.svelte';
	import DisruptionSelector from '#lib/components/disruption/DisruptionSelector.svelte';
	import CompareToggle from '#lib/components/compare/CompareToggle.svelte';
	import DemoToggle from '#lib/components/demo/DemoToggle.svelte';
	import WeatherReadout from './WeatherReadout.svelte';
	import HudClock from './HudClock.svelte';
</script>

<header
	class="relative z-30 flex h-(--hud-top-h) shrink-0 items-center gap-3 border-b border-hud-line bg-hud-panel px-3"
>
	<div class="flex shrink-0 items-center gap-2">
		<span class="grid size-6 place-items-center rounded bg-hud-accent-dim text-hud-accent">
			<svg viewBox="0 0 16 16" class="size-3.5" fill="currentColor" aria-hidden="true">
				<path d="M8 1 15 8 8 15 1 8Z" opacity=".35" />
				<path d="M8 4.5 11.5 8 8 11.5 4.5 8Z" />
			</svg>
		</span>
		<span class="text-[13px] font-semibold tracking-tight whitespace-nowrap">
			{APP_CONFIG.productName}
		</span>
	</div>

	<div class="mx-1 h-5 w-px bg-hud-line max-md:hidden"></div>

	<LocationSearch />

	<div class="flex-1"></div>

	<ScenarioSelector />
	<CompareToggle />
	<DisruptionSelector />
	<WeatherReadout />
	<DemoToggle />
	<HudClock />
</header>
