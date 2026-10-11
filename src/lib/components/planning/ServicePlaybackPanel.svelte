<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Pause, Play, RotateCcw, BusFront, Ship } from '@lucide/svelte';
	import {
		playbackClockBounds,
		servicePlaybackFrame,
		type ServicePlaybackFrame
	} from '#lib/planning/playback.ts';
	import type { PlanningServicePattern, PlanningStop } from '#lib/planning/types.ts';
	let {
		pattern,
		stops,
		date,
		departureMinutes,
		sourceReferenceDate,
		onframe
	}: {
		pattern: PlanningServicePattern | null;
		stops: readonly PlanningStop[];
		date: string;
		departureMinutes: number;
		sourceReferenceDate?: string;
		onframe: (frame: ServicePlaybackFrame | null) => void;
	} = $props();
	let clockMinutes = $state(untrack(() => departureMinutes));
	let playing = $state(false);
	let reducedMotion = $state(false);
	let mounted = $state(false);
	const bounds = $derived(pattern ? playbackClockBounds(pattern) : null);
	const frame = $derived(
		pattern
			? servicePlaybackFrame({ pattern, stops, date, clockMinutes, sourceReferenceDate })
			: null
	);
	function clock(value: number) {
		const rounded = Math.floor(value),
			day = Math.floor(rounded / 1440);
		return `${String(Math.floor((rounded % 1440) / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}${day ? ` +${day}d` : ''}`;
	}
	function reset() {
		playing = false;
		clockMinutes = bounds
			? Math.max(bounds[0], Math.min(bounds[1], departureMinutes))
			: departureMinutes;
	}
	$effect(() => {
		// Time-dependent scenario geometry follows the selected planning departure.
		const key = `${pattern?.id ?? ''}:${date}:${departureMinutes}`;
		if (key) untrack(reset);
	});
	$effect(() => {
		if (mounted) onframe(frame);
	});
	$effect(() => {
		if (frame?.status === 'unavailable' || reducedMotion) playing = false;
	});
	$effect(() => {
		if (!mounted || !playing || !bounds || reducedMotion) return;
		let animation = 0;
		let previous = performance.now();
		const end = bounds[1];
		const step = (now: number) => {
			// One second illustrates one service minute; no current-position claim.
			clockMinutes = Math.min(
				end,
				clockMinutes + Math.min(100, Math.max(0, now - previous)) / 1000
			);
			previous = now;
			if (clockMinutes >= end) playing = false;
			else animation = requestAnimationFrame(step);
		};
		animation = requestAnimationFrame(step);
		return () => cancelAnimationFrame(animation);
	});
	onMount(() => {
		mounted = true;
		const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = motion.matches;
		const updateMotion = () => {
			reducedMotion = motion.matches;
		};
		motion.addEventListener('change', updateMotion);
		return () => {
			motion.removeEventListener('change', updateMotion);
			onframe(null);
		};
	});
</script>

