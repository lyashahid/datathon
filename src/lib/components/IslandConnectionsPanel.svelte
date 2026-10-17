<script lang="ts">
	import { onMount } from 'svelte';
	import { ArrowLeftRight, Check, MapPin, RefreshCw, Ship, TriangleAlert } from '@lucide/svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { api, subscribeApiInvalidation } from '#lib/api.js';
	import {
		ferryConnectionLabel,
		ferryFeatureBounds,
		type FerryConnectivity
	} from '#lib/ferry-planning.js';
	import type { Coordinates, MapFeatures } from '#lib/types.js';
	import type { FeatureCollection } from 'geojson';
	let {
		islands,
		originId = $bindable(''),
		destinationId = $bindable(''),
		serviceDate = $bindable('2026-10-10'),
		onPick,
		onPreview,
		onFocus,
		onPropose
	}: {
		islands: MapFeatures | null;
		originId: string;
		destinationId: string;
		serviceDate: string;
		onPick: (endpoint: 'origin' | 'destination') => void;
		onPreview: (features: FeatureCollection) => void;
		onFocus: (bounds: [Coordinates, Coordinates]) => void;
		onPropose: (origin: string, destination: string, serviceDate: string) => void;
	} = $props();
	let connection = $state.raw<FerryConnectivity | null>(null);
	let loading = $state(false);
	let error = $state('');
	let retry = $state(0);
	onMount(() => subscribeApiInvalidation(() => (retry += 1)));
	const choices = $derived(
		(islands?.features ?? [])
			.filter((feature) => feature.properties?.id?.startsWith('island:'))
			.map((feature) => ({
				id: String(feature.properties!.id),
				name: String(feature.properties!.name ?? 'Unnamed island'),
				atoll: String(feature.properties!.atoll ?? '')
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
	);
	$effect(() => {
		const origin = originId,
			destination = destinationId,
			date = serviceDate;
		void retry;
		connection = null;
		error = '';
		onPreview({ type: 'FeatureCollection', features: [] });
		if (!origin || !date || origin === destination) {
			loading = false;
			return;
		}
		const controller = new AbortController();
		loading = true;
		const params = new SvelteURLSearchParams({ origin_island_id: origin, date });
		if (destination) params.set('destination_island_id', destination);
		api<FerryConnectivity>(`planning/connectivity?${params}`, undefined, controller.signal)
			.then((value) => {
				if (controller.signal.aborted) return;
				connection = value;
				if (destination) {
					const preview: FeatureCollection = {
						type: 'FeatureCollection',
						features: [...value.map_features.features]
					};
					for (const [role, island, terminals] of [
						['origin', value.origin, value.terminals.origin],
						['destination', value.destination, value.terminals.destination]
					] as const) {
						const coordinates = terminals[0]?.coordinates ?? island?.coordinates;
						if (coordinates)
							preview.features.push({
								type: 'Feature',
								properties: {
									role,
									name: island?.name,
									location_basis: terminals.length ? 'mapped_terminal' : 'island_centre'
								},
								geometry: { type: 'Point', coordinates }
							});
					}
					onPreview(preview);
					const bounds = ferryFeatureBounds(preview);
					if (bounds) onFocus(bounds);
				}
			})
			.catch((cause) => {
				if (!controller.signal.aborted)
					error =
						cause instanceof Error
							? cause.message
							: 'Connection check unavailable. Please try again.';
			})
			.finally(() => {
				if (!controller.signal.aborted) loading = false;
			});
		return () => controller.abort();
	});
	$effect(() => () => onPreview({ type: 'FeatureCollection', features: [] }));
</script>

<section class="island-connections" aria-label="Island connections" aria-busy={loading}>
	<div class="connection-intro">
		<Ship size={20} />
		<div>
			<h2>Island connections</h2>
			<p>Explore public transport and ferry ports, then plan new connections.</p>
		</div>
	</div>
	<div class="connection-date">
		<Label for="connection-date">Travel date</Label><Input
			id="connection-date"
			type="date"
			bind:value={serviceDate}
		/>
		<p>Bus timetables are for 10 October 2026. Services on other dates may be unconfirmed.</p>
	</div>
	{#each ['origin', 'destination'] as endpoint (endpoint)}
		{@const from = endpoint === 'origin'}
		<div class="island-endpoint">
			<Label for={`connection-${endpoint}`}>{from ? 'From island' : 'To island'}</Label>
			<NativeSelect.Root
				id={`connection-${endpoint}`}
				value={from ? originId : destinationId}
				onchange={(event) => {
					if (from) originId = event.currentTarget.value;
					else destinationId = event.currentTarget.value;
				}}
			>
				<NativeSelect.Option value="">Choose an island</NativeSelect.Option>
				{#each choices as island (island.id)}<NativeSelect.Option value={island.id}
						>{island.name}{island.atoll ? ` · ${island.atoll}` : ''}</NativeSelect.Option
					>{/each}
			</NativeSelect.Root>
			<Button variant="ghost" size="sm" onclick={() => onPick(from ? 'origin' : 'destination')}
				><MapPin size={13} />Choose {from ? 'start' : 'destination'} on map</Button
			>
		</div>
	{/each}
	<div class="connection-actions">
		<Button
			variant="ghost"
			size="sm"
			disabled={!originId || !destinationId}
			onclick={() => {
				const previous = originId;
				originId = destinationId;
				destinationId = previous;
			}}><ArrowLeftRight size={13} />Swap</Button
		><Button
			variant="ghost"
			size="sm"
			disabled={!destinationId}
			onclick={() => (destinationId = '')}>Clear destination</Button
		>
	</div>
	{#if originId && originId === destinationId}<p class="connection-note" role="status">
			Choose a different island to check an inter-island journey.
		</p>{/if}
	{#if loading}<p class="connection-note" role="status">
			Checking connections and ports…
		</p>{:else if error}<div class="connection-note" role="alert">
			<p>{error}</p>
			<Button variant="outline" size="sm" onclick={() => (retry += 1)}
				><RefreshCw size={13} />Try again</Button
			>
		</div>{:else if connection}
		{#if connection.local_transport}{@const access = connection.local_transport}
			{@const busStops = access.bus_stop_count || access.planning_bus_stop_count}
			<section class="local-transport" aria-label="Public transport walking access">
				<span class="access-eyebrow">Public transport in {connection.origin.name}</span>
				<div>
					<strong
						>{access.resident_coverage_pct == null
							? 'Not yet measured'
							: `${Math.round(access.resident_coverage_pct)}%`}</strong
					><span
						>{access.resident_coverage_pct == null
							? 'Walking access has not been calculated for this island.'
							: `of estimated residents within a ${access.walk_target_minutes}-minute walk of a bus stop`}</span
					>
				</div>
				<p>
					{busStops} bus stop{busStops === 1 ? '' : 's'} in {connection.origin.name}
					· {access.ferry_terminal_count} ferry port{access.ferry_terminal_count === 1 ? '' : 's'}
				</p>
				<p>
					Walking access shows how close residents are to a stop. Check the timetable for
					departures.
				</p>
			</section>{/if}
		{#if connection.destination}
			<div
				class="connection-verdict"
				class:verified={connection.status === 'dated_service'}
				role="status"
			>
				{#if connection.status === 'dated_service'}<Check size={18} />{:else}<TriangleAlert
						size={18}
					/>{/if}
				<h3>{ferryConnectionLabel(connection.status)}</h3>
				{#each connection.reasons as reason (reason)}<p>{reason}</p>{/each}
			</div>
			<div class="landing-checks" aria-label="Ferry infrastructure check">
				{#each [{ island: connection.origin, terminals: connection.terminals.origin }, { island: connection.destination, terminals: connection.terminals.destination }] as endpoint (endpoint.island.id)}
					<div>
						<Ship size={15} /><span
							><strong>{endpoint.island.name}</strong><small
								>{endpoint.terminals.length
									? `${endpoint.terminals.length} ferry ${endpoint.terminals.length === 1 ? 'port' : 'ports'}`
									: 'Port location unavailable'}</small
							></span
						>
					</div>
				{/each}
			</div>
			{#if connection.links.length}<details class="service-evidence">
					<summary>Routes and timetables</summary>{#each connection.links as link (link.id)}<div>
							<strong>{link.name}</strong>
							<p>
								{link.mode === 'ferry' ? 'Ferry' : 'Bus'} · {link.evidence === 'dated_service'
									? 'Published timetable for this date'
									: 'Timetable unconfirmed'}{link.departure_count != null
									? ` · ${link.departure_count} departures`
									: ''}
							</p>
						</div>{/each}
				</details>{/if}
			<Button
				class="propose-ferry"
				disabled={!connection.terminals.origin.length || !connection.terminals.destination.length}
				onclick={() => onPropose(originId, destinationId, serviceDate)}
				><Ship size={16} />Plan a ferry service</Button
			>
			<p class="connection-note">
				Your proposal uses existing ports and includes vessel costs. Port permission and suitability
				need confirmation before the service can run.
			</p>
		{:else}
			<div class="connection-overview">
				<strong>{connection.reachable_islands.length}</strong><span>connected islands</span>
				<p>
					Choose a destination to see its routes, timetables and ports. A route needs a confirmed
					timetable before it can be used for a journey.
				</p>
			</div>
			{#if connection.reachable_islands.length}<div
					class="reachable-islands"
					aria-label="Connected islands"
				>
					{#each connection.reachable_islands.slice(0, 8) as island (island.id)}<Button
							variant="outline"
							size="sm"
							onclick={() => (destinationId = island.id)}>{island.name}</Button
						>{/each}
				</div>{/if}
		{/if}
		<details class="service-evidence">
			<summary>About these connections</summary>
			<p>
				Port locations, routes and timetables are checked separately. An unconfirmed connection may
				still have a service. Check with the operator for crossing times and passenger capacity.
			</p>
			<p>
				Local transport access measures walking distance to a stop. Island connections show which
				islands the network links.
			</p>
		</details>
	{/if}
</section>

<style>
	.island-connections {
		display: grid;
		gap: 14px;
		min-width: 0;
	}
	.connection-intro {
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}
	.connection-intro > :global(svg) {
		color: var(--theme-color-087f78);
		flex-shrink: 0;
		margin-top: 3px;
	}
	h2 {
		font-size: 20px;
		line-height: 1.3;
		letter-spacing: -0.5px;
		margin: 0 0 6px;
	}
	h3 {
		font-size: 13px;
		line-height: 1.5;
		margin: 0;
	}
	p {
		color: var(--theme-color-65746c);
		font-size: 11px;
		line-height: 1.65;
		margin: 0;
	}
	.connection-date {
		display: grid;
		gap: 7px;
	}
	.connection-date :global(label) {
		font-size: 11px;
	}
	.island-endpoint {
		display: grid;
		gap: 7px;
	}
	.island-endpoint :global(label) {
		font-size: 11px;
	}
	.island-endpoint :global(select) {
		width: 100%;
		min-width: 0;
	}
	.island-endpoint :global(button) {
		justify-self: start;
		padding-inline: 0;
	}
	.connection-actions {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.connection-note {
		font-size: 11px;
		color: var(--theme-color-65746c);
		line-height: 1.6;
	}
	.connection-verdict {
		padding: 14px;
		background: var(--theme-color-faf6ed);
		border: 1px solid var(--theme-color-eee0c8);
		border-radius: 12px;
		display: grid;
		gap: 8px;
		color: var(--theme-color-946630);
	}
	.connection-verdict.verified {
		background: var(--theme-color-edf7f1);
		border-color: var(--theme-color-d7e9df);
		color: var(--theme-color-087f78);
	}
	.landing-checks {
		display: grid;
		gap: 10px;
	}
	.landing-checks > div {
		display: flex;
		gap: 9px;
		align-items: center;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--theme-color-e3ebe6);
		color: var(--theme-color-087f78);
	}
	.landing-checks span {
		display: grid;
		gap: 3px;
	}
	.landing-checks strong {
		font-size: 12px;
		color: var(--theme-color-29483e);
	}
	.landing-checks small {
		font-size: 11px;
		color: var(--theme-color-65746c);
	}
	.service-evidence {
		font-size: 11px;
		color: var(--theme-color-617567);
	}
	.service-evidence summary {
		cursor: pointer;
		padding: 5px 0;
	}
	.service-evidence p,
	.service-evidence div {
		margin-top: 8px;
	}
	.local-transport {
		display: grid;
		gap: 9px;
		padding: 14px;
		background: var(--theme-color-eef6f4);
		border: 1px solid var(--theme-color-d5e6de);
		border-radius: 12px;
	}
	.access-eyebrow {
		font-size: 10px;
		font-weight: 650;
		color: var(--theme-color-587367);
	}
	.local-transport > div {
		display: grid;
		gap: 4px;
	}
	.local-transport strong {
		font-size: 28px;
		letter-spacing: -0.7px;
		color: var(--theme-color-087f78);
	}
	.local-transport > div > span {
		font-size: 11px;
		line-height: 1.6;
		color: var(--theme-color-38584c);
	}
	.connection-overview {
		padding: 15px;
		border: 1px solid var(--theme-color-dce8e2);
		background: var(--theme-color-f5faf7);
		border-radius: 12px;
		display: grid;
		gap: 6px;
	}
	.connection-overview strong {
		font-size: 32px;
		color: var(--theme-color-087f78);
		line-height: 1.1;
	}
	.connection-overview span {
		font-size: 12px;
		font-weight: 600;
		color: var(--theme-color-29483e);
	}
	.reachable-islands {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
</style>
