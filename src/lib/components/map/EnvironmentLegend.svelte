<!-- Legend for forecast views. Marked as live forecast data, never as a simulation assumption. -->
<script lang="ts">
	import type { EnvironmentInfoView } from '#lib/config/infoViews.ts';
	import type { SampleGrid } from '#lib/types/weather.ts';
	import { formatCompact, formatMvtTime } from '#lib/utils/format.ts';

	let {
		view,
		grid,
		status
	}: {
		view: EnvironmentInfoView;
		grid: SampleGrid<unknown> | null;
		status: 'idle' | 'loading' | 'ready' | 'unavailable';
	} = $props();

	const stops = $derived(view.scale.stops);
	const max = $derived(stops[stops.length - 1][0]);
	const pct = (v: number) => (v / max) * 100;
	const gradient = $derived(
		`linear-gradient(to right, ${stops.map(([v, c]) => `${c} ${pct(v)}%`).join(', ')})`
	);
	const validAt = $derived(grid?.validAt ? formatMvtTime(grid.validAt) : null);
</script>

<section class="w-60 hud-panel p-2.5" aria-label="{view.label} legend">
	<div class="flex items-center gap-1.5">
		<h3 class="text-xs font-semibold">{view.label}</h3>
		<span
			class="rounded-sm border border-sky-400/40 px-1 text-[9px] font-semibold tracking-wide text-sky-300 uppercase"
			title="Live forecast data from an external provider">Forecast</span
		>
	</div>
	<p class="mt-0.5 text-[10px] leading-snug text-hud-faint">{view.description}</p>

	{#if status === 'unavailable'}
		<p class="mt-2 text-[11px] text-hud-warn" role="alert">
			Forecast unavailable. The provider could not be reached; try again later.
		</p>
	{:else if !grid}
		<p class="mt-2 animate-pulse text-[11px] text-hud-muted">Loading forecast…</p>
	{:else}
		{#if view.categories}
			<ul class="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-hud-muted">
				{#each view.categories as c (c.label)}
					<li class="flex items-center gap-1.5">
						<span class="size-2.5 shrink-0 rounded-sm" style:background={c.color}></span>
						{c.label}
						<span class="ml-auto font-mono text-hud-faint tabular-nums">{c.min}+</span>
					</li>
				{/each}
			</ul>
		{:else}
			<div class="mt-2 h-2.5 rounded-sm" style:background={gradient} aria-hidden="true"></div>
			<div class="relative mt-0.5 h-3 font-mono text-[9px] text-hud-muted tabular-nums">
				{#each stops as [value], i (value)}
					<span
						class="absolute {i === 0
							? ''
							: i === stops.length - 1
								? '-translate-x-full'
								: '-translate-x-1/2'}"
						style:left="{pct(value)}%"
					>
						{formatCompact(value)}{i === stops.length - 1 ? '+' : ''}
					</span>
				{/each}
			</div>
		{/if}
		<div class="mt-1 text-[10px] text-hud-faint">{view.unit}</div>
		<p class="mt-1.5 border-t border-hud-line pt-1.5 text-[10px] leading-snug text-hud-muted">
			Forecast ·
			<a href={grid.source.url} target="_blank" rel="noopener noreferrer" class="underline"
				>{grid.source.name}</a
			>{validAt ? ` · valid ${validAt} MVT` : ''}
		</p>
		<p class="mt-0.5 text-[10px] leading-snug text-hud-faint">
			Live data, not used in accessibility scores or simulations.
		</p>
	{/if}
</section>
