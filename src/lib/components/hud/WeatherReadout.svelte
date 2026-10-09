<!-- Live conditions in the HUD: temperature, weather state, wind, waves, and source. -->
<script lang="ts">
	import {
		CloudDrizzle,
		CloudFog,
		CloudLightning,
		CloudRain,
		CloudSun,
		Navigation2,
		Sun,
		Waves
	} from '@lucide/svelte';
	import { describeWeatherCode, type WeatherIconGroup } from '#lib/config/weather.ts';
	import { getWeatherState } from '#lib/stores/weather.svelte.ts';
	import type { IconComponent } from '#lib/types/ui.ts';

	const state = getWeatherState();

	const ICONS: Record<WeatherIconGroup, IconComponent> = {
		clear: Sun,
		cloud: CloudSun,
		fog: CloudFog,
		drizzle: CloudDrizzle,
		rain: CloudRain,
		storm: CloudLightning
	};

	const w = $derived(state.weather);
	const m = $derived(state.marine);
	const condition = $derived(describeWeatherCode(w?.weatherCode ?? null));
	const Icon = $derived(ICONS[condition.group]);
	const fmt = (v: number | null | undefined, digits = 0) => (v == null ? '--' : v.toFixed(digits));
	const source = $derived(w?.source ?? m?.source ?? null);
	const updated = $derived(
		w
			? new Date(w.timestamp).toLocaleTimeString('en-GB', {
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'Indian/Maldives'
				})
			: null
	);
	const title = $derived(
		state.status === 'unavailable'
			? `Weather unavailable: ${state.errors.join('; ')}`
			: `${source?.name ?? ''} ${source?.kind ?? ''} for Malé${updated ? `, valid ${updated} MVT` : ''}. Live data, not a simulation assumption.${state.errors.length ? ` Partial: ${state.errors.join('; ')}` : ''}`
	);
</script>

<div
	class="flex h-7 shrink-0 items-center gap-3 rounded border border-hud-line px-2 max-lg:hidden"
	{title}
	aria-live="polite"
>
	{#if state.status === 'unavailable'}
		<span class="text-[11px] text-hud-faint">Weather unavailable</span>
	{:else}
		<span
			class="flex items-center gap-1 text-xs"
			aria-label="Weather: {condition.label}, {fmt(w?.temperatureC)} degrees"
		>
			<Icon class="size-3.5 text-hud-muted" />
			<span class="font-mono tabular-nums">{fmt(w?.temperatureC)}</span>
			<span class="text-[10px] text-hud-faint">°C</span>
			<span class="text-[10px] text-hud-muted max-xl:hidden">{w ? condition.label : ''}</span>
		</span>
		<span
			class="flex items-center gap-1 text-xs"
			aria-label="Wind {fmt(w?.windSpeedKph)} kilometres per hour"
		>
			<Navigation2
				class="size-3 text-hud-muted"
				style="transform: rotate({(w?.windDirectionDeg ?? 0) + 180}deg)"
			/>
			<span class="font-mono tabular-nums">{fmt(w?.windSpeedKph)}</span>
			<span class="text-[10px] text-hud-faint">km/h</span>
		</span>
		<span
			class="flex items-center gap-1 text-xs"
			aria-label="Waves {fmt(m?.waveHeightM, 1)} metres"
		>
			<Waves class="size-3.5 text-hud-muted" />
			<span class="font-mono tabular-nums">{fmt(m?.waveHeightM, 1)}</span>
			<span class="text-[10px] text-hud-faint">m</span>
		</span>
		{#if source}
			<a
				href={source.url}
				target="_blank"
				rel="noopener noreferrer"
				class="text-[9px] text-hud-faint hover:text-hud-muted max-xl:hidden"
			>
				{source.name}
			</a>
		{/if}
	{/if}
</div>
