<script lang="ts">
	import { Ship, ExternalLink } from '@lucide/svelte';
	import {
		createFerryRuntimeAssumption,
		type FerryRuntimeEvidence
	} from '#lib/planning/ferryAssumption.ts';
	import type { PlanningAction, PlanningBaseline } from '#lib/planning/types.ts';
	let {
		baseline,
		evidence,
		date,
		onapply
	}: {
		baseline: PlanningBaseline;
		evidence: FerryRuntimeEvidence | null;
		date: string;
		onapply: (action: PlanningAction, warnings: string[]) => void;
	} = $props();
	let crossingMinutes = $state(10);
	let publicHoliday = $state(false);
	let acknowledged = $state(false);
	let applied = $state(false);
	const proposal = $derived(
		evidence
			? createFerryRuntimeAssumption(baseline, evidence, {
					date,
					crossingMinutes,
					publicHoliday,
					acknowledgeCalendarValidity: acknowledged
				})
			: null
	);
	function apply() {
		if (proposal?.ok) {
			onapply(proposal.action, proposal.warnings);
			applied = true;
		}
	}
	$effect(() => {
		const key = `${date}:${crossingMinutes}:${publicHoliday}`;
		if (key) applied = false;
	});
</script>

<section class="ferry-assumption" aria-label="Conditional Vilimalé ferry service">
	<header>
		<Ship size={17} aria-hidden="true" />
		<h3>Test the Vilimalé crossing</h3>
		<span>Assumption</span>
	</header>
	{#if evidence}
		<p class="intro">
			Published ferry headways are available. Crossing duration is missing, so a return journey
			needs an explicit assumption.
		</p>
		<div class="input-row">
			<label for="ferry-runtime">Assumed crossing</label>
			<div>
				<input
					id="ferry-runtime"
					type="number"
					min="2"
					max="120"
					step="1"
					bind:value={crossingMinutes}
				/><span>min</span>
			</div>
		</div>
		<label class="check"
			><input type="checkbox" bind:checked={publicHoliday} />Use the published holiday day type</label
		>
		<label class="check"
			><input type="checkbox" bind:checked={acknowledged} /><span
				>I am testing this calendar as a scenario. Current cancellations and holiday exceptions are
				unverified.</span
			></label
		>
		<button class="apply" disabled={!proposal?.ok || applied} onclick={apply}
			>{applied ? 'Ferry assumption added' : 'Add both ferry directions'}</button
		>
		{#if proposal && !proposal.ok && acknowledged}<p class="gap">{proposal.reason}</p>{/if}
		<details>
			<summary>Published evidence and limitations</summary>
			<div>
				<p>
					Official terminal coordinates and direction-independent headway intervals are retained.
					Friday prayer breaks and unspecified calendar gaps are preserved. Added services are
					labeled assumed and apply only to {date}.
				</p>
				<p>
					Expected wait is half the published headway. This does not guarantee a sailing, establish
					a vessel trajectory, or provide ferry cost/emissions estimates.
				</p>
				{#if proposal?.ok}{#each proposal.warnings as warning (warning)}<p>{warning}</p>{/each}{/if}
				<a href={evidence.sourceUrl} target="_blank" rel="noreferrer"
					>MTCC published timetable <ExternalLink size={12} aria-hidden="true" /></a
				>
			</div>
		</details>
	{:else}<p class="intro">
			Published terminal and calendar evidence is unavailable. No crossing is invented.
		</p>{/if}
</section>

<style>
	.ferry-assumption {
		border: 1px solid #dbe7ed;
		border-radius: 14px;
		background: #fff;
		color: #294a5e;
		overflow: hidden;
		min-width: 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 12px 13px 8px;
	}
	h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 650;
		flex: 1;
		line-height: 1.4;
	}
	header span {
		background: #fbf3e1;
		color: #8c6825;
		border-radius: 5px;
		padding: 2px 5px;
		font-size: 10px;
	}
	.intro {
		padding: 0 13px 10px;
		margin: 0;
		color: #607888;
		font-size: 12px;
		line-height: 1.5;
	}
	.input-row {
		padding: 2px 13px 10px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		font-size: 12px;
	}
	.input-row div {
		display: flex;
		align-items: center;
		gap: 6px;
		border: 1px solid #d5e4ec;
		border-radius: 8px;
		padding: 6px 8px;
		background: #f7fafc;
	}
	.input-row input {
		width: 50px;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: 14px;
		color: #294a5e;
	}
	.input-row span {
		color: #607888;
		font-size: 11px;
	}
	.check {
		display: flex;
		align-items: start;
		gap: 7px;
		margin: 0 13px 10px;
		font-size: 12px;
		line-height: 1.5;
		color: #607888;
	}
	.check input {
		accent-color: #377491;
		margin: 3px 0 0;
		flex-shrink: 0;
	}
	.apply {
		width: calc(100% - 26px);
		margin: 2px 13px 12px;
		padding: 9px;
		border: 1px solid #cee0ea;
		border-radius: 8px;
		color: #2f627e;
		background: #eef6fa;
		font-size: 12px;
		font-weight: 650;
		cursor: pointer;
	}
	.apply:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.apply:active {
		transform: scale(0.98);
	}
	.gap {
		font-size: 12px;
		line-height: 1.5;
		padding: 0 13px 10px;
		color: #8c6825;
		margin: 0;
	}
	details {
		border-top: 1px solid #e7eef2;
	}
	summary {
		cursor: pointer;
		font-size: 12px;
		color: #607888;
		padding: 9px 13px;
	}
	details div {
		padding: 0 13px 12px;
		font-size: 12px;
		line-height: 1.5;
		color: #607888;
		display: grid;
		gap: 8px;
	}
	details p {
		margin: 0;
	}
	a {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: #2f627e;
		text-decoration: underline;
	}
	input:focus-visible,
	button:focus-visible,
	summary:focus-visible {
		outline: 2px solid #377491;
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		.apply {
			min-height: 44px;
		}
		summary {
			min-height: 44px;
			box-sizing: border-box;
			padding-top: 14px;
		}
		.input-row div {
			min-height: 32px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.apply:active {
			transform: none;
		}
	}
</style>
