<script lang="ts">
	import { downloadText } from '#lib/download.js';
	import { onMount, tick, untrack } from 'svelte';
	import {
		ArrowDown,
		ArrowRight,
		ArrowUp,
		Check,
		ChevronLeft,
		ChevronRight,
		ChevronDown,
		CircleHelp,
		Download,
		MapPin,
		RefreshCw,
		Search,
		SlidersHorizontal
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { api, subscribeApiInvalidation } from '#lib/api.js';
	import PolicyOpportunityOverview from '#lib/components/PolicyOpportunityOverview.svelte';
	import MobilityPulse from '#lib/components/MobilityPulse.svelte';
	import IslandAccessibilityDetails from '#lib/components/IslandAccessibilityDetails.svelte';
	import AnimatedNumber from '#lib/components/AnimatedNumber.svelte';
	import type { PolicyLens } from '#lib/policy-opportunities.js';
	import {
		atollInventory,
		facilityColors,
		facilityLabels,
		hasMissingAccessibilityData,
		inventoryForScope,
		inventoryFromFeatures,
		islandAnalytics,
		scoreDistribution,
		type NationalAccessibility
	} from '#lib/analytics.js';
	import type { Accessibility, IslandProfile, MapFeatures, NationalSummary } from '#lib/types.js';

	let {
		summary,
		features,
		onExplore,
		onConnections,
		onForecast,
		active = true
	}: {
		summary: NationalSummary | null;
		features: MapFeatures | null;
		onExplore: (islandId?: string, atoll?: string, lens?: PolicyLens) => void;
		onConnections?: (islandId?: string) => void;
		onForecast?: () => void;
		active?: boolean;
	} = $props();
	let accessibility = $state.raw<NationalAccessibility | null>(null);
	let infrastructure = $state.raw<MapFeatures | null>(null);
	let loading = $state(true);
	let mounted = $state(false);
	let needsRefresh = $state(false);
	let error = $state('');
	let checkedAt = $state<Date | null>(null);
	let cohort = $state('residential');
	let selectedAtoll = $state('all');
	let chartMetric = $state<'all' | 'health' | 'education' | 'airports'>('all');
	let hoveredAtoll = $state<string | null>(null);
	let search = $state('');
	let tableFilter = $state('all');
	let sort = $state<'name' | 'facilities' | 'score'>('facilities');
	let ascending = $state(false);
	let page = $state(0);
	let showMethod = $state(false);
	let selectedScoreId = $state<string | null>(null);
	let scoreDetails = $state.raw<Accessibility | null>(null);
	let scoreDetailsLoading = $state(false);
	let scoreDetailsError = $state('');
	let scoreController: AbortController | undefined;
	let controller: AbortController;

	const numberFormatter = new Intl.NumberFormat('en-US');
	const decimalFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
	const number = (value: number) => numberFormatter.format(value);
	const decimal = (value: number) => decimalFormatter.format(value);
	const percentage = (part: number, total: number) =>
		total ? Math.round((part / total) * 100) : 0;
	const shortAtoll = (name: string) =>
		name.length > 11
			? name
					.split(' ')
					.map((word) => word.slice(0, 2))
					.join('. ')
			: name;

	const inventory = $derived(inventoryFromFeatures(infrastructure));
	const rows = $derived(islandAnalytics(features, inventory, accessibility));
	const selectedScore = $derived.by(() => {
		const row = rows.find((item) => item.id === selectedScoreId);
		return row && scoreDetails?.island_id === row.id
			? { ...row, assessment: scoreDetails.assessment ?? null }
			: row;
	});
	const atolls = $derived([...new Set(rows.map((row) => row.atoll))].sort());
	const cohortRows = $derived(
		rows.filter((row) => cohort === 'all' || row.category === 'Residential Island')
	);
	const scopeRows = $derived(
		cohortRows.filter((row) => selectedAtoll === 'all' || row.atoll === selectedAtoll)
	);
	const scopeInventory = $derived(
		inventoryForScope(inventory, scopeRows, cohort === 'all' && selectedAtoll === 'all')
	);
	const chartAtolls = $derived.by(() => {
		const all = atollInventory(cohortRows);
		const leading = all.slice(0, 8);
		const selected = all.find((atoll) => atoll.name === selectedAtoll);
		return selected && !leading.includes(selected) ? [...leading.slice(0, 7), selected] : leading;
	});
	const chartMaximum = $derived(
		Math.max(
			1,
			...chartAtolls.map((atoll) =>
				chartMetric === 'all'
					? Math.max(atoll.health, atoll.education, atoll.airports)
					: atoll[chartMetric]
			)
		)
	);
	const categories = $derived(
		Object.entries(
			scopeInventory.reduce<Record<string, number>>((counts, item) => {
				counts[item.category] = (counts[item.category] ?? 0) + 1;
				return counts;
			}, {})
		).sort((a, b) => b[1] - a[1])
	);
	const activeCategory = $derived(categories.some(([category]) => category === tableFilter));
	const locatedCount = $derived(scopeInventory.filter((item) => item.located).length);
	const mixSegments = $derived.by(() => {
		let offset = 0;
		return categories.map(([category, count]) => {
			const share = (count / Math.max(1, scopeInventory.length)) * 100;
			const segment = { category, count, share, offset };
			offset += share;
			return segment;
		});
	});
	const contextCount = $derived(
		scopeInventory.filter((item) => !item.located && item.contextOnly).length
	);
	const unassignedCount = $derived(scopeInventory.filter((item) => !item.islandId).length);
	const locatedPercent = $derived(percentage(locatedCount, scopeInventory.length));
	const scoredRows = $derived(scopeRows.filter((row) => row.score !== null));
	const averageScore = $derived(
		scoredRows.length
			? scoredRows.reduce((sum, row) => sum + (row.score ?? 0), 0) / scoredRows.length
			: null
	);
	const missingDataCount = $derived(scopeRows.filter(hasMissingAccessibilityData).length);
	const distribution = $derived(scoreDistribution(scopeRows));
	const distributionMax = $derived(Math.max(1, ...distribution.bins.map((bin) => bin.count)));
	const normalizedSearch = $derived(search.toLowerCase().trim());
	const matchedRows = $derived(
		scopeRows
			.filter((row) => {
				const matchesSearch = `${row.name} ${row.atoll}`.toLowerCase().includes(normalizedSearch);
				const matchesFilter =
					tableFilter === 'all' ||
					(tableFilter === 'zero'
						? row.score === 0
						: tableFilter === 'missing'
							? hasMissingAccessibilityData(row)
							: (row.facilities[tableFilter] ?? 0) > 0);
				return matchesSearch && matchesFilter;
			})
			.sort((a, b) => {
				let difference =
					sort === 'name'
						? a.name.localeCompare(b.name)
						: sort === 'facilities'
							? a.facilityCount - b.facilityCount
							: (a.score ?? -1) - (b.score ?? -1);
				if (!ascending) difference *= -1;
				return difference || a.name.localeCompare(b.name);
			})
	);
	const zeroScoreCount = $derived(matchedRows.filter((row) => row.score === 0).length);
	const pageCount = $derived(Math.max(1, Math.ceil(matchedRows.length / 8)));
	const currentPage = $derived(Math.min(page, pageCount - 1));
	const visibleRows = $derived(matchedRows.slice(currentPage * 8, currentPage * 8 + 8));
	const activeAtoll = $derived(chartAtolls.find((atoll) => atoll.name === hoveredAtoll));
	const scopeLabel = $derived(
		selectedAtoll === 'all'
			? cohort === 'all'
				? 'All Maldives'
				: 'Residential islands'
			: selectedAtoll
	);
	const initialLoading = $derived(loading && !accessibility && !infrastructure);

	async function load() {
		needsRefresh = false;
		scoreController?.abort();
		scoreDetailsLoading = false;
		controller?.abort();
		const requestController = new AbortController();
		controller = requestController;
		loading = true;
		error = '';
		try {
			const result = await Promise.all([
				api<NationalAccessibility>(
					'accessibility/summary?compact=true',
					undefined,
					requestController.signal
				),
				api<MapFeatures>(
					'map/features?layer=infrastructure&include_unlocated=true',
					undefined,
					requestController.signal
				)
			]);
			if (controller === requestController && !requestController.signal.aborted) {
				accessibility = result[0];
				infrastructure = result[1];
				checkedAt = new Date();
				if (selectedScoreId) void openScoreDetails(selectedScoreId);
			}
		} catch (caught) {
			if (controller === requestController && !requestController.signal.aborted)
				error = caught instanceof Error ? caught.message : 'National analysis could not be loaded.';
		} finally {
			if (controller === requestController) loading = false;
		}
	}

	async function openScoreDetails(id: string) {
		scoreController?.abort();
		const requestController = new AbortController();
		scoreController = requestController;
		selectedScoreId = id;
		scoreDetails = null;
		scoreDetailsLoading = true;
		scoreDetailsError = '';
		try {
			const profile = await api<IslandProfile>(
				`islands/${encodeURIComponent(id)}/profile`,
				undefined,
				requestController.signal
			);
			if (!requestController.signal.aborted && scoreController === requestController) {
				if (!profile.accessibility) throw new Error('The score explanation is not available yet.');
				scoreDetails = profile.accessibility;
			}
		} catch (caught) {
			if (!requestController.signal.aborted && scoreController === requestController)
				scoreDetailsError =
					caught instanceof Error ? caught.message : 'The score explanation could not be loaded.';
		} finally {
			if (scoreController === requestController) scoreDetailsLoading = false;
		}
	}
	function closeScoreDetails() {
		scoreController?.abort();
		selectedScoreId = null;
		scoreDetails = null;
	}

	function selectAtoll(name: string) {
		selectedAtoll = selectedAtoll === name ? 'all' : name;
		page = 0;
	}
	function sortBy(column: typeof sort) {
		if (sort === column) ascending = !ascending;
		else {
			sort = column;
			ascending = column === 'name';
		}
		page = 0;
	}
	function filterRows(filter: string) {
		tableFilter = tableFilter === filter ? 'all' : filter;
		page = 0;
	}
	function openRecords() {
		const disclosure = document.querySelector<HTMLDetailsElement>('.inventory-disclosure');
		if (disclosure) disclosure.open = true;
		document.querySelector('.screening-card')?.scrollIntoView({ block: 'start' });
	}
	async function toggleMethod() {
		showMethod = !showMethod;
		if (showMethod) {
			await tick();
			document.querySelector('#analytics-methodology')?.scrollIntoView({ block: 'nearest' });
		}
	}
	function exportTable() {
		const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
		const contents = [
			[
				'Island ID',
				'Island',
				'Atoll',
				'Category',
				'Official facility records',
				'Records with coordinates',
				'Modeled access score /100',
				'Model confidence',
				'Missing data flags'
			],
			...matchedRows.map((row) => [
				row.id,
				row.name,
				row.atoll,
				row.category,
				row.facilityCount,
				row.locatedCount,
				row.score ?? 'Unavailable',
				row.confidence ?? 'Unavailable',
				row.missingData?.join('; ') ?? 'Unavailable'
			])
		]
			.map((row) => row.map(escape).join(','))
			.join('\r\n');
		downloadText(contents, 'maldives-island-screening.csv', 'text/csv;charset=utf-8');
	}

	onMount(() => {
		mounted = true;
		const unsubscribe = subscribeApiInvalidation(() => {
			needsRefresh = true;
		});
		if (active) void load();
		else needsRefresh = true;
		return () => {
			unsubscribe();
			controller?.abort();
			scoreController?.abort();
		};
	});
	$effect(() => {
		if (mounted && active && needsRefresh) untrack(() => void load());
	});
</script>

<section class="analytics-dashboard" aria-label="National analytics" aria-busy={loading}>
	<div class="overview-heading">
		<div>
			<h1>National overview<span class="heading-period">.</span></h1>
			<p>Understand service access. Find your next investment.</p>
		</div>
		<Button
			class="overview-map-button"
			onclick={() => onExplore(undefined, selectedAtoll === 'all' ? undefined : selectedAtoll)}
			><MapPin size={15} /> Explore the map <ArrowRight size={15} /></Button
		>
	</div>

	<div class="overview-filters">
		<div class="scope-controls">
			<SlidersHorizontal size={14} />
			<NativeSelect.Root
				aria-label="Island cohort"
				bind:value={cohort}
				onchange={() => {
					page = 0;
				}}
				class="cohort-select"
			>
				<NativeSelect.Option value="all">All islands</NativeSelect.Option>
				<NativeSelect.Option value="residential">Residential islands</NativeSelect.Option>
			</NativeSelect.Root>
			<NativeSelect.Root
				aria-label="Analytics atoll"
				bind:value={selectedAtoll}
				onchange={() => {
					page = 0;
				}}
				class="atoll-select"
			>
				<NativeSelect.Option value="all">All atolls</NativeSelect.Option>
				{#each atolls as atoll (atoll)}<NativeSelect.Option value={atoll}
						>{atoll}</NativeSelect.Option
					>{/each}
			</NativeSelect.Root>
			{#if cohort !== 'residential' || selectedAtoll !== 'all'}<Button
					variant="ghost"
					size="sm"
					onclick={() => {
						cohort = 'residential';
						selectedAtoll = 'all';
						search = '';
						tableFilter = 'all';
						page = 0;
					}}>Reset filters</Button
				>{/if}
		</div>
		<div class="snapshot-controls">
			<div class="snapshot-note">
				<span class="snapshot-dot"></span> Supplied data snapshot
				<span class="snapshot-divider">/</span>
				{summary ? `${number(summary.island_count)} island records` : 'Loading island catalogue…'}
			</div>
			<div class="refresh-state" role="status" aria-live="polite">
				{#if loading}<span>{initialLoading ? 'Loading analysis…' : 'Updating analysis…'}</span>
				{:else if checkedAt && !error}<Check size={12} /><span
						>Loaded {new Intl.DateTimeFormat('en-GB', {
							hour: '2-digit',
							minute: '2-digit'
						}).format(checkedAt)}</span
					>{/if}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Reload national analytics"
					title="Reload the available analysis"
					disabled={loading}
					onclick={load}><RefreshCw size={13} class={loading ? 'refresh-icon' : ''} /></Button
				>
			</div>
		</div>
	</div>

	{#if error}
		<div class="analysis-error" role="alert">
			<div>
				<strong
					>{accessibility && infrastructure
						? 'The latest analysis could not be checked.'
						: 'National analytics are unavailable.'}</strong
				>
				<p>
					{accessibility && infrastructure
						? 'The previous results remain visible. Retry to check for updates.'
						: 'Try again to load the service records and island scores.'}
				</p>
				<details>
					<summary>Error details</summary>
					<p>{error}</p>
				</details>
			</div>
			<Button variant="outline" size="sm" onclick={load}>Retry analysis</Button>
		</div>
	{/if}

	<PolicyOpportunityOverview atoll={selectedAtoll} {cohort} {onExplore} {onConnections} {active} />

	<div class="analytics-grid" class:initial-loading={initialLoading}>
		<Card.Root class="analytics-card footprint-card">
			<div class="card-heading">
				<div>
					<h2>Service footprint</h2>
					<p>Official facility inventory · {scopeLabel}</p>
				</div>
				<Badge variant="secondary"
					>{!infrastructure || !features ? 'Loading' : `${number(scopeRows.length)} islands`}</Badge
				>
			</div>
			<div class="inventory-metric">
				<strong
					><AnimatedNumber
						value={infrastructure ? scopeInventory.length : null}
						format={number}
						context={`${cohort}:${selectedAtoll}`}
					/></strong
				><span>official facility records</span>
			</div>
			<div class="chart-tabs" aria-label="Facility chart categories">
				{#each [{ id: 'all' as const, label: 'All services' }, { id: 'health' as const, label: 'Health' }, { id: 'education' as const, label: 'Education' }, { id: 'airports' as const, label: 'Airports' }] as metric (metric.id)}
					<Button
						variant="ghost"
						size="sm"
						class={chartMetric === metric.id ? 'chart-tab active' : 'chart-tab'}
						aria-pressed={chartMetric === metric.id}
						onclick={() => (chartMetric = metric.id)}>{metric.label}</Button
					>
				{/each}
			</div>
			<div class="chart-context">Geographic comparison · leading atolls and your selection</div>
			<div
				class="atoll-chart"
				aria-label="Facility records by atoll, showing leading atolls and the current selection"
			>
				<div class="chart-gridlines" aria-hidden="true">
					<span>{number(chartMaximum)}</span><span>{number(Math.round(chartMaximum / 2))}</span
					><span>0</span>
				</div>
				<div class="chart-bars">
					{#each chartAtolls as atoll, index (atoll.name)}
						<div class="atoll-column">
							<Button
								variant="ghost"
								class={selectedAtoll === atoll.name ? 'atoll-bar selected' : 'atoll-bar'}
								aria-pressed={selectedAtoll === atoll.name}
								aria-label={`${atoll.name}: ${atoll.facilityCount} assigned facility records. Filter by this atoll.`}
								title={`${atoll.name}: health ${atoll.health}, education ${atoll.education}, airports ${atoll.airports}`}
								onmouseenter={() => (hoveredAtoll = atoll.name)}
								onmouseleave={() => (hoveredAtoll = null)}
								onfocus={() => (hoveredAtoll = atoll.name)}
								onblur={() => (hoveredAtoll = null)}
								onclick={() => selectAtoll(atoll.name)}
							>
								<div class="bar-group" aria-hidden="true">
									{#if chartMetric === 'all' || chartMetric === 'health'}<span
											class="bar bar-health"
											style:height={`${(atoll.health / chartMaximum) * 100}%`}
										></span>{/if}
									{#if chartMetric === 'all' || chartMetric === 'education'}<span
											class="bar bar-education"
											style:height={`${(atoll.education / chartMaximum) * 100}%`}
										></span>{/if}
									{#if chartMetric === 'all' || chartMetric === 'airports'}<span
											class="bar bar-airports"
											style:height={`${(atoll.airports / chartMaximum) * 100}%`}
										></span>{/if}
								</div>
							</Button>
							{#if hoveredAtoll === atoll.name}<div
									class="atoll-tooltip"
									class:tooltip-start={index < 2}
									class:tooltip-end={index >= chartAtolls.length - 2}
									role="status"
								>
									<strong>{atoll.name}</strong><span
										><i class="bar-health"></i>Health <b>{number(atoll.health)}</b></span
									><span
										><i class="bar-education"></i>Education <b>{number(atoll.education)}</b></span
									><span><i class="bar-airports"></i>Airports <b>{number(atoll.airports)}</b></span>
								</div>{/if}
							<span class="atoll-label" title={atoll.name}>{shortAtoll(atoll.name)}</span>
						</div>
					{/each}
				</div>
			</div>
			<div class="chart-caption" aria-live="polite">
				{#if activeAtoll}<strong>{activeAtoll.name}</strong> · {number(activeAtoll.facilityCount)} records
					/ {number(activeAtoll.islandCount)} islands{:else}Compare atolls with linked records.
					Select a bar to focus the dashboard.{/if}
			</div>
			<div class="chart-legend">
				<span><i style:background="#9072dd"></i> Health</span><span
					><i style:background="#32ae89"></i> Education</span
				><span><i style:background="#efa84b"></i> Airports</span>
			</div>
		</Card.Root>

		<Card.Root class="analytics-card mix-card">
			<div class="card-heading">
				<div>
					<h2>Facility mix</h2>
					<p>How the service inventory is composed</p>
				</div>
			</div>
			<div class="facility-mix-chart">
				<svg
					viewBox="0 0 220 220"
					role="img"
					aria-label={`Facility category proportions for ${scopeLabel}: ${categories.map(([category, count]) => `${facilityLabels[category] ?? category} ${count}`).join(', ')}`}
				>
					<circle cx="110" cy="110" r="82" fill="none" stroke="#f0edf6" stroke-width="25" />
					{#each mixSegments as segment (segment.category)}<circle
							cx="110"
							cy="110"
							r="82"
							fill="none"
							stroke={facilityColors[segment.category] ?? '#9072dd'}
							stroke-width="25"
							pathLength="100"
							stroke-dasharray={`${segment.share} ${100 - segment.share}`}
							stroke-dashoffset={-segment.offset}
							transform="rotate(-90 110 110)"
							opacity={!activeCategory || tableFilter === segment.category ? 1 : 0.25}
							><title
								>{facilityLabels[segment.category] ?? segment.category}: {number(segment.count)} ({percentage(
									segment.count,
									scopeInventory.length
								)}%)</title
							></circle
						>{/each}
				</svg>
				<div class="mix-centre">
					<strong
						><AnimatedNumber
							value={infrastructure ? scopeInventory.length : null}
							format={number}
							context={`${cohort}:${selectedAtoll}`}
						/></strong
					><span>facility records</span>
				</div>
			</div>
			<div class="category-list">
				{#each categories as [category, count] (category)}
					<Button
						variant="ghost"
						class={tableFilter === category ? 'category-row category-selected' : 'category-row'}
						aria-pressed={tableFilter === category}
						onclick={() => filterRows(category)}
					>
						<span class="category-label"
							><i style:background={facilityColors[category] ?? '#9072dd'}></i>{facilityLabels[
								category
							] ?? category}</span
						><span class="category-share">{percentage(count, scopeInventory.length)}%</span><strong
							>{number(count)}</strong
						>{#if tableFilter === category}<Check size={13} />{:else}<ArrowRight size={13} />{/if}
					</Button>
				{/each}
			</div>
			<p class="mix-note">
				{#if categories.some(([category]) => category === tableFilter)}<Button
						variant="ghost"
						size="sm"
						onclick={openRecords}
						>View islands with {facilityLabels[tableFilter]?.toLowerCase()}
						<ArrowRight size={13} /></Button
					>{:else}Select a category to explore its island records.{/if}
			</p>
		</Card.Root>
		<div class="mobility-pulse-slot"><MobilityPulse {onForecast} {active} /></div>

		<Card.Root class="analytics-card coverage-card">
			<div class="card-heading">
				<div>
					<h2>Mapping coverage</h2>
					<p>Facility records with coordinates</p>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Explain analytics methodology"
					aria-expanded={showMethod}
					aria-controls="analytics-methodology"
					onclick={toggleMethod}><CircleHelp size={15} /></Button
				>
			</div>
			<div class="coverage-gauge">
				<svg
					viewBox="0 0 220 124"
					role="img"
					aria-label={`${locatedPercent} percent of scoped facility records have coordinates`}
				>
					<path
						d="M 22 110 A 88 88 0 0 1 198 110"
						fill="none"
						stroke="#eaf5ef"
						stroke-width="7"
						stroke-linecap="round"
					/>
					<path
						d="M 22 110 A 88 88 0 0 1 198 110"
						fill="none"
						stroke="#32ae89"
						stroke-width="7"
						stroke-linecap="round"
						pathLength="100"
						stroke-dasharray={`${locatedPercent} 100`}
					/>
				</svg>
				<div class="gauge-value">
					<strong
						><AnimatedNumber
							value={infrastructure ? locatedPercent : null}
							format={(value) => `${value}%`}
							context={`${cohort}:${selectedAtoll}`}
						/></strong
					><span>{number(locatedCount)} of {number(scopeInventory.length)} records</span>
				</div>
			</div>
			<div class="coverage-breakdown">
				<div>
					<span><i class="located-dot"></i> Coordinates present</span><strong
						>{number(locatedCount)}</strong
					>
				</div>
				<div>
					<span><i class="context-dot"></i> Island context only</span><strong
						>{number(contextCount)}</strong
					>
				</div>
				<div>
					<span><i class="unlocated-dot"></i> Other unlocated records</span><strong
						>{number(scopeInventory.length - locatedCount - contextCount)}</strong
					>
				</div>
			</div>
			<p class="coverage-note">
				Coordinates can be provisional. Inspect the source and match quality before choosing a site.
			</p>
		</Card.Root>

		<Card.Root class="analytics-card access-card">
			<div class="card-heading">
				<div>
					<h2>Accessibility score</h2>
					<p>Health, education and transport access</p>
				</div>
				<Badge variant="outline">Out of 100</Badge>
			</div>
			<div class="access-metric">
				<strong
					><AnimatedNumber
						value={averageScore}
						format={decimal}
						context={`${cohort}:${selectedAtoll}`}
					/></strong
				><span>average across {number(scoredRows.length)} islands</span>
			</div>
			<div
				class="distribution-chart"
				aria-label="Distribution of modeled island accessibility scores"
			>
				{#each distribution.bins as bin, index (bin.label)}
					<div class="distribution-column">
						<span class="distribution-count">{number(bin.count)}</span>
						<div class="distribution-track">
							<span
								style:height={`${(bin.count / distributionMax) * 100}%`}
								style:background={index === 0 ? '#c5b4e6' : '#32ae89'}
							></span>
						</div>
						<span class="distribution-label">{bin.label}</span>
					</div>
				{/each}
			</div>
			<p class="access-note">
				<span class="note-dot"></span> Missing data can lower a score. Open an island to see why.
			</p>
			<Button variant="outline" size="sm" onclick={openRecords}
				>View island scores <ArrowRight size={14} /></Button
			>
		</Card.Root>
	</div>

	{#if showMethod}
		<Card.Root class="analytics-card methodology-card" id="analytics-methodology"
			><div>
				<h2>Read these numbers with their sources.</h2>
				<p>
					Facility counts include official records from HEMS, education and airport sources. Atoll
					bars show the eight atolls with the most island-linked records; unassigned facilities stay
					in national totals and are excluded from geographic comparisons. The accessibility index
					uses the backend’s cached default model, with missing inputs contributing zero. It is an
					unweighted island mean, not a population-weighted measure or a service forecast.
				</p>
				<p>
					Coordinates indicate geometry availability, including provisional matches. These inventory
					and index views do not verify passenger ferry calendars, approved budgets, observed time
					trends or causal impact. Use proposal review to inspect cost assumptions and modeled
					access changes.
				</p>
			</div>
			<Button variant="ghost" size="sm" onclick={() => (showMethod = false)}>Close</Button
			></Card.Root
		>
	{/if}

	<details class="inventory-disclosure">
		<summary
			><div>
				<h2>Island accessibility scores</h2>
				<p>{number(scopeRows.length)} islands · See each score and the reasons behind it</p>
			</div>
			<span class="disclosure-action">View scores <ChevronDown size={16} /></span></summary
		>
		<div class="data-gap-grid">
			<Card.Root class="analytics-card mini-card"
				><span class="mini-icon purple"><MapPin size={17} /></span>
				<h2>Unassigned records</h2>
				<strong>{infrastructure ? number(unassignedCount) : '—'}</strong>
				<p>Facilities without an island match</p></Card.Root
			>
			<Card.Root class="analytics-card mini-card"
				><span class="mini-icon green"><CircleHelp size={17} /></span>
				<h2>Need more data</h2>
				<strong>{accessibility ? number(missingDataCount) : '—'}</strong>
				<p>Islands with incomplete information</p>
				<Button variant="ghost" size="sm" class="mini-action" onclick={() => filterRows('missing')}
					>Review islands <ArrowRight size={12} /></Button
				></Card.Root
			>
		</div>

		<Card.Root class="analytics-card screening-card">
			<div class="screening-heading">
				<div>
					<div class="eyebrow">YOUR NEXT STEP</div>
					<h2>Choose an island.</h2>
					<p>
						Open a score for a simple explanation. {scopeLabel} · {number(matchedRows.length)}
						{matchedRows.length === 1 ? 'island' : 'islands'}
					</p>
				</div>
				<Button variant="outline" size="sm" onclick={exportTable} disabled={!matchedRows.length}
					><Download size={14} /> Export table</Button
				>
			</div>
			<div class="table-toolbar">
				<div class="table-search">
					<Search size={15} /><Input
						aria-label="Search analytics islands"
						placeholder="Search an island or atoll…"
						bind:value={search}
						oninput={() => (page = 0)}
					/>
				</div>
				<NativeSelect.Root
					aria-label="Island screening filter"
					bind:value={tableFilter}
					onchange={() => (page = 0)}
					><NativeSelect.Option value="all">All island records</NativeSelect.Option
					><NativeSelect.Option value="zero">Score of zero</NativeSelect.Option><NativeSelect.Option
						value="missing">Incomplete information</NativeSelect.Option
					>{#each Object.entries(facilityLabels) as [category, name] (category)}<NativeSelect.Option
							value={category}>{name} recorded</NativeSelect.Option
						>{/each}</NativeSelect.Root
				>
			</div>
			<div class="table-scroll">
				<table>
					<thead
						><tr
							><th aria-sort={sort === 'name' ? (ascending ? 'ascending' : 'descending') : 'none'}
								><Button variant="ghost" size="sm" class="table-sort" onclick={() => sortBy('name')}
									>Island {#if sort === 'name'}{#if ascending}<ArrowUp size={12} />{:else}<ArrowDown
												size={12}
											/>{/if}{/if}</Button
								></th
							><th>Atoll</th><th
								aria-sort={sort === 'facilities'
									? ascending
										? 'ascending'
										: 'descending'
									: 'none'}
								><Button
									variant="ghost"
									size="sm"
									class="table-sort"
									onclick={() => sortBy('facilities')}
									>Facilities {#if sort === 'facilities'}{#if ascending}<ArrowUp
												size={12}
											/>{:else}<ArrowDown size={12} />{/if}{/if}</Button
								></th
							><th aria-sort={sort === 'score' ? (ascending ? 'ascending' : 'descending') : 'none'}
								><Button
									variant="ghost"
									size="sm"
									class="table-sort"
									onclick={() => sortBy('score')}
									>Access score {#if sort === 'score'}{#if ascending}<ArrowUp
												size={12}
											/>{:else}<ArrowDown size={12} />{/if}{/if}</Button
								></th
							><th>Information</th><th><span class="sr-only">Open island map</span></th></tr
						></thead
					><tbody>
						{#each visibleRows as row (row.id)}<tr data-analytics-island-id={row.id}
								><td
									><div class="island-name">{row.name}</div>
									<span class="island-type">{row.category.replace(' Island', '')}</span></td
								><td>{row.atoll}</td><td
									><strong>{number(row.facilityCount)}</strong><span class="table-subline"
										>{number(row.locatedCount)} with map locations</span
									></td
								><td
									><Button
										variant="ghost"
										size="sm"
										class="score-explanation"
										aria-label={`Why this score for ${row.name}`}
										aria-describedby={`score-number-${row.id}`}
										onclick={() => void openScoreDetails(row.id)}
										><span class="score-value" id={`score-number-${row.id}`}
											>{row.score === null ? '—' : decimal(row.score)}<small>/100</small></span
										><CircleHelp size={13} /></Button
									></td
								><td
									>{#if row.missingData === null}<Badge variant="outline">Not available</Badge
										>{:else}<Badge variant={row.missingData.length ? 'secondary' : 'outline'}
											>{row.assessment?.coverage.label ??
												(row.missingData.length ? 'Incomplete information' : 'Available')}</Badge
										>{/if}</td
								><td
									><Button
										variant="ghost"
										size="sm"
										class="row-explore"
										aria-label={`Explore ${row.name} on map`}
										onclick={() => onExplore(row.id, row.atoll)}
										>Explore <ArrowRight size={14} /></Button
									></td
								></tr
							>{/each}
						{#if !visibleRows.length}<tr
								><td colspan="6" class="table-empty"
									>{loading || !features
										? 'Loading the national island catalogue…'
										: 'No islands match these filters. Try another name or clear the filter.'}</td
								></tr
							>{/if}
					</tbody>
				</table>
			</div>
			<div class="table-footer">
				<span
					>{matchedRows.length
						? `${number(currentPage * 8 + 1)}–${number(Math.min((currentPage + 1) * 8, matchedRows.length))} of ${number(matchedRows.length)} ${matchedRows.length === 1 ? 'island' : 'islands'}`
						: 'No island results'} <span class="footer-divider">·</span>
					{zeroScoreCount
						? `${number(zeroScoreCount)} zero scores in this list`
						: 'Current data snapshot'}</span
				>
				<div class="pagination">
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="Previous analytics page"
						disabled={currentPage === 0}
						onclick={() => (page = currentPage - 1)}><ChevronLeft size={14} /></Button
					><span>{currentPage + 1} / {pageCount}</span><Button
						variant="outline"
						size="icon-sm"
						aria-label="Next analytics page"
						disabled={currentPage >= pageCount - 1}
						onclick={() => (page = currentPage + 1)}><ChevronRight size={14} /></Button
					>
				</div>
			</div>
		</Card.Root>
		<div class="analytics-footer">
			<span>Source-backed planning, with the gaps visible.</span><Button
				variant="ghost"
				size="sm"
				aria-expanded={showMethod}
				aria-controls="analytics-methodology"
				onclick={toggleMethod}><CircleHelp size={13} /> How to read this dashboard</Button
			>
		</div>
	</details>
</section>

{#if selectedScore}
	<IslandAccessibilityDetails
		island={selectedScore}
		onclose={closeScoreDetails}
		loading={scoreDetailsLoading}
		error={scoreDetailsError}
		onRetry={() => selectedScoreId && void openScoreDetails(selectedScoreId)}
		{onExplore}
	/>
{/if}

<style>
	.analytics-dashboard {
		max-width: 1510px;
		margin: 0 auto;
		padding: 32px 36px 36px;
		color: #292535;
		font-variant-numeric: tabular-nums;
	}
	.overview-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		margin-bottom: 25px;
	}
	h1 {
		font-size: 34px;
		font-weight: 560;
		letter-spacing: -1.6px;
		line-height: 1.2;
		margin: 0 0 8px;
	}
	.heading-period {
		color: #9674d9;
	}
	.overview-heading p {
		font-size: 12px;
		color: #777181;
	}
	:global(.analytics-dashboard .overview-map-button) {
		background: #7960bc;
		border-radius: 11px;
		min-height: 40px;
		font-size: 12px;
		box-shadow: 0 3px 6px #7053a51c;
	}
	:global(.analytics-dashboard .overview-map-button:hover) {
		background: #6d50b2;
	}
	.overview-filters {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 24px;
	}
	.scope-controls {
		display: flex;
		align-items: center;
		gap: 9px;
		color: #756b83;
	}
	.scope-controls > :global(svg) {
		margin-right: 2px;
	}
	.scope-controls :global([data-slot='native-select-wrapper']) {
		width: auto;
	}
	.scope-controls :global(select) {
		height: 37px;
		min-width: 159px;
		border-color: #e1ddea;
		border-radius: 9px;
		font-size: 11px;
	}
	.snapshot-note {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 10px;
		color: #777181;
	}
	.snapshot-controls {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
	}
	.refresh-state {
		display: flex;
		align-items: center;
		gap: 5px;
		min-height: 24px;
		font-size: 10px;
		color: #6b7973;
	}
	.refresh-state :global(button) {
		height: 24px;
		width: 24px;
	}
	:global(.analytics-dashboard .refresh-icon) {
		animation: analytics-refresh 850ms linear infinite;
	}
	@keyframes analytics-refresh {
		to {
			transform: rotate(360deg);
		}
	}
	.analytics-grid.initial-loading .atoll-chart,
	.analytics-grid.initial-loading .facility-mix-chart,
	.analytics-grid.initial-loading .coverage-gauge,
	.analytics-grid.initial-loading .distribution-chart {
		position: relative;
		border-radius: 12px;
		background: #f6f3f9;
	}
	.analytics-grid.initial-loading .atoll-chart > *,
	.analytics-grid.initial-loading .facility-mix-chart > *,
	.analytics-grid.initial-loading .coverage-gauge > *,
	.analytics-grid.initial-loading .distribution-chart > * {
		visibility: hidden;
	}
	.analysis-error details {
		font-size: 10px;
		margin-top: 8px;
	}
	.analysis-error details summary {
		cursor: pointer;
	}
	@media (max-width: 850px) {
		.snapshot-controls {
			align-items: flex-start;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.analytics-dashboard .refresh-icon) {
			animation: none;
		}
	}
	.snapshot-dot {
		width: 6px;
		height: 6px;
		background: #29a783;
		border-radius: 50%;
		box-shadow: 0 0 0 3px #2ba78212;
	}
	.snapshot-divider {
		color: #bbb3c6;
		margin: 0 2px;
	}
	.analytics-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.28fr) minmax(0, 1fr) minmax(0, 1fr);
		gap: 20px;
		margin-bottom: 38px;
		align-items: stretch;
	}
	:global(.analytics-dashboard .analytics-card) {
		padding: 24px;
		gap: 0;
		min-width: 0;
		border: 1px solid #e4dfed;
		border-radius: 21px;
		background: #fff;
		box-shadow:
			0 4px 8px #3c315803,
			0 12px 30px #3c315804;
		--tw-ring-shadow: 0 0 #0000;
	}
	:global(.analytics-dashboard .footprint-card) {
		grid-column: 1;
		grid-row: 1;
	}
	:global(.analytics-dashboard .mix-card) {
		grid-column: 2;
		grid-row: 1;
	}
	:global(.analytics-dashboard .coverage-card) {
		grid-column: 3;
		grid-row: 1;
		background: linear-gradient(160deg, #fff 50%, #f5fbf8);
	}
	.mobility-pulse-slot {
		grid-column: 1 / span 2;
		grid-row: 2;
		min-width: 0;
	}
	:global(.analytics-dashboard .access-card) {
		grid-column: 3;
		grid-row: 2;
	}
	.card-heading {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	h2 {
		font-size: 15px;
		font-weight: 590;
		line-height: 1.4;
		letter-spacing: -0.35px;
	}
	.card-heading p {
		margin-top: 5px;
		font-size: 10px;
		line-height: 1.5;
		color: #81778c;
	}
	.card-heading :global([data-slot='badge']) {
		font-size: 9px;
		padding: 3px 7px;
		white-space: nowrap;
		border-radius: 6px;
	}
	.inventory-metric {
		display: flex;
		align-items: baseline;
		gap: 9px;
		margin-top: 19px;
	}
	.inventory-metric strong,
	.access-metric strong {
		font-size: 40px;
		line-height: 1.1;
		font-weight: 470;
		letter-spacing: -1.9px;
	}
	.inventory-metric > span {
		font-size: 10px;
		color: #81778c;
	}
	.chart-tabs {
		display: flex;
		gap: 2px;
		margin: 19px 0 12px;
		padding: 3px;
		background: #f7f5fa;
		border: 1px solid #efebf5;
		border-radius: 8px;
		width: fit-content;
	}
	:global(.analytics-dashboard .chart-tab) {
		height: 25px;
		padding: 0 8px;
		font-size: 9px;
		font-weight: 500;
		color: #7a7086;
		border-radius: 5px;
	}
	:global(.analytics-dashboard .chart-tab.active) {
		background: #fff;
		color: #7956bf;
		box-shadow: 0 1px 3px #5b427a12;
	}
	.chart-context {
		font-size: 9px;
		color: #81778c;
		margin-bottom: 14px;
	}
	.atoll-chart {
		position: relative;
		height: 176px;
		padding: 0 2px 0 28px;
		margin-top: 8px;
	}
	.chart-gridlines {
		position: absolute;
		inset: 0 0 28px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		pointer-events: none;
	}
	.chart-gridlines > span {
		display: flex;
		align-items: center;
		gap: 10px;
		color: #8a8195;
		font-size: 8px;
	}
	.chart-gridlines > span::after {
		content: '';
		border-top: 1px dashed #e9e4f0;
		flex: 1;
	}
	.chart-bars {
		position: relative;
		display: flex;
		height: 100%;
		align-items: flex-end;
		justify-content: space-around;
		gap: 4px;
	}
	.atoll-column {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		justify-content: flex-end;
		align-items: center;
		height: 100%;
		position: relative;
	}
	:global(.analytics-dashboard .atoll-bar) {
		height: calc(100% - 28px);
		width: 100%;
		padding: 0 3px;
		border-radius: 5px 5px 0 0;
		display: flex;
		align-items: flex-end;
	}
	:global(.analytics-dashboard .atoll-bar:hover),
	:global(.analytics-dashboard .atoll-bar.selected) {
		background: #eee8fa;
	}
	:global(.analytics-dashboard .atoll-bar.selected) {
		box-shadow: inset 0 -2px #8c66d0;
	}
	.bar-group {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		width: 100%;
		height: 100%;
		gap: 4px;
	}
	.bar {
		flex: 1;
		max-width: 12px;
		border-radius: 3px 3px 0 0;
		min-height: 0;
	}
	.bar-health {
		background: #9072dd;
	}
	.bar-education {
		background: #32ae89;
	}
	.bar-airports {
		background: #efa84b;
	}
	.atoll-label {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 28px;
		width: 100%;
		font-size: 8px;
		color: #81778c;
		text-align: center;
		line-height: 1.25;
		overflow: hidden;
	}
	.atoll-tooltip {
		position: absolute;
		bottom: calc(100% + 5px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 3;
		pointer-events: none;
		width: 150px;
		padding: 11px 12px;
		border: 1px solid #e5dfed;
		border-radius: 10px;
		background: #fff;
		box-shadow: 0 6px 24px #3c31581c;
		font-size: 10px;
	}
	.atoll-tooltip > strong {
		display: block;
		margin-bottom: 7px;
		font-size: 11px;
	}
	.atoll-tooltip.tooltip-start {
		left: 0;
		transform: none;
	}
	.atoll-tooltip.tooltip-end {
		left: auto;
		right: 0;
		transform: none;
	}
	.atoll-tooltip > span {
		display: flex;
		align-items: center;
		gap: 5px;
		margin-top: 4px;
		color: #756a81;
	}
	.atoll-tooltip i {
		width: 5px;
		height: 5px;
		border-radius: 50%;
	}
	.atoll-tooltip b {
		margin-left: auto;
		color: #3c3150;
		font-weight: 500;
	}
	.chart-caption {
		font-size: 9px;
		color: #81778c;
		line-height: 1.5;
		min-height: 27px;
		margin-top: 9px;
	}
	.chart-caption strong {
		color: #6e528f;
		font-weight: 600;
	}
	.chart-legend {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 14px;
		color: #756b80;
		font-size: 9px;
		margin-top: 12px;
	}
	.chart-legend > span,
	.category-label {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.chart-legend i,
	.category-label i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.facility-mix-chart {
		position: relative;
		width: 194px;
		height: 194px;
		margin: 15px auto 12px;
	}
	.facility-mix-chart svg {
		width: 100%;
		height: 100%;
	}
	.facility-mix-chart circle {
		transition: opacity 140ms ease;
	}
	.mix-centre {
		position: absolute;
		inset: 0;
		display: flex;
		justify-content: center;
		align-items: center;
		flex-direction: column;
		pointer-events: none;
	}
	.mix-centre strong {
		font-size: 34px;
		font-weight: 470;
		letter-spacing: -1.4px;
	}
	.mix-centre > span {
		font-size: 9px;
		color: #8a7f97;
		margin-top: 2px;
	}
	.category-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	:global(.analytics-dashboard .category-row) {
		display: grid;
		grid-template-columns: 1fr 31px 30px 12px;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 30px;
		padding: 4px 5px;
		border-radius: 6px;
		font-size: 10px;
		color: #776b84;
		font-weight: 450;
	}
	.category-label {
		text-align: left;
		min-width: 0;
	}
	.category-share {
		color: #94889f;
		text-align: right;
		font-size: 9px;
	}
	:global(.analytics-dashboard .category-row strong) {
		text-align: right;
		color: #4f425f;
		font-size: 11px;
		font-weight: 550;
	}
	:global(.analytics-dashboard .category-selected) {
		background: #f1ebfb;
	}
	.mix-note {
		margin-top: 13px;
		color: #8a7f97;
		font-size: 9px;
		line-height: 1.6;
	}
	.mix-note :global(button) {
		height: auto;
		padding: 0;
		color: #7d5ab6;
		font-size: 10px;
		white-space: normal;
		text-align: left;
	}
	.coverage-gauge {
		position: relative;
		width: 100%;
		height: 160px;
		max-width: 270px;
		margin: 26px auto 26px;
	}
	.coverage-gauge svg {
		position: absolute;
		width: 100%;
		height: 100%;
		inset: 0;
		overflow: visible;
	}
	.gauge-value {
		position: absolute;
		bottom: 15px;
		left: 0;
		right: 0;
		text-align: center;
	}
	.gauge-value strong {
		font-size: 38px;
		font-weight: 470;
		letter-spacing: -1.5px;
	}
	.gauge-value > span {
		display: block;
		font-size: 10px;
		color: #7c7587;
		margin-top: 4px;
	}
	.coverage-breakdown {
		display: flex;
		flex-direction: column;
		gap: 13px;
	}
	.coverage-breakdown > div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 10px;
		color: #7b7287;
	}
	.coverage-breakdown > div > span {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.coverage-breakdown strong {
		font-size: 11px;
		color: #4f425f;
		font-weight: 550;
	}
	.coverage-breakdown i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	.located-dot {
		background: #32ae89;
	}
	.context-dot {
		background: #ac93df;
	}
	.unlocated-dot {
		background: #efa84b;
	}
	.coverage-note {
		border-top: 1px solid #edf0ed;
		padding-top: 13px;
		margin-top: 19px;
		color: #80768b;
		font-size: 9px;
		line-height: 1.65;
	}
	.access-metric {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 7px;
		margin-top: 23px;
	}
	.access-metric > span {
		color: #8a7e96;
		font-size: 10px;
	}
	.distribution-chart {
		display: flex;
		justify-content: space-between;
		gap: 9px;
		margin: 30px 0 0;
	}
	.distribution-column {
		display: flex;
		align-items: center;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}
	.distribution-count {
		color: #867791;
		font-size: 9px;
		height: 19px;
	}
	.distribution-track {
		display: flex;
		justify-content: center;
		align-items: flex-end;
		width: 100%;
		height: 94px;
		border-bottom: 1px solid #eee9f3;
	}
	.distribution-track > span {
		width: 100%;
		max-width: 27px;
		border-radius: 5px 5px 0 0;
	}
	.distribution-label {
		color: #867791;
		font-size: 8px;
		margin-top: 9px;
	}
	.access-note {
		display: flex;
		align-items: flex-start;
		gap: 7px;
		margin-top: 21px;
		padding: 12px;
		background: #f8f5fc;
		border-radius: 9px;
		color: #7a6a89;
		font-size: 10px;
		line-height: 1.6;
	}
	.note-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		flex-shrink: 0;
		margin-top: 5px;
		background: #ac91d6;
	}
	.inventory-disclosure {
		margin-top: 25px;
		border-top: 1px solid #ddd6e9;
		padding-top: 22px;
	}
	.inventory-disclosure > summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		list-style: none;
		cursor: pointer;
		border-radius: 8px;
	}
	.inventory-disclosure > summary::-webkit-details-marker {
		display: none;
	}
	.inventory-disclosure > summary h2 {
		font-size: 17px;
	}
	.inventory-disclosure > summary p {
		color: #80748e;
		font-size: 11px;
		margin-top: 6px;
	}
	.disclosure-action {
		display: flex;
		align-items: center;
		gap: 9px;
		color: #7b5caf;
		font-size: 11px;
		white-space: nowrap;
	}
	.inventory-disclosure[open] .disclosure-action :global(svg) {
		transform: rotate(180deg);
	}
	.data-gap-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 18px;
		margin-top: 23px;
	}
	:global(.analytics-dashboard .mini-card) {
		display: grid;
		grid-template-columns: 42px auto 1fr;
		align-items: center;
		gap: 7px 14px;
		padding: 19px 23px;
	}
	.mini-icon {
		grid-row: 1 / span 3;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 12px;
	}
	.mini-icon.purple {
		background: #eee7fa;
		color: #9571cf;
	}
	.mini-icon.green {
		background: #e7f6ef;
		color: #30a982;
	}
	:global(.analytics-dashboard .mini-card h2) {
		font-size: 11px;
	}
	:global(.analytics-dashboard .mini-card > strong) {
		grid-column: 3;
		grid-row: 1 / span 3;
		justify-self: end;
		font-size: 29px;
		font-weight: 460;
		letter-spacing: -1px;
	}
	:global(.analytics-dashboard .mini-card p) {
		font-size: 10px;
		color: #82748e;
	}
	:global(.analytics-dashboard .mini-action) {
		grid-column: 2;
		justify-self: start;
		font-size: 10px;
		height: 22px;
		padding: 0;
		color: #7c5ab1;
	}
	:global(.analytics-dashboard .methodology-card) {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: 20px;
		padding: 22px;
		margin: 0 0 28px;
	}
	:global(.analytics-dashboard .methodology-card p) {
		margin-top: 8px;
		font-size: 11px;
		color: #80748e;
		line-height: 1.8;
	}
	:global(.analytics-dashboard .screening-card) {
		padding: 0;
		margin-top: 20px;
		overflow: hidden;
	}
	.screening-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 20px;
		padding: 24px;
	}
	.screening-heading h2 {
		font-size: 19px;
		letter-spacing: -0.6px;
	}
	.screening-heading p {
		font-size: 11px;
		color: #80748e;
		margin-top: 6px;
	}
	.eyebrow {
		font-size: 9px;
		letter-spacing: 0.12em;
		font-weight: 600;
		color: #a08cb4;
		margin-bottom: 6px;
	}
	.table-toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 20px;
		padding: 0 24px 20px;
	}
	.table-search {
		position: relative;
		width: 280px;
		display: flex;
		align-items: center;
		color: #8b7b9a;
	}
	.table-search > :global(svg) {
		position: absolute;
		left: 11px;
		z-index: 1;
	}
	.table-search :global(input) {
		padding-left: 33px;
		height: 35px;
		font-size: 11px;
		background: #fbfafd;
	}
	.table-toolbar :global([data-slot='native-select-wrapper']) {
		width: 220px;
	}
	.table-toolbar :global(select) {
		height: 35px;
		font-size: 11px;
	}
	.table-scroll {
		position: relative;
		width: 100%;
		min-width: 0;
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 11px;
	}
	th {
		background: #faf8fd;
		color: #897c97;
		font-size: 10px;
		font-weight: 500;
		height: 43px;
		padding: 0 16px;
		white-space: nowrap;
		border-block: 1px solid #f0ebf6;
	}
	th:first-child,
	td:first-child {
		padding-left: 24px;
	}
	th:last-child,
	td:last-child {
		padding-right: 24px;
		text-align: right;
	}
	:global(.analytics-dashboard .table-sort) {
		height: 28px;
		margin-left: -9px;
		font-size: 10px;
		color: #897c97;
		font-weight: 500;
	}
	td {
		border-bottom: 1px solid #f2edf7;
		padding: 15px 16px;
		color: #82748e;
		white-space: nowrap;
	}
	td > strong {
		font-size: 12px;
		font-weight: 550;
		color: #5e4e6e;
	}
	.island-name {
		font-size: 12px;
		color: #44354f;
		font-weight: 560;
	}
	.island-type,
	.table-subline {
		display: block;
		font-size: 9px;
		color: #998ba3;
		margin-top: 4px;
	}
	.score-value {
		color: #6c537d;
		font-size: 14px;
	}
	.score-value small {
		color: #a294ad;
		font-size: 9px;
		margin-left: 3px;
	}
	:global(.analytics-dashboard .row-explore) {
		font-size: 11px;
		color: #8761b8;
	}
	.table-empty {
		text-align: center !important;
		padding: 30px;
		white-space: normal;
	}
	.table-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 15px;
		padding: 17px 24px;
		color: #897b97;
		font-size: 10px;
	}
	.pagination {
		display: flex;
		align-items: center;
		gap: 12px;
		white-space: nowrap;
	}
	.analytics-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-top: 18px;
		color: #8c7b9d;
		font-size: 10px;
	}
	.analytics-footer :global(button) {
		font-size: 10px;
		color: #8a6eab;
	}
	.analysis-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 18px 22px;
		margin-bottom: 22px;
		border: 1px solid #ebc8d1;
		background: #fff5f7;
		border-radius: 14px;
		color: #914e60;
	}
	.analysis-error strong {
		font-size: 13px;
	}
	.analysis-error p {
		font-size: 11px;
		margin-top: 5px;
	}
	@media (min-width: 1500px) {
		.atoll-chart {
			height: 192px;
		}
		.facility-mix-chart {
			width: 205px;
			height: 205px;
		}
	}
	@media (max-width: 1100px) {
		.analytics-dashboard {
			padding: 28px 24px;
		}
		.analytics-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 17px;
		}
		:global(.analytics-dashboard .footprint-card) {
			grid-column: 1;
			grid-row: 1;
		}
		:global(.analytics-dashboard .mix-card) {
			grid-column: 2;
			grid-row: 1;
		}
		:global(.analytics-dashboard .coverage-card) {
			grid-column: 1;
			grid-row: 3;
		}
		:global(.analytics-dashboard .access-card) {
			grid-column: 2;
			grid-row: 3;
		}
		.mobility-pulse-slot {
			grid-column: 1 / -1;
			grid-row: 2;
		}
		.snapshot-note {
			max-width: 245px;
			flex-wrap: wrap;
			justify-content: flex-end;
		}
		.coverage-gauge {
			height: 170px;
		}
	}
	@media (max-width: 640px) {
		.analytics-dashboard {
			padding: 24px 16px;
		}
		.overview-heading {
			align-items: flex-start;
			gap: 14px;
			margin-bottom: 20px;
		}
		h1 {
			font-size: 27px;
			letter-spacing: -1.2px;
		}
		.overview-heading p {
			font-size: 11px;
			max-width: 205px;
			line-height: 1.6;
		}
		:global(.analytics-dashboard .overview-map-button) {
			width: 37px;
			min-width: 37px;
			min-height: 37px;
			height: 37px;
			padding: 0;
			font-size: 0;
			gap: 0;
		}
		:global(.analytics-dashboard .overview-map-button svg:last-child) {
			display: none;
		}
		.overview-filters {
			flex-direction: column;
			align-items: stretch;
			gap: 12px;
		}
		.scope-controls {
			flex-wrap: wrap;
			gap: 8px;
		}
		.scope-controls > :global(svg) {
			display: none;
		}
		.scope-controls :global([data-slot='native-select-wrapper']) {
			flex: 1;
			min-width: 0;
		}
		.scope-controls :global(select) {
			width: 100%;
			min-width: 0;
			font-size: 10px;
		}
		.scope-controls > :global(button) {
			flex-basis: 100%;
			justify-content: flex-start;
			padding-inline: 0;
			height: 24px;
			font-size: 11px;
		}
		.snapshot-note {
			max-width: none;
			justify-content: flex-start;
			font-size: 9px;
		}
		.analytics-grid {
			display: flex;
			flex-direction: column;
			gap: 15px;
			margin-bottom: 28px;
		}
		:global(.analytics-dashboard .analytics-card) {
			padding: 21px;
			border-radius: 18px;
		}
		.mobility-pulse-slot {
			order: 0;
		}
		:global(.analytics-dashboard .footprint-card) {
			order: 1;
		}
		:global(.analytics-dashboard .mix-card) {
			order: 2;
		}
		:global(.analytics-dashboard .coverage-card) {
			order: 3;
		}
		:global(.analytics-dashboard .access-card) {
			order: 4;
		}
		.atoll-chart {
			height: 184px;
		}
		.facility-mix-chart {
			width: 196px;
			height: 196px;
		}
		.coverage-gauge {
			height: 168px;
			max-width: 265px;
			margin-block: 20px;
		}
		.category-list {
			gap: 4px;
		}
		.category-label {
			font-size: 11px;
		}
		.distribution-track {
			height: 83px;
		}
		.data-gap-grid {
			grid-template-columns: 1fr;
			gap: 12px;
		}
		.inventory-disclosure > summary {
			gap: 12px;
			align-items: flex-start;
		}
		.inventory-disclosure > summary h2 {
			font-size: 15px;
		}
		.inventory-disclosure > summary p {
			font-size: 10px;
			max-width: 220px;
		}
		.disclosure-action {
			font-size: 0;
			gap: 0;
			padding-top: 3px;
		}
		.table-toolbar {
			flex-direction: column;
			align-items: stretch;
			gap: 10px;
			padding: 0 18px 18px;
		}
		.table-search {
			width: 100%;
		}
		.table-toolbar :global([data-slot='native-select-wrapper']) {
			width: 100%;
		}
		:global(.analytics-dashboard .screening-card) {
			padding: 0;
		}
		.screening-heading {
			align-items: flex-start;
			gap: 12px;
			padding: 20px 18px;
		}
		.screening-heading h2 {
			font-size: 17px;
		}
		.screening-heading p {
			font-size: 10px;
		}
		.screening-heading :global(button) {
			font-size: 10px;
		}
		.table-footer {
			flex-wrap: wrap;
			padding: 15px 18px;
		}
		.analytics-footer {
			align-items: flex-start;
			font-size: 9px;
		}
		.analytics-footer > span {
			max-width: 130px;
		}
		:global(.analytics-dashboard .methodology-card) {
			flex-direction: column;
			padding: 20px;
			gap: 10px;
		}
		.analysis-error {
			padding: 15px;
			flex-wrap: wrap;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.facility-mix-chart circle {
			transition: none;
		}
	}
</style>
