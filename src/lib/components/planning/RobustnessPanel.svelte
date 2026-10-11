<script lang="ts">
	import type { PlanningAnalysis } from '#lib/planning/types.ts';
	import { money, number } from './atlasData.ts';
	let { result }: { result: PlanningAnalysis['robustness'] } = $props();
</script>

{#if result}
	<section class="robustness" aria-label="Investment resilience comparison">
		<h3>Does the investment hold up?</h3>
		<p>Identical residents, destination goal and investment. Only the road stress changes.</p>
		<div class="table-scroll">
			<table>
				<thead
					><tr
						><th>Condition</th><th>People within target</th><th>People lose access</th><th
							>Unknown</th
						></tr
					></thead
				><tbody>
					{#each [result.normal, ...result.stresses] as row (row.id)}<tr
							><th>{row.name}</th><td>{number(row.scenarioReachableResidents)}</td><td
								class:loss={row.lostResidents > 0}>{number(row.lostResidents)}</td
							><td>{number(row.unknownResidents)}</td></tr
						>{/each}
				</tbody>
			</table>
		</div>
		<details>
			<summary>Cost, fleet & carbon details</summary
			>{#each [result.normal, ...result.stresses] as row (row.id)}<div class="case">
					<b>{row.name}</b><span>Investment {money(row.capitalMvr?.central)}</span><span
						>Annual operations {money(row.annualOperatingMvr?.central)}</span
					><span>Additional vehicles {number(row.additionalFleet)}</span><span
						>Carbon {row.carbonKgCo2e
							? `${row.carbonKgCo2e.central > 0 ? '+' : ''}${number(row.carbonKgCo2e.central / 1000, 1)} t CO₂e / year`
							: 'Unavailable'}</span
					>
				</div>{/each}
			<p>
				Annual figures price the investment. Temporary event operations appear separately in the
				disruption results.
			</p>
		</details>
		<p class="qualification">
			Assumed stress tests describe conditional outcomes; they are not traffic predictions.
		</p>
	</section>
{/if}

<style>
	.robustness {
		margin: 14px 0;
		padding: 13px;
		border: 1px solid #d5e3d9;
		border-radius: 11px;
		background: #f8faf4;
		color: #28453d;
	}
	h3 {
		font-size: 15px;
		margin: 0 0 6px;
	}
	p {
		font-size: 12px;
		line-height: 1.5;
		color: #6b7b6e;
		margin: 6px 0 11px;
	}
	.table-scroll {
		overflow: auto;
	}
	table {
		font-size: 12px;
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		padding: 8px 6px;
		border-bottom: 1px solid #e0e8dd;
		text-align: right;
		vertical-align: top;
	}
	th:first-child {
		text-align: left;
	}
	thead {
		color: #708070;
	}
	tbody th {
		font-weight: 550;
	}
	td.loss {
		color: #ac503b;
		font-weight: 700;
	}
	summary {
		font-size: 12px;
		cursor: pointer;
		margin-top: 12px;
	}
	.case {
		display: grid;
		gap: 3px;
		font-size: 12px;
		margin: 12px 0;
	}
	.qualification {
		margin-bottom: 0;
		font-size: 11px;
	}
</style>
