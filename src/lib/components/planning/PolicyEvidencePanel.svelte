<script lang="ts">
	import type { PolicyEvidenceBundle } from '#lib/server/data/policyEvidenceSource.ts';
	let {
		evidence,
		enabledLayers = [],
		ontoggle
	}: {
		evidence: PolicyEvidenceBundle | null;
		enabledLayers?: string[];
		ontoggle: (id: string, enabled: boolean) => void;
	} = $props();
	const count = (n: number | null | undefined) =>
		n == null ? 'Unavailable' : n.toLocaleString('en');
</script>

<details class="policy-evidence">
	<summary>Sites, walking conditions & supporting evidence</summary>
	{#if evidence}
		<p class="qualification">
			Use these records to identify places to investigate. They do not establish a usable pavement,
			accessible entrance, available school place, or shaded journey.
		</p>
		{#if evidence.stale}<p class="gap">
				Last validated policy snapshot. Review source dates before a decision.
			</p>{/if}
		<div class="layer-list">
			{#each evidence.layers as layer (layer.id)}
				<label class="layer-row">
					<input
						type="checkbox"
						checked={enabledLayers.includes(layer.id)}
						disabled={!layer.recordCount}
						onchange={(event) => ontoggle(layer.id, event.currentTarget.checked)}
					/>
					<span
						><strong>{layer.title}</strong><small
							>{count(layer.recordCount)} records · {layer.coverage}</small
						></span
					>
				</label>
			{/each}
		</div>
		{#if evidence.schoolCompleteness}<section>
				<h3>Complete the school inventory</h3>
				<p>
					<strong>{count(evidence.schoolCompleteness.publishedSchools)}</strong> institutions in the
					published statistics;
					<strong>{count(evidence.schoolCompleteness.mappedEligibleLocations)}</strong> eligible mapped
					destinations in this snapshot.
				</p>
				<p class="qualification">
					{evidence.schoolCompleteness.referencePeriod}. Counts use different dates and categories;
					this is a reconciliation task, not a count of missing schools.
				</p>
			</section>{/if}
		{#if evidence.observations.length}<details>
				<summary>Hospital activity & household affordability context</summary>
				{#each evidence.observations as row (row.id)}<div class="observation">
						<strong>{row.metric}</strong><span>{count(row.value)} {row.unit}</span><small
							>{row.geography} · {row.referencePeriod}</small
						>
						<p>{row.definition}</p>
					</div>{/each}
			</details>{/if}
		{#if evidence.constituencies.length}<details>
				<summary>Constituency population · {evidence.constituencies.length} records</summary>
				<p class="qualification">
					Census 2022 totals. Boundaries must be matched before reporting neighborhood benefits by
					constituency. Nationality cohorts remain separate.
				</p>
				<div class="constituencies">
					{#each evidence.constituencies as row (row.id)}<div>
							<strong>{row.name}</strong><span>{count(row.population)} residents</span><small
								>Maldivian {count(row.maldivianPopulation)} · foreign {count(
									row.foreignPopulation
								)}</small
							>
						</div>{/each}
				</div>
			</details>{/if}
		<details>
			<summary>Verification & agency requests</summary>
			<ul>
				{#each evidence.gaps as gap (gap)}<li>
						{gap}
					</li>{/each}{#each evidence.agencyRequests as request (request)}<li>{request}</li>{/each}
			</ul>
		</details>
		<details>
			<summary>Supporting dataset sources · {evidence.sources.length}</summary
			>{#each evidence.sources as source (source.id)}<div class="source">
					<a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small
						>{source.publisher} · {source.referencePeriod} · retrieved {source.retrievedAt.slice(
							0,
							10
						)}</small
					>
					<p>{source.licenseStatus}</p>
				</div>{/each}
		</details>
	{:else}<p class="gap">
			Supporting policy data is unavailable. Core planning continues with its validated local
			snapshot.
		</p>{/if}
</details>

<style>
	.policy-evidence {
		margin: 18px 0;
		border: 1px solid #dae4d7;
		border-radius: 12px;
		padding: 14px;
	}
	summary {
		cursor: pointer;
		color: #294e3a;
		font-size: 14px;
		font-weight: 650;
		line-height: 1.5;
	}
	p,
	li {
		font-size: 13px;
		color: #566950;
		line-height: 1.6;
	}
	.qualification,
	small {
		color: #6d7d65;
		font-size: 12px;
	}
	.gap {
		padding: 10px;
		background: #fff1d4;
		border-radius: 8px;
	}
	.layer-list {
		display: grid;
		gap: 8px;
		margin: 14px 0;
	}
	.layer-row {
		display: flex;
		gap: 10px;
		align-items: center;
		padding: 12px;
		border-radius: 9px;
		background: #f1f5ed;
		cursor: pointer;
	}
	input {
		accent-color: #087c79;
		width: 16px;
		height: 16px;
	}
	.layer-row span,
	.observation,
	.source,
	.constituencies > div {
		display: grid;
		gap: 4px;
	}
	strong {
		font-size: 13px;
		color: #294e3a;
	}
	section,
	details details {
		margin-top: 16px;
	}
	h3 {
		font-size: 14px;
	}
	.observation,
	.source,
	.constituencies > div {
		padding: 10px 0;
		border-bottom: 1px solid #e5eadf;
	}
	.observation p,
	.source p {
		margin: 0;
		font-size: 12px;
	}
	a {
		color: #087c79;
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.constituencies {
		max-height: 240px;
		overflow: auto;
	}
</style>
