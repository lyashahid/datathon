<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { api, subscribeApiInvalidation } from '#lib/api.js';
	import {
		seaMapState,
		seaServiceDate,
		type SeaConnections,
		type SeaMapState
	} from '#lib/sea-connectivity.js';
	import SeaIslandRating from './SeaIslandRating.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	let {
		islandId,
		islandName,
		onMapChange,
		onExplore
	}: {
		islandId: string;
		islandName: string;
		onMapChange: (state: SeaMapState | null) => void;
		onExplore: () => void;
	} = $props();
	let data = $state.raw<SeaConnections | null>(null);
	let error = $state('');
	let retry = $state(0);
	const serviceDate = seaServiceDate();
	onMount(() => subscribeApiInvalidation(() => retry++));
	$effect(() => {
		const origin = islandId;
		void retry;
		const controller = new AbortController();
		data = null;
		error = '';
		untrack(() => onMapChange(null));
		void api<SeaConnections>(
			'planning/sea-connections',
			{
				origin_island_id: origin,
				date: serviceDate,
				departure_minutes: 420,
				budget_minutes: 60,
				max_transfers: 2,
				operations: [],
				assumptions: {}
			},
			controller.signal
		)
			.then((value) => {
				if (controller.signal.aborted) return;
				data = value;
				onMapChange(seaMapState(value, 'baseline', '', ''));
			})
			.catch((cause) => {
				if (!controller.signal.aborted)
					error = cause instanceof Error ? cause.message : 'Sea connections could not load.';
			});
		return () => {
			controller.abort();
			onMapChange(null);
		};
	});
</script>

<div class="sea-layer-card">
	{#if error}
		<p role="alert">{error}</p>
		<Button variant="ghost" size="sm" onclick={() => retry++}>Try again</Button>
	{:else}
		<SeaIslandRating
			{islandId}
			{islandName}
			originId={islandId}
			originData={data}
			mode="baseline"
			{serviceDate}
			departureMinutes={420}
			budgetMinutes={60}
		/>
	{/if}
	<Button variant="ghost" size="sm" onclick={onExplore}>Explore sea connections</Button>
</div>

<style>
	.sea-layer-card {
		display: grid;
		gap: 6px;
		width: min(370px, calc(100vw - 40px));
		padding: 8px;
		border: 1px solid var(--theme-color-dce5dd);
		border-radius: 16px;
		background: var(--theme-color-fffffff9);
		box-shadow: 0 12px 38px var(--theme-color-1c3e3722);
	}
	p {
		padding: 8px;
		font-size: 12px;
	}
</style>
