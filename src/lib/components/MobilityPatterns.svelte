<script lang="ts">
	import { onMount } from 'svelte';
	import { Car, Plane, ArrowUpRight, RefreshCw, Ship } from '@lucide/svelte';
	import { api } from '#lib/api.js';
	import {
		airportHours,
		busiestHour,
		type AirportHour,
		type TaxiProfile
	} from '#lib/mobility-patterns.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	let { onExplore }: { onExplore: (id: string) => void } = $props();
	type Corridor = TaxiProfile & { pickup_zone: string; dropoff_zone: string };
	type Source = { title: string; url: string };
	type Evidence = { status: string; limitations?: string[]; sources?: Source[] };
	type Bundle = {
		taxis: Evidence & {
			hourly?: (TaxiProfile & { hour: number })[];
			corridors?: Corridor[];
			corridorHourly?: (Corridor & { hour: number })[];
			summary?: TaxiProfile;
			coverage?: {
				date_from: string;
				date_to: string;
				observed_days: number;
				both_endpoints_matched: number;
			};
		};
		airport: Evidence & { hourly?: AirportHour[] };
		vessels: Evidence;
	};
	let bundle = $state.raw<Bundle | null>(null);
	let error = $state('');
	let loading = $state(true);
	let corridor = $state('all');
	let metric = $state<'rides' | 'minutes'>('rides');
	let selectedHour = $state<number | null>(null);
	let year = $state('2025');
	let event = $state('arrival');
	const zoneNames: Record<string, string> = {
		male: 'Malé',
		hulhumale: 'Hulhumalé',
		hulhule: 'Hulhulé / airport'
	};
	const format = (value: number | undefined, digits = 0) =>
		value === undefined
			? '—'
			: new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(value);
	const clock = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
	const corridorId = (row: Corridor) => `${row.pickup_zone}:${row.dropoff_zone}`;
	const corridorName = (row: Corridor) =>
		`${zoneNames[row.pickup_zone] ?? row.pickup_zone} → ${zoneNames[row.dropoff_zone] ?? row.dropoff_zone}`;
	const taxi = $derived(bundle?.taxis);
	const profiles = $derived(
		corridor === 'all'
			? (taxi?.hourly ?? [])
			: (taxi?.corridorHourly ?? []).filter((row) => corridorId(row) === corridor)
	);
	const overall = $derived(
		corridor === 'all'
			? taxi?.summary
			: taxi?.corridors?.find((row) => corridorId(row) === corridor)
	);
	const selected = $derived(
		selectedHour === null ? overall : profiles.find((row) => row.hour === selectedHour)
	);
	const taxiBars = $derived(
		Array.from({ length: 24 }, (_, hour) => profiles.find((row) => row.hour === hour))
	);
	const taxiMax = $derived(
		Math.max(
			1,
			...profiles.map((row) => (metric === 'rides' ? row.ride_count : row.median_minutes))
		)
	);
	const taxiPeak = $derived(
		busiestHour(profiles.map((row) => ({ hour: row.hour, value: row.ride_count })))
	);
	const airport = $derived(airportHours(bundle?.airport.hourly ?? [], Number(year), event));
	const airportMax = $derived(Math.max(1, ...airport.map((row) => row.passengers)));
	const airportPeak = $derived(
		busiestHour(airport.map((row) => ({ hour: row.hour, value: row.passengers })))
	);
	const years = $derived(
		[...new Set((bundle?.airport.hourly ?? []).map((row) => row.year))].sort((a, b) => b - a)
	);
	const candidates = $derived(
		[...(taxi?.corridors ?? [])]
			.filter((row) => row.pickup_zone !== row.dropoff_zone)
			.sort((a, b) => b.ride_count - a.ride_count)
			.slice(0, 3)
	);
	async function load() {
		loading = true;
		error = '';
		try {
			bundle = await api<Bundle>('datasets/mobility-patterns');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Historical profiles could not be loaded.';
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		void load();
	});
