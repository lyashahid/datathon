<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import {
		ArrowLeft,
		ArrowRight,
		Clock3,
		MapPin,
		RefreshCw,
		Search,
		Ship,
		X
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import SeaIslandRating from '#lib/components/SeaIslandRating.svelte';
	import { api, subscribeApiInvalidation } from '#lib/api.js';
	import { ferryPlanningDate } from '#lib/ferry-planning.js';
	import type { PlanningOperation } from '#lib/planning-map.js';
	import type { Coordinates } from '#lib/types.js';
	import {
		seaClock,
		seaClockMinutes,
		seaDestinations,
		seaDuration,
		seaRouteEvidenceLabel,
		seaMapState,
		seaNetworkBounds,
		seaSelectionBounds,
		seaServiceDate,
		seaStatusLabel,
		seaUniqueStrings,
		type SeaConnectionMode,
		type SeaConnections,
		type SeaDestination,
		type SeaMapSelection,
		type SeaMapState,
		type SeaSource
	} from '#lib/sea-connectivity.js';

	let {
		selectedIslandId,
		islandName,
		operations = [],
		assumptions = {},
		initialMode = 'baseline',
		initialDepartureMinutes = 420,
		serviceDate = $bindable(seaServiceDate()),
		selectedDestinationId = $bindable(''),
		selectedRouteId = $bindable(''),
		mapSelection,
		onMapChange,
		onFocus,
		onPropose,
		onExplore,
		onClose
	}: {
		selectedIslandId: string;
		islandName: string;
		operations?: PlanningOperation[];
		assumptions?: Record<string, unknown>;
		initialMode?: SeaConnectionMode;
		initialDepartureMinutes?: number;
		serviceDate?: string;
		selectedDestinationId?: string;
		selectedRouteId?: string;
		mapSelection?: SeaMapSelection | null;
		onMapChange: (state: SeaMapState | null) => void;
		onFocus: (bounds: [Coordinates, Coordinates]) => void;
		onPropose: (origin: string, destination: string, serviceDate: string) => void;
		onExplore?: (islandId: string) => void;
		onClose?: () => void;
	} = $props();
	let data = $state.raw<SeaConnections | null>(null);
	let focusedView = '';
	let loading = $state(false);
	let error = $state('');
	let retry = $state(0);
	let departureTime = $state(
		untrack(() =>
			seaClock(
				Number.isFinite(initialDepartureMinutes) &&
					initialDepartureMinutes >= 0 &&
					initialDepartureMinutes < 1440
					? initialDepartureMinutes
					: 420
			)
		)
	);
	let budget = $state(60);
	let checkReturn = $state(false);
	let returnTime = $state('18:00');
	let mode = $state<SeaConnectionMode>(untrack(() => initialMode));
	let filter = $state<'all' | 'timed' | 'return'>('all');
	let search = $state('');
	let visibleCount = $state(40);
	let scrollArea: HTMLDivElement;
	const operationsKey = $derived(JSON.stringify(operations));
	const assumptionsKey = $derived(JSON.stringify(assumptions));
	const view = $derived((mode === 'scenario' ? data?.scenario : null) ?? data?.baseline ?? null);
	const gainedIds = $derived(
		mode === 'scenario' ? (data?.comparison.newly_reachable_island_ids ?? []) : []
	);
	const improvedIds = $derived(
		mode === 'scenario' ? (data?.comparison.time_improved_island_ids ?? []) : []
	);
	const destinations = $derived(seaDestinations(view, search, filter, gainedIds));
	const destination = $derived(
		view?.destinations.find((item) => item.id === selectedDestinationId)
	);
	const route = $derived(view?.routes.find((item) => item.id === selectedRouteId));
	const hasProjection = $derived(
		view?.routes.some((item) => item.projection_status === 'published_pattern_projection')
	);
	const hasHistorical = $derived(
		view?.routes.some((item) => item.validity_status === 'historical')
	);
	const routeDepartures = $derived(
		route?.origin_departures?.length
			? route.origin_departures
			: route?.published_departures?.length
				? route.published_departures
				: (route?.departures ?? [])
	);
	const timedCount = $derived(
		view?.destinations.filter((item) => item.journey && item.within_budget).length ?? 0
	);
	const returnCount = $derived(
		view?.destinations.filter(
			(item) =>
				item.journey &&
				item.within_budget &&
				item.return_status === 'feasible' &&
				item.return_journey
		).length ?? 0
	);
	const sources = $derived(new Map((data?.sources ?? []).map((source) => [source.id, source])));
	const inputError = $derived.by(() => {
		if (!ferryPlanningDate(serviceDate)) return 'Choose a valid service date.';
		const depart = seaClockMinutes(departureTime);
		if (depart === null) return 'Choose a valid departure time.';
		if (checkReturn) {
			const deadline = seaClockMinutes(returnTime);
			if (deadline === null || deadline <= depart)
				return 'Return by must be later than the departure time.';
		}
		return '';
	});

	onMount(() => subscribeApiInvalidation(() => (retry += 1)));
	onDestroy(() => onMapChange(null));
	$effect(() => {
		const origin = selectedIslandId;
		untrack(() => {
			selectedDestinationId = '';
			selectedRouteId = '';
			search = '';
			visibleCount = 40;
		});
		void origin;
	});
	$effect(() => {
		const selection = mapSelection;
		if (!selection) return;
		untrack(() => {
			if (selection.kind === 'route') {
				selectedRouteId = selection.id;
				selectedDestinationId = '';
			} else {
				selectedDestinationId = selection.id === selectedIslandId ? '' : selection.id;
				selectedRouteId = '';
				scrollArea?.scrollTo({ top: 0 });
			}
		});
	});
	$effect(() => {
		const origin = selectedIslandId,
			date = serviceDate,
			departure = seaClockMinutes(departureTime),
			deadline = checkReturn ? seaClockMinutes(returnTime) : null,
			minutes = budget,
			operationSnapshot = operationsKey,
			assumptionSnapshot = assumptionsKey,
			invalid = inputError;
		void retry;
		data = null;
		error = '';
		loading = false;
		untrack(() => onMapChange(null));
		if (!origin || invalid || departure === null) return;
		const controller = new AbortController();
		loading = true;
		const timer = setTimeout(() => {
			api<SeaConnections>(
				'planning/sea-connections',
				{
					origin_island_id: origin,
					date,
					departure_minutes: departure,
					budget_minutes: minutes,
					return_deadline_minutes: deadline,
					minimum_stay_minutes: 60,
					max_transfers: 2,
					operations: JSON.parse(operationSnapshot),
					assumptions: JSON.parse(assumptionSnapshot)
				},
				controller.signal
			)
				.then((value) => {
					if (controller.signal.aborted) return;
					data = value;
					if (!value.scenario && mode === 'scenario') mode = 'baseline';
				})
				.catch((cause) => {
					if (!controller.signal.aborted)
						error = cause instanceof Error ? cause.message : 'Sea connections could not be loaded.';
				})
				.finally(() => {
					if (!controller.signal.aborted) loading = false;
				});
		}, 120);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});
	$effect(() => {
		const current = data;
		const selection = selectedDestinationId;
		const routeSelection = selectedRouteId;
		const currentMode = mode;
		untrack(() =>
			onMapChange(current ? seaMapState(current, currentMode, selection, routeSelection) : null)
		);
	});
	$effect(() => {
		void search;
		void filter;
		visibleCount = 40;
	});
	$effect(() => {
		if (!checkReturn && filter === 'return') filter = 'all';
	});
	$effect(() => {
		const currentView = view;
		const current = data;
		const currentMode = mode;
		if (!currentView || !current) return;
		untrack(() => {
			if (selectedRouteId && !currentView.routes.some((item) => item.id === selectedRouteId))
				selectedRouteId = '';
			const focusKey = `${current.origin.id}:${currentMode}`;
			if (focusedView !== focusKey) {
				const bounds = seaNetworkBounds(currentView, current.origin);
				if (bounds) onFocus(bounds);
				focusedView = focusKey;
			}
		});
	});

	function chooseDestination(item: SeaDestination) {
		selectedDestinationId = item.id;
		selectedRouteId = '';
		scrollArea?.scrollTo({ top: 0 });
		if (view && data) {
			const bounds = seaSelectionBounds(view, data.origin, item.id);
			if (bounds) onFocus(bounds);
		}
	}
	function chooseRoute(id: string) {
		selectedRouteId = id;
		selectedDestinationId = '';
		if (view && data) {
			const bounds = seaSelectionBounds(view, data.origin, '', id);
			if (bounds) onFocus(bounds);
		}
	}
	function islandLabel(id: string | null) {
		if (!id) return 'Island identity unverified';
		return id === data?.origin.id
			? data.origin.name
			: (view?.destinations.find((item) => item.id === id)?.name ??
					view?.routes.flatMap((item) => item.stops).find((stop) => stop.island_id === id)
						?.island_name ??
					'Island');
	}
	function sourceUrl(source: SeaSource) {
		return source.url && /^https?:\/\//i.test(source.url) ? source.url : null;
	}
</script>

<section
	class="sea-connections-panel"
	aria-label="Sea connections"
	aria-busy={loading}
	data-testid="sea-connections-panel"
>
	<header class="sea-header">
		<div class="sea-heading">
			<span class="sea-icon"><Ship size={19} /></span>
			<div>
				<span class="sea-eyebrow">SEA CONNECTIONS</span>
				<h2>From {islandName || 'this island'}</h2>
			</div>
		</div>
		{#if onClose}<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Close sea connections"
				onclick={onClose}><X size={17} /></Button
			>{/if}
	</header>
	<div class="sea-scroll" bind:this={scrollArea}>
		{#if !error && !inputError}<SeaIslandRating
				islandId={selectedDestinationId || selectedIslandId}
				islandName={selectedDestinationId
					? destination?.name ||
						(mapSelection?.kind === 'island' && mapSelection.id === selectedDestinationId
							? mapSelection.name
							: '') ||
						'Selected island'
					: islandName}
				originId={selectedIslandId}
				originData={data}
				{mode}
				{serviceDate}
				departureMinutes={seaClockMinutes(departureTime)}
				budgetMinutes={budget}
				{onExplore}
			/>{/if}
		<p class="sea-intro">See which islands are linked, then check whether a timed journey works.</p>
		<p class="sea-small">From the boarding point · Maldives time</p>
		<div class="sea-fields">
			<Label for="sea-date"
				>Travel date<Input id="sea-date" type="date" bind:value={serviceDate} /></Label
			>
			<Label for="sea-departure"
				>Leave at · MVT<Input id="sea-departure" type="time" bind:value={departureTime} /></Label
			>
		</div>
		<div class="sea-time-budget">
			<span>Reach within</span>
			<div aria-label="Sea travel time budget">
				{#each [30, 60, 120] as minutes (minutes)}<button
						class:active={budget === minutes}
						aria-pressed={budget === minutes}
						onclick={() => (budget = minutes)}>{minutes} min</button
					>{/each}
			</div>
		</div>
		<label class="sea-return-option"
			><input type="checkbox" bind:checked={checkReturn} />Check a same-day return</label
		>
		{#if checkReturn}<div class="sea-return-fields">
				<Label for="sea-return"
					>Back at origin by · MVT<Input
						id="sea-return"
						type="time"
						bind:value={returnTime}
					/></Label
				>
				<p>Allows at least one hour at the destination.</p>
			</div>{/if}
		{#if inputError}<p class="sea-notice" role="status">{inputError}</p>{/if}
		{#if operations.length}
			<div class="sea-scenario-switch" aria-label="Compare ferry proposal">
				<button
					class:active={mode === 'baseline'}
					aria-pressed={mode === 'baseline'}
					onclick={() => (mode = 'baseline')}>Without proposal</button
				><button
					class:active={mode === 'scenario'}
					aria-pressed={mode === 'scenario'}
					disabled={Boolean(data && !data.scenario)}
					onclick={() => (mode = 'scenario')}>With proposal</button
				>
			</div>
		{/if}
		{#if loading}<div class="sea-loading" role="status">
				<Ship size={19} />
				<div>
					<strong>Checking sea connections…</strong>
					<p>Loading routes and departure times.</p>
				</div>
			</div>
		{:else if error}<div class="sea-notice sea-error" role="alert">
				<p>{error}</p>
				<Button variant="outline" size="sm" onclick={() => (retry += 1)}
					><RefreshCw size={13} />Try again</Button
				>
			</div>
		{:else if data && view}
			<div class="sea-metrics" aria-label="Sea connectivity summary">
				<div><strong>{view.summary.direct_islands}</strong><span>direct islands</span></div>
				<div><strong>{view.summary.transfer_islands}</strong><span>with transfers</span></div>
				<div class="sea-metric-timed">
					<strong>{timedCount}</strong><span>within {budget} min</span>
				</div>
			</div>
			<p class="sea-small">Unique destination islands. Two directions to one island count once.</p>
			<p class="sea-small">
				Direct and transfer connections describe the route network. Timed journeys also need a valid
				timetable.
			</p>
			{#if hasProjection}<p class="sea-notice">
					Departure times are projected from published weekly patterns. Confirm the sailing with the
					operator before travelling.
				</p>{/if}
			{#if hasHistorical}<p class="sea-notice">
					Historical routes are shown as unverified connections. They do not establish current
					service or count as timed reachability.
				</p>{/if}
			{#if mode === 'scenario' && data.scenario}<div class="sea-impact" role="status">
					<strong
						>{data.comparison.newly_reachable_island_ids.length} newly reachable {data.comparison
							.newly_reachable_island_ids.length === 1
							? 'island'
							: 'islands'}</strong
					>
					<p>
						{data.comparison.time_improved_island_ids.length} with a quicker timed journey · {data
							.comparison.new_direct_island_ids.length} new direct connections
					</p>
					{#if data.comparison.lost_reachable_island_ids.length}<p>
							{data.comparison.lost_reachable_island_ids.length} destinations lose timed reachability
							with this proposal.
						</p>{/if}
					{#each seaUniqueStrings(data.comparison.warnings) as warning (warning)}<p>
							{warning}
						</p>{/each}<small
						>Compared with the existing network at this departure time and time limit.</small
					>
				</div>{/if}
			{#if checkReturn}<p class="sea-return-count">
					<Clock3 size={13} />{returnCount}
					{returnCount === 1 ? 'island has' : 'islands have'} a timed return by {returnTime}.
				</p>{/if}
			<div class="sea-legend" aria-label="Sea map legend">
				<span><i class="direct"></i>Direct</span><span><i class="transfer"></i>Transfer</span><span
					><i class="unverified"></i>Unverified</span
				>{#if mode === 'scenario'}<span><i class="proposal"></i>Proposal</span
					>{#if gainedIds.length || improvedIds.length}<span
							><i class="improved"></i>New / quicker</span
						>{/if}{/if}
			</div>
			<p class="sea-small">
				Lines connect ports around the coastline. A ring marks arrival within {budget} min.
			</p>
			{#if destination}
				<section
					class="sea-inspector"
					aria-label="Selected sea destination"
					data-testid="sea-destination-detail"
				>
					<button
						class="sea-back"
						onclick={() => {
							selectedDestinationId = '';
							selectedRouteId = '';
						}}><ArrowLeft size={13} />All destinations</button
					>
					<div class="sea-inspector-heading">
						<h3>{destination.name}</h3>
						<span class="sea-badge" data-status={destination.status}
							>{seaStatusLabel(destination.status)}</span
						>
					</div>
					{#if destination.journey}
						<div class="sea-arrival">
							<strong>{seaDuration(destination.journey.total_minutes)}</strong><span
								>Arrive {seaClock(destination.journey.arrival_minutes)} MVT</span
							>
						</div>
						<p class="sea-small">
							{seaDuration(destination.journey.wait_minutes)} waiting · {seaDuration(
								destination.journey.sailing_minutes
							)} sailing{destination.within_budget
								? ` · within ${budget} min`
								: ` · exceeds ${budget} min`}
						</p>
						<ol class="sea-itinerary" aria-label="Outbound ferry journey">
							{#each destination.journey.legs as leg, index (index)}<li>
									<span class="sea-leg-number">{index + 1}</span>
									<div>
										<button onclick={() => chooseRoute(leg.route_id)}
											>{leg.name}{#if leg.proposed}<span class="sea-proposal-label">Proposal</span
												>{/if}</button
										>
										<p>
											{islandLabel(leg.from_island_id)}
											<ArrowRight size={11} />
											{islandLabel(leg.to_island_id)}
										</p>
										<small
											>{seaClock(leg.departure_minutes)} → {seaClock(leg.arrival_minutes)} MVT · {seaDuration(
												leg.wait_minutes
											)} wait</small
										>
									</div>
								</li>{/each}
						</ol>
					{:else}<p class="sea-notice">
							{destination.status === 'direct' || destination.status === 'transfer'
								? 'These islands are connected. Journey times are unconfirmed for this date and departure time.'
								: 'Journey times are unavailable for this date. Check current service with the operator.'}
						</p>{/if}
					{#if checkReturn}<div class="sea-return-result">
							<strong
								>{destination.return_status === 'feasible' && destination.return_journey
									? `Return arrives ${seaClock(destination.return_journey.arrival_minutes)} MVT`
									: destination.return_status === 'unknown'
										? 'Return timetable needs verification'
										: 'No feasible return found in this timetable'}</strong
							>{#if destination.return_journey}<p>
									Leave {seaClock(destination.return_journey.departure_minutes)} MVT · {seaDuration(
										destination.return_journey.total_minutes
									)} journey
								</p>{:else}<p>Check with the operator before arranging a same-day visit.</p>{/if}
						</div>{/if}
					{#if destination.route_ids.length}<div class="sea-route-links">
							<span>Connection routes</span
							>{#each seaUniqueStrings(destination.route_ids) as routeId (routeId)}{@const item =
									view.routes.find((candidate) => candidate.id === routeId)}{#if item}<button
										onclick={() => chooseRoute(item.id)}
										><Ship size={13} />{item.name}<ArrowRight size={13} /></button
									>{/if}{/each}
						</div>{/if}
					<Button
						class="sea-propose"
						variant="outline"
						onclick={() => onPropose(selectedIslandId, destination.id, serviceDate)}
						><Ship size={14} />Plan a ferry to {destination.name}</Button
					>
				</section>
			{:else if route}
				<section
					class="sea-inspector"
					aria-label="Selected ferry route"
					data-testid="sea-route-detail"
				>
					<button class="sea-back" onclick={() => (selectedRouteId = '')}
						><ArrowLeft size={13} />All destinations</button
					>
					<h3>{route.name}</h3>
					{#if route.route_code}<p class="sea-small">Route {route.route_code}</p>{/if}
					<p class="sea-operator">{route.operator || 'Operator unverified'}</p>
					<p class="sea-small">
						{route.stops[0]?.island_name ||
							route.stops[0]?.name ||
							islandLabel(route.from_island_id)}
						→ {route.stops.at(-1)?.island_name ||
							route.stops.at(-1)?.name ||
							islandLabel(route.to_island_id)}
					</p>
					<span
						class="sea-badge"
						data-status={route.evidence === 'proposal'
							? 'proposal'
							: route.evidence === 'dated_service'
								? 'direct'
								: 'unverified'}>{seaRouteEvidenceLabel(route)}</span
					>
					<ol class="sea-stop-list" aria-label="Route stops">
						{#each route.stops as stop, index (`${stop.id}-${index}`)}<li>
								<span></span>
								<div>
									<strong>{stop.name}</strong><small
										>{stop.island_name || islandLabel(stop.island_id)}</small
									>
								</div>
							</li>{/each}
					</ol>
					<div class="sea-route-metrics">
						<div>
							<span>Departures on this date</span><strong
								>{route.validity_status === 'historical'
									? 'Unverified'
									: route.frequency_windows?.length
										? 'See frequency'
										: routeDepartures.length || (route.departure_count ?? 'Unverified')}</strong
							>
						</div>
						<div>
							<span>Crossing time</span><strong>{seaDuration(route.crossing_minutes)}</strong>
						</div>
					</div>
					{#if routeDepartures.length}<details>
							<summary
								>{route.origin_departures?.length
									? `Departures from ${islandName}`
									: `Published departures from ${route.stops[0]?.name || 'the first stop'}`} · MVT</summary
							>
							<p class="sea-departures">{routeDepartures.map(seaClock).join(' · ')}</p>
						</details>{/if}
					{#if route.frequency_windows?.length}<div class="sea-service-windows">
							<strong>Published frequency · from {route.stops[0]?.name || 'the first stop'}</strong>
							{#each route.frequency_windows as window, index (index)}<p>
									{seaClock(window.start_minutes)}–{seaClock(window.end_minutes)} MVT · {window.headway_minutes
										? `every ${window.headway_minutes} min`
										: 'frequency unverified'}
									<small
										>{window.label}{window.includes_public_holidays
											? ' · includes public holidays'
											: ''}</small
									>
								</p>{/each}
						</div>{/if}
					{#if route.no_scheduled_service}<p class="sea-notice">
							The published calendar lists no scheduled service on this weekday. Confirm exceptions
							with the operator.
						</p>{/if}
					{#each route.no_service_windows ?? [] as window, index (index)}<p class="sea-small">
							Published break {seaClock(window.start_minutes)}–{seaClock(window.end_minutes)} MVT{window.reason
								? ` · ${window.reason}`
								: ''}.
						</p>{/each}
					{#each route.unknown_windows ?? [] as window, index (index)}<p class="sea-notice">
							Timetable detail is unverified for {seaClock(window.start_minutes)}–{seaClock(
								window.end_minutes
							)} MVT{window.reason ? ` · ${window.reason}` : ''}.
						</p>{/each}
					<p class="sea-small">
						{route.evidence === 'proposal'
							? 'Planned departures from your proposal, evaluated for the selected date.'
							: route.validity_status === 'historical'
								? `Historical publication${route.valid_from ? ` effective from ${route.valid_from}` : ''}${route.valid_until ? `, ending ${route.valid_until}` : ''}. Current operation and timing are unverified.`
								: route.valid_from
									? `Effective from ${route.valid_from}.${route.valid_until ? ` Published end date: ${route.valid_until}.` : ' No end date is published.'}`
									: 'Current timetable validity needs operator verification.'}
					</p>
					{#if route.current_as_of}<p class="sea-small">
							Source checked {route.current_as_of.slice(0, 10)}.
						</p>{/if}
					{#each seaUniqueStrings(route.qualifications) as note (note)}<p class="sea-small">
							{note}
						</p>{/each}
					{#if route.source_ids.length}<div class="sea-route-sources">
							<strong>Route sources</strong
							>{#each seaUniqueStrings(route.source_ids) as sourceId (sourceId)}{@const source =
									sources.get(sourceId)}{#if source}{@const href = sourceUrl(source)}{#if href}<a
											{href}
											target="_blank"
											rel="noreferrer">{source.title}<ArrowRight size={12} /></a
										>{:else}<span>{source.title}</span>{/if}{/if}{/each}
						</div>{/if}
				</section>
			{:else if selectedDestinationId}
				<section
					class="sea-inspector"
					aria-label="Selected sea destination"
					data-testid="sea-destination-detail"
				>
					<button class="sea-back" onclick={() => (selectedDestinationId = '')}
						><ArrowLeft size={13} />All destinations</button
					>
					<h3>
						{mapSelection?.kind === 'island' && mapSelection.id === selectedDestinationId
							? mapSelection.name || 'Selected island'
							: 'Selected island'}
					</h3>
					<span class="sea-badge" data-status="unknown">Connection details unavailable</span>
					<p class="sea-notice">
						A connection from {islandName} to this island is not listed. This does not prove that no ferry
						service operates.
					</p>
					<Button
						class="sea-propose"
						variant="outline"
						onclick={() => onPropose(selectedIslandId, selectedDestinationId, serviceDate)}
						><Ship size={14} />Plan a ferry to this island</Button
					>
				</section>
			{:else}
				<section class="sea-destinations" aria-label="Sea destination islands">
					<div class="sea-list-heading">
						<h3>Where can I go?</h3>
						<span>{destinations.length} {destinations.length === 1 ? 'island' : 'islands'}</span>
					</div>
					<div class="sea-search">
						<Search size={14} /><Input
							aria-label="Search sea destination islands"
							placeholder="Find a destination island"
							bind:value={search}
						/>
					</div>
					<div class="sea-list-filters" aria-label="Filter sea destinations">
						<button
							class:active={filter === 'all'}
							aria-pressed={filter === 'all'}
							onclick={() => (filter = 'all')}>Connections</button
						><button
							class:active={filter === 'timed'}
							aria-pressed={filter === 'timed'}
							onclick={() => (filter = 'timed')}>Within {budget} min</button
						>{#if checkReturn}<button
								class:active={filter === 'return'}
								aria-pressed={filter === 'return'}
								onclick={() => (filter = 'return')}>Day return</button
							>{/if}
					</div>
					{#if destinations.length}<div class="sea-destination-list">
							{#each destinations.slice(0, visibleCount) as item (item.id)}<button
									class="sea-destination"
									onclick={() => chooseDestination(item)}
									data-testid="sea-destination"
									><span class="sea-destination-dot" data-status={item.status}></span><span
										class="sea-destination-copy"
										><strong
											>{item.name}{#if gainedIds.includes(item.id)}<small class="sea-new-label"
													>New</small
												>{:else if improvedIds.includes(item.id)}<small class="sea-new-label"
													>Quicker</small
												>{/if}</strong
										><small
											>{seaStatusLabel(
												item.status
											)}{#if item.status === 'transfer' && item.transfers != null}
												· {item.transfers}
												{item.transfers === 1 ? 'transfer' : 'transfers'}{/if}</small
										></span
									><span class="sea-destination-time"
										>{#if item.journey}<strong>{seaDuration(item.journey.total_minutes)}</strong
											><small>{seaClock(item.journey.arrival_minutes)} MVT</small>{:else}<small
												>Time<br />unverified</small
											>{/if}</span
									><ArrowRight size={13} /></button
								>{/each}
						</div>
						{#if destinations.length > visibleCount}<Button
								variant="ghost"
								size="sm"
								onclick={() => (visibleCount += 40)}>Show more islands</Button
							>{/if}
					{:else}<div class="sea-empty">
							<MapPin size={20} /><strong
								>{search
									? 'No matching destinations'
									: filter === 'all'
										? 'Connection details unavailable'
										: 'No matching timed journeys found'}</strong
							>
							<p>
								{search
									? 'Try another island name.'
									: 'Check current service with the operator, review the route sources below, or plan a ferry connection.'}
							</p>
						</div>{/if}
				</section>
			{/if}
			<details class="sea-route-overview">
				<summary>Routes in this view <span>{view.routes.length}</span></summary>
				<div>
					{#each view.routes as item (item.id)}<button onclick={() => chooseRoute(item.id)}
							><Ship size={13} /><span
								><strong>{item.name}</strong><small
									>{item.operator || 'Operator unverified'} · {seaRouteEvidenceLabel(item)}</small
								></span
							><ArrowRight size={13} /></button
						>{/each}{#if !view.routes.length}<p class="sea-small">
							No routes are listed for this island.
						</p>{/if}
				</div>
			</details>
			<details class="sea-evidence">
				<summary>Sources and assumptions</summary>
				<div>
					<p>{data.qualification}</p>
					{#each seaUniqueStrings(data.coverage.notes) as note (note)}<p>{note}</p>{/each}
					<p>{data.vessel_assignment.reason}</p>
					<p>
						Routes describe island connections. Boat positions describe sightings; they do not
						establish a passenger route. Travel times here are terminal to terminal and exclude
						walking, check-in and disruption.
					</p>
					{#if data.sources.length}<h4>Sources used</h4>
						{#each data.sources as source (source.id)}{@const href = sourceUrl(source)}
							<div class="sea-source">
								{#if href}<a {href} target="_blank" rel="noreferrer"
										>{source.title}<ArrowRight size={12} /></a
									>{:else}<strong>{source.title}</strong>{/if}{#if source.publisher}<small
										>{source.publisher}</small
									>{/if}{#if source.retrieved_at}<small
										>Retrieved {source.retrieved_at.slice(0, 10)}</small
									>{/if}
							</div>{/each}{/if}
				</div>
			</details>
		{/if}
	</div>
</section>

<style>
	.sea-connections-panel {
		display: flex;
		flex-direction: column;
		width: 380px;
		max-width: 100%;
		max-height: min(760px, var(--sea-panel-height, calc(100dvh - 165px)));
		min-height: 0;
		overflow: hidden;
		border: 1px solid var(--theme-color-d8e4e6);
		border-radius: 18px;
		background: var(--theme-color-fbfdfc);
		color: var(--theme-color-253d49);
		box-shadow:
			0 12px 40px var(--theme-color-173a4a20),
			0 2px 7px var(--theme-color-173a4a0a);
	}
	.sea-header {
		display: flex;
		flex-shrink: 0;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 18px 18px 13px;
		border-bottom: 1px solid var(--theme-color-e4ecec);
	}
	.sea-heading {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.sea-icon {
		display: grid;
		place-items: center;
		width: 37px;
		height: 37px;
		flex-shrink: 0;
		border: 1px solid var(--theme-color-d2e8e8);
		border-radius: 11px;
		background: var(--theme-color-e9f5f3);
		color: var(--theme-color-087f8c);
	}
	.sea-eyebrow {
		color: var(--theme-color-688187);
		font-size: 9px;
		font-weight: 650;
		letter-spacing: 1.3px;
	}
	h2 {
		margin: 3px 0 0;
		font-size: 19px;
		line-height: 1.25;
		letter-spacing: -0.6px;
		overflow-wrap: anywhere;
	}
	.sea-scroll {
		display: flex;
		flex-direction: column;
		gap: 13px;
		min-height: 0;
		padding: 15px 18px 18px;
		overflow: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
	}
	p {
		margin: 0;
		font-size: 11px;
		line-height: 1.65;
		color: var(--theme-color-647b83);
	}
	.sea-intro {
		font-size: 12px;
	}
	.sea-fields {
		display: grid;
		grid-template-columns: 1.15fr 1fr;
		gap: 10px;
	}
	.sea-fields :global(label),
	.sea-return-fields :global(label) {
		display: grid;
		gap: 6px;
		min-width: 0;
		font-size: 10px;
		color: var(--theme-color-4d6872);
	}
	.sea-fields :global(input),
	.sea-return-fields :global(input) {
		width: 100%;
		min-width: 0;
		font-size: 12px;
		height: 36px;
		font-variant-numeric: tabular-nums;
	}
	.sea-time-budget {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 11px;
		color: var(--theme-color-5a747c);
	}
	.sea-time-budget > div,
	.sea-list-filters,
	.sea-scenario-switch {
		display: flex;
		gap: 3px;
		padding: 3px;
		border: 1px solid var(--theme-color-dce8e9);
		border-radius: 9px;
		background: var(--theme-color-eef4f4);
	}
	.sea-time-budget button,
	.sea-list-filters button,
	.sea-scenario-switch button {
		min-height: 29px;
		border: 0;
		border-radius: 6px;
		padding: 5px 10px;
		background: transparent;
		color: var(--theme-color-5c747d);
		font-size: 10px;
		font-weight: 550;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}
	.sea-time-budget button.active,
	.sea-list-filters button.active,
	.sea-scenario-switch button.active {
		background: var(--theme-color-ffffff);
		color: var(--theme-color-116976);
		box-shadow: 0 1px 4px var(--theme-color-19394614);
	}
	.sea-return-option {
		display: flex;
		gap: 8px;
		align-items: center;
		min-height: 30px;
		font-size: 11px;
		color: var(--theme-color-4c6873);
		cursor: pointer;
	}
	.sea-return-option input {
		accent-color: var(--theme-color-087f8c);
		width: 15px;
		height: 15px;
	}
	.sea-return-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		align-items: end;
		padding: 10px;
		border: 1px solid var(--theme-color-dde8eb);
		border-radius: 9px;
		background: var(--theme-color-f4f8fa);
	}
	.sea-return-fields p {
		font-size: 10px;
		padding-bottom: 3px;
	}
	.sea-scenario-switch button {
		flex: 1;
		min-height: 33px;
		font-size: 11px;
	}
	.sea-metrics {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 7px;
	}
	.sea-metrics > div {
		display: grid;
		gap: 5px;
		border: 1px solid var(--theme-color-e0e9e9);
		border-radius: 10px;
		padding: 12px 7px;
		background: var(--theme-color-f0f6f5);
	}
	.sea-metrics strong {
		font-size: 26px;
		line-height: 1;
		letter-spacing: -0.7px;
		color: var(--theme-color-087f8c);
		font-variant-numeric: tabular-nums;
	}
	.sea-metrics span {
		font-size: 9px;
		color: var(--theme-color-56747c);
	}
	.sea-metrics .sea-metric-timed {
		background: var(--theme-color-edf2fa);
		border-color: var(--theme-color-dde5f2);
	}
	.sea-metric-timed strong {
		color: var(--theme-color-566cc3);
	}
	.sea-small {
		font-size: 10px;
		line-height: 1.65;
	}
	.sea-metrics + .sea-small {
		margin-top: -7px;
	}
	.sea-impact {
		display: grid;
		gap: 6px;
		padding: 12px;
		border: 1px solid var(--theme-color-ecd8b4);
		border-radius: 10px;
		background: var(--theme-color-fff8eb);
	}
	.sea-impact > strong {
		font-size: 13px;
		color: var(--theme-color-91651d);
	}
	.sea-impact p {
		font-size: 10px;
		color: var(--theme-color-8c733f);
	}
	.sea-impact small {
		font-size: 9px;
		line-height: 1.6;
		color: var(--theme-color-99845b);
	}
	.sea-return-count {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		color: var(--theme-color-536aa6);
	}
	.sea-return-count :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}
	.sea-legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 11px;
		padding: 9px 0;
		border-block: 1px solid var(--theme-color-e4ecec);
	}
	.sea-legend span {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 9px;
		color: var(--theme-color-667d85);
	}
	.sea-legend i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--theme-color-087f8c);
	}
	.sea-legend i.transfer {
		background: var(--theme-color-566cc3);
	}
	.sea-legend i.unverified {
		background: var(--theme-color-a48858);
	}
	.sea-legend i.proposal {
		background: var(--theme-color-d08a28);
	}
	.sea-legend i.improved {
		background: var(--theme-color-22824e);
	}
	h3 {
		font-size: 14px;
		line-height: 1.4;
		margin: 0;
		letter-spacing: -0.2px;
	}
	.sea-list-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.sea-list-heading > span {
		font-size: 10px;
		color: var(--theme-color-728891);
	}
	.sea-destinations {
		display: grid;
		gap: 10px;
	}
	.sea-search {
		position: relative;
	}
	.sea-search > :global(svg) {
		position: absolute;
		top: 11px;
		left: 11px;
		color: var(--theme-color-8ba0a6);
		pointer-events: none;
	}
	.sea-search :global(input) {
		height: 36px;
		padding-left: 33px;
		font-size: 11px;
	}
	.sea-list-filters {
		width: fit-content;
		max-width: 100%;
		flex-wrap: wrap;
	}
	.sea-list-filters button {
		padding-inline: 9px;
		min-height: 27px;
		font-size: 10px;
	}
	.sea-destination-list {
		display: grid;
	}
	.sea-destination {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
		width: 100%;
		border: 0;
		border-bottom: 1px solid var(--theme-color-e5eded);
		padding: 12px 1px;
		background: transparent;
		color: var(--theme-color-5c7a84);
		text-align: left;
		cursor: pointer;
		border-radius: 5px;
		transition: background-color 120ms ease;
	}
	.sea-destination:hover {
		background: var(--theme-color-f0f6f5);
	}
	.sea-destination-dot {
		width: 7px;
		height: 7px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--theme-color-087f8c);
	}
	.sea-destination-dot[data-status='transfer'] {
		background: var(--theme-color-566cc3);
	}
	.sea-destination-dot[data-status='unverified'] {
		background: var(--theme-color-a48858);
	}
	.sea-destination-dot[data-status='unknown'] {
		background: var(--theme-color-87939b);
	}
	.sea-destination-copy {
		display: grid;
		flex: 1;
		gap: 4px;
		min-width: 0;
	}
	.sea-destination-copy strong {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 600;
		color: var(--theme-color-2f4e5a);
		overflow-wrap: anywhere;
	}
	.sea-destination-copy > small {
		font-size: 9px;
		line-height: 1.5;
		color: var(--theme-color-7a8f96);
	}
	.sea-new-label {
		padding: 2px 5px;
		border-radius: 4px;
		background: var(--theme-color-fff0cd);
		color: var(--theme-color-956918);
		font-size: 8px;
		text-transform: uppercase;
		letter-spacing: 0.4px;
	}
	.sea-destination-time {
		display: grid;
		gap: 4px;
		flex-shrink: 0;
		text-align: right;
	}
	.sea-destination-time strong {
		font-size: 11px;
		font-weight: 550;
		color: var(--theme-color-42737e);
		font-variant-numeric: tabular-nums;
	}
	.sea-destination-time small {
		font-size: 9px;
		line-height: 1.4;
		color: var(--theme-color-8798a0);
		font-variant-numeric: tabular-nums;
	}
	.sea-inspector {
		display: grid;
		gap: 11px;
		min-width: 0;
		padding: 13px;
		border: 1px solid var(--theme-color-d8e7e8);
		border-radius: 12px;
		background: var(--theme-color-f5f9f9);
	}
	.sea-inspector-heading {
		display: grid;
		gap: 8px;
	}
	.sea-back {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		width: fit-content;
		padding: 3px 0;
		border: 0;
		background: transparent;
		color: var(--theme-color-66818a);
		font-size: 10px;
		cursor: pointer;
	}
	.sea-badge {
		width: fit-content;
		max-width: 100%;
		padding: 4px 7px;
		border-radius: 5px;
		background: var(--theme-color-e4f2ef);
		color: var(--theme-color-24787b);
		font-size: 9px;
		line-height: 1.5;
	}
	.sea-badge[data-status='transfer'] {
		background: var(--theme-color-e9edf9);
		color: var(--theme-color-566cc3);
	}
	.sea-badge[data-status='unverified'],
	.sea-badge[data-status='unknown'] {
		background: var(--theme-color-f1ebdf);
		color: var(--theme-color-8e7447);
	}
	.sea-badge[data-status='proposal'] {
		background: var(--theme-color-fff0d6);
		color: var(--theme-color-91651d);
	}
	.sea-arrival {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 5px 10px;
	}
	.sea-arrival strong {
		font-size: 23px;
		letter-spacing: -0.7px;
		color: var(--theme-color-167c87);
		font-variant-numeric: tabular-nums;
	}
	.sea-arrival span {
		font-size: 10px;
		color: var(--theme-color-5b7781);
	}
	.sea-itinerary,
	.sea-stop-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 12px;
	}
	.sea-itinerary li {
		display: flex;
		gap: 8px;
		align-items: flex-start;
	}
	.sea-leg-number {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 21px;
		height: 21px;
		margin-top: 1px;
		border: 1px solid var(--theme-color-cfdee1);
		border-radius: 50%;
		font-size: 9px;
		color: var(--theme-color-6c8b96);
		background: var(--theme-color-ffffff);
	}
	.sea-itinerary li > div {
		display: grid;
		min-width: 0;
		gap: 4px;
	}
	.sea-itinerary button {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 5px;
		border: 0;
		padding: 0;
		background: transparent;
		text-align: left;
		font-size: 11px;
		line-height: 1.6;
		font-weight: 600;
		color: var(--theme-color-167c87);
		cursor: pointer;
	}
	.sea-itinerary p {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 5px;
		font-size: 10px;
	}
	.sea-itinerary small {
		font-size: 9px;
		line-height: 1.65;
		color: var(--theme-color-7c929a);
	}
	.sea-proposal-label {
		font-size: 8px;
		background: var(--theme-color-fff0cd);
		color: var(--theme-color-956918);
		padding: 1px 4px;
		border-radius: 3px;
	}
	.sea-return-result {
		display: grid;
		gap: 5px;
		padding-top: 10px;
		border-top: 1px solid var(--theme-color-dde8e9);
	}
	.sea-return-result strong {
		font-size: 11px;
		color: var(--theme-color-5874a4);
	}
	.sea-return-result p {
		font-size: 10px;
	}
	.sea-route-links {
		display: grid;
		gap: 5px;
	}
	.sea-route-links > span {
		font-size: 9px;
		color: var(--theme-color-7a9097);
	}
	.sea-route-links button,
	.sea-route-overview button {
		display: flex;
		gap: 7px;
		align-items: center;
		border: 0;
		border-bottom: 1px solid var(--theme-color-dfebeb);
		padding: 8px 0;
		background: transparent;
		text-align: left;
		color: var(--theme-color-3e7782);
		font-size: 10px;
		cursor: pointer;
	}
	.sea-route-links button > :global(svg:last-child) {
		margin-left: auto;
	}
	.sea-inspector :global(.sea-propose) {
		max-width: 100%;
		white-space: normal;
		height: auto;
		min-height: 34px;
		font-size: 10px;
	}
	.sea-operator {
		margin-top: -6px;
		font-size: 11px;
	}
	.sea-stop-list {
		gap: 0;
		margin: 2px 0;
	}
	.sea-stop-list li {
		position: relative;
		display: flex;
		gap: 10px;
		padding: 5px 0 12px;
	}
	.sea-stop-list li:not(:last-child)::after {
		content: '';
		position: absolute;
		left: 3px;
		top: 14px;
		bottom: -5px;
		width: 1px;
		background: var(--theme-color-bdd5da);
	}
	.sea-stop-list li > span {
		position: relative;
		z-index: 1;
		flex-shrink: 0;
		width: 7px;
		height: 7px;
		border: 1.5px solid var(--theme-color-4c8e99);
		border-radius: 50%;
		margin-top: 3px;
		background: var(--theme-color-f5f9f9);
	}
	.sea-stop-list li > div {
		display: grid;
		gap: 4px;
	}
	.sea-stop-list strong {
		font-size: 11px;
		font-weight: 550;
		color: var(--theme-color-3f626e);
	}
	.sea-stop-list small {
		font-size: 9px;
		color: var(--theme-color-81969d);
	}
	.sea-route-metrics {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 9px;
		padding-block: 10px;
		border-block: 1px solid var(--theme-color-dce8e9);
	}
	.sea-route-metrics > div {
		display: grid;
		gap: 6px;
	}
	.sea-route-metrics span {
		font-size: 9px;
		color: var(--theme-color-7d9299);
	}
	.sea-route-metrics strong {
		font-size: 13px;
		font-weight: 550;
		color: var(--theme-color-3f6a78);
	}
	details {
		font-size: 10px;
		color: var(--theme-color-667f87);
	}
	summary {
		cursor: pointer;
		min-height: 30px;
		padding: 7px 0;
		line-height: 1.5;
	}
	.sea-departures {
		font-variant-numeric: tabular-nums;
		word-spacing: 2px;
		font-size: 10px;
		padding-top: 5px;
	}
	.sea-service-windows {
		display: grid;
		gap: 9px;
		font-size: 10px;
		line-height: 1.7;
	}
	.sea-service-windows > strong {
		font-weight: 600;
		color: var(--theme-color-58737e);
	}
	.sea-service-windows small {
		display: block;
		color: var(--theme-color-7d9299);
		font-size: 9px;
	}
	.sea-route-sources {
		display: grid;
		gap: 7px;
		font-size: 10px;
	}
	.sea-route-sources > strong {
		font-size: 10px;
		color: var(--theme-color-58737e);
	}
	a {
		display: inline-flex;
		align-items: baseline;
		gap: 5px;
		color: var(--theme-color-147b86);
		text-decoration: underline;
		text-decoration-color: var(--theme-color-a7cccf);
		text-underline-offset: 3px;
		overflow-wrap: anywhere;
	}
	.sea-route-overview {
		border-top: 1px solid var(--theme-color-e1ebec);
		padding-top: 4px;
	}
	.sea-route-overview summary span {
		padding: 2px 5px;
		margin-left: 5px;
		border-radius: 4px;
		background: var(--theme-color-eaf1f2);
		font-size: 9px;
	}
	.sea-route-overview > div {
		display: grid;
	}
	.sea-route-overview button {
		padding: 9px 0;
	}
	.sea-route-overview button > span {
		display: grid;
		flex: 1;
		gap: 4px;
	}
	.sea-route-overview strong {
		color: var(--theme-color-466d79);
		font-size: 10px;
		font-weight: 550;
	}
	.sea-route-overview small {
		color: var(--theme-color-8a9ba2);
		font-size: 9px;
		line-height: 1.6;
	}
	.sea-evidence {
		border-top: 1px solid var(--theme-color-e1ebec);
		padding-top: 4px;
	}
	.sea-evidence > div {
		display: grid;
		gap: 9px;
		padding-top: 5px;
	}
	.sea-evidence p {
		font-size: 10px;
		line-height: 1.7;
	}
	h4 {
		font-size: 10px;
		font-weight: 600;
		margin: 3px 0 0;
	}
	.sea-source {
		display: grid;
		gap: 4px;
		font-size: 10px;
	}
	.sea-source small {
		font-size: 9px;
		color: var(--theme-color-899ba2);
	}
	.sea-loading {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 22px 8px;
		color: var(--theme-color-4f8d99);
	}
	.sea-loading > :global(svg) {
		flex-shrink: 0;
		margin-top: 1px;
	}
	.sea-loading strong {
		display: block;
		margin-bottom: 5px;
		color: var(--theme-color-426b78);
		font-size: 12px;
		font-weight: 550;
	}
	.sea-loading p {
		font-size: 10px;
	}
	.sea-notice {
		padding: 11px;
		border: 1px solid var(--theme-color-e7ddc4);
		border-radius: 9px;
		background: var(--theme-color-fcf8ed);
		color: var(--theme-color-8c7851);
		font-size: 10px;
		line-height: 1.7;
	}
	.sea-error {
		display: grid;
		justify-items: start;
		gap: 8px;
	}
	.sea-error p {
		color: var(--theme-color-926c54);
	}
	.sea-empty {
		display: grid;
		justify-items: center;
		gap: 9px;
		padding: 20px 8px;
		text-align: center;
		color: var(--theme-color-90a5ac);
	}
	.sea-empty strong {
		color: var(--theme-color-637e89);
		font-size: 12px;
		font-weight: 550;
	}
	.sea-empty p {
		max-width: 270px;
		font-size: 10px;
	}
	button:focus-visible,
	summary:focus-visible,
	a:focus-visible {
		outline: 2px solid var(--theme-color-087f8c);
		outline-offset: 3px;
	}
	button:active {
		transform: translateY(1px);
	}
	@media (max-width: 700px) {
		.sea-connections-panel {
			width: 100%;
			max-height: min(620px, var(--sea-panel-height, 66dvh));
			border-radius: 15px;
		}
		.sea-header {
			padding: 14px 14px 11px;
		}
		.sea-scroll {
			padding: 12px 14px 15px;
			gap: 12px;
		}
		h2 {
			font-size: 18px;
		}
		.sea-time-budget button,
		.sea-scenario-switch button,
		.sea-list-filters button {
			min-height: 35px;
		}
		.sea-destination {
			min-height: 55px;
		}
		summary {
			min-height: 39px;
			padding-block: 10px;
		}
		.sea-back {
			min-height: 30px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		button {
			transition: none !important;
		}
		button:active {
			transform: none;
		}
	}
</style>
