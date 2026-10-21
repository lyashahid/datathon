<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { Car, ChartNoAxesColumn, ChevronDown, Map, RefreshCw, Ship } from '@lucide/svelte';
	import { api } from '#lib/api.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import {
		taxiChoices,
		taxiCorridorId,
		taxiSelection,
		taxiZoneNames,
		vesselCalendar,
		type IslandMobility,
		type MobilityMapSelection,
		type TaxiCorridor
	} from '#lib/island-mobility.js';
	import { taxiConnectionFeatures } from '#lib/taxi-map.js';
	import type { Coordinates, MapFeatures } from '#lib/types.js';
	let {
		islandId,
		mapFeatures,
		onMapChange,
		onFocusBounds
	}: {
		islandId: string;
		mapFeatures: MapFeatures | null;
		onMapChange?: (selection: MobilityMapSelection) => void;
		onFocusBounds?: (bounds: [Coordinates, Coordinates]) => void;
	} = $props();

	let bundle = $state.raw<IslandMobility | null>(null);
	let loading = $state(true);
	let error = $state('');
	let retry = $state(0);
	let expanded = $state(false);
	let corridor = $state('pickups');
	let hour = $state<number | null>(null);
	let showConnection = $state(false);
	const data = $derived(bundle?.island.id === islandId ? bundle : null);
	const taxi = $derived(data?.taxis);
	const vessels = $derived(data?.vessels);
	const choices = $derived(taxi ? taxiChoices(taxi) : []);
	const profile = $derived(taxi ? taxiSelection(taxi, corridor, hour) : null);
	const connection = $derived(
		corridor !== 'pickups' && profile?.selected && 'pickup_zone' in profile.selected
			? (profile.selected as TaxiCorridor)
			: null
	);
	const mapped = $derived(taxiConnectionFeatures(showConnection ? connection : null, mapFeatures));
	const canMap = $derived(
		!!connection && taxiConnectionFeatures(connection, mapFeatures).features.length > 0
	);
	const taxiMax = $derived(
		Math.max(1, ...(profile?.hourly ?? []).map((row) => row?.ride_count ?? 0))
	);
	const vesselDays = $derived(vessels ? vesselCalendar(vessels) : []);
	const vesselMax = $derived(Math.max(1, ...vesselDays.map((row) => row.tracked_devices ?? 0)));
	const sources = $derived([...(taxi?.sources ?? []), ...(vessels?.sources ?? [])]);
	const format = (value: number | null | undefined, digits = 0) =>
		value == null
			? '—'
			: new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(value);
	const clock = (value: number) => `${String(value).padStart(2, '0')}:00`;
	const corridorName = (row: TaxiCorridor) =>
		`${taxiZoneNames[row.pickup_zone] ?? row.pickup_zone} → ${taxiZoneNames[row.dropoff_zone] ?? row.dropoff_zone}`;
	function period(from?: string, through?: string) {
		if (!from) return 'Period unavailable';
		const date = (value: string) =>
			new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
				new Date(`${value.length === 7 ? `${value}-01` : value}T12:00:00Z`)
			);
		return through && through.slice(0, 7) !== from.slice(0, 7)
			? `${date(from)} – ${date(through)}`
			: date(from);
	}
	function focusConnection() {
		if (!connection) return;
		const features = taxiConnectionFeatures(connection, mapFeatures);
		const points = features.features.flatMap((feature) =>
			feature.geometry?.type === 'Point' ? [feature.geometry.coordinates] : []
		);
		if (points.length < 2) return;
		onFocusBounds?.([
			[Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1]))],
			[Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1]))]
		]);
	}
	$effect(() => {
		const id = islandId;
		const attempt = retry;
		const controller = new AbortController();
		untrack(() => {
			loading = true;
			error = '';
			bundle = null;
			corridor = 'pickups';
			hour = null;
			showConnection = false;
		});
		void api<IslandMobility>(
			`datasets/island-mobility?${new URLSearchParams({ island_id: id })}`,
			undefined,
			controller.signal
		)
			.then((value) => {
				if (!controller.signal.aborted && value.island.id === id && attempt === retry)
					bundle = value;
			})
			.catch(() => {
				if (!controller.signal.aborted) error = 'Historical travel records could not load.';
			})
			.finally(() => {
				if (!controller.signal.aborted) loading = false;
			});
		return () => controller.abort();
	});
	$effect(() => {
		const selection = mapped.features.length ? { islandId, features: mapped } : null;
		untrack(() => onMapChange?.(selection));
		return () => untrack(() => onMapChange?.(null));
	});
</script>

