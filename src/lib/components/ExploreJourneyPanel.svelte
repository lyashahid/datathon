<script lang="ts">
	import {
		ArrowLeft,
		ArrowLeftRight,
		ArrowRight,
		Bus,
		Footprints,
		MapPin,
		Ship,
		Clock,
		X,
		RotateCcw
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { journeyClock } from '#lib/explore-journey.js';
	import type { Coordinates, LandRoute } from '#lib/types.js';
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
		onBack,
		onFind,
		onChange
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
		onBack: () => void;
		onFind: () => void;
		onChange: () => void;
	} = $props();
	const journey = $derived(result?.journey);
	const unavailable = $derived(journey?.reason ?? result?.reason);
	const reasons: Record<string, string> = {
		no_verified_service_date:
			'There is no verified timetable for this date. Try the captured timetable on 10 October 2026.',
		no_active_service: 'No scheduled service is available for this departure time.',
		unreachable: 'These places are not connected in the available road or timetable data.',
		no_path: 'These places are not connected in the available road data.',
		no_graph: 'Road routing has not been mapped for this island yet.'
	};
</script>

<section class="explore-journey" aria-label="Explore journey directions">
	<div class="journey-heading">
		<Button variant="ghost" size="sm" onclick={onBack}><ArrowLeft size={14} />Back to map</Button
		><Button variant="ghost" size="sm" disabled={!start && !end} onclick={onReset}
			><RotateCcw size={14} />Reset</Button
		>
	</div>
	<h2>Where would you like to go?</h2>
	<p>Choose places on the map, or click a stop or a service. Drag A or B to move it.</p>
	<div class="journey-endpoints">
		{#each ['start', 'end'] as endpoint (endpoint)}
			{@const point = endpoint as 'start' | 'end'}
			{@const chosen = point === 'start' ? start : end}
			<div class="journey-endpoint" class:destination={point === 'end'}>
				<span class="endpoint-letter">{point === 'start' ? 'A' : 'B'}</span><button
					class="endpoint-choice"
					onclick={() => onPick(point)}
					><small>{point === 'start' ? 'Start' : 'Destination'}</small><span
						>{point === 'start' ? startLabel : endLabel}</span
					></button
				><Button
					variant="ghost"
					size="icon-sm"
					disabled={!chosen}
					aria-label={point === 'start' ? 'Remove start point' : 'Remove destination point'}
					onclick={() => onClear(point)}><X size={15} /></Button
				>
			</div>
		{/each}
	</div>
	<Button variant="ghost" size="sm" disabled={!start || !end} onclick={onSwap}
		><ArrowLeftRight size={14} />Swap start & destination</Button
	>
	<Label for="route-mode">Travel by</Label><NativeSelect.Root
		id="route-mode"
		bind:value={mode}
		onchange={onChange}
		><NativeSelect.Option value="walk">Walk</NativeSelect.Option><NativeSelect.Option
			value="transit">Bus & public transport</NativeSelect.Option
		><NativeSelect.Option value="bicycle">Bicycle</NativeSelect.Option><NativeSelect.Option
			value="car">Car</NativeSelect.Option
		><NativeSelect.Option value="taxi">Taxi</NativeSelect.Option></NativeSelect.Root
	>
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
					>Shortest mapped {mode === 'walk' ? 'walking' : mode === 'bicycle' ? 'cycling' : 'road'} route</span
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
</section>

<style>
	.explore-journey {
		display: grid;
		gap: 13px;
		min-width: 0;
	}
	.journey-heading {
		display: flex;
		justify-content: space-between;
		margin: -3px -8px 0;
	}
	h2 {
		font-size: 21px;
		line-height: 1.25;
		margin: 0;
		letter-spacing: -0.5px;
	}
	p {
		margin: 0;
		font-size: 12px;
		line-height: 1.6;
		color: #65746c;
	}
	.journey-endpoints {
		display: grid;
		gap: 8px;
	}
	.journey-endpoint {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 8px;
		border: 1px solid #dce7e1;
		border-radius: 12px;
		background: #f9fcfa;
	}
	.endpoint-letter {
		flex: 0 0 27px;
		height: 27px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: #087f78;
		color: white;
		font-weight: 700;
		font-size: 12px;
	}
	.destination .endpoint-letter {
		background: #b76c43;
	}
	.endpoint-choice {
		display: grid;
		gap: 2px;
		flex: 1;
		min-width: 0;
		text-align: left;
		cursor: pointer;
	}
	.endpoint-choice:focus-visible {
		outline: 2px solid #087f78;
		outline-offset: 4px;
		border-radius: 3px;
	}
	.endpoint-choice small {
		color: #6a796f;
		font-size: 10px;
	}
	.endpoint-choice span {
		font-size: 12px;
		font-weight: 600;
		overflow-wrap: anywhere;
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
		background: #edf4fa;
		color: #355679;
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
		background: #eef7f2;
		border: 1px solid #d9e9df;
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
		color: #62766a;
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
		border-bottom: 1px solid #e5ece7;
	}
	.leg-icon {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		flex: 0 0 30px;
		background: #f2f5f2;
		border-radius: 9px;
		color: #647769;
	}
	.ride .leg-icon {
		background: #e9f0ff;
		color: #2563eb;
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
		color: #738177;
	}
	.boarding-copy {
		font-size: 11px;
		line-height: 1.7;
	}
	details {
		font-size: 11px;
		color: #617567;
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
		background: #faf6ed;
		border: 1px solid #eee0c8;
		border-radius: 12px;
	}
	.journey-unavailable :global(svg) {
		color: #ad8246;
	}
</style>