<section class="playback" aria-label="Selected service illustration">
	<header>
		<div class="title">
			{#if pattern?.mode === 'ferry'}<Ship size={16} aria-hidden="true" />{:else}<BusFront
					size={16}
					aria-hidden="true"
				/>{/if}
			<h3>Follow this service</h3>
		</div>
		<span class="badge">Illustration</span>
	</header>
	{#if pattern && bounds && frame}
		<p class="name">{pattern.name}</p>
		<div class="transport-controls">
			<button
				class="play"
				aria-label={playing ? 'Pause service illustration' : 'Play service illustration'}
				disabled={reducedMotion || frame.status === 'unavailable'}
				onclick={() => {
					if (clockMinutes >= bounds![1]) clockMinutes = bounds![0];
					playing = !playing;
				}}
			>
				{#if playing}<Pause size={16} aria-hidden="true" />{:else}<Play
						size={16}
						aria-hidden="true"
					/>{/if}
			</button>
			<div class="scrub">
				<label for="service-clock">{clock(clockMinutes)} <span>MVT</span></label><input
					id="service-clock"
					type="range"
					min={bounds[0]}
					max={bounds[1]}
					step="0.1"
					value={clockMinutes}
					oninput={(event) => {
						playing = false;
						clockMinutes = event.currentTarget.valueAsNumber;
					}}
					aria-label="Illustrated service clock in Maldives time"
				/>
			</div>
			<button class="restart" aria-label="Reset service illustration" onclick={reset}
				><RotateCcw size={15} aria-hidden="true" /></button
			>
		</div>
		<p class="explanation">{frame.label}. One second = one service minute.</p>
		{#if reducedMotion}<p class="notice">
				Reduced motion is enabled. Use the clock slider for static positions.
			</p>{/if}
		{#if frame.reason}<p class="notice">{frame.reason}</p>{/if}
		<details>
			<summary>Timing and source</summary>
			<p>
				{frame.sourceLabel}
				{#if pattern.timing.kind === 'frequency'}Vehicle departure phases are illustrative;
					frequency evidence does not establish actual dispatch times.{:else}Locations between stops
					are interpolated along the mapped directed route; stop times do not establish actual
					vehicle positions.{/if}
			</p>
		</details>
	{:else}<p class="empty">
			Select a direction with valid service timing to illustrate its journey.
		</p>{/if}
</section>

<style>
	.playback {
		border: 1px solid #dce7e2;
		border-radius: 14px;
		background: #fff;
		color: #243d36;
		min-width: 0;
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 12px 13px 6px;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	h3 {
		font-size: 14px;
		font-weight: 650;
		line-height: 1.4;
		margin: 0;
	}
	.badge {
		font-size: 10px;
		border: 1px solid #d8e8dd;
		color: #476b59;
		background: #f4faf6;
		border-radius: 5px;
		padding: 2px 5px;
	}
	.name {
		padding: 0 13px;
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: #60756a;
		overflow-wrap: anywhere;
	}
	.transport-controls {
		display: flex;
		gap: 10px;
		align-items: center;
		padding: 11px 13px 5px;
	}
	.scrub {
		flex: 1;
		min-width: 0;
	}
	.scrub label {
		display: block;
		font-variant-numeric: tabular-nums;
		font-size: 14px;
		font-weight: 650;
	}
	.scrub label span {
		font-size: 10px;
		font-weight: 500;
		color: #72887c;
	}
	input {
		width: 100%;
		accent-color: #27795e;
		margin: 5px 0 0;
		cursor: pointer;
	}
	button {
		display: grid;
		place-items: center;
		border: 1px solid #d8e8dd;
		background: #edf7f0;
		color: #216845;
		border-radius: 8px;
		width: 36px;
		height: 36px;
		cursor: pointer;
		flex-shrink: 0;
		transition: transform 120ms ease;
	}
	button:active {
		transform: scale(0.97);
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.restart {
		background: #f8fbf9;
		width: 31px;
		height: 31px;
	}
	button:focus-visible,
	input:focus-visible,
	summary:focus-visible {
		outline: 2px solid #27795e;
		outline-offset: 2px;
	}
	.explanation {
		padding: 0 13px 10px;
		margin: 0;
		font-size: 11px;
		line-height: 1.5;
		color: #60756a;
	}
	.notice {
		margin: 0 12px 10px;
		padding: 8px;
		border-radius: 6px;
		background: #fbf7ed;
		color: #735926;
		font-size: 12px;
		line-height: 1.5;
	}
	details {
		border-top: 1px solid #e8eee9;
	}
	summary {
		cursor: pointer;
		font-size: 12px;
		color: #60756a;
		padding: 9px 13px;
	}
	details p,
	.empty {
		font-size: 12px;
		line-height: 1.5;
		color: #60756a;
		padding: 0 13px 12px;
		margin: 0;
	}
	@media (pointer: coarse) {
		button,
		.restart {
			width: 44px;
			height: 44px;
		}
		input {
			min-height: 26px;
		}
		summary {
			min-height: 44px;
			box-sizing: border-box;
			padding-top: 14px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		button {
			transition: none;
		}
		button:active {
			transform: none;
		}
	}
</style>
