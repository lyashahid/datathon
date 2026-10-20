<script lang="ts">
	import { tick } from 'svelte';
	import { flip, type AnimationConfig } from 'svelte/animate';
	import { quartOut } from 'svelte/easing';
	import { slide, type TransitionConfig } from 'svelte/transition';
	import {
		ArrowDownUp,
		ArrowRight,
		Bike,
		Bus,
		Car,
		ChevronDown,
		Clock3,
		Crosshair,
		Footprints,
		Plus,
		Ship,
		Trash2,
		X
	} from '@lucide/svelte';
	import type { Geometry } from 'geojson';
	import MapSearch from '#lib/components/MapSearch.svelte';
	import LoadingSkeleton from '#lib/components/LoadingSkeleton.svelte';
	import { journeyClock, type JourneyPlace } from '#lib/explore-journey.js';
	import { animatedSelection, shouldAnimateMotion } from '#lib/motion.js';
	import { validPoint } from '#lib/planning-map.js';
	import { surfaceMotion } from '#lib/surface-motion.js';
	import type {
		SearchDirectionPoint,
		SearchDirectionsResult,
		SearchTravelMode
	} from '#lib/search-directions.js';
	import type { Coordinates, IslandFeature, MapFeatures } from '#lib/types.js';

	let {
		islands,
		island,
		features,
		places = [],
		loading = false,
		points = $bindable([
			{ id: 'start', name: '', coordinates: null },
			{ id: 'end', name: '', coordinates: null }
		]),
		mode = $bindable('transit'),
		serviceDate = $bindable(new Date().toISOString().slice(0, 10)),
		departureTime = $bindable('08:00'),
		result = null,
		busy = false,
		error = null,
		pickingIndex = null,
		onPick,
		onChange,
		onFind,
		onClose
	}: {
		islands: IslandFeature[];
		island: { id: string; name: string; coordinates?: Coordinates; boundary?: Geometry } | null;
		features: MapFeatures | null;
		places?: JourneyPlace[];
		loading?: boolean;
		points?: SearchDirectionPoint[];
		mode?: SearchTravelMode;
		serviceDate?: string;
		departureTime?: string;
		result?: SearchDirectionsResult | null;
		busy?: boolean;
		error?: string | null;
		pickingIndex?: number | null;
		onPick: (index: number) => void;
		onChange: () => void;
		onFind: () => void;
		onClose: () => void;
	} = $props();

	const componentId = $props.id();
	let stopSequence = 0;
	let endpointContainer: HTMLDivElement;
	let pendingFocusId = $state<string | null>(null);
	const modes = [
		{ value: 'walk' as const, label: 'Walk', icon: Footprints },
		{ value: 'transit' as const, label: 'Bus & ferry', icon: Bus },
		{ value: 'bicycle' as const, label: 'Bicycle', icon: Bike },
		{ value: 'car' as const, label: 'Car', icon: Car }
	];
	const ready = $derived(
		points.length >= 2 &&
			points.every((point) => validPoint(point.coordinates)) &&
			(mode !== 'transit' ||
				(/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) &&
					/^([01]\d|2[0-3]):[0-5]\d$/.test(departureTime)))
	);
	const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
	const warnings = $derived([...new Set(result?.warnings ?? [])]);
	const totalLabel = $derived(
		result?.status !== 'ok'
			? 'Partial journey'
			: result.minutes !== null
				? duration(result.minutes)
				: result.distance_m !== null
					? distance(result.distance_m)
					: 'Route found'
	);

	function pointLabel(index: number) {
		return index === 0
			? 'Starting point'
			: index === points.length - 1
				? 'Destination'
				: `Stop ${index}`;
	}
	function letter(index: number) {
		return String.fromCharCode(65 + index);
	}
	function duration(minutes: number) {
		if (minutes > 0 && minutes < 1) return 'Less than 1 min';
		const rounded = Math.round(minutes);
		return rounded >= 60
			? `${Math.floor(rounded / 60)} hr${rounded % 60 ? ` ${rounded % 60} min` : ''}`
			: `${rounded} min`;
	}
	function distance(meters: number) {
		return meters >= 1000 ? `${number.format(meters / 1000)} km` : `${Math.round(meters)} m`;
	}
	function formatDate(value: string) {
		const parsed = new Date(`${value}T12:00:00Z`);
		return Number.isNaN(parsed.getTime())
			? value
			: new Intl.DateTimeFormat('en-GB', {
					day: 'numeric',
					month: 'short',
					timeZone: 'UTC'
				}).format(parsed);
	}
	function routeReason(reason: string | null, fallback: string) {
		const messages: Record<string, string> = {
			different_islands: 'No connected mapped land route between these islands. Try Bus & ferry.',
			no_land_graph: 'The mapped street network is not available for this route.',
			no_nearby_land_node: 'Choose a point closer to a mapped street or path.',
			no_connected_path: 'No connected mapped route was found for this travel mode.',
			no_supported_transit_journey:
				'No journey could be confirmed with the available bus and ferry timetables.'
		};
		return reason ? (messages[reason] ?? reason) : fallback;
	}
	function updatePoint(index: number, point: SearchDirectionPoint) {
		points = points.map((existing, position) =>
			position === index ? { ...point, id: existing.id } : existing
		);
		onChange();
	}
	function editPoint(index: number, name: string) {
		const existing = points[index];
		if (!existing || (existing.name === name && existing.coordinates === null)) return;
		points = points.map((point, position) =>
			position === index ? { ...point, name, coordinates: null } : point
		);
		onChange();
	}
	function addStop() {
		if (points.length >= 10) return;
		const id = `${componentId}-stop-${++stopSequence}`;
		const animate = shouldAnimateMotion();
		pendingFocusId = id;
		points = [...points, { id, name: '', coordinates: null }];
		onChange();
		void tick().then(() => {
			if (!animate) focusAddedStop(id);
		});
	}
	function focusAddedStop(id: string) {
		if (pendingFocusId !== id) return;
		const row = [
			...(endpointContainer?.querySelectorAll<HTMLElement>('[data-directions-point-id]') ?? [])
		].find((element) => element.dataset.directionsPointId === id);
		row?.querySelector<HTMLInputElement>('[data-testid="directions-endpoint-input"]')?.focus();
		pendingFocusId = null;
	}
	function stopMotion(
		node: Element,
		{ enabled = true, removing = false }: { enabled?: boolean; removing?: boolean } = {}
	): TransitionConfig {
		return slide(node, {
			duration: enabled && shouldAnimateMotion() ? (removing ? 180 : 220) : 0,
			easing: quartOut
		});
	}
	function stopReflow(node: Element, position: { from: DOMRect; to: DOMRect }): AnimationConfig {
		return flip(node, position, {
			duration: shouldAnimateMotion() ? 240 : 0,
			easing: quartOut
		});
	}
	function removeStop(index: number) {
		if (points.length <= 2) return;
		if (pickingIndex !== null) onPick(pickingIndex);
		points = points.filter((_, position) => position !== index);
		onChange();
	}
	function reverse() {
		if (pickingIndex !== null) onPick(pickingIndex);
		points = [...points].reverse();
		onChange();
	}
	function close() {
		if (pickingIndex !== null) onPick(pickingIndex);
		onClose();
	}
	function handleEscape(event: KeyboardEvent) {
		if (event.key === 'Escape' && !event.defaultPrevented && pickingIndex !== null) {
			event.preventDefault();
			onPick(pickingIndex);
		}
	}
