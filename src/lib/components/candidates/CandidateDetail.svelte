<!-- Detailed analysis of one bus-stop candidate, with Add to Scenario. -->
<script lang="ts">
	import { ArrowLeft, CirclePlus, CircleCheck, TriangleAlert } from '@lucide/svelte';
	import { BUS_STOP_SCORING, CANDIDATE_LABELS } from '#lib/config/busStopScoring.ts';
	import { CURSOR_COORDINATE_DECIMALS } from '#lib/config/map.ts';
	import { proposedName } from '#lib/simulator/placement.ts';
	import { getCandidateSearch } from '#lib/stores/candidates.svelte.ts';
	import { getScenarioStore } from '#lib/stores/scenario.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import type { BusStopCandidate } from '#lib/types/candidates.ts';
	import { formatLatLng, formatPopulation } from '#lib/utils/format.ts';
	import DemoTag from '#lib/components/inspector/DemoTag.svelte';

	let { candidate }: { candidate: BusStopCandidate } = $props();

	const search = getCandidateSearch();
	const scenarios = getScenarioStore();
	const ui = getUiState();
	let error = $state<string | null>(null);

	const total = $derived(
		candidate.criteria.reduce((s, c) => s + c.contribution, 0) +
			candidate.penalties.reduce((s, p) => s + p.points, 0)
	);
	const pct = (w: number) => `${Math.round(w * 100)}%`;

	function addToScenario() {
		error = null;
		scenarios.ensureScenario();
		const result = scenarios.addInfrastructure({
			name: proposedName('bus_stop', scenarios.effective.infrastructure),
			type: 'bus_stop',
			position: candidate.position,
			metadata: { island: candidate.island, ...(candidate.atoll ? { atoll: candidate.atoll } : {}) }
		});
		if (!result.ok) {
			error = result.reason;
			return;
		}
		// The search would now re-rank around the new stop; close it and show the new stop.
		search.close();
		ui.select({ kind: 'infrastructure', id: result.id });
	}
</script>

<div class="flex flex-col gap-4 p-3">
	<button
		type="button"
		class="flex items-center gap-1 self-start text-[11px] text-hud-muted hover:text-hud-text"
		onclick={() => ui.select({ kind: 'candidates' })}
	>
		<ArrowLeft class="size-3" /> All candidates
	</button>

	<header>
		<div class="flex items-center gap-1.5">
			<span
				class="grid size-5 place-items-center rounded-full text-[10px] font-bold text-hud-base {candidate.rank ===
				1
					? 'bg-amber-400'
					: 'bg-slate-200'}">{candidate.rank}</span
			>
			<span class="hud-label">Bus-stop candidate</span>
			<DemoTag title="Demo demographics; straight-line proximity model" />
		</div>
		<h2 class="mt-1 text-sm leading-snug font-semibold">
			{candidate.rank === 1 ? CANDIDATE_LABELS.top : CANDIDATE_LABELS.ranked(candidate.rank)}
		</h2>
		<p class="mt-0.5 font-mono text-[10px] text-hud-faint tabular-nums">
			{formatLatLng(candidate.position[0], candidate.position[1], CURSOR_COORDINATE_DECIMALS)} · {candidate.island}
		</p>
	</header>

	<div class="flex items-baseline gap-2">
		<span class="font-mono text-3xl leading-none font-semibold tabular-nums">{candidate.score}</span
		>
		<span class="text-[11px] text-hud-faint">/100 candidate score</span>
	</div>

	<dl class="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-[11px] tabular-nums">
		<dt class="text-hud-muted">Residents within {BUS_STOP_SCORING.catchmentRadiusM} m</dt>
		<dd class="text-right font-mono">{formatPopulation(candidate.expectedPopulationServed)}</dd>
		<dt class="text-hud-muted">Underserved reached (weighted)</dt>
		<dd class="text-right font-mono">{formatPopulation(candidate.underservedReached)}</dd>
		<dt class="text-hud-muted">Est. transport accessibility gain</dt>
		<dd class="text-right font-mono text-emerald-400">
			{candidate.estimatedAccessibilityGain >= 0
				? '+'
				: ''}{candidate.estimatedAccessibilityGain.toFixed(1)} pts
		</dd>
	</dl>
	<p class="-mt-2 text-[10px] text-hud-faint">
		Gain = change in the population-weighted average transport score (0–100) across the
		{BUS_STOP_SCORING.areaRadiusM} m search area; straight-line model.
	</p>

	<section>
		<h3 class="mb-1.5 hud-label">Score breakdown · selected priorities</h3>
		<ul class="flex flex-col gap-2">
			{#each candidate.criteria as c (c.id)}
				<li>
					<div class="flex items-baseline gap-2 text-[11px]">
						<span class="flex-1 font-medium">{c.label}</span>
						<span class="font-mono text-hud-muted tabular-nums"
							>{Math.round(c.score)} × {pct(c.weight)}</span
						>
						<span class="w-10 text-right font-mono font-medium tabular-nums"
							>+{c.contribution.toFixed(1)}</span
						>
					</div>
					<p class="mt-0.5 text-[10px] leading-relaxed text-hud-faint">{c.explanation}</p>
				</li>
			{/each}
			{#each candidate.penalties as p (p.id)}
				<li>
					<div class="flex items-baseline gap-2 text-[11px]">
						<span class="flex-1 font-medium">{p.label}</span>
						<span class="w-10 text-right font-mono font-medium text-hud-warn tabular-nums"
							>{p.points.toFixed(1)}</span
						>
					</div>
					<p class="mt-0.5 text-[10px] leading-relaxed text-hud-faint">{p.explanation}</p>
				</li>
			{/each}
		</ul>
		<p class="mt-2 border-t border-hud-line pt-1.5 font-mono text-[10px] text-hud-muted">
			Σ = {total.toFixed(1)} → <span class="text-hud-text">{candidate.score}</span>
			<span class="text-hud-faint">(clamped 0–100, rounded)</span>
		</p>
	</section>

	{#if candidate.positives.length}
		<section>
			<h3 class="mb-1 hud-label">Positive factors</h3>
			<ul class="flex flex-col gap-1">
				{#each candidate.positives as text (text)}
					<li class="flex gap-1.5 text-[11px] leading-snug">
						<CircleCheck class="mt-px size-3 shrink-0 text-emerald-400" />{text}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
	{#if candidate.tradeoffs.length}
		<section>
			<h3 class="mb-1 hud-label">Trade-offs</h3>
			<ul class="flex flex-col gap-1">
				{#each candidate.tradeoffs as text (text)}
					<li class="flex gap-1.5 text-[11px] leading-snug">
						<TriangleAlert class="mt-px size-3 shrink-0 text-hud-warn" />{text}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<p class="text-[10px] leading-relaxed text-hud-faint">{CANDIDATE_LABELS.disclaimer}</p>

	{#if error}<p class="text-[11px] text-hud-warn" role="alert">{error}</p>{/if}
	<button
		type="button"
		class="flex items-center justify-center gap-1.5 rounded border border-hud-accent/50 bg-hud-accent-dim py-2 text-xs font-medium text-hud-accent hover:bg-hud-accent/20"
		data-demo="add-to-scenario"
		onclick={addToScenario}
	>
		<CirclePlus class="size-4" /> Add to Scenario
	</button>
</div>
