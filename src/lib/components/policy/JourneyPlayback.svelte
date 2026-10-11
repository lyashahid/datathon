<script lang="ts">
	import { Play, Pause } from '@lucide/svelte';
	import type { FeatureCollection, Point } from 'geojson';
	import type {
		PlanningAnalysis,
		PlanningJourney,
		PlanningAssumptions
	} from '#lib/planning/types.ts';
	import { selectedJourneyPlayback } from './journeyPlayback.ts';
	let {
		journey,
		analysis,
		assumptions,
		sourceReferenceDate,
		onframe
	}: {
		journey: PlanningJourney | null;
		analysis: PlanningAnalysis | null;
		assumptions: PlanningAssumptions;
		sourceReferenceDate: string;
		onframe: (symbols: FeatureCollection<Point>) => void;
	} = $props();
	const playback = $derived(
		selectedJourneyPlayback(journey, analysis, assumptions, sourceReferenceDate)
	);
	let clock = $state(0);
	let playing = $state(false);
	let shown = $state(false);
	const frame = $derived(playback?.frame(clock));
	const formatClock = (value: number) =>
		`${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
	$effect(() => {
		const selection = playback;
		void selection;
		playing = false;
		shown = false;
		clock = selection?.start ?? 0;
	});
	$effect(() => {
		onframe(shown && frame ? frame.features : { type: 'FeatureCollection', features: [] });
	});
	$effect(() => {
		if (!playing || !playback) return;
		const end = playback.end,
			step = Math.max(0.25, (end - playback.start) / 100);
		const timer = setInterval(() => {
			clock = Math.min(end, clock + step);
			if (clock >= end) playing = false;
		}, 150);
		return () => clearInterval(timer);
	});
	function play() {
		if (!playback) return;
		shown = true;
		if (playing) {
			playing = false;
			return;
		}
		if (clock >= playback.end) clock = playback.start;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			clock = Math.min(playback.end, clock + 1);
			return;
		}
		playing = true;
	}
</script>

{#if playback}<div class="journey-playback" data-testid="journey-playback">
		<div class="controls">
			<button type="button" onclick={play} data-testid="play-journey-illustration"
				>{#if playing}<Pause size={14} aria-hidden="true" />Pause{:else}<Play
						size={14}
						aria-hidden="true"
					/>Illustrate this bus journey{/if}</button
			><span>{formatClock(clock)} MVT</span>
		</div>
		<label
			>{playback.name}<input
				type="range"
				min={playback.start}
				max={playback.end}
				step="0.25"
				value={clock}
				oninput={(event) => {
					playing = false;
					shown = true;
					clock = event.currentTarget.valueAsNumber;
				}}
				aria-label="Timetable illustration time"
			/></label
		>
		<p>
			Timetable illustration · {assumptions.date}. {shown && frame?.reason
				? frame.reason
				: 'An assumed journey, not a live bus or a traffic forecast.'}
		</p>
		<details>
			<summary>What does the moving symbol mean?</summary>
			<p>{playback.qualification}</p>
		</details>
	</div>{/if}

<style>
	.journey-playback {
		padding: 14px 16px;
		border: 1px solid #dce9e3;
		border-radius: var(--surface-radius-inner, 16px);
		background: #fff;
		margin-top: 10px;
		color: #385f58;
		font-size: 12px;
	}
	.controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	button {
		display: flex;
		align-items: center;
		gap: 6px;
		background: #edf6f2;
		border: 1px solid #cde2d8;
		border-radius: var(--surface-radius-pill, 999px);
		min-height: 44px;
		padding: 8px 14px;
		cursor: pointer;
		color: #18564a;
		font: inherit;
		font-weight: 600;
	}
	label {
		display: block;
		margin-top: 9px;
	}
	input {
		display: block;
		width: 100%;
		accent-color: #0a7d6b;
		margin: 7px 0;
	}
	p {
		margin: 6px 0;
		line-height: 1.6;
	}
	summary {
		cursor: pointer;
	}
	details {
		margin-top: 6px;
	}
	button:focus-visible,
	input:focus-visible,
	summary:focus-visible {
		outline: 3px solid #63bfa4;
		outline-offset: 3px;
	}
</style>