</script>

<section class="patterns" aria-label="Historical mobility patterns">
	<div class="intro">
		<div>
			<span class="eyebrow">HISTORICAL MOBILITY</span>
			<h2>When does travel concentrate?</h2>
			<p>
				Explore recorded taxi journeys and airport activity before choosing where to investigate a
				transport improvement.
			</p>
		</div>
		<span class="historical">Dated source records</span>
	</div>
	{#if loading}<p role="status" class="empty">Loading historical mobility profiles…</p>
	{:else if error}<div role="alert" class="empty">
			{error}<Button variant="outline" onclick={load}><RefreshCw size={14} />Retry</Button>
		</div>
	{:else if bundle}
		{#if taxi?.status === 'available' && taxi.summary}
			<article class="panel taxi-panel">
				<div class="panel-heading">
					<div>
						<span class="icon"><Car size={18} /></span>
						<h3>Taxi activity</h3>
						<p>Avas Ride · {taxi.coverage?.date_from} to {taxi.coverage?.date_to}</p>
					</div>
					<Button variant="ghost" size="sm" onclick={() => onExplore('datathon-taxi-hourly')}
						>Inspect data <ArrowUpRight size={14} /></Button
					>
				</div>
				<div class="filters">
					<label
						>Journey area<NativeSelect.Root
							aria-label="Taxi journey area"
							value={corridor}
							onchange={(e) => {
								corridor = e.currentTarget.value;
								selectedHour = null;
							}}
							><option value="all">All recorded areas</option
							>{#each taxi.corridors ?? [] as row (corridorId(row))}<option value={corridorId(row)}
									>{corridorName(row)}</option
								>{/each}</NativeSelect.Root
						></label
					>
					<div class="switch" aria-label="Taxi chart measure">
						<Button
							variant={metric === 'rides' ? 'secondary' : 'ghost'}
							size="sm"
							aria-pressed={metric === 'rides'}
							onclick={() => (metric = 'rides')}>Recorded rides</Button
						><Button
							variant={metric === 'minutes' ? 'secondary' : 'ghost'}
							size="sm"
							aria-pressed={metric === 'minutes'}
							onclick={() => (metric = 'minutes')}>Trip minutes</Button
						>
					</div>
				</div>
				<div class="stats" aria-live="polite">
					<div>
						<span
							>{selectedHour === null
								? 'Completed ride records'
								: `Records starting ${clock(selectedHour)}`}</span
						><strong>{format(selected?.ride_count)}</strong>
					</div>
					<div>
						<span>Median trip</span><strong
							>{format(selected?.median_minutes, 1)}<small> min</small></strong
						>
					</div>
					<div>
						<span>90th percentile trip</span><strong
							>{format(selected?.p90_minutes, 1)}<small> min</small></strong
						>
					</div>
				</div>
				<div class="chart-caption">
					<strong
						>{metric === 'rides'
							? 'Recorded rides by starting hour'
							: 'Median recorded trip minutes by starting hour'}</strong
					><span
						>{taxiPeak ? `Most records · ${clock(taxiPeak.hour)}` : 'No profile available'}</span
					>
				</div>
				<div class="bars" role="group" aria-label="Choose a taxi starting hour">
					{#each taxiBars as row, hour (hour)}<button
							class:chosen={selectedHour === hour}
							class:muted={selectedHour !== null && selectedHour !== hour}
							disabled={!row}
							style={`--height:${row ? Math.max(1, ((metric === 'rides' ? row.ride_count : row.median_minutes) / taxiMax) * 100) : 0}%`}
							aria-pressed={selectedHour === hour}
							aria-label={row
								? `${clock(hour)}: ${format(row.ride_count)} recorded rides, median ${format(row.median_minutes, 1)} minutes`
								: `${clock(hour)}: profile unavailable`}
							title={row
								? `${clock(hour)} · ${format(metric === 'rides' ? row.ride_count : row.median_minutes, metric === 'rides' ? 0 : 1)} ${metric === 'rides' ? 'records' : 'minutes'}`
								: 'Fewer than 30 records; profile withheld'}
							onclick={() => (selectedHour = selectedHour === hour ? null : hour)}
							><span></span></button
						>{/each}
				</div>
				<div class="axis">
					<span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
				</div>
				<p class="note">
					{metric === 'rides'
						? 'Counts cover the entire source period. Select an hour for its journey-time profile.'
						: 'Journey lengths and stopping affect these times. They do not measure road congestion or taxi pickup waiting.'}
					Source clock timezone is undocumented. Profiles with fewer than 30 records are withheld.
				</p>
			</article>
			<article class="panel candidates">
				<span class="eyebrow">A PLACE TO START</span>
				<h3>Corridors worth investigating</h3>
				<p>
					The busiest recorded journeys between mapped islands can guide a closer bus or interchange
					study.
				</p>
				<div class="corridor-list">
					{#each candidates as row (corridorId(row))}<button
							onclick={() => {
								corridor = corridorId(row);
								selectedHour = null;
							}}
							aria-pressed={corridor === corridorId(row)}
							><span
								>{corridorName(row)}<small
									>Median {format(row.median_minutes, 1)} min · 90th percentile {format(
										row.p90_minutes,
										1
									)} min</small
								></span
							><strong>{format(row.ride_count)}<small>records</small></strong></button
						>{/each}
				</div>
				<p class="note">
					This ranks supplied Avas Ride records, not all travel demand or proven bus ridership.
					Trips with either endpoint outside the mapped island polygons are excluded from corridor
					profiles; all valid completed records remain in the overall profile.
				</p>
			</article>
		{:else}<p class="empty">
				The historical taxi profile is unavailable. Missing data does not imply no journeys.
			</p>{/if}
		{#if bundle.airport.status === 'available'}
			<article class="panel airport-panel">
				<div class="panel-heading">
					<div>
						<span class="icon"><Plane size={18} /></span>
						<h3>Airport activity by hour</h3>
						<p>MACL movement records · independent arrival and departure clocks</p>
					</div>
					<Button variant="ghost" size="sm" onclick={() => onExplore('datathon-airport-monthly')}
						>Inspect data <ArrowUpRight size={14} /></Button
					>
				</div>
				<div class="filters">
					<label
						>Year<NativeSelect.Root
							aria-label="Airport activity year"
							value={year}
							onchange={(e) => (year = e.currentTarget.value)}
							>{#each years as y (y)}<option value={String(y)}
									>{y}{y === 2026 ? ' · Jan–Jul' : ''}</option
								>{/each}</NativeSelect.Root
						></label
					><label
						>Movement<NativeSelect.Root
							aria-label="Airport movement type"
							value={event}
							onchange={(e) => (event = e.currentTarget.value)}
							><option value="arrival">Arriving passengers</option><option value="departure"
								>Departing passengers</option
							></NativeSelect.Root
						></label
					>
				</div>
				<div class="chart-caption">
					<strong>Passenger movements · {year}</strong><span
						>{airportPeak
							? `Peak recorded hour · ${clock(airportPeak.hour)}`
							: 'No recorded profile'}</span
					>
				</div>
				<div
					class="bars airport-bars"
					role="img"
					aria-label={`Recorded ${event} passengers by hour in ${year}; peak ${airportPeak ? clock(airportPeak.hour) : 'unavailable'}`}
				>
					{#each airport as row (row.hour)}<div
							style={`--height:${(row.passengers / airportMax) * 100}%`}
							title={row.observed
								? `${clock(row.hour)} · ${format(row.passengers)} passenger movements · ${format(row.movement_records)} movement records`
								: `${clock(row.hour)} · no usable hourly records`}
						>
							<span></span>
						</div>{/each}
				</div>
				<div class="axis">
					<span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
				</div>
				<p class="note">
					This shows historical airport activity, not airport bus demand. Timezone and named route
					mapping are not supplied. Invalid event dates/times are excluded, and absent hours are not
					proof of no service. Airport and taxi periods differ; they are not joined into a demand
					estimate.
				</p>
			</article>
		{/if}
		{#if bundle.vessels.status === 'available'}<article class="panel vessel-panel">
				<div>
					<Ship size={20} />
					<h3>Recorded vessel activity</h3>
					<p>
						Explore the historical GPS coverage and near-island presence separately from published
						ferry services.
					</p>
				</div>
				<Button variant="outline" onclick={() => onExplore('datathon-vessel-daily')}
					>Explore vessel records <ArrowUpRight size={14} /></Button
				>
			</article>{/if}
		<details class="method">
			<summary>Sources, interpretation and quality checks</summary
			>{#each [bundle.taxis, bundle.airport, bundle.vessels] as evidence, i (i)}{#if evidence.status === 'available'}<div
					>
						<h4>{['Avas Ride', 'MACL', 'FollowMe'][i]}</h4>
						{#each evidence.sources ?? [] as source (source.url)}<a
								href={source.url}
								target="_blank"
								rel="noreferrer">{source.title}</a
							>{/each}
						<ul>
							{#each evidence.limitations ?? [] as limitation (limitation)}<li>
									{limitation}
								</li>{/each}
						</ul>
					</div>{/if}{/each}
		</details>
	{/if}
</section>

<style>
	.patterns {
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr);
		gap: 20px;
	}
	.intro {
		grid-column: 1 / -1;
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 20px;
		margin: 4px 0 5px;
	}
	h2 {
		font-size: clamp(21px, 2.4vw, 29px);
		letter-spacing: -0.7px;
		font-weight: 650;
		margin: 8px 0;
	}
	h3 {
		font-size: 18px;
		font-weight: 630;
		letter-spacing: -0.35px;
		margin: 0;
	}
	p {
		color: var(--muted-foreground);
		font-size: 13px;
		line-height: 1.65;
		margin: 7px 0 0;
		max-width: 72ch;
	}
	.eyebrow,
	.historical {
		font-size: 10px;
		letter-spacing: 1.2px;
		font-weight: 650;
		color: var(--muted-foreground);
	}
	.historical {
		border: 1px solid var(--border);
		border-radius: 30px;
		padding: 8px 12px;
		white-space: nowrap;
		letter-spacing: 0.2px;
	}
	.panel {
		min-width: 0;
		padding: 24px;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--card);
	}
	.panel-heading {
		display: flex;
		gap: 10px;
		align-items: start;
		justify-content: space-between;
		margin-bottom: 22px;
	}
	.panel-heading h3 {
		display: inline;
		vertical-align: middle;
	}
	.icon {
		display: inline-flex;
		color: var(--theme-brand);
		vertical-align: middle;
		margin-right: 7px;
	}
	.filters {
		display: flex;
		align-items: end;
		gap: 16px;
		justify-content: space-between;
		margin: 15px 0 20px;
	}
	label {
		display: grid;
		gap: 7px;
		color: var(--muted-foreground);
		font-size: 11px;
		min-width: 0;
	}
	.filters > label:first-child {
		flex: 1;
		max-width: 310px;
	}
	.switch {
		display: flex;
		white-space: nowrap;
	}
	.stats {
		display: grid;
		grid-template-columns: 1.3fr 1fr 1fr;
		gap: 16px;
		padding: 2px 0 25px;
	}
	.stats span {
		color: var(--muted-foreground);
		font-size: 11px;
		display: block;
		margin-bottom: 6px;
	}
	.stats strong {
		font-size: clamp(22px, 2vw, 30px);
		letter-spacing: -0.8px;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.stats small {
		font-size: 12px;
		font-weight: 450;
		letter-spacing: 0;
		color: var(--muted-foreground);
	}
	.chart-caption {
		display: flex;
		gap: 12px;
		justify-content: space-between;
		font-size: 11px;
		margin-bottom: 14px;
	}
	.chart-caption strong {
		font-weight: 550;
	}
	.chart-caption > span {
		color: var(--muted-foreground);
		text-align: right;
	}
	.bars {
		height: 145px;
		display: flex;
		align-items: end;
		gap: 3px;
		border-bottom: 1px solid var(--border);
		background: repeating-linear-gradient(
			to top,
			transparent 0,
			transparent calc(33.33% - 1px),
			var(--border) 33.33%
		);
	}
	.bars > button,
	.bars > div {
		height: 100%;
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: end;
		padding: 0;
		border: 0;
		background: transparent;
		border-radius: 4px 4px 0 0;
	}
	.bars > button {
		cursor: pointer;
	}
	.bars span {
		display: block;
		width: 100%;
		height: var(--height);
		background: var(--theme-brand);
		border-radius: 3px 3px 0 0;
		opacity: 0.65;
		transition: opacity 150ms ease-out;
	}
	.bars .chosen span,
	.bars > button:hover span,
	.bars > button:focus-visible span {
		opacity: 1;
	}
	.bars .muted span {
		opacity: 0.22;
	}
	.bars button:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.bars > button:disabled {
		cursor: default;
	}
	.airport-bars span {
		background: var(--theme-transfer);
	}
	.axis {
		display: flex;
		justify-content: space-between;
		font-size: 10px;
		color: var(--muted-foreground);
		padding-top: 8px;
		font-variant-numeric: tabular-nums;
	}
	.note {
		font-size: 11px;
		line-height: 1.7;
		margin-top: 16px;
	}
	.candidates h3 {
		margin-top: 9px;
	}
	.corridor-list {
		margin-top: 22px;
	}
	.corridor-list button {
		width: 100%;
		text-align: left;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 15px;
		padding: 17px 0;
		border: 0;
		border-top: 1px solid var(--border);
		background: none;
		color: var(--foreground);
		font-size: 12px;
		cursor: pointer;
	}
	.corridor-list button:hover,
	.corridor-list button[aria-pressed='true'] {
		color: var(--theme-brand);
	}
	.corridor-list small {
		display: block;
		color: var(--muted-foreground);
		font-weight: 400;
		font-size: 10px;
		margin-top: 6px;
	}
	.corridor-list strong {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.airport-panel {
		grid-column: 1 / -1;
	}
	.vessel-panel {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
	}
	.vessel-panel :global(svg) {
		color: var(--theme-sea);
		margin-bottom: 10px;
	}
	.method {
		grid-column: 1 / -1;
		border-top: 1px solid var(--border);
		padding-top: 16px;
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.method summary {
		cursor: pointer;
		color: var(--foreground);
	}
	.method h4 {
		font-weight: 600;
		margin: 20px 0 8px;
	}
	.method a {
		color: var(--theme-brand);
		text-decoration: underline;
	}
	.method ul {
		padding-left: 18px;
		line-height: 1.7;
	}
	.empty {
		grid-column: 1 / -1;
		padding: 30px 0;
		display: flex;
		align-items: center;
		gap: 15px;
	}
	@media (max-width: 1000px) {
		.patterns {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 600px) {
		.panel {
			padding: 18px;
		}
		.intro {
			display: block;
		}
		.historical {
			display: inline-block;
			margin-top: 15px;
		}
		.filters {
			flex-wrap: wrap;
		}
		.filters > label:first-child {
			flex-basis: 100%;
			max-width: none;
		}
		.switch {
			width: 100%;
		}
		.stats {
			gap: 10px;
		}
		.stats span {
			min-height: 30px;
		}
		.chart-caption {
			flex-direction: column;
			gap: 4px;
		}
		.chart-caption > span {
			text-align: left;
		}
		.vessel-panel {
			display: block;
		}
		.vessel-panel > :global(button) {
			margin-top: 15px;
		}
		.panel-heading {
			flex-wrap: wrap;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bars span {
			transition: none;
		}
	}
</style>
