<!-- Analysis view for one H3 cell: residents, approximate access by service, and why. -->
<script lang="ts">
	import { ChevronDown, Hexagon, MapPinPlus, Ship } from '@lucide/svelte';
	import { getCandidateSearch } from '#lib/stores/candidates.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import { SCORE_CATEGORIES } from '#lib/config/analysis.ts';
	import { getInfoView } from '#lib/config/infoViews.ts';
	import {
		ACCESS_CATEGORY_LABELS,
		ACCESSIBILITY_DISCLAIMER,
		UNDERSERVED_THRESHOLD
	} from '#lib/config/scoring.ts';
	import { underservedShortfall } from '#lib/analysis/h3Grid.ts';
	import { scoreCategory } from '#lib/analysis/scoring.ts';
	import type { H3Cell } from '#lib/types/h3.ts';
	import { colorAt } from '#lib/utils/color.ts';
	import { formatCompact, formatDistance, formatPopulation } from '#lib/utils/format.ts';
	import InspectorSection from './InspectorSection.svelte';
	import AccessBreakdown from './sections/AccessBreakdown.svelte';
	import InterventionFinder from '#lib/components/interventions/InterventionFinder.svelte';

	let { cell, resolution }: { cell: H3Cell; resolution: number } = $props();

	const accessScale = getInfoView('transportAccessibility').scale;
	const candidateSearch = getCandidateSearch();
	const ui = getUiState();
	let breakdownOpen = $state(false);

	const category = $derived(
		SCORE_CATEGORIES.find((c) => c.category === scoreCategory(cell.overallAccessibility))!
	);
	const ages = $derived([
		{ label: 'Children', value: cell.children },
		{ label: 'Working age', value: cell.workingAge },
		{ label: 'Older (65+)', value: cell.olderPopulation }
	]);
	const categories = $derived(cell.access.overall.components.map((c) => cell.access[c.category]));
	const shortfall = $derived(underservedShortfall(cell.overallAccessibility));
</script>

<div class="flex flex-col gap-4 p-3">
	<header>
		<div class="flex items-center gap-1.5">
			<Hexagon class="size-3 text-hud-muted" />
			<span class="hud-label">H3 cell · res {resolution}</span>
		</div>
		<h2 class="mt-1 text-sm font-semibold">{cell.island}</h2>
		<p class="mt-0.5 font-mono text-[10px] text-hud-faint">
			{cell.h3Index} · {(cell.areaKm2 * 1_000_000).toFixed(0)} m²
		</p>
	</header>

	<InspectorSection
		title="Approximate accessibility"
		provenance="demo"
		provenanceNote="Straight-line proximity on demo data"
	>
		<div class="flex items-end gap-3">
			<span class="font-mono text-3xl leading-none font-semibold tabular-nums">
				{cell.overallAccessibility}
			</span>
			<span
				class="mb-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
				style:color={category.color}
				style:background-color="color-mix(in srgb, {category.color} 14%, transparent)"
			>
				{category.label}
			</span>
		</div>
		<p class="text-[10px] leading-snug text-hud-faint">{ACCESSIBILITY_DISCLAIMER}</p>

		<ul class="flex flex-col gap-2">
			{#each categories as access (access.category)}
				{@const lead = access.components[0]}
				<li class="text-[11px]">
					<div class="flex items-center gap-2">
						<span class="w-16 text-hud-muted">{ACCESS_CATEGORY_LABELS[access.category]}</span>
						<span class="h-1.5 flex-1 overflow-hidden rounded-full bg-hud-line" aria-hidden="true">
							<span
								class="block h-full rounded-full"
								style:width="{access.score}%"
								style:background-color={colorAt(accessScale, access.score)}
							></span>
						</span>
						<span class="w-7 text-right font-mono font-medium tabular-nums">{access.score}</span>
					</div>
					<div class="mt-0.5 flex items-center gap-1 pl-[4.5rem] text-[10px] text-hud-faint">
						{#if lead.distanceM === null}
							No {lead.label.toLowerCase()} reachable
						{:else}
							{#if lead.viaFerry}<Ship class="size-3 text-hud-warn" />{/if}
							{lead.label}
							{formatDistance(lead.distanceM)}{lead.viaFerry ? ' incl. ferry' : ''}
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		<button
			type="button"
			class="flex items-center gap-1 self-start text-[11px] text-hud-muted hover:text-hud-text"
			aria-expanded={breakdownOpen}
			onclick={() => (breakdownOpen = !breakdownOpen)}
		>
			<ChevronDown class="size-3 transition-transform {breakdownOpen ? 'rotate-180' : ''}" />
			Why this score?
		</button>
		{#if breakdownOpen}
			<AccessBreakdown access={cell.access} />
		{/if}
	</InspectorSection>

	<InterventionFinder {cell}>
		{#snippet cardActions(suggestion)}
			{#if suggestion.type === 'add_bus_stop'}
				<button
					type="button"
					class="flex w-full items-center justify-center gap-1.5 rounded border border-hud-accent/40 bg-hud-accent-dim py-1.5 text-[11px] font-medium text-hud-accent hover:bg-hud-accent/20"
					data-demo="find-bus-stops"
					onclick={() => {
						candidateSearch.start(cell.h3Index);
						ui.select({ kind: 'candidates' });
					}}
				>
					<MapPinPlus class="size-3.5" /> Find bus-stop locations
				</button>
			{/if}
		{/snippet}
	</InterventionFinder>

	<InspectorSection title="Residents" provenance="demo" provenanceNote="Demo island profiles">
		<div class="flex items-baseline justify-between text-[11px]">
			<span class="text-hud-muted">Total</span>
			<span class="font-mono font-medium tabular-nums">{formatPopulation(cell.population)}</span>
		</div>
		<ul class="flex flex-col gap-1">
			{#each ages as age (age.label)}
				<li class="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-2 text-[11px]">
					<span class="text-hud-muted">{age.label}</span>
					<span class="h-1.5 overflow-hidden rounded-full bg-hud-line" aria-hidden="true">
						<span
							class="block h-full rounded-full bg-hud-accent/70"
							style:width="{cell.population ? (age.value / cell.population) * 100 : 0}%"
						></span>
					</span>
					<span class="text-right font-mono tabular-nums">{formatPopulation(age.value)}</span>
				</li>
			{/each}
		</ul>
		<p class="text-[10px] text-hud-faint">
			Density {formatCompact(Math.round(cell.populationDensity))} residents/km²
		</p>
	</InspectorSection>

	<InspectorSection title="Underserved (weighted)" provenance="demo">
		<div class="flex items-baseline justify-between text-[11px]">
			<span class="text-hud-muted">Gap-weighted</span>
			<span class="font-mono font-medium tabular-nums">
				{formatPopulation(cell.underservedPopulation)}
			</span>
		</div>
		<p class="text-[10px] leading-relaxed text-hud-faint">
			Residents × shortfall below an overall score of {UNDERSERVED_THRESHOLD}:
			{formatPopulation(cell.population)} × {shortfall.toFixed(2)}.
		</p>
	</InspectorSection>
</div>
