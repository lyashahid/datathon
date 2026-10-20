<script lang="ts">
	import { finiteValue, type PlanningEconomics } from '#lib/proposal-review.js';

	let { economics }: { economics: PlanningEconomics | null | undefined } = $props();
	const basis = $derived(economics?.cost_basis);
	const money = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
	const factors = $derived(
		Object.entries(basis?.factors ?? {}).flatMap(([key, factor]) => {
			if (!factor.unit.startsWith('MVR')) return [];
			const applied = finiteValue(economics?.assumptions[key]);
			if (applied === null) return [];
			const provenance = economics?.calibration?.factor_basis[key] ?? '';
			const override = provenance.startsWith('manual_')
				? 'Manual scenario override'
				: provenance.startsWith('uploaded_')
					? 'Selected uploaded evidence'
					: provenance.startsWith('derived_')
						? 'Derived from scenario energy inputs'
						: applied !== factor.value
							? 'Scenario-specific value'
							: '';
			return [{ key, ...factor, applied, override }];
		})
	);
	const sources = $derived(
		(basis?.sources ?? []).flatMap((source) => {
			try {
				const url = new URL(source.url);
				return url.protocol === 'https:' || url.protocol === 'http:'
					? [{ ...source, url: url.href }]
					: [];
			} catch {
				return [];
			}
		})
	);
	function amount(value: number, unit: string) {
		return `MVR ${money.format(value)}${unit.slice(3).replace('/', ' / ')}`;
	}
</script>

{#if basis && factors.length}
	<details class="cost-assumptions">
		<summary>Cost assumptions and sources <span>MVR · reviewed {basis.reviewed_at}</span></summary>
		<div class="cost-basis-content">
			<p>{basis.price_basis}</p>
			<p class="scope-note">
				These are editable model inputs. Only factors relevant to the proposal are charged; route
				distance, departures and required vehicles determine service totals.
			</p>
			<div class="factor-list">
				{#each factors as factor (factor.key)}
					<details class="factor">
						<summary>
							<span
								>{factor.title}{#if factor.override}<small>{factor.override}</small>{/if}</span
							>
							<strong>{amount(factor.applied, factor.unit)}</strong>
						</summary>
						<div>
							{#if factor.override}<p>
									The applied value above takes precedence. Research starting value:
									{amount(factor.value, factor.unit)}.
								</p>{/if}
							<p>{factor.basis}</p>
							{#each factor.source_ids as sourceId (sourceId)}
								{@const source = sources.find((item) => item.id === sourceId)}
								{#if source}<p class="source">
										<a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
										<span
											>{source.publisher}{#if source.published_date}
												· {source.published_date}{/if}</span
										>
										{#if source.qualification}<span>{source.qualification}</span>{/if}
									</p>{/if}
							{/each}
						</div>
					</details>
				{/each}
			</div>
			<div class="budget-basis">
				<strong>Suggested starting budget</strong>
				<p>
					{amount(basis.budget.capital_mvr, 'MVR')} capital ·
					{amount(basis.budget.annual_operating_mvr, 'MVR/year')} running costs
				</p>
				<p>{basis.budget.basis}</p>
			</div>
		</div>
	</details>
{/if}

<style>
	.cost-assumptions {
		margin-top: 20px;
		border-top: 1px solid var(--border);
		padding-top: 16px;
		font-size: 12px;
	}
	.cost-assumptions > summary {
		cursor: pointer;
		font-weight: 600;
		color: var(--foreground);
	}
	.cost-assumptions > summary > span {
		margin-left: 8px;
		font-size: 10px;
		font-weight: 400;
		color: var(--muted-foreground);
	}
	.cost-basis-content {
		padding-top: 12px;
		line-height: 1.6;
	}
	p {
		margin: 0 0 10px;
		color: var(--muted-foreground);
	}
	.scope-note {
		font-size: 11px;
	}
	.factor-list {
		margin: 14px 0;
	}
	.factor {
		border-top: 1px solid var(--border);
	}
	.factor > summary {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 16px;
		padding: 10px 0;
		cursor: pointer;
		list-style: none;
	}
	.factor > summary::-webkit-details-marker {
		display: none;
	}
	.factor > summary > span::before {
		content: '›';
		display: inline-block;
		margin-right: 7px;
		color: var(--muted-foreground);
	}
	.factor[open] > summary > span::before {
		transform: rotate(90deg);
	}
	.factor strong {
		font-weight: 550;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.factor small {
		display: block;
		margin-left: 12px;
		font-size: 10px;
		color: var(--muted-foreground);
	}
	.factor > div {
		padding: 0 12px 6px;
		max-width: 850px;
	}
	.source a {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.source span {
		display: block;
		font-size: 11px;
	}
	.budget-basis {
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
	.budget-basis > strong {
		display: block;
		margin-bottom: 6px;
		font-weight: 600;
	}
	@media (max-width: 640px) {
		.cost-assumptions > summary > span {
			display: block;
			margin: 5px 0 0 15px;
		}
		.factor > summary {
			gap: 10px;
		}
		.factor strong {
			max-width: 46%;
		}
	}
</style>
