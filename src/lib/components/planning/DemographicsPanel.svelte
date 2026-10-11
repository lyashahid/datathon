<script lang="ts">
	import { number } from './atlasData.ts';
	interface Group {
		dimension: string;
		year: number;
		status: string;
		denominator: string | number;
		groups: { id: string; label: string; value: number }[];
		qualification?: string;
	}
	interface Island {
		islandId: string;
		availableGroups: Group[];
		unavailableGroups: { dimension: string; reason: string }[];
	}
	let { data, names }: { data: unknown; names: Record<string, string> } = $props();
	let year = $state(2022);
	const demographics = $derived(data as { islands?: Island[]; gaps?: string[] } | undefined);
</script>

{#if demographics?.islands}
	<details class="demographics">
		<summary>Demographics & equity coverage</summary>
		<p>
			Official groups describe whole islands. They are not assigned to neighborhood origins or used
			to infer who benefits from a proposed service.
		</p>
		<label
			>Reference year<select bind:value={year}
				><option value={2022}>2022 · census</option><option value={2026}>2026 · projection</option
				><option value={2030}>2030 · projection</option></select
			></label
		>
		{#each demographics.islands as island (island.islandId)}
			<section>
				<h4>{names[island.islandId] ?? island.islandId}</h4>
				{#each island.availableGroups.filter((group) => group.year === year) as group (group.dimension)}
					<strong>{group.dimension} · {group.status}</strong>
					<dl>
						{#each group.groups as item (item.id)}<div>
								<dt>{item.label}</dt>
								<dd>{number(item.value)}</dd>
							</div>{/each}
					</dl>
					{#if group.qualification}<p>{group.qualification}</p>{/if}
				{/each}
				{#if !island.availableGroups.some((group) => group.year === year)}<p>
						No separate projection available for this island.
					</p>{/if}
				<details>
					<summary>Unavailable groups</summary
					>{#each island.unavailableGroups as gap (gap.dimension)}<p>
							<strong>{gap.dimension}:</strong>
							{gap.reason}
						</p>{/each}
				</details>
			</section>
		{/each}
	</details>
{/if}

<style>
	.demographics {
		min-width: 0;
		max-width: 100%;
		box-sizing: border-box;
		overflow-wrap: anywhere;
		border: 1px solid #dce6de;
		border-radius: 12px;
		padding: 16px;
		margin: 20px 0;
		font-size: 14px;
		color: #355c60;
	}
	summary {
		cursor: pointer;
		font-weight: 650;
	}
	summary:focus-visible,
	select:focus-visible {
		outline: 2px solid #27795e;
		outline-offset: 3px;
	}
	p {
		font-size: 13px;
		line-height: 1.65;
	}
	label {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}
	select {
		min-width: 0;
		max-width: 100%;
		min-height: 40px;
		box-sizing: border-box;
		border: 1px solid #cedbd2;
		border-radius: 8px;
		padding: 8px;
		background: white;
		color: #163e4b;
	}
	section {
		padding: 12px 0;
		border-top: 1px solid #e2e9e2;
		margin-top: 16px;
	}
	h4 {
		margin: 0 0 14px;
		font-size: 16px;
	}
	dl {
		margin: 8px 0 16px;
	}
	dl div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 5px 0;
	}
	dd {
		flex-shrink: 0;
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
	dt {
		min-width: 0;
	}
	@media (max-width: 480px) {
		.demographics {
			padding: 12px;
		}
		label {
			align-items: stretch;
			flex-direction: column;
			gap: 8px;
		}
		select {
			width: 100%;
		}
	}
	@media (pointer: coarse) {
		select {
			min-height: 44px;
			font-size: 16px;
		}
		summary {
			min-height: 44px;
			padding: 11px 0;
			box-sizing: border-box;
		}
	}
</style>
