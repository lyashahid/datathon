<!-- Draggable divider between the baseline (left) and scenario (right) maps. -->
<script lang="ts">
	import { ChevronsLeftRight } from '@lucide/svelte';

	let {
		split = $bindable(),
		leftLabel,
		rightLabel
	}: { split: number; leftLabel: string; rightLabel: string } = $props();

	const MIN = 0.05;
	const MAX = 0.95;
	const KEY_STEP = 0.05;
	let track: HTMLDivElement | undefined = $state();
	let dragging = $state(false);

	const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

	function moveTo(clientX: number) {
		if (!track) return;
		const rect = track.getBoundingClientRect();
		split = clamp((clientX - rect.left) / rect.width);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') split = clamp(split - KEY_STEP);
		else if (e.key === 'ArrowRight') split = clamp(split + KEY_STEP);
		else if (e.key === 'Home') split = MIN;
		else if (e.key === 'End') split = MAX;
		else return;
		e.preventDefault();
	}
</script>

<div bind:this={track} class="pointer-events-none absolute inset-0 z-[2]">
	<div
		class="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-hud-accent shadow-[0_0_8px_rgba(0,0,0,0.6)]"
		style:left="{split * 100}%"
	>
		<span
			class="absolute top-16 right-2 hud-panel rounded px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
			>{leftLabel}</span
		>
		<span
			class="absolute top-16 left-2 hud-panel rounded px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-hud-accent"
			>{rightLabel}</span
		>
		<div
			class="pointer-events-auto absolute top-1/2 left-1/2 grid size-8 -translate-1/2 cursor-ew-resize touch-none place-items-center rounded-full border-2 border-hud-accent bg-hud-panel text-hud-accent focus-visible:outline-2 focus-visible:outline-hud-accent {dragging
				? 'scale-110'
				: ''}"
			role="slider"
			tabindex="0"
			aria-label="Comparison divider: baseline on the left, scenario on the right"
			aria-valuemin={MIN * 100}
			aria-valuemax={MAX * 100}
			aria-valuenow={Math.round(split * 100)}
			aria-orientation="horizontal"
			{onkeydown}
			onpointerdown={(e) => {
				dragging = true;
				e.currentTarget.setPointerCapture(e.pointerId);
			}}
			onpointermove={(e) => dragging && moveTo(e.clientX)}
			onpointerup={() => (dragging = false)}
			onpointercancel={() => (dragging = false)}
		>
			<ChevronsLeftRight class="size-4" />
		</div>
	</div>
</div>
