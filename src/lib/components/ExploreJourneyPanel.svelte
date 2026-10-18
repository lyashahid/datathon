<script lang="ts">
	import { tick } from 'svelte';
	import {
		ArrowUpDown,
		Bike,
		Car,
		CarTaxiFront,
		ArrowRight,
		Bus,
		Footprints,
		MapPin,
		CloudSun,
		Ship,
		Clock,
		X,
		RotateCcw
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { journeyClock } from '#lib/explore-journey.js';
	import IslandConnectionsPanel from './IslandConnectionsPanel.svelte';
	import MapConditionsPanel from './MapConditionsPanel.svelte';
	import type { FeatureCollection } from 'geojson';
	import type { Coordinates, MapFeatures, LandRoute } from '#lib/types.js';
	type JourneyPlace = { id: string; name: string; coordinates: Coordinates; category?: string };
	let {
		start,
		end,
		startLabel,
		endLabel,
		mode = $bindable('walk'),
		serviceDate = $bindable('2026-10-10'),
		departureTime = $bindable('15:20'),
		result,
		busy,
		onPick,
		onClear,
		onReset,
		onSwap,
		onFind,
		onChange,
		journeyKind = $bindable('local'),
		onKindChange,
		islands = null,
		originIslandId = $bindable(''),
		destinationIslandId = $bindable(''),
		onPickIsland,
		onConnectionPreview,
		onConnectionFocus,
		onProposeFerry,
		places = [],
		picking = null,
		onSelectPlace,
		conditionsCoordinates,
		islandName = 'Selected island',
		onConditionRoute,
		onNotices
	}: {
		start: Coordinates | null;
		end: Coordinates | null;
		startLabel: string;
		endLabel: string;
		mode: string;
		serviceDate: string;
		departureTime: string;
		result: LandRoute | null;
		busy: boolean;
		onPick: (point: 'start' | 'end') => void;
		onClear: (point: 'start' | 'end') => void;
		onReset: () => void;
		onSwap: () => void;
		onFind: () => void;
		onChange: () => void;
		journeyKind?: 'local' | 'islands';
		onKindChange?: () => void;
		islands?: MapFeatures | null;
		originIslandId?: string;
		destinationIslandId?: string;
		onPickIsland: (endpoint: 'origin' | 'destination') => void;
		onConnectionPreview: (features: FeatureCollection) => void;
		onConnectionFocus: (bounds: [Coordinates, Coordinates]) => void;
		onProposeFerry: (origin: string, destination: string, serviceDate: string) => void;
		places?: JourneyPlace[];
		picking?: 'start' | 'end' | null;
		onSelectPlace?: (endpoint: 'start' | 'end', place: JourneyPlace) => void;
		conditionsCoordinates?: Coordinates;
		islandName?: string;
		onConditionRoute?: (coordinates: Coordinates[]) => void;
		onNotices?: () => void;
	} = $props();
	let queries = $state({ start: '', end: '' });
	let activeSearch = $state<'start' | 'end' | null>(null);
	let conditionsOpen = $state(false);
	let searchInputs = $state<{ start: HTMLInputElement | null; end: HTMLInputElement | null }>({
		start: null,
		end: null
	});
	const travelModes = [
		{ value: 'walk', label: 'Walk', icon: Footprints },
		{ value: 'transit', label: 'Bus', icon: Bus },
		{ value: 'bicycle', label: 'Bicycle', icon: Bike },
		{ value: 'car', label: 'Car', icon: Car },
		{ value: 'taxi', label: 'Taxi', icon: CarTaxiFront }
	];
	const matches = (endpoint: 'start' | 'end') => {
		const query = queries[endpoint].trim().toLocaleLowerCase();
		return query
			? places.filter((place) => place.name.toLocaleLowerCase().includes(query)).slice(0, 6)
			: [];
	};
	async function choosePlace(endpoint: 'start' | 'end', place: JourneyPlace) {
		const focusDestination = endpoint === 'start' && !end;
		onSelectPlace?.(endpoint, place);
		queries[endpoint] = '';
		activeSearch = null;
		if (focusDestination) {
			await tick();
			searchInputs.end?.focus();
		}
	}
	function chooseOnMap(endpoint: 'start' | 'end') {
		activeSearch = null;
		onPick(endpoint);
	}
	function changeJourneyKind(kind: 'local' | 'islands') {
		if (journeyKind === kind) return;
		journeyKind = kind;
		activeSearch = null;
		onKindChange?.();
	}
	const journey = $derived(result?.journey);
	const unavailable = $derived(journey?.reason ?? result?.reason);
	const reasons: Record<string, string> = {
		no_verified_service_date:
			'There is no verified timetable for this date. Try the captured timetable on 10 October 2026.',
		no_active_service: 'No scheduled service is available for this departure time.',
		unreachable: 'No connecting journey was found on the road network or timetable.',
		no_path: 'No connecting route was found on the road network.',
		no_graph: 'Road routing is unavailable for this island.'
	};
</script>

<section class="explore-journey" aria-label="Explore journey directions">
	<div class="journey-kinds" aria-label="Journey type">
		<Button
			variant={journeyKind === 'local' ? 'secondary' : 'ghost'}
			size="sm"
			aria-pressed={journeyKind === 'local'}
			onclick={() => changeJourneyKind('local')}>Local directions</Button
		><Button
			variant={journeyKind === 'islands' ? 'secondary' : 'ghost'}
			size="sm"
			aria-pressed={journeyKind === 'islands'}
			onclick={() => changeJourneyKind('islands')}><Ship size={14} />Island connections</Button
		>
	</div>
	{#if journeyKind === 'islands'}
		<IslandConnectionsPanel
			{islands}
			bind:originId={originIslandId}
			bind:destinationId={destinationIslandId}
			bind:serviceDate
			onPick={onPickIsland}
			onPreview={onConnectionPreview}
			onFocus={onConnectionFocus}
			onPropose={onProposeFerry}
		/>
	{:else}
		<div class="travel-modes" role="group" aria-label="Travel mode">
			{#each travelModes as travelMode (travelMode.value)}
				<button
					type="button"
					class:active={mode === travelMode.value}
					aria-pressed={mode === travelMode.value}
					onclick={() => {
						mode = travelMode.value;
						onChange();
					}}><travelMode.icon size={18} /><span>{travelMode.label}</span></button
				>
			{/each}
		</div>
		<div class="endpoint-layout">
			<div class="journey-endpoints">
				{#each ['start', 'end'] as endpoint (endpoint)}
					{@const point = endpoint as 'start' | 'end'}
					{@const chosen = point === 'start' ? start : end}
					{@const pointLabel = point === 'start' ? startLabel : endLabel}
					<div class="endpoint-group">
						<div
							class="journey-endpoint"
							class:destination={point === 'end'}
							class:picking={picking === point}
						>
							<span class="endpoint-letter" aria-hidden="true">{point === 'start' ? 'A' : 'B'}</span
							>
							{#if onSelectPlace}
								<input
									bind:this={searchInputs[point]}
									id={`journey-${point}-search`}
									value={activeSearch === point
										? queries[point]
										: chosen
											? pointLabel
											: queries[point]}
									placeholder={point === 'start' ? 'Choose starting point' : 'Choose destination'}
									autocomplete="off"
									aria-label={point === 'start'
										? 'Search start location'
										: 'Search destination location'}
									aria-controls={queries[point].trim() && activeSearch === point
										? `journey-${point}-results`
										: undefined}
									onfocus={(event) => {
										queries[point] = chosen ? pointLabel : queries[point];
										activeSearch = point;
										event.currentTarget.select();
									}}
									oninput={(event) => {
										if (chosen) onClear(point);
										queries[point] = event.currentTarget.value;
										activeSearch = point;
									}}
									onkeydown={(event) => {
										if (event.key === 'Escape') {
											event.preventDefault();
											event.stopPropagation();
											queries[point] = '';
											activeSearch = null;
										} else if (event.key === 'Enter' && matches(point)[0]) {
											event.preventDefault();
											void choosePlace(point, matches(point)[0]);
										}
									}}
								/>
							{:else}<span class="endpoint-fallback"
									>{chosen
										? pointLabel
										: point === 'start'
											? 'Choose starting point'
											: 'Choose destination'}</span
								>{/if}
							<Button
								variant={picking === point ? 'secondary' : 'ghost'}
								size="icon-sm"
								aria-label={point === 'start' ? 'Choose start on map' : 'Choose destination on map'}
								title={point === 'start' ? 'Choose start on map' : 'Choose destination on map'}
								aria-pressed={picking === point}
								onclick={() => chooseOnMap(point)}><MapPin size={15} /></Button
							>
							{#if chosen}<Button
									variant="ghost"
									size="icon-sm"
									aria-label={point === 'start' ? 'Remove start point' : 'Remove destination point'}
									onclick={() => {
										queries[point] = '';
										activeSearch = null;
										onClear(point);
									}}><X size={14} /></Button
								>{/if}
						</div>
						{#if onSelectPlace && activeSearch === point && queries[point].trim()}
							<div
								class="endpoint-results"
								id={`journey-${point}-results`}
								aria-label={point === 'start'
									? 'Start location results'
									: 'Destination location results'}
							>
								{#each matches(point) as place (place.id)}<button
										type="button"
										aria-label={place.name}
										onclick={() => choosePlace(point, place)}
										><MapPin size={13} /><span
											>{place.name}{#if place.category}<small
													>{place.category.replaceAll('_', ' ')}</small
												>{/if}</span
										></button
									>{:else}<p>No places found. Choose a point on the map.</p>{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
			<div class="endpoint-actions">
				<Button
					variant="ghost"
					size="icon-sm"
					class="swap-endpoints"
					disabled={!start || !end}
					aria-label="Swap start and destination"
					title="Swap start and destination"
					onclick={() => {
						queries = { start: '', end: '' };
						activeSearch = null;
						onSwap();
					}}><ArrowUpDown size={18} /></Button
				>
				<Button
					variant="ghost"
					size="icon-sm"
					disabled={!start && !end && !queries.start && !queries.end}
					aria-label="Reset directions"
					title="Reset directions"
					onclick={() => {
						queries = { start: '', end: '' };
						activeSearch = null;
						onReset();
					}}><RotateCcw size={16} /></Button
				>
			</div>
		</div>
		{#if picking}<p class="map-picking-hint" role="status">
				<MapPin size={15} />{picking === 'start'
					? 'Click the map to choose your starting point.'
					: 'Click the map to choose your destination.'}
			</p>{:else if !start || !end}<p class="endpoint-help">
				Search a place or bus stop, or use <MapPin size={12} /> to choose on the map.
			</p>{/if}
		{#if mode === 'transit'}
			<div class="timetable-scope">
				<Bus size={16} /><span
					><strong>Captured timetable · 10 Oct 2026</strong><small
						>Bus departures from 15:20 MVT. This is a dated timetable, not today's service.</small
					></span
				>
			</div>
			<div class="departure-fields">
				<Label for="journey-date"
					>Service date<Input
						id="journey-date"
						type="date"
						bind:value={serviceDate}
						onchange={onChange}
					/></Label
				><Label for="journey-time"
					>Leave at · MVT<Input
						id="journey-time"
						type="time"
						bind:value={departureTime}
						onchange={onChange}
					/></Label
				>
			</div>
		{/if}
		<Button
			class="find-journey"
			disabled={!start || !end || busy || (mode === 'transit' && (!serviceDate || !departureTime))}
			onclick={onFind}
			>{busy ? 'Finding your journey…' : 'Find directions'}<ArrowRight size={16} /></Button
		>
		{#if result}
			{#if result.status === 'ok' && journey}
				<div class="journey-summary" role="status">
					<strong>{Math.ceil(journey.minutes ?? 0)} min</strong><span
						>Arrive {journeyClock(journey.arrival_minutes)} MVT</span
					><small
						>{journey.uses_transit
							? 'Walk to the stop, take the named service, then continue to B.'
							: 'Walking is the quickest available option. No bus is needed for this route.'}</small
					>
				</div>
				<ol class="journey-itinerary" aria-label="Step by step journey">
					{#each journey.legs as leg, index (index)}
						<li class:ride={leg.mode === 'bus' || leg.mode === 'ferry'}>
							<span class="leg-icon"
								>{#if leg.mode === 'bus'}<Bus size={17} />{:else if leg.mode === 'ferry'}<Ship
										size={17}
									/>{:else if leg.mode === 'wait'}<Clock size={17} />{:else}<Footprints
										size={17}
									/>{/if}</span
							>
							<div>
								<strong
									>{leg.mode === 'bus' || leg.mode === 'ferry'
										? `Take ${leg.route_name ?? (leg.mode === 'bus' ? 'the bus' : 'the ferry')}`
										: leg.mode === 'wait'
											? `Wait at ${leg.from.name}`
											: `Walk to ${leg.to.name}`}</strong
								><span
									>{leg.mode === 'bus' || leg.mode === 'ferry'
										? `${leg.from.name} → ${leg.to.name}`
										: leg.mode === 'walk'
											? `From ${leg.from.name}`
											: leg.route_name
												? `For ${leg.route_name}`
												: 'Until departure'}</span
								><small
									>{journeyClock(leg.departure_minutes)}–{journeyClock(leg.arrival_minutes)} · {Math.ceil(
										leg.minutes
									)} min{leg.distance_m != null && leg.mode === 'walk'
										? ` · ${Math.round(leg.distance_m)} m`
										: ''}</small
								>
								{#if leg.mode === 'bus' || leg.mode === 'ferry'}<div class="boarding-copy">
										<b>Board:</b>
										{leg.from.name}<br /><b>Get off:</b>
										{leg.to.name}
									</div>{/if}
								{#if leg.stops.length > 2}<details>
										<summary>{leg.stops.length - 2} stops along the way</summary>
										<ul>
											{#each leg.stops.slice(1, -1) as stop (stop.id)}<li>
													{stop.name}<small>{journeyClock(stop.arrival_minutes)}</small>
												</li>{/each}
										</ul>
									</details>{/if}
							</div>
						</li>
					{/each}
				</ol>
				{#if journey.warnings.length}<details class="journey-data-note">
						<summary>Timetable & route coverage</summary
						>{#each journey.warnings as warning (warning)}<p>{warning}</p>{/each}
					</details>{/if}
			{:else if result.status === 'ok'}
				<div class="journey-summary" role="status">
					<strong>{Math.round(result.distance_m ?? 0).toLocaleString()} m</strong><span
						>Shortest {mode === 'walk' ? 'walking' : mode === 'bicycle' ? 'cycling' : 'road'} route</span
					><small>Road distance only. Travel time and live traffic are unavailable.</small>
				</div>
			{:else}<div class="journey-unavailable" role="status">
					<MapPin size={18} />
					<p>
						{reasons[unavailable ?? ''] ??
							(journey?.reason ||
								'No verified journey is available between these places at this time.')}
					</p>
					{#if journey?.warnings.length}<details>
							<summary>Why this journey is unavailable</summary
							>{#each journey.warnings as warning (warning)}<p>{warning}</p>{/each}
						</details>{/if}
				</div>{/if}
		{/if}
		<details class="journey-conditions" bind:open={conditionsOpen}>
			<summary
				><CloudSun size={16} /><span>Weather & traffic</span><small>For this journey</small
				></summary
			>
			{#if conditionsOpen}
				<MapConditionsPanel
					embedded
					coordinates={start ?? conditionsCoordinates}
					{islandName}
					{start}
					{end}
					{startLabel}
					{endLabel}
					onRoute={onConditionRoute}
					{onNotices}
				/>
			{/if}
		</details>
	{/if}
</section>

<style>
	.explore-journey {
		display: grid;
		gap: 13px;
		min-width: 0;
	}
	.journey-kinds {
		display: flex;
		padding: 4px;
		border: 1px solid var(--theme-color-dce7e1);
		border-radius: 11px;
		gap: 3px;
	}
	.journey-kinds :global(button) {
		flex: 1;
		font-size: 11px;
		padding-inline: 7px;
	}
	p {
		margin: 0;
		font-size: 12px;
		line-height: 1.6;
		color: var(--theme-color-65746c);
	}
	.travel-modes {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 4px;
		border-bottom: 1px solid var(--theme-color-dce7e1);
		padding-bottom: 10px;
	}
	.travel-modes button {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 5px;
		padding: 9px 3px;
		border-radius: 9px;
		color: var(--theme-color-65746c);
		cursor: pointer;
		font-size: 10px;
	}
	.travel-modes button.active {
		background: var(--theme-color-eef7f2);
		color: var(--theme-color-087f78);
		font-weight: 600;
	}
	.travel-modes button:hover {
		background: var(--theme-color-f2f5f2);
	}
	.travel-modes button:focus-visible {
		outline: 2px solid var(--theme-color-087f78);
		outline-offset: 2px;
	}
	.endpoint-layout {
		display: flex;
		align-items: flex-start;
		gap: 5px;
	}
	.endpoint-actions {
		display: grid;
		gap: 5px;
		padding-top: 19px;
		flex-shrink: 0;
	}
	.journey-endpoints {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 10px;
	}
	.endpoint-group {
		min-width: 0;
	}
	.journey-endpoint {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 46px;
		padding: 5px 6px;
		border: 1px solid var(--theme-color-dce7e1);
		border-radius: 9px;
		background: var(--theme-color-f9fcfa);
	}
	.journey-endpoint.picking {
		border-color: var(--theme-color-087f78);
		box-shadow: 0 0 0 1px var(--theme-color-087f78);
	}
	.journey-endpoint:focus-within {
		border-color: var(--theme-color-087f78);
	}
	.journey-endpoint input {
		flex: 1;
		width: 0;
		min-width: 0;
		padding: 7px 0;
		font-size: 12px;
		color: var(--theme-color-25272d);
		background: transparent;
		outline: none;
	}
	.journey-endpoint input::placeholder {
		color: var(--theme-color-6a796f);
	}
	.journey-endpoint :global(button) {
		flex-shrink: 0;
	}
	.endpoint-letter {
		flex: 0 0 19px;
		height: 19px;
		display: grid;
		place-items: center;
		border: 1px solid var(--theme-color-087f78);
		border-radius: 50%;
		color: var(--theme-color-087f78);
		font-weight: 700;
		font-size: 10px;
	}
	.destination .endpoint-letter {
		background: var(--theme-color-b76c43);
		border-color: var(--theme-color-b76c43);
		color: var(--theme-color-ffffff);
	}
	.endpoint-fallback {
		flex: 1;
		min-width: 0;
		font-size: 12px;
	}
	.map-picking-hint {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 10px;
		border-radius: 9px;
		background: var(--theme-color-eef7f2);
		color: var(--theme-color-087f78);
		font-weight: 600;
	}
	.map-picking-hint :global(svg) {
		flex-shrink: 0;
	}
	.endpoint-help {
		font-size: 11px;
	}
	.endpoint-help :global(svg) {
		display: inline-block;
		vertical-align: -2px;
	}
	.endpoint-results {
		margin-top: 5px;
		display: grid;
		gap: 2px;
		border: 1px solid var(--theme-color-dce7e1);
		padding: 4px;
		border-radius: 8px;
		background: var(--theme-color-ffffff);
		max-height: 230px;
		overflow-y: auto;
	}
	.endpoint-results button {
		display: flex;
		align-items: center;
		gap: 8px;
		text-align: left;
		padding: 9px 7px;
		border-radius: 5px;
		cursor: pointer;
		font-size: 11px;
	}
	.endpoint-results button:hover,
	.endpoint-results button:focus-visible {
		background: var(--theme-color-eef7f2);
		outline: 1px solid var(--theme-color-087f78);
	}
	.endpoint-results button span {
		display: grid;
		gap: 2px;
	}
	.endpoint-results small {
		font-size: 10px;
		color: var(--theme-color-6a796f);
		text-transform: capitalize;
	}
	.endpoint-results p {
		padding: 8px;
	}
	.journey-conditions {
		border-top: 1px solid var(--theme-color-dce7e1);
		padding-top: 8px;
	}
	.journey-conditions > summary {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		font-weight: 600;
		padding: 10px 0;
	}
	.journey-conditions > summary small {
		margin-left: auto;
		font-size: 10px;
		font-weight: 400;
	}
	.departure-fields {
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		gap: 9px;
	}
	.departure-fields :global(label) {
		display: grid;
		gap: 6px;
		min-width: 0;
		font-size: 11px;
	}
	.departure-fields :global(input) {
		min-width: 0;
		width: 100%;
		padding-inline: 8px;
	}
	.timetable-scope {
		display: flex;
		gap: 9px;
		padding: 12px;
		border-radius: 10px;
		background: var(--theme-color-edf4fa);
		color: var(--theme-color-355679);
	}
	.timetable-scope :global(svg) {
		flex-shrink: 0;
	}
	.timetable-scope span {
		display: grid;
		gap: 4px;
	}
	.timetable-scope strong {
		font-size: 11px;
	}
	.timetable-scope small {
		font-size: 10px;
		line-height: 1.5;
	}
	.explore-journey :global(.find-journey) {
		width: 100%;
	}
	.journey-summary {
		display: grid;
		gap: 5px;
		border-radius: 12px;
		padding: 16px;
		background: var(--theme-color-eef7f2);
		border: 1px solid var(--theme-color-d9e9df);
	}
	.journey-summary strong {
		font-size: 26px;
		letter-spacing: -0.8px;
	}
	.journey-summary span {
		font-size: 12px;
		font-weight: 600;
	}
	.journey-summary small {
		font-size: 11px;
		line-height: 1.6;
		color: var(--theme-color-62766a);
	}
	.journey-itinerary {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0;
	}
	.journey-itinerary > li {
		position: relative;
		display: flex;
		gap: 11px;
		padding: 12px 0;
		border-bottom: 1px solid var(--theme-color-e5ece7);
	}
	.leg-icon {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		flex: 0 0 30px;
		background: var(--theme-color-f2f5f2);
		border-radius: 9px;
		color: var(--theme-color-647769);
	}
	.ride .leg-icon {
		background: var(--theme-color-e9f0ff);
		color: var(--theme-color-2563eb);
	}
	.journey-itinerary > li > div {
		display: grid;
		gap: 4px;
		flex: 1;
		min-width: 0;
	}
	.journey-itinerary strong {
		font-size: 12px;
		overflow-wrap: anywhere;
	}
	.journey-itinerary span {
		font-size: 11px;
		line-height: 1.5;
	}
	.journey-itinerary small {
		font-size: 10px;
		color: var(--theme-color-738177);
	}
	.boarding-copy {
		font-size: 11px;
		line-height: 1.7;
	}
	details {
		font-size: 11px;
		color: var(--theme-color-617567);
	}
	summary {
		cursor: pointer;
		padding-block: 5px;
	}
	.journey-itinerary ul {
		list-style: none;
		margin: 0;
		padding: 5px 0;
		display: grid;
		gap: 6px;
	}
	.journey-itinerary ul li {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-size: 11px;
	}
	.journey-unavailable {
		display: grid;
		gap: 8px;
		padding: 14px;
		background: var(--theme-color-faf6ed);
		border: 1px solid var(--theme-color-eee0c8);
		border-radius: 12px;
	}
	.journey-unavailable :global(svg) {
		color: var(--theme-color-ad8246);
	}
</style>
