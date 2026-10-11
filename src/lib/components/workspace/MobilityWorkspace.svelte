<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { Map, TrendingUp, Scale, BookOpen, Menu } from '@lucide/svelte';
	import PlanningAtlas from '#lib/components/planning/PlanningAtlas.svelte';
	import PolicyWorkspace from '#lib/components/policy/PolicyWorkspace.svelte';
	import DataForecastWorkspace from '#lib/components/analytics/DataForecastWorkspace.svelte';
	import EvidenceWorkspace from './EvidenceWorkspace.svelte';
	import PassengerOutlookCard from './PassengerOutlookCard.svelte';
	import type { LayoutData } from '../../../routes/$types';
	import type { MonthlyForecast } from '#lib/prediction/types.ts';
	import type { PolicyMapContext } from '#lib/policy/decisions.ts';
	import {
		workspaceView,
		forecastMapSelection,
		validMonth,
		type MapSelection
	} from '#lib/workspace/context.ts';

	let { data }: { data: LayoutData } = $props();
	const workspaceUrl = $derived(page.url);
	let atlas = $state<PlanningAtlas | null>(null);
	let dataElement = $state<HTMLElement>();
	let mapContext = $state.raw<PolicyMapContext | undefined>(undefined);
	let selectedSeries = $state.raw<MonthlyForecast | null>(null);
	const view = $derived(workspaceView(workspaceUrl.pathname));
	const targetMonth = $derived(
		validMonth(workspaceUrl.searchParams.get('month')) ||
			data.prediction?.target?.month ||
			data.prediction?.monthly[0]?.forecastMonth
	);
	const selectedSeriesId = $derived(
		workspaceUrl.searchParams.get('forecast') ||
			selectedSeries?.seriesId ||
			data.prediction?.monthly[0]?.seriesId
	);
	const mapSeries = $derived(
		[selectedSeries, ...(data.prediction?.monthly ?? [])].find(
			(series) =>
				!!series && series.seriesId === selectedSeriesId && series.forecastMonth === targetMonth
		) ?? null
	);
	const nav = [
		{ id: 'map', path: '/', label: 'Map', icon: Map },
		{ id: 'forecasts', path: '/forecasts', label: 'Data and Forecasts', icon: TrendingUp },
		{ id: 'decisions', path: '/decisions', label: 'Decisions', icon: Scale },
		{ id: 'evidence', path: '/evidence', label: 'Evidence', icon: BookOpen }
	];
	function urlFor(path: string) {
		const query = new SvelteURLSearchParams(workspaceUrl.searchParams.toString());
		if (path !== '/evidence') query.delete('evidence');
		return path + (query.size ? `?${query}` : '');
	}
	function forecastUrl() {
		const query = new SvelteURLSearchParams(workspaceUrl.searchParams.toString());
		query.delete('evidence');
		query.set('dataView', 'forecasts');
		return `/forecasts?${query}`;
	}
	async function showEvidence(workflow: string) {
		const query = new SvelteURLSearchParams(workspaceUrl.searchParams.toString());
		query.set('evidence', workflow);
		await goto(`/evidence?${query}`);
	}
	async function showMap(selection: MapSelection = {}) {
		const query = new SvelteURLSearchParams(workspaceUrl.searchParams.toString());
		query.delete('evidence');
		query.delete('origin');
		query.delete('road');
		query.delete('island');
		if (selection.originId) query.set('origin', selection.originId);
		if (selection.roadEdgeId) query.set('road', selection.roadEdgeId);
		if (selection.islandId) query.set('island', selection.islandId);
		await goto('/' + (query.size ? `?${query}` : ''), { reset: false });
		await tick();
		atlas?.focusLocation(selection);
	}
	async function showForecast(series: MonthlyForecast) {
		selectedSeries = series;
		await setQuery({ forecast: series.seriesId, month: series.forecastMonth }, false);
		await showMap(data.planning ? forecastMapSelection(series, data.planning) : {});
	}
	async function setQuery(values: Record<string, string>, replaceState = true) {
		const query = new SvelteURLSearchParams(workspaceUrl.searchParams.toString());
		for (const [key, value] of Object.entries(values)) query.set(key, value);
		await goto(`${workspaceUrl.pathname}?${query}`, { replace: replaceState, reset: false });
	}
	async function openDataSection(dataView: string, dataset?: string) {
		await setQuery(dataset ? { dataView, dataset } : { dataView }, false);
		await tick();
		dataElement?.scrollTo({ top: 0 });
	}
	async function openForecastSeries(forecast: string) {
		await setQuery({ dataView: 'forecasts', forecast }, false);
		await tick();
		dataElement?.scrollTo({ top: 0 });
	}
	async function openEditor(context: PolicyMapContext) {
		await showMap({ originId: context.originId });
		atlas?.applyContext(context);
	}
	async function reviewNotices() {
		await showMap();
		atlas?.showNotices();
	}
	let appliedMapLocation: string | null = null;
	$effect(() => {
		if (!atlas || view !== 'map') return;
		const query = workspaceUrl.searchParams;
		const selection = {
			originId: query.get('origin') || undefined,
			roadEdgeId: query.get('road') || undefined,
			islandId: query.get('island') || undefined
		};
		const locationKey = JSON.stringify(selection);
		if (locationKey === appliedMapLocation) return;
		appliedMapLocation = locationKey;
		if (selection.originId || selection.roadEdgeId || selection.islandId) {
			atlas.focusLocation(selection);
		}
	});