</script>

<svelte:window onkeydown={handleEscape} />

<section class="search-directions" data-testid="search-directions" aria-label="Directions">
	<header class="directions-heading">
		<div>
			<h2>Directions</h2>
			<p>Add stops in the order you want to visit them.</p>
		</div>
		<button
			class="directions-icon-button"
			type="button"
			aria-label="Close directions"
			onclick={close}><X size={17} aria-hidden="true" /></button
		>
	</header>
	<div
		class="directions-mode-group"
		role="group"
		aria-label="Travel mode"
		use:animatedSelection={{ selector: 'button.active' }}
	>
		{#each modes as option (option.value)}
			{@const Icon = option.icon}
			<button
				type="button"
				class:active={mode === option.value}
				aria-label={`${option.label} directions`}
				aria-pressed={mode === option.value}
				data-directions-mode={option.value}
				onclick={() => {
					if (mode !== option.value) {
						mode = option.value;
						onChange();
					}
				}}
				><Icon size={17} strokeWidth={1.75} aria-hidden="true" /><span>{option.label}</span></button
			>
		{/each}
	</div>
	<form
		class="directions-form"
		onsubmit={(event) => {
			event.preventDefault();
			if (ready && !busy) onFind();
		}}
	>
		<div class="directions-editor" bind:this={endpointContainer}>
			<div class="directions-endpoints">
				{#each points as point, index (point.id)}
					<div
						class="directions-endpoint-row"
						data-directions-point={index}
						data-directions-point-id={point.id}
						class:directions-picking={pickingIndex === index}
						animate:stopReflow
						in:stopMotion={{ enabled: point.id === pendingFocusId }}
						out:stopMotion={{ removing: true }}
						onintroend={() => focusAddedStop(point.id)}
					>
						<span class="directions-point-marker" aria-hidden="true">{letter(index)}</span>
						<MapSearch
							{islands}
							{island}
							{features}
							{places}
							{loading}
							variant="endpoint"
							selectedPoint={point}
							endpointLabel={pointLabel(index)}
							onEndpoint={(selected) => updatePoint(index, selected)}
							onQueryChange={(text) => editPoint(index, text)}
						/>
						<button
							class="directions-icon-button directions-pick-button"
							type="button"
							aria-label={`Choose ${pointLabel(index).toLowerCase()} on map`}
							aria-pressed={pickingIndex === index}
							title="Choose on map"
							onclick={() => onPick(index)}><Crosshair size={16} aria-hidden="true" /></button
						>
						{#if points.length > 2}<button
								class="directions-icon-button directions-remove-button"
								type="button"
								aria-label={`Remove ${pointLabel(index).toLowerCase()}`}
								title="Remove stop"
								onclick={() => removeStop(index)}><Trash2 size={14} aria-hidden="true" /></button
							>{/if}
					</div>
				{/each}
			</div>
			<div class="directions-edit-actions">
				<button
					class="directions-text-button"
					type="button"
					disabled={points.length >= 10}
					onclick={addStop}
					><Plus size={15} aria-hidden="true" />Add stop{#if points.length >= 10}<span
							class="directions-limit">10 maximum</span
						>{/if}</button
				>
				<button
					class="directions-text-button"
					type="button"
					aria-label="Reverse route"
					onclick={reverse}><ArrowDownUp size={14} aria-hidden="true" />Reverse</button
				>
			</div>
			{#if pickingIndex !== null}
				<div class="directions-pick-notice" role="status">
					<Crosshair size={15} aria-hidden="true" /><span
						>Choose {pointLabel(pickingIndex).toLowerCase()} on the map.</span
					><button type="button" onclick={() => onPick(pickingIndex!)}>Cancel</button>
				</div>
			{/if}
			{#if mode === 'transit'}
				<div class="directions-departure">
					<label for={`${componentId}-date`}
						>Travel date<input
							id={`${componentId}-date`}
							type="date"
							aria-label="Travel date"
							bind:value={serviceDate}
							onchange={onChange}
							required
						/></label
					>
					<label for={`${componentId}-time`}
						>Depart at<input
							id={`${componentId}-time`}
							type="time"
							aria-label="Departure time"
							bind:value={departureTime}
							onchange={onChange}
							required
						/></label
					>
				</div>
			{/if}
		</div>
		<div class="directions-submit-row">
			<button
				class="directions-submit"
				type="submit"
				disabled={!ready || busy}
				data-testid="find-directions"
				>{busy ? 'Finding directions…' : 'Find directions'}{#if !busy}<ArrowRight
						size={16}
						aria-hidden="true"
					/>{/if}</button
			>
		</div>
	</form>
	{#if busy}<div class="directions-progress" aria-busy="true">
			<LoadingSkeleton
				variant="route"
				label={`Finding a route through all ${points.length} stops…`}
			/>
		</div>
	{:else if error}<div class="directions-error" role="alert">
			<strong>Directions couldn’t load</strong>
			<p>{error}</p>
			<button class="directions-text-button" type="button" disabled={!ready} onclick={onFind}
				>Try again</button
			>
		</div>
	{:else if result}
		<div
			class="directions-results"
			data-testid="directions-results"
			data-route-status={result.status}
			in:surfaceMotion
		>
			<div class="directions-result-summary">
				<div>
					<h3>{result.status === 'unreachable' ? 'No route found' : totalLabel}</h3>
					<p>
						{result.status === 'ok'
							? result.minutes !== null && result.distance_m !== null
								? distance(result.distance_m)
								: result.minutes === null
									? 'Travel time unavailable'
									: `${points.length} stops`
							: routeReason(result.reason, 'Some stops could not be connected.')}
					</p>
				</div>
				{#if result.status === 'ok' && mode === 'transit' && result.arrival_minutes !== null}<span
						class="directions-arrival"
						>Arrive<strong>{journeyClock(result.arrival_minutes)}</strong></span
					>{/if}
			</div>
			{#if mode === 'transit'}<p class="directions-service-date">
					{formatDate(result.service_date)} · {result.timezone}
				</p>{/if}
			{#if result.status === 'partial' && (result.known_minutes > 0 || result.known_distance_m > 0)}<p
					class="directions-partial-note"
				>
					Confirmed legs: {result.known_minutes > 0
						? duration(result.known_minutes)
						: ''}{result.known_minutes > 0 && result.known_distance_m > 0
						? ' · '
						: ''}{result.known_distance_m > 0 ? distance(result.known_distance_m) : ''}
				</p>{/if}
			<div class="directions-segments">
				{#each result.segments as segment (segment.index)}
					<details
						class="directions-segment"
						open={segment.index === 0}
						data-directions-segment={segment.index}
						data-segment-status={segment.status}
					>
						<summary
							><span class="directions-leg-markers"
								>{letter(segment.index)}<ArrowRight size={11} aria-hidden="true" />{letter(
									segment.index + 1
								)}</span
							><span class="directions-leg-title"
								><strong>{points[segment.index + 1]?.name || `Stop ${segment.index + 2}`}</strong
								><span
									>{segment.status === 'ok'
										? [
												segment.minutes !== null ? duration(segment.minutes) : '',
												segment.distance_m !== null ? distance(segment.distance_m) : ''
											]
												.filter(Boolean)
												.join(' · ') || 'Route found'
										: segment.status === 'skipped'
											? 'Not routed'
											: 'No route for this leg'}</span
								></span
							><ChevronDown size={14} aria-hidden="true" /></summary
						>
						<div class="directions-leg-detail">
							{#if segment.status !== 'ok'}<p class="directions-unavailable-leg">
									{routeReason(
										segment.reason,
										segment.status === 'skipped'
											? 'A previous leg could not be completed.'
											: 'No route connects these stops in this travel mode.'
									)}
								</p>
							{:else if segment.result?.journey}
								<ol class="directions-transit-legs">
									{#each segment.result.journey.legs as leg, legIndex (`${segment.index}:${legIndex}`)}
										{@const Icon =
											leg.mode === 'bus'
												? Bus
												: leg.mode === 'ferry'
													? Ship
													: leg.mode === 'wait'
														? Clock3
														: Footprints}
										<li data-leg-mode={leg.mode}>
											<span class="directions-transit-icon"
												><Icon size={15} aria-hidden="true" /></span
											>
											<div>
												<strong
													>{leg.mode === 'wait'
														? `Wait at ${leg.from.name}`
														: leg.mode === 'walk'
															? `Walk to ${leg.to.name}`
															: `${leg.route_name || (leg.mode === 'bus' ? 'Bus' : 'Ferry')} to ${leg.to.name}`}</strong
												><span
													>{journeyClock(leg.departure_minutes)}–{journeyClock(leg.arrival_minutes)} ·
													{duration(leg.minutes)}</span
												>{#if leg.geometry_warning}<small>{leg.geometry_warning}</small>{/if}
											</div>
										</li>
									{/each}
								</ol>
							{:else}<p class="directions-road-leg">
									From {points[segment.index]?.name || `Stop ${segment.index + 1}`} to {points[
										segment.index + 1
									]?.name || `Stop ${segment.index + 2}`}.{#if segment.minutes === null}
										Travel time is unavailable for this route.{/if}
								</p>{/if}
						</div>
					</details>
				{/each}
			</div>
			{#if warnings.length}<details class="directions-source-notes">
					<summary
						>Route notes <span>{warnings.length}</span><ChevronDown
							size={13}
							aria-hidden="true"
						/></summary
					>
					<ul>
						{#each warnings as warning (warning)}<li>{warning}</li>{/each}
					</ul>
				</details>{/if}
		</div>
	{:else}<p class="directions-help">
			{ready
				? 'Your stops are ready. Find directions to see the route.'
				: 'Choose a place for every stop, or select it on the map.'}
		</p>{/if}
</section>

<style>
	.search-directions {
		display: flex;
		flex-direction: column;
		width: 100%;
		min-width: 0;
		max-height: inherit;
		color: var(--theme-color-25272d);
	}
	.directions-heading {
		display: flex;
		flex: 0 0 auto;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 15px 14px 12px;
	}
	.directions-heading h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 650;
		letter-spacing: -0.04em;
		line-height: 1.3;
	}
	.directions-heading p {
		margin: 5px 0 0;
		color: var(--theme-color-73877d);
		font-size: 11px;
		line-height: 1.5;
	}
	.directions-icon-button {
		display: grid;
		flex: 0 0 auto;
		place-items: center;
		width: 28px;
		height: 30px;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--theme-color-65746c);
		cursor: pointer;
	}
	.directions-icon-button:hover {
		background: var(--theme-color-eef6f4);
		color: var(--theme-color-243a36);
	}
	.directions-mode-group {
		--selection-radius: 8px;
		--selection-background: var(--theme-color-ffffff);
		--selection-shadow: 0 1px 4px var(--theme-color-17373512);
		display: grid;
		flex: 0 0 auto;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 3px;
		margin: 0 14px 14px;
		padding: 4px;
		border: 1px solid var(--theme-color-e1e7e0);
		border-radius: 12px;
		background: var(--theme-color-f7faf7);
	}
	.directions-mode-group button {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 0;
		min-height: 37px;
		padding: 5px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--theme-color-65746c);
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
	}
	.directions-mode-group button[aria-pressed='true'] {
		background: var(--theme-color-ffffff);
		color: var(--theme-color-1d645e);
		box-shadow: 0 1px 4px var(--theme-color-17373512);
	}
	.directions-mode-group:global([data-selection-ready]) button.active {
		background: transparent;
		box-shadow: none;
	}
	.directions-form {
		display: flex;
		flex: 0 1 auto;
		flex-direction: column;
		min-height: 0;
	}
	.directions-editor {
		min-height: 110px;
		max-height: min(46dvh, 470px);
		padding: 0 12px;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
	}
	.directions-endpoints {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	.directions-endpoint-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
	}
	.directions-point-marker {
		display: grid;
		flex: 0 0 auto;
		place-items: center;
		width: 22px;
		height: 22px;
		border: 1px solid var(--theme-color-cbdcd6);
		border-radius: 50%;
		background: var(--theme-color-eef6f4);
		color: var(--theme-color-365b54);
		font-size: 10px;
		font-weight: 650;
	}
	.directions-endpoint-row:not(:last-child)::after {
		position: absolute;
		z-index: 0;
		top: 34px;
		bottom: -13px;
		left: 10px;
		width: 1px;
		background: repeating-linear-gradient(
			to bottom,
			var(--theme-color-cbdcd6) 0 2px,
			transparent 2px 5px
		);
		content: '';
	}
	.directions-endpoint-row > :global(.map-search) {
		flex: 1 1 auto;
		min-width: 0;
	}
	.directions-pick-button {
		width: 27px;
	}
	.directions-pick-button[aria-pressed='true'] {
		background: var(--theme-color-e4f2ef);
		color: var(--theme-color-1d645e);
	}
	.directions-remove-button {
		width: 22px;
	}
	.directions-edit-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 9px 2px 11px 28px;
	}
	.directions-text-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		min-height: 29px;
		padding: 4px 2px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--theme-color-365b54);
		font: inherit;
		font-size: 11px;
		font-weight: 550;
		cursor: pointer;
	}
	.directions-text-button:hover {
		color: var(--theme-color-1d645e);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.directions-text-button:disabled {
		opacity: 0.5;
		cursor: default;
		text-decoration: none;
	}
	.directions-limit {
		margin-left: 4px;
		font-size: 10px;
		font-weight: 400;
	}
	.directions-departure {
		display: grid;
		grid-template-columns: 1fr 0.8fr;
		gap: 10px;
		padding: 0 1px 13px 28px;
	}
	.directions-departure label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
		color: var(--theme-color-65746c);
		font-size: 10px;
		font-weight: 500;
	}
	.directions-departure input {
		width: 100%;
		min-width: 0;
		min-height: 34px;
		padding: 6px 8px;
		border: 1px solid var(--theme-color-d6e1db);
		border-radius: 8px;
		background: var(--theme-color-ffffff);
		color: var(--theme-color-25272d);
		font: inherit;
		font-size: 11px;
	}
	.directions-pick-notice {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 0 1px 12px 28px;
		padding: 9px;
		border-radius: 9px;
		background: var(--theme-color-eef6f4);
		color: var(--theme-color-365b54);
		font-size: 11px;
		line-height: 1.5;
	}
	.directions-pick-notice > :global(svg) {
		flex-shrink: 0;
	}
	.directions-pick-notice button {
		margin-left: auto;
		padding: 2px 0 2px 5px;
		border: 0;
		border-radius: 3px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.directions-submit-row {
		flex: 0 0 auto;
		padding: 0 14px 13px 40px;
	}
	.directions-submit {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		min-height: 37px;
		padding: 8px 12px;
		border: 0;
		border-radius: 9px;
		background: var(--theme-color-273732);
		color: var(--theme-color-ffffff);
		font: inherit;
		font-size: 12px;
		font-weight: 550;
		cursor: pointer;
	}
	.directions-submit:hover {
		background: var(--theme-color-365b54);
	}
	.directions-submit:disabled {
		background: var(--theme-color-e7eeea);
		color: var(--theme-color-73877d);
		cursor: default;
	}
	.directions-help,
	.directions-progress {
		flex: 0 0 auto;
		margin: 0;
		padding: 0 16px 15px;
		color: var(--theme-color-73877d);
		font-size: 11px;
		line-height: 1.6;
	}
	.directions-progress {
		padding: 16px;
		border-top: 1px solid var(--theme-color-e1e7e0);
	}
	.directions-error {
		flex: 0 0 auto;
		padding: 13px 16px;
		border-top: 1px solid var(--theme-color-e1e7e0);
		font-size: 12px;
	}
	.directions-error strong {
		font-weight: 550;
	}
	.directions-error p {
		margin: 6px 0;
		color: var(--theme-color-65746c);
		font-size: 11px;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.directions-results {
		flex: 1 1 auto;
		min-height: 90px;
		max-height: min(46dvh, 430px);
		padding: 14px 15px;
		overflow-y: auto;
		overscroll-behavior: contain;
		border-top: 1px solid var(--theme-color-e1e7e0);
		scrollbar-width: thin;
	}
	.directions-result-summary {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}
	.directions-result-summary h3 {
		margin: 0;
		color: var(--theme-color-243a36);
		font-size: 22px;
		font-weight: 650;
		letter-spacing: -0.045em;
		line-height: 1.25;
	}
	.directions-result-summary p {
		margin: 5px 0 0;
		color: var(--theme-color-65746c);
		font-size: 11px;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.directions-arrival {
		display: flex;
		flex: 0 0 auto;
		flex-direction: column;
		gap: 4px;
		color: var(--theme-color-73877d);
		font-size: 10px;
		text-align: right;
	}
	.directions-arrival strong {
		color: var(--theme-color-365b54);
		font-size: 14px;
		font-weight: 600;
	}
	.directions-service-date,
	.directions-partial-note {
		margin: 6px 0 0;
		color: var(--theme-color-73877d);
		font-size: 10px;
		line-height: 1.6;
	}
	.directions-partial-note {
		color: var(--theme-color-365b54);
	}
	.directions-segments {
		margin-top: 14px;
	}
	.directions-segment {
		border-top: 1px solid var(--theme-color-e7eeea);
	}
	.directions-segment summary {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 57px;
		padding: 10px 0;
		list-style: none;
		cursor: pointer;
	}
	.directions-segment summary::-webkit-details-marker,
	.directions-source-notes summary::-webkit-details-marker {
		display: none;
	}
	.directions-leg-markers {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 3px;
		color: var(--theme-color-48716e);
		font-size: 10px;
		font-weight: 650;
	}
	.directions-leg-title {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.directions-leg-title strong {
		overflow: hidden;
		font-size: 11px;
		font-weight: 550;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.directions-leg-title > span {
		color: var(--theme-color-73877d);
		font-size: 10px;
	}
	.directions-segment summary > :global(svg) {
		flex: 0 0 auto;
		color: var(--theme-color-73877d);
	}
	.directions-segment[open] summary > :global(svg) {
		transform: rotate(180deg);
	}
	.directions-leg-detail {
		padding: 0 0 12px 37px;
	}
	.directions-road-leg,
	.directions-unavailable-leg {
		margin: 0;
		color: var(--theme-color-65746c);
		font-size: 11px;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.directions-transit-legs {
		display: flex;
		flex-direction: column;
		gap: 13px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.directions-transit-legs li {
		display: flex;
		align-items: flex-start;
		gap: 9px;
	}
	.directions-transit-icon {
		display: grid;
		flex: 0 0 auto;
		place-items: center;
		width: 23px;
		height: 25px;
		border-radius: 6px;
		background: var(--theme-color-eef6f4);
		color: var(--theme-color-48716e);
	}
	.directions-transit-legs li > div {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.directions-transit-legs strong {
		font-size: 11px;
		font-weight: 500;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.directions-transit-legs span:not(.directions-transit-icon),
	.directions-transit-legs small {
		color: var(--theme-color-73877d);
		font-size: 10px;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.directions-source-notes {
		margin-top: 4px;
		border-top: 1px solid var(--theme-color-e7eeea);
	}
	.directions-source-notes summary {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 34px;
		color: var(--theme-color-65746c);
		font-size: 10px;
		list-style: none;
		cursor: pointer;
	}
	.directions-source-notes summary > :global(svg) {
		margin-left: auto;
	}
	.directions-source-notes summary span {
		padding: 1px 5px;
		border-radius: 5px;
		background: var(--theme-color-eef6f4);
		font-size: 9px;
	}
	.directions-source-notes ul {
		margin: 0;
		padding: 0 0 0 14px;
		color: var(--theme-color-73877d);
		font-size: 10px;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.directions-source-notes li + li {
		margin-top: 7px;
	}
	button:focus-visible,
	summary:focus-visible,
	input:focus-visible {
		outline: 2px solid var(--theme-color-087f78);
		outline-offset: 2px;
	}
	@media (max-width: 640px) {
		.directions-heading {
			padding-top: 12px;
		}
		.directions-mode-group button {
			gap: 4px;
			font-size: 10px;
		}
		.directions-editor {
			max-height: 32dvh;
		}
		.directions-results {
			max-height: 27dvh;
		}
		.directions-departure input {
			font-size: 16px;
		}
	}
</style>
