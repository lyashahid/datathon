<script lang="ts">
	import { onMount } from 'svelte';
	import { ArrowRight, RefreshCw } from '@lucide/svelte';
	import { api, subscribeApiInvalidation } from '#lib/api.js';
	import { ferryPlanningDate } from '#lib/ferry-planning.js';
	import {
		seaClock,
		seaConnectivityRating,
		type SeaConnectionMode,
		type SeaConnections
	} from '#lib/sea-connectivity.js';
	let {
		islandId,
		islandName,
		originId,
		originData,
		mode,
		serviceDate,
		departureMinutes,
		budgetMinutes,
		onExplore
	}: {
		islandId: string;
		islandName: string;
		originId: string;
		originData: SeaConnections | null;
		mode: SeaConnectionMode;
		serviceDate: string;
		departureMinutes: number | null;
		budgetMinutes: number;
		onExplore?: (islandId: string) => void;
	} = $props();
	let selectedData = $state.raw<SeaConnections | null>(null);
	let loading = $state(false);
	let error = $state('');
	let retry = $state(0);
	const isOrigin = $derived(islandId === originId);
	const data = $derived(isOrigin ? originData : selectedData);
	const view = $derived(
		isOrigin && mode === 'scenario' ? (data?.scenario ?? data?.baseline) : data?.baseline
	);
	const rating = $derived(view ? seaConnectivityRating(view, budgetMinutes) : null);
	onMount(() => subscribeApiInvalidation(() => (retry += 1)));
	$effect(() => {
		const selectedId = islandId,
			origin = originId,
			date = serviceDate,
			departure = departureMinutes,
			budget = budgetMinutes;
		void retry;
		selectedData = null;
		error = '';
		loading = false;
		if (selectedId === origin || !selectedId || departure === null || !ferryPlanningDate(date))
			return;
		const controller = new AbortController();
		loading = true;
		const timer = setTimeout(() => {
			api<SeaConnections>(
				'planning/sea-connections',
				{
					origin_island_id: selectedId,
					date,
					departure_minutes: departure,
					budget_minutes: budget,
					max_transfers: 2,
					operations: [],
					assumptions: {}
				},
				controller.signal
			)
				.then((value) => {
					if (!controller.signal.aborted) selectedData = value;
				})
				.catch((cause) => {
					if (!controller.signal.aborted)
						error =
							cause instanceof Error
								? cause.message
								: 'The connectivity rating could not be loaded.';
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
</script>

<section
	class="sea-island-rating"
	aria-label={`Sea connectivity rating for ${islandName}`}
	aria-busy={loading || (!data && !error)}
	data-testid="sea-island-rating"
>
	<div class="rating-heading">
		<div>
			<span>CONNECTIVITY RATING</span>
			<h3>{islandName}</h3>
		</div>
		<span class="rating-basis"
			>{isOrigin && mode === 'scenario' && data?.scenario
				? 'With proposal'
				: 'Existing sea network'}</span
		>
	</div>
	{#if error}<p role="alert">{error}</p>
		<button class="rating-action" onclick={() => (retry += 1)}
			><RefreshCw size={12} />Try again</button
		>
	{:else if rating}
		<div class="rating-value">
			<strong>{rating.reachable === null ? 'Unverified' : rating.reachable}</strong
			>{#if rating.reachable !== null}<span
					>{rating.reachable === 1 ? 'island' : 'islands'} within {budgetMinutes} min</span
				>{/if}
		</div>
		<p>{rating.reason}</p>
		<div class="rating-counts">
			<span><b>{rating.direct}</b> direct</span><span><b>{rating.transfer}</b> via transfers</span
			>{#if rating.unverified}<span><b>{rating.unverified}</b> unverified</span>{/if}
		</div>
		<p class="rating-context">
			{serviceDate} · from {seaClock(departureMinutes)} MVT · terminal to terminal
		</p>
		{#if rating.projected}<p class="rating-context">
				Projected from the published weekly timetable; confirm with the operator.
			</p>{/if}
		{#if !isOrigin && mode === 'scenario'}<p class="rating-context">
				This island’s rating uses the existing network. The proposal comparison remains centred on
				the original island.
			</p>{/if}
	{:else}<p role="status">Checking this island’s sea connectivity…</p>{/if}
	{#if !isOrigin && onExplore}<button class="rating-action" onclick={() => onExplore?.(islandId)}
			>Explore connections from here<ArrowRight size={13} /></button
		>{/if}
</section>

<style>
	.sea-island-rating {
		display: grid;
		gap: 9px;
		padding: 13px;
		border: 1px solid var(--theme-color-d5e6e5);
		border-radius: 11px;
		background: var(--theme-color-eff7f5);
		color: var(--theme-color-25454d);
	}
	.rating-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 9px;
	}
	.rating-heading > div {
		min-width: 0;
	}
	.rating-heading > div > span {
		font-size: 8px;
		font-weight: 650;
		letter-spacing: 1px;
		color: var(--theme-color-66858a);
	}
	h3 {
		margin: 3px 0 0;
		font-size: 14px;
		line-height: 1.4;
		letter-spacing: -0.2px;
		overflow-wrap: anywhere;
	}
	.rating-basis {
		padding-top: 2px;
		flex-shrink: 0;
		font-size: 8px;
		color: var(--theme-color-6a858a);
	}
	.rating-value {
		display: flex;
		align-items: baseline;
		gap: 7px;
	}
	.rating-value strong {
		font-size: 27px;
		font-weight: 650;
		line-height: 1.1;
		letter-spacing: -0.8px;
		color: var(--theme-color-087f8c);
		font-variant-numeric: tabular-nums;
	}
	.rating-value span {
		font-size: 10px;
		color: var(--theme-color-4d7078);
	}
	p {
		margin: 0;
		font-size: 10px;
		line-height: 1.6;
		color: var(--theme-color-56737a);
	}
	.rating-counts {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		font-size: 10px;
		color: var(--theme-color-5e7b82);
	}
	.rating-counts b {
		color: var(--theme-color-355e67);
		font-variant-numeric: tabular-nums;
	}
	.rating-context {
		font-size: 9px;
		color: var(--theme-color-728b90);
	}
	.rating-action {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 7px;
		width: 100%;
		min-height: 28px;
		padding: 5px 0;
		border: 0;
		border-top: 1px solid var(--theme-color-d8e7e5);
		background: transparent;
		color: var(--theme-color-087f8c);
		font-size: 10px;
		font-weight: 550;
		text-align: left;
		cursor: pointer;
	}
	.rating-action:hover {
		color: var(--theme-color-045761);
	}
	.rating-action:focus-visible {
		outline: 2px solid var(--theme-color-087f8c);
		outline-offset: 3px;
		border-radius: 3px;
	}
</style>
