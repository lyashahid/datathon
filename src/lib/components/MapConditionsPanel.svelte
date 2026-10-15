<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { CloudSun, Wind, Waves, Route, RefreshCw, X } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { api } from '#lib/api.js';
	import type { Coordinates } from '#lib/types.js';
	type Forecast = {
		current: Record<string, number | string | null>;
		current_units: Record<string, string>;
		receipt: { retrieved_at: string; stale: boolean; qualification: string };
		warning?: string;
	};
	type TrafficRoute = {
		summary: string;
		distance_meters: number;
		typical_seconds: number | null;
		traffic_seconds: number | null;
		geometry?: { coordinates: Coordinates[] };
	};
	let {
		coordinates,
		islandName,
		start,
		end,
		startLabel,
		endLabel,
		onClose,
		onChoosePoint,
		onReset,
		onRoute,
		onNotices
	}: {
		coordinates?: Coordinates;
		islandName: string;
		start: Coordinates | null;
		end: Coordinates | null;
		startLabel: string;
		endLabel: string;
		onClose: () => void;
		onChoosePoint: (endpoint: 'start' | 'end') => void;
		onReset: () => void;
		onRoute: (coordinates: Coordinates[]) => void;
		onNotices: () => void;
	} = $props();
	let weather = $state.raw<Forecast | null>(null),
		marine = $state.raw<Forecast | null>(null);
	let weatherError = $state(''),
		trafficError = $state('');
	let loading = $state(false),
		trafficLoading = $state(false);
	let traffic = $state.raw<TrafficRoute | null>(null);
	let controller: AbortController | undefined, trafficController: AbortController | undefined;
	let refresh = $state(0);
	onDestroy(() => {
		controller?.abort();
		trafficController?.abort();
	});
	$effect(() => {
		const point = coordinates,
			key = refresh;
		void key;
		controller?.abort();
		weather = null;
		marine = null;
		weatherError = '';
		loading = false;
		if (!point) return;
		const current = new AbortController();
		controller = current;
		loading = true;
		void Promise.allSettled([
			api<Forecast>(
				`conditions/weather?latitude=${point[1]}&longitude=${point[0]}`,
				undefined,
				current.signal
			),
			api<Forecast>(
				`conditions/marine?latitude=${point[1]}&longitude=${point[0]}`,
				undefined,
				current.signal
			)
		]).then((results) => {
			if (current.signal.aborted) return;
			if (results[0].status === 'fulfilled') weather = results[0].value;
			if (results[1].status === 'fulfilled') marine = results[1].value;
			weatherError = results
				.filter((result) => result.status === 'rejected')
				.map((result) =>
					result.status === 'rejected' ? String(result.reason.message ?? result.reason) : ''
				)
				.join(' ');
			loading = false;
		});
		return () => current.abort();
	});
	$effect(() => {
		const a = start,
			b = end;
		void a;
		void b;
		untrack(() => {
			trafficController?.abort();
			traffic = null;
			trafficLoading = false;
			trafficError = '';
			onRoute([]);
		});
	});
	async function checkTraffic() {
		if (!start || !end) return;
		trafficController?.abort();
		const current = new AbortController();
		trafficController = current;
		trafficLoading = true;
		trafficError = '';
		try {
			const result = await api<{ data: { routes: TrafficRoute[] } }>(
				'conditions/traffic',
				{
					origin: { longitude: start[0], latitude: start[1] },
					destination: { longitude: end[0], latitude: end[1] },
					mode: 'driving',
					region: 'mv',
					language: 'en'
				},
				current.signal
			);
			if (!current.signal.aborted) {
				traffic = result.data.routes[0] ?? null;
				onRoute(traffic?.geometry?.coordinates ?? []);
				if (!traffic) trafficError = 'The provider returned no road route for these points.';
			}
		} catch (cause) {
			if (!current.signal.aborted)
				trafficError = cause instanceof Error ? cause.message : 'Traffic evidence is unavailable.';
		} finally {
			if (trafficController === current) trafficLoading = false;
		}
	}
	const value = (forecast: Forecast | null, key: string, unit: string) =>
		typeof forecast?.current[key] === 'number'
			? `${Number(forecast.current[key]).toFixed(1)}${unit}`
			: 'Unavailable';
	const minutes = (seconds: number | null | undefined) =>
		seconds == null ? 'Unavailable' : `${Math.round(seconds / 60)} min`;
