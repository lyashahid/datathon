<!-- "Current → Proposed" row with a signed delta coloured by whether the change is good. -->
<script lang="ts">
	import type { MetricChange } from '#lib/types/impact.ts';

	let {
		label,
		change,
		format,
		higherIsBetter = true,
		/** Deltas smaller than this display as unchanged. */
		epsilon = 0.05
	}: {
		label: string;
		change: MetricChange;
		format: (value: number) => string;
		higherIsBetter?: boolean;
		epsilon?: number;
	} = $props();

	const tone = $derived(
		Math.abs(change.delta) < epsilon
			? 'text-hud-faint'
			: change.delta > 0 === higherIsBetter
				? 'text-emerald-400'
				: 'text-hud-warn'
	);
	const sign = $derived(change.delta > 0 ? '+' : change.delta < 0 ? '−' : '±');
</script>

<div class="grid grid-cols-[1fr_auto] items-baseline gap-x-2 text-[11px]">
	<span class="text-hud-muted">{label}</span>
	<span class="font-mono tabular-nums {tone}">
		{Math.abs(change.delta) < epsilon ? '±0' : `${sign}${format(Math.abs(change.delta))}`}
	</span>
	<span class="col-span-2 font-mono text-[10px] text-hud-faint tabular-nums">
		{format(change.before)} → <span class="text-hud-text">{format(change.after)}</span>
	</span>
</div>
