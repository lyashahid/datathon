<script lang="ts">
	import { ExternalLink, Database } from '@lucide/svelte';
	import type { PlanningBaseline } from '#lib/planning/types.ts';
	import type { OperationsBundle } from '#lib/operations/types.ts';
	import { sourceEvidence } from '#lib/policy/sourceEvidence.ts';
	let {
		baseline,
		operations = null,
		supportingSources = []
	}: {
		baseline: PlanningBaseline;
		operations?: OperationsBundle | null;
		supportingSources?: Pick<
			import('#lib/planning/types.ts').PlanningSource,
			'id' | 'title' | 'url'
		>[];
	} = $props();
	function date(value: string) {
		const parsed = new Date(value);
		return Number.isFinite(parsed.getTime())
			? parsed.toLocaleDateString('en-GB', {
					day: 'numeric',
					month: 'short',
					year: 'numeric',
					timeZone: 'Indian/Maldives'
				})
			: value;
	}
</script>

<details class="evidence" data-testid="policy-evidence">
	<summary><Database size={16} aria-hidden="true" /> What supports these results?</summary>
	<div class="evidence-body">
		<p>
			Official island population totals anchor the map. Neighborhood populations and journey results
			are estimates. Missing transport information stays unknown.
		</p>
		<dl>
			<div>
				<dt>Transport snapshot</dt>
				<dd>{date(baseline.referenceDate)}</dd>
			</div>
			<div>
				<dt>Prepared</dt>
				<dd>{date(baseline.generatedAt)}</dd>
			</div>
			<div>
				<dt>Population</dt>
				<dd>Official projections, distributed across the map</dd>
			</div>
		</dl>
		<details>
			<summary>Sources and dates</summary>
			<ul>
				{#each baseline.sources as source (source.id)}{@const audit = sourceEvidence(source)}
					<li data-testid="policy-source-row">
						<a href={source.url} target="_blank" rel="noreferrer"
							>{source.title ?? source.id}<ExternalLink size={12} aria-hidden="true" /></a
						>
						<p>Source period: {audit.reference}. Status: {audit.status}.</p>
						<p>
							Collected: {audit.collected ? date(audit.collected) : 'Not supplied'} · Validated: {audit.validated
								? date(audit.validated)
								: 'Not supplied'}
						</p>
						{#if audit.qualification}<p>{audit.qualification}</p>{/if}
						{#if audit.license}<p>Reuse: {audit.license}</p>{/if}
					</li>{/each}
			</ul>
		</details>
		{#if supportingSources.length}<details>
				<summary>Additional public context</summary>
				<p>
					These sources provide context. They do not directly determine neighborhood journey times.
				</p>
				<ul>
					{#each supportingSources as source, index (`${source.id}:${index}`)}{@const audit =
							sourceEvidence(source)}
						<li>
							<a href={source.url} target="_blank" rel="noreferrer"
								>{source.title ?? source.id}<ExternalLink size={12} aria-hidden="true" /></a
							>
							<p>
								Source period: {audit.reference}. Status: {audit.status}. Collected: {audit.collected
									? date(audit.collected)
									: 'Not supplied'}.
							</p>
							{#if audit.license}<p>Reuse: {audit.license}</p>{/if}
						</li>{/each}
				</ul>
			</details>{/if}
		{#if operations?.gaps.length}<details>
				<summary>What information is missing?</summary>
				<ul>
					{#each operations.gaps as gap (gap)}<li>{gap}</li>{/each}
				</ul>
			</details>{/if}
		<details>
			<summary>Reproduce this snapshot</summary>
			<p class="version">Dataset: {baseline.version}</p>
			<p class="version">Operations: {operations?.version ?? 'Unavailable'}</p>
			<p>
				Downloaded results include their inputs and versions so another analyst can repeat the
				comparison.
			</p>
		</details>
	</div>
</details>

<style>
	.evidence {
		border: 1px solid #dfe9e5;
		border-radius: var(--surface-radius, 28px);
		background: #fff;
		box-shadow: var(--surface-shadow, 0 4px 16px #102e3412, 0 1px 3px #102e340a);
		margin-top: 18px;
		padding: 18px 22px;
		color: #254d48;
		font-size: 13px;
	}
	summary {
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		line-height: 1.5;
		list-style: none;
		min-height: 32px;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary::after {
		content: '+';
		margin-left: auto;
		font-weight: 400;
		font-size: 18px;
	}
	details[open] > summary::after {
		content: '−';
	}
	.evidence-body {
		padding-top: 10px;
	}
	p {
		line-height: 1.6;
		margin: 0 0 12px;
		color: #4e6964;
	}
	dl {
		margin: 12px 0;
	}
	dl > div {
		display: grid;
		grid-template-columns: 105px minmax(0, 1fr);
		gap: 10px;
		margin: 8px 0;
	}
	dt {
		color: #5c726e;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	details details {
		padding: 10px 0;
		border-top: 1px solid #e6eeeb;
	}
	ul {
		padding-left: 17px;
		margin: 12px 0 0;
	}
	li {
		margin-bottom: 10px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	a {
		color: #08776e;
		display: inline-flex;
		align-items: baseline;
		gap: 5px;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.version {
		overflow-wrap: anywhere;
		font-size: 12px;
	}
	summary:focus-visible,
	a:focus-visible {
		outline: 2px solid #0e8378;
		outline-offset: 4px;
		border-radius: var(--surface-radius-field, 14px);
	}
	@media (max-width: 600px) {
		.evidence {
			border-radius: var(--surface-radius-mobile, 24px);
			padding: 16px;
		}
	}
</style>
