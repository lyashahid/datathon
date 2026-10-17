<script lang="ts">
	import type { OfficialIslandContext } from '#lib/types.js';

	let { context, islandId }: { context: OfficialIslandContext | null; islandId: string } = $props();
	const count = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
	const rate = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
	const displayCount = (value: number | null | undefined) =>
		value == null ? 'Not available' : count.format(value);
	const census = $derived(
		context?.census_demographics?.island_id === islandId ? context.census_demographics : null
	);
	const projections = $derived(
		context?.projections.filter((row) => row.island_id === islandId) ?? []
	);
	const employment = $derived(
		context?.employment.find(
			(row) =>
				row.island_id === islandId && row.population_scope === 'residents' && row.sex === 'both'
		)
	);
	const sources = $derived(
		context?.sources.filter((source) =>
			['mbs-census2022-population', 'mbs-census2022-employment', 'mbs-island-projections'].includes(
				source.id
			)
		) ?? []
	);
</script>

{#if census}
	<section class="official-island-context" aria-label="Official island population context">
		<h2>Official island context</h2>
		<p class="context-grain">Whole administrative island · Census {census.year}</p>
		<dl>
			<div>
				<dt>Residents</dt>
				<dd>{displayCount(census.residents_total)}</dd>
			</div>
			{#each [2026, 2030] as year (year)}
				{@const projection = projections.find((row) => row.year === year)}
				{#if projection}
					<div>
						<dt>Projected residents · {year}</dt>
						<dd>{displayCount(projection.residents_total)}</dd>
					</div>
				{/if}
			{/each}
			<div>
				<dt>Maldivian children · ages 0–17</dt>
				<dd>{displayCount(census.maldivian_children_0_17_total)}</dd>
			</div>
			<div>
				<dt>Maldivian older adults · ages 65+</dt>
				<dd>{displayCount(census.maldivian_older_adults_65_plus_total)}</dd>
			</div>
			{#if employment}
				<div>
					<dt>Resident unemployment · {employment.year}</dt>
					<dd>
						{employment.unemployment_rate == null
							? 'Not available'
							: `${rate.format(employment.unemployment_rate)}%`}
					</dd>
				</div>
			{/if}
		</dl>
		<p class="context-note">
			Age counts cover Maldivians only. Unemployment uses the resident labour force, both sexes.
			Projections allocate atoll trends to islands; these totals do not measure neighbourhood
			residents or travel demand.
		</p>
		<div class="context-sources">
			<span>Maldives Bureau of Statistics:</span>
			{#each sources as source (source.id)}
				<a href={source.url} target="_blank" rel="noreferrer"
					>{source.id === 'mbs-island-projections'
						? '2022–2030 projections'
						: source.id === 'mbs-census2022-employment'
							? '2022 employment'
							: '2022 population'}</a
				>
			{/each}
		</div>
	</section>
{/if}

<style>
	.official-island-context {
		border: 1px solid var(--theme-color-eeeaf2);
		border-radius: 14px;
		padding: 17px;
	}
	h2 {
		font-size: 15px;
		font-weight: 600;
		margin: 0 0 5px;
	}
	.context-grain,
	.context-note,
	.context-sources {
		color: var(--theme-color-71687e);
		font-size: 11px;
		line-height: 1.6;
	}
	.context-grain {
		margin: 0 0 12px;
	}
	dl {
		margin: 0;
	}
	dl > div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 5px 0;
		font-size: 12px;
	}
	dd {
		margin: 0;
		font-weight: 600;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.context-note {
		margin: 12px 0 8px;
	}
	.context-sources {
		display: flex;
		flex-wrap: wrap;
		gap: 3px 9px;
	}
	a {
		color: var(--theme-color-645080);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
</style>