</script>

<svelte:head>
	<title>{nav.find((item) => item.id === view)?.label ?? 'Map'} · Maldives</title>
</svelte:head>

{#if data.planning}
	<div class="mobility-workspace">
		<a class="skip-link" href={`#workspace-${view}`}
			>Skip to {view === 'map' ? 'map' : 'analysis'}</a
		>
		<header class="workspace-navigation">
			<nav class="navigation-island" aria-label="Main pages">
				{#each nav as item (item.id)}<a
						href={urlFor(item.path)}
						class:chosen={view === item.id}
						aria-label={item.label}
						aria-current={view === item.id ? 'page' : undefined}
						><item.icon size={16} /><span class="nav-label">{item.label}</span><span
							class="compact-label">{item.id === 'forecasts' ? 'Data' : item.label}</span
						></a
					>{/each}
			</nav>
			{#if view === 'map'}<button
					class="tools"
					aria-label="Map tools"
					onclick={() => atlas?.openMenu()}><Menu size={18} /><span>Map tools</span></button
				>{:else}<a class="tools map-link" aria-label="Open map" href={urlFor('/')}
					><Map size={18} /><span>Open map</span></a
				>{/if}
		</header>
		<div class="workspace-body">
			<div class="page map-page" id="workspace-map" tabindex="-1" hidden={view !== 'map'}>
				<PlanningAtlas
					bind:this={atlas}
					baseline={data.planning}
					snapshotStale={data.snapshotStale}
					transportContext={data.transportContext}
					policyEvidence={data.policyEvidence}
					operations={data.operations}
					embedded
					active={view === 'map'}
					onContextChange={(context) => (mapContext = context)}
				>
					{#snippet forecastSummary()}<PassengerOutlookCard
							series={mapSeries}
							pending={!!data.prediction && !mapSeries}
							requestedMonth={targetMonth}
							onOpen={() => goto(forecastUrl())}
						/>{/snippet}
				</PlanningAtlas>
			</div>
			<main
				class="page analytics"
				id="workspace-forecasts"
				tabindex="-1"
				hidden={view !== 'forecasts'}
				aria-label="Data and Forecasts"
				bind:this={dataElement}
			>
				<DataForecastWorkspace
					{data}
					section={workspaceUrl.searchParams.get('dataView') || 'overview'}
					requestedDatasetId={workspaceUrl.searchParams.get('dataset') || undefined}
					onSectionChange={(dataView) => void openDataSection(dataView)}
					onBuild={(dataset) => void openDataSection('builder', dataset)}
					onExplore={(dataset) => void openDataSection('explore', dataset)}
					onOpenForecast={(forecast) => void openForecastSeries(forecast)}
					{targetMonth}
					{selectedSeriesId}
					onTargetMonthChange={(month) => void setQuery({ month })}
					onSeriesChange={(forecast) => void setQuery({ forecast })}
					onselectSeries={(series) => (selectedSeries = series)}
					onShowOnMap={showForecast}
					onShowEvidence={(workflow) => void showEvidence(workflow)}
					onShowMap={() => void showMap()}
				/>
			</main>
			<main
				class="page decisions-page"
				id="workspace-decisions"
				tabindex="-1"
				hidden={view !== 'decisions'}
				aria-label="Policy decisions"
			>
				<PolicyWorkspace
					baseline={data.planning}
					prediction={data.prediction}
					snapshotStale={data.snapshotStale}
					transportContext={data.transportContext}
					policyEvidence={data.policyEvidence}
					operations={data.operations}
					showMap={false}
					{mapContext}
					onShowMap={showMap}
					onOpenEditor={openEditor}
					onShowEvidence={() => void showEvidence('Planning map')}
				/>
			</main>
			<main
				class="page analytics"
				id="workspace-evidence"
				tabindex="-1"
				hidden={view !== 'evidence'}
				aria-label="Sources and evidence"
			>
				<EvidenceWorkspace
					baseline={data.planning}
					operations={data.operations}
					policyEvidence={data.policyEvidence}
					prediction={data.prediction}
					requestedWorkflow={workspaceUrl.searchParams.get('evidence') || undefined}
					onShowMap={() => void showMap()}
					onReviewNotices={reviewNotices}
					onShowForecasts={() => void goto(forecastUrl())}
					onShowDecisions={() => void goto(urlFor('/decisions'))}
				/>
			</main>
		</div>
	</div>
{:else}
	<main class="unavailable">
		<h1>The public data snapshot is unavailable.</h1>
		<p>{data.unavailable}</p>
		<a href="/">Retry loading the snapshot</a>
	</main>
{/if}

<style>
	.mobility-workspace {
		--analytics-ink: #172b3a;
		--analytics-muted: #647381;
		--analytics-border: #dde3e9;
		--analytics-accent: #087f78;
		--analytics-canvas: #f5f6f8;
		height: 100dvh;
		position: relative;
		color: var(--analytics-ink);
		background: var(--analytics-canvas);
		overflow: clip;
	}
	.workspace-navigation {
		position: absolute;
		inset: 0 0 auto;
		z-index: 40;
		pointer-events: none;
	}
	.navigation-island {
		position: absolute;
		top: max(16px, env(safe-area-inset-top));
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 2px;
		padding: 5px;
		border: 1px solid #354345;
		border-radius: 999px;
		background: #202f32;
		box-shadow:
			0 4px 16px #102e3424,
			0 1px 3px #102e341f;
		pointer-events: auto;
	}
	.navigation-island a,
	.tools {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 44px;
		padding: 9px 15px;
		border-radius: 999px;
		text-decoration: none;
		white-space: nowrap;
		font-size: 13px;
		font-weight: 550;
		line-height: 1.2;
		font-family: inherit;
		cursor: pointer;
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}
	.navigation-island a {
		color: #ced8d8;
	}
	.navigation-island a:hover {
		color: #fff;
		background: #ffffff0d;
	}
	.navigation-island a.chosen {
		color: #183c3d;
		background: #fff;
		box-shadow: 0 1px 3px #00000026;
	}
	.compact-label {
		display: none;
	}
	.tools {
		position: absolute;
		top: max(16px, env(safe-area-inset-top));
		right: 20px;
		min-height: 52px;
		padding: 10px 17px;
		border: 1px solid #d9e1df;
		background: #fff;
		color: #344a4d;
		box-shadow: 0 3px 14px #18393912;
		pointer-events: auto;
	}
	.tools:hover {
		background: #f0f4f2;
	}
	.workspace-body,
	.page {
		height: 100%;
		min-height: 0;
	}
	.workspace-body {
		position: relative;
		overflow: clip;
	}
	.page[hidden] {
		display: none !important;
	}
	.map-page {
		overflow: hidden;
	}
	.analytics,
	.decisions-page {
		overflow: auto;
		padding: 104px clamp(20px, 4vw, 56px) 56px;
		font-size: 14px;
		line-height: 1.5;
		scrollbar-gutter: stable;
		overscroll-behavior: contain;
		scroll-padding-top: 104px;
	}
	.analytics > :global(*),
	.decisions-page > :global(*) {
		max-width: 1200px;
		margin-left: auto;
		margin-right: auto;
	}
	.skip-link {
		position: absolute;
		top: 12px;
		left: 16px;
		z-index: 100;
		padding: 10px 14px;
		background: white;
		color: var(--analytics-ink);
		border: 1px solid var(--analytics-border);
		border-radius: 6px;
		transform: translateY(-180%);
	}
	.skip-link:focus {
		transform: translateY(0);
	}
	.unavailable {
		padding: 40px;
		max-width: 800px;
		margin: auto;
	}
	a:focus-visible,
	button:focus-visible {
		outline: 3px solid #17938c;
		outline-offset: 3px;
	}
	@media (max-width: 960px) {
		.tools {
			min-width: 52px;
			padding: 10px;
		}
		.tools span {
			display: none;
		}
		.navigation-island a {
			padding-inline: 12px;
		}
	}
	@media (max-width: 680px) {
		.navigation-island {
			top: max(12px, env(safe-area-inset-top));
			width: calc(100% - 24px);
			padding: 3px;
			gap: 0;
		}
		.navigation-island a {
			flex: 1;
			min-width: 0;
			min-height: 44px;
			padding: 9px 5px;
			font-size: 12px;
		}
		.navigation-island a :global(svg),
		.nav-label {
			display: none;
		}
		.compact-label {
			display: inline;
		}
		.tools {
			top: calc(max(12px, env(safe-area-inset-top)) + 60px);
			right: 12px;
			min-width: 44px;
			min-height: 44px;
			padding: 10px;
		}
		.analytics,
		.decisions-page {
			padding: 132px 16px 36px;
			scroll-padding-top: 132px;
			scrollbar-gutter: auto;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.navigation-island a,
		.tools {
			transition: none;
		}
	}
</style>