</script>

<section class="map-conditions-panel" aria-label="Weather and traffic on this map">
	<header>
		<div>
			<span class="eyebrow">ON THIS MAP</span>
			<h2>Weather & traffic</h2>
			<p>{islandName}</p>
		</div>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="Close weather and traffic"
			onclick={() => {
				controller?.abort();
				trafficController?.abort();
				onClose();
			}}><X size={18} /></Button
		>
	</header>
	<div class="conditions-scroll">
		<div class="conditions-heading">
			<h3>Conditions near this island</h3>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Refresh weather"
				disabled={loading}
				onclick={() => refresh++}><RefreshCw size={14} /></Button
			>
		</div>
		{#if loading}<p class="conditions-status" role="status">Checking forecast providers…</p>{/if}
		<div class="conditions-metrics">
			<div>
				<CloudSun size={20} /><small>Temperature</small><strong
					>{value(weather, 'temperature_2m', '°C')}</strong
				>
			</div>
			<div>
				<Wind size={20} /><small>Wind</small><strong
					>{value(weather, 'wind_speed_10m', ' km/h')}</strong
				>
			</div>
			<div>
				<Waves size={20} /><small>Waves</small><strong>{value(marine, 'wave_height', ' m')}</strong>
			</div>
		</div>
		{#if weatherError}<p class="conditions-error" role="status">{weatherError}</p>{/if}
		{#if weather?.receipt}<p class="conditions-note">
				Weather · {weather.receipt.stale ? 'Cached forecast · ' : 'Retrieved '}{new Date(
					weather.receipt.retrieved_at
				).toLocaleString()}<br />{weather.receipt.qualification}
			</p>{/if}
		{#if marine?.receipt}<p class="conditions-note">
				Sea conditions · {marine.receipt.stale ? 'Cached forecast · ' : 'Retrieved '}{new Date(
					marine.receipt.retrieved_at
				).toLocaleString()}<br />{marine.receipt.qualification}
			</p>{/if}
		<div class="conditions-heading">
			<h3>Check a road journey</h3>
			<Button variant="ghost" size="sm" onclick={onReset} disabled={!start && !end}>Reset</Button>
		</div>
		<p class="conditions-note">
			Choose both points on this map. The same A and B markers are used for directions.
		</p>
		<button class="conditions-endpoint" onclick={() => onChoosePoint('start')}
			><span>A</span><strong>{start ? startLabel : 'Choose start on the map'}</strong></button
		>
		<button class="conditions-endpoint" onclick={() => onChoosePoint('end')}
			><span>B</span><strong>{end ? endLabel : 'Choose destination on the map'}</strong></button
		>
		<Button disabled={!start || !end || trafficLoading} onclick={checkTraffic}
			><Route size={15} />{trafficLoading
				? 'Checking provider traffic…'
				: 'Check traffic for this journey'}</Button
		>
		{#if traffic}<div class="traffic-result">
				<strong>{traffic.summary || 'Provider road route'}</strong>
				<div>
					<span>Typical time<b>{minutes(traffic.typical_seconds)}</b></span><span
						>With traffic<b>{minutes(traffic.traffic_seconds)}</b></span
					>
				</div>
				<small
					>{traffic.traffic_seconds == null
						? 'The provider has no current traffic duration. Typical time is kept separate.'
						: 'Provider supplied traffic estimate; conditions can change.'}</small
				>
			</div>{/if}
		{#if trafficError}<p class="conditions-error" role="alert">{trafficError}</p>{/if}
		<p class="conditions-note">
			Nearby buses, vessels and aircraft remain visible on the base map. Provider availability and
			observation times are shown with each vehicle.
		</p>
		<Button variant="outline" onclick={onNotices}>Open notice evidence & disruption tools</Button>
	</div>
</section>

<style>
	.map-conditions-panel {
		position: absolute;
		right: 18px;
		top: calc(76px + var(--map-navigation-offset, 0px));
		bottom: 20px;
		z-index: 8;
		width: 370px;
		border: 1px solid #dce5dd;
		border-radius: 17px;
		background: #fffffff9;
		box-shadow: 0 12px 38px #1c3e3722;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.map-conditions-panel > header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 20px 20px 10px;
	}
	.eyebrow {
		font-size: 9px;
		color: #7c8874;
		letter-spacing: 1.3px;
	}
	h2 {
		font-size: 22px;
		letter-spacing: -0.6px;
		margin: 6px 0;
	}
	header p {
		font-size: 12px;
		color: #798371;
		margin: 0;
	}
	.conditions-scroll {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 8px 20px 20px;
		overflow: auto;
	}
	.conditions-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	h3 {
		font-size: 12px;
		font-weight: 600;
		margin: 4px 0;
	}
	.conditions-metrics {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 7px;
	}
	.conditions-metrics > div {
		background: #f1f5ec;
		border-radius: 9px;
		padding: 12px 7px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		color: #6b8157;
	}
	.conditions-metrics small {
		font-size: 10px;
		color: #8a937d;
	}
	.conditions-metrics strong {
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		color: #3f5935;
	}
	.conditions-note {
		font-size: 11px;
		color: #849075;
		line-height: 1.65;
		margin: 0;
	}
	.conditions-status {
		font-size: 12px;
		color: #7b8b6a;
	}
	.conditions-error {
		font-size: 11px;
		color: #a87556;
		line-height: 1.65;
		padding: 10px;
		border-radius: 8px;
		background: #fff3e9;
		margin: 0;
	}
	.conditions-endpoint {
		display: flex;
		align-items: center;
		gap: 12px;
		text-align: left;
		border: 1px solid #dbe4d3;
		border-radius: 9px;
		padding: 12px;
	}
	.conditions-endpoint span {
		background: #e3eedb;
		border-radius: 50%;
		padding: 5px 8px;
		color: #628147;
		font-size: 11px;
	}
	.conditions-endpoint strong {
		font-size: 12px;
		font-weight: 500;
		color: #647358;
	}
	.traffic-result {
		padding: 14px;
		background: #f1f4ed;
		border-radius: 9px;
		font-size: 12px;
	}
	.traffic-result > div {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin: 14px 0;
	}
	.traffic-result span {
		font-size: 10px;
		color: #8b957e;
	}
	.traffic-result b {
		display: block;
		font-size: 17px;
		color: #4f6940;
		margin-top: 5px;
		font-variant-numeric: tabular-nums;
	}
	.traffic-result small {
		font-size: 10px;
		color: #8a947c;
		line-height: 1.6;
	}
	.conditions-scroll :global(button) {
		font-size: 11px;
	}
	button:focus-visible {
		outline: 2px solid #52834d;
		outline-offset: 3px;
	}
	@media (max-width: 1100px) {
		.map-conditions-panel {
			top: calc(116px + var(--map-navigation-offset, 0px));
			width: 340px;
		}
	}
	@media (max-width: 640px) {
		.map-conditions-panel {
			top: auto;
			bottom: 10px;
			left: 10px;
			right: 10px;
			width: auto;
			max-height: 70%;
			border-radius: 17px;
		}
		.map-conditions-panel > header {
			padding: 15px 16px 8px;
		}
		.conditions-scroll {
			padding: 8px 16px 16px;
		}
		h2 {
			font-size: 19px;
		}
	}
</style>
