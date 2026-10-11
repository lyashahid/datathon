<script lang="ts">
	import type { AnnualImageryEvidence } from '#lib/operations/types.ts';
	import type { AnnualImageryYear } from '#lib/operations/imagery.ts';
	interface Props {
		evidence?: AnnualImageryEvidence;
		year?: AnnualImageryYear;
		onselect: (year: AnnualImageryYear) => void;
	}
	let { evidence, year = 2025, onselect }: Props = $props();
	const years: AnnualImageryYear[] = [2020, 2025];
</script>

<section class="imagery-picker" aria-label="Compare annual satellite mosaics">
	<div class="imagery-heading">
		<span class="imagery-kicker">Earth observation</span><strong>See the island in context</strong>
	</div>
	<div class="imagery-years" role="group" aria-label="Satellite mosaic year">
		{#each years as option (option)}
			{@const available = evidence?.mosaics.some((entry) => entry.year === option) ?? false}
			<button
				type="button"
				class:active={year === option}
				aria-pressed={year === option}
				disabled={!available}
				onclick={() => onselect(option)}
			>
				<span>{option}</span><small>Annual mosaic</small>
			</button>
		{/each}
	</div>
	<p>
		Compare land and settlement visually. A mosaic combines dates; it does not measure growth or
		traffic.
	</p>
	<div class="imagery-credit">
		<span>Sentinel-2 · 10 m · online imagery</span><a
			href="https://cloudless.eox.at/pricing"
			target="_blank"
			rel="noopener noreferrer">EOX · noncommercial license ↗</a
		>
	</div>
</section>

<style>
	.imagery-picker {
		display: grid;
		gap: 12px;
		padding: 15px;
		border: 1px solid #d9e3e7;
		border-radius: 14px;
		background: #f8fbfc;
		color: #243f4c;
	}
	.imagery-heading {
		display: grid;
		gap: 4px;
	}
	.imagery-kicker {
		font-size: 10px;
		font-weight: 750;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #66858f;
	}
	.imagery-heading strong {
		font-size: 14px;
		line-height: 1.35;
	}
	.imagery-years {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 7px;
	}
	button {
		display: grid;
		gap: 3px;
		padding: 11px 10px;
		border: 1px solid #d8e4e8;
		border-radius: 10px;
		background: white;
		color: #486772;
		text-align: left;
		cursor: pointer;
	}
	button span {
		font-size: 18px;
		font-weight: 730;
		font-variant-numeric: tabular-nums;
	}
	button small {
		font-size: 10px;
	}
	button.active {
		border-color: #1d887e;
		color: #116c64;
		background: #eaf6f2;
		box-shadow: inset 0 0 0 1px #1d887e;
	}
	button:hover:not(:disabled) {
		background: #edf5f5;
	}
	button:focus-visible {
		outline: 3px solid #6cc2bd;
		outline-offset: 3px;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	p {
		margin: 0;
		font-size: 11px;
		line-height: 1.6;
		color: #58717b;
	}
	.imagery-credit {
		display: grid;
		gap: 5px;
		font-size: 10px;
		line-height: 1.4;
		color: #748b94;
	}
	a {
		color: #477a83;
		text-underline-offset: 3px;
		width: fit-content;
	}
</style>