<details
	class="mobility-context"
	open={expanded}
	ontoggle={(event) => {
		expanded = event.currentTarget.open;
		if (!expanded) showConnection = false;
	}}
	data-testid="island-mobility"
>
	<summary>
		<span class="context-title"
			><ChartNoAxesColumn size={15} aria-hidden="true" />Recorded travel
			<span class="historical">Historical</span></span
		>
		<ChevronDown size={15} class="chevron" aria-hidden="true" />
		<span class="preview">
			{#if loading}Loading travel records…
			{:else if error}Travel records unavailable
			{:else}
				{#if taxi?.status === 'available'}<span
						>{format(taxi.pickup_summary?.ride_count)} taxi pickups · {period(
							taxi.period?.from,
							taxi.period?.through
						)}</span
					>{/if}
				{#if vessels?.status === 'available'}<span
						>{format(vessels.summary?.tracked_devices)} vessel trackers · {period(
							vessels.period?.from,
							vessels.period?.through
						)}</span
					>
				{:else}<span>Explore available records and coverage</span>{/if}
			{/if}
		</span>
	</summary>
	<div class="context-body">
		{#if loading}<p class="empty" role="status">Loading historical travel records…</p>
		{:else if error}<p class="empty" role="alert">
				{error}<Button variant="ghost" size="sm" onclick={() => retry++}
					><RefreshCw size={13} />Retry</Button
				>
			</p>
		{:else if data}
			{#if taxi?.status === 'available'}
				<section aria-label="Recorded island taxi journeys">
					<div class="section-heading">
						<h4><Car size={14} aria-hidden="true" />Taxi journeys</h4>
						<span>Avas Ride · {period(taxi.period?.from, taxi.period?.through)}</span>
					</div>
					<div class="filters">
						<label
							>Journey area<NativeSelect.Root
								aria-label="Recorded taxi journey area"
								value={corridor}
								onchange={(event) => {
									corridor = event.currentTarget.value;
									hour = null;
									showConnection = false;
								}}
							>
								<option value="pickups">All pickups on {data.island.name}</option>
								{#each choices as row (taxiCorridorId(row))}<option value={taxiCorridorId(row)}
										>{corridorName(row)}</option
									>{/each}
							</NativeSelect.Root></label
						>
						<label
							>Start hour<NativeSelect.Root
								aria-label="Recorded taxi start hour"
								value={hour === null ? 'all' : String(hour)}
								onchange={(event) =>
									(hour =
										event.currentTarget.value === 'all' ? null : Number(event.currentTarget.value))}
							>
								<option value="all">All hours</option
								>{#each Array.from({ length: 24 }, (_, i) => i) as value (value)}<option
										value={String(value)}>{clock(value)}–{clock((value + 1) % 24)}</option
									>{/each}
							</NativeSelect.Root></label
						>
					</div>
					<div class="metrics" aria-live="polite">
						<div>
							<strong>{format(profile?.selected?.ride_count)}</strong><span>completed records</span>
						</div>
						<div>
							<strong>{format(profile?.selected?.median_minutes, 1)}<small> min</small></strong
							><span>median trip</span>
						</div>
						<div>
							<strong>{format(profile?.selected?.p90_minutes, 1)}<small> min</small></strong><span
								>90th percentile</span
							>
						</div>
					</div>
					{#if !profile?.selected}<p class="coverage-note" role="status">
							This hour has no published profile. Groups below {taxi.coverage
								?.minimum_profile_records ?? 30} records are withheld; this does not mean zero journeys.
						</p>{/if}
					<svg
						class="hour-chart"
						viewBox="0 0 360 65"
						role="img"
						aria-label="Completed taxi records by start hour. Historical source clock; timezone unspecified."
					>
						<title
							>{profile?.hourly
								.map(
									(row, i) =>
										`${clock(i)}: ${row ? `${format(row.ride_count)} records` : 'unavailable'}`
								)
								.join('; ')}</title
						>
						{#each profile?.hourly ?? [] as row, index (index)}
							<rect
								x={index * 15 + 1}
								y={row ? 49 - (row.ride_count / taxiMax) * 45 : 47}
								width="11"
								height={row ? Math.max(1, (row.ride_count / taxiMax) * 45) : 2}
								rx="2"
								class:missing={!row}
								class:selected={hour === index}
								class:dimmed={hour !== null && hour !== index}
							/>
						{/each}
						{#each [0, 6, 12, 18, 23] as tick (tick)}<text
								x={tick * 15 + 6}
								y="63"
								text-anchor="middle">{String(tick).padStart(2, '0')}</text
							>{/each}
					</svg>
					<p class="chart-caption">Records by start hour · source clock, timezone unspecified</p>
					{#if canMap}<Button
							variant={showConnection ? 'secondary' : 'outline'}
							size="sm"
							aria-pressed={showConnection}
							onclick={async () => {
								showConnection = !showConnection;
								if (showConnection) {
									await tick();
									focusConnection();
								}
							}}
							><Map size={14} />{showConnection
								? 'Hide connection'
								: 'Show connection on map'}</Button
						>{/if}
					{#if mapped.features.length}<p class="map-key">
							<i aria-hidden="true"></i>Schematic island connection · not the driven route
						</p>{/if}
					<p class="qualification">
						Recorded trips, not unique passengers or live traffic. Trip minutes do not establish
						pickup waiting time or congestion. Hulhulé covers the airport island, not a specific
						terminal.
					</p>
				</section>
			{:else if taxi?.status !== 'not_applicable'}<p class="empty">
					Taxi records are unavailable for this island.
				</p>{/if}

			<section class="vessel-section" aria-label="Historical near-island vessel activity">
				<div class="section-heading">
					<h4><Ship size={14} aria-hidden="true" />Nearby vessel activity</h4>
					<span>FollowMe · {period(vessels?.period?.from, vessels?.period?.through)}</span>
				</div>
				{#if vessels?.status === 'available' && vessels.summary}
					<div class="metrics vessel-metrics">
						<div>
							<strong>{format(vessels.summary.tracked_devices)}</strong><span
								>distinct trackers in month</span
							>
						</div>
						<div>
							<strong>{vessels.summary.days_observed}<small> / {vesselDays.length}</small></strong
							><span>days with matched observations</span>
						</div>
					</div>
					<svg
						class="vessel-chart"
						viewBox={`0 0 ${Math.max(1, vesselDays.length) * 11} 40`}
						role="img"
						aria-label={`Daily near-island tracked-device presence in ${period(vessels.period?.from, vessels.period?.through)}. Missing days are unknown, not zero.`}
					>
						<title
							>{vesselDays
								.map(
									(row) =>
										`${row.date}: ${row.tracked_devices === null ? 'unknown' : `${row.tracked_devices} trackers`}`
								)
								.join('; ')}</title
						>
						{#each vesselDays as day, i (day.date)}<rect
								x={i * 11 + 1}
								y={day.tracked_devices === null ? 37 : 39 - (day.tracked_devices / vesselMax) * 36}
								width="7"
								height={day.tracked_devices === null
									? 2
									: Math.max(1, (day.tracked_devices / vesselMax) * 36)}
								rx="1.5"
								class:missing={day.tracked_devices === null}
							/>{/each}
					</svg>
					<div class="chart-caption chart-ends">
						<span>1 {period(vessels.period?.from, vessels.period?.through)}</span><span
							>{vesselDays.length} {period(vessels.period?.from, vessels.period?.through)}</span
						>
					</div>
					<p class="qualification">
						Trackers observed inside or within about 500 m of this island. These are vessels of
						different types, not counts of ferry trips or passengers.
					</p>
				{:else}<p class="empty">
						{vessels?.status === 'no_matched_records'
							? 'No unambiguous vessel observations matched this island in the retained snapshot. Service availability is unknown.'
							: 'Historical vessel records are unavailable for this island.'}
					</p>{/if}
			</section>
			<details class="source-notes">
				<summary>Sources &amp; coverage</summary>
				<div>
					<p>
						Each source has its own historical period. These observations provide context alongside
						the access model.
					</p>
					{#if taxi?.status === 'available'}<p>
							Taxi areas use coarse physical-island polygons. Unmatched endpoints are excluded from
							corridor profiles. Only one retained journey-area/hour profile is shown at a time;
							medians are not averaged together.
						</p>{/if}
					<p>
						Vessel trackers can appear near multiple islands on the same day. Do not add the island
						or daily tracker counts. Missing observations are unknown; they do not establish no
						boats or no ferry service.
					</p>
					{#each sources as source (source.url)}<a
							href={source.url}
							target="_blank"
							rel="noreferrer">{source.title}</a
						>{/each}
				</div>
			</details>
		{/if}
	</div>
</details>

<style>
	.mobility-context {
		margin: 12px 0;
		border: 1px solid var(--theme-color-e7ece7);
		border-radius: 13px;
		background: var(--theme-color-ffffff);
		color: var(--theme-color-273732);
		font-variant-numeric: tabular-nums;
		overflow: hidden;
	}
	summary {
		cursor: pointer;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.mobility-context > summary {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		padding: 14px 15px;
		transition: background-color 150ms ease-out;
	}
	.mobility-context > summary:hover {
		background: var(--theme-color-f7faf7);
	}
	summary:focus-visible {
		outline: 2px solid var(--theme-color-9072dd);
		outline-offset: -3px;
		border-radius: 10px;
	}
	.context-title {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 7px;
		font-size: 12px;
		font-weight: 600;
	}
	.context-title :global(svg) {
		color: var(--theme-color-9072dd);
	}
	.historical {
		font-size: 9px;
		font-weight: 500;
		color: var(--theme-color-6f8177);
		border: 1px solid var(--theme-color-e7ece7);
		border-radius: 5px;
		padding: 2px 5px;
	}
	.preview {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		gap: 3px;
		color: var(--theme-color-6f8177);
		font-size: 11px;
		line-height: 1.5;
	}
	.mobility-context :global(.chevron) {
		color: var(--theme-color-6f8177);
		transition: transform 180ms ease-out;
	}
	.mobility-context[open] > summary :global(.chevron) {
		transform: rotate(180deg);
	}
	.context-body {
		padding: 0 15px 14px;
	}
	.section-heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 5px;
		padding-top: 13px;
		border-top: 1px solid var(--theme-color-e7ece7);
		margin-bottom: 12px;
	}
	h4 {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		font-size: 12px;
		font-weight: 600;
	}
	.section-heading > span {
		color: var(--theme-color-6f8177);
		font-size: 10px;
	}
	.filters {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(105px, 1fr);
		gap: 8px;
		margin-bottom: 13px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 10px;
		color: var(--theme-color-6f8177);
		min-width: 0;
	}
	label :global(select) {
		width: 100%;
		min-width: 0;
		font-size: 11px;
		color: var(--theme-color-273732);
	}
	.metrics {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 9px;
		margin: 7px 0 12px;
	}
	.metrics > div {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.metrics strong {
		font-size: 21px;
		letter-spacing: -0.04em;
		line-height: 1.2;
		font-weight: 600;
	}
	.metrics small {
		font-size: 11px;
		font-weight: 400;
		letter-spacing: 0;
		color: var(--theme-color-6f8177);
	}
	.metrics span {
		font-size: 10px;
		line-height: 1.4;
		color: var(--theme-color-6f8177);
	}
	.hour-chart,
	.vessel-chart {
		width: 100%;
		display: block;
		overflow: visible;
	}
	.hour-chart rect {
		fill: var(--theme-color-9072dd);
		opacity: 0.65;
	}
	.hour-chart rect.selected {
		opacity: 1;
	}
	.hour-chart rect.dimmed {
		opacity: 0.18;
	}
	.hour-chart rect.missing,
	.vessel-chart rect.missing {
		fill: var(--theme-color-e7ece7);
		opacity: 1;
	}
	.hour-chart text {
		fill: var(--theme-color-6f8177);
		font-size: 8px;
	}
	.chart-caption {
		margin: 4px 0 12px;
		font-size: 10px;
		color: var(--theme-color-6f8177);
		line-height: 1.5;
	}
	.chart-ends {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.qualification,
	.empty,
	.coverage-note {
		font-size: 11px;
		color: var(--theme-color-6f8177);
		line-height: 1.6;
		margin: 9px 0 0;
	}
	.coverage-note {
		margin: 0 0 12px;
	}
	.empty {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 7px;
	}
	.vessel-section {
		margin-top: 15px;
	}
	.vessel-metrics {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.vessel-chart rect {
		fill: var(--theme-color-32ae89);
		opacity: 0.75;
	}
	.map-key {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 8px 0 0;
		color: var(--theme-color-6f8177);
		font-size: 10px;
		line-height: 1.5;
	}
	.map-key i {
		width: 20px;
		border-top: 2px dashed var(--theme-color-9072dd);
		flex-shrink: 0;
	}
	.source-notes {
		margin-top: 13px;
		border-top: 1px solid var(--theme-color-e7ece7);
		font-size: 11px;
		line-height: 1.6;
		color: var(--theme-color-6f8177);
	}
	.source-notes > summary {
		padding-top: 10px;
		font-weight: 550;
	}
	.source-notes p {
		margin: 8px 0;
	}
	.source-notes a {
		display: block;
		margin-top: 7px;
		color: var(--theme-color-48665d);
		text-decoration: underline;
		text-underline-offset: 3px;
		overflow-wrap: anywhere;
	}
	@media (prefers-reduced-motion: reduce) {
		.mobility-context > summary,
		.mobility-context :global(.chevron) {
			transition: none;
		}
	}
</style>
