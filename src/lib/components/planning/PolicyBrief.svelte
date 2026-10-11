<script lang="ts">
	import type { PolicyBriefPdfPayload } from '#lib/planning/policyBriefPdf.ts';
	export interface BriefMetric {
		label: string;
		before?: number | string | null;
		after?: number | string | null;
		unit?: string;
		detail?: string;
		afterTone?: 'neutral' | 'favorable' | 'unfavorable';
	}
	export interface BriefEvidence {
		name: string;
		status?: string;
		date?: string;
		detail?: string;
		url?: string;
	}
	let {
		title = 'A better-connected island',
		location = 'Greater Malé',
		baselineLabel = 'Current network',
		scenarioLabel = 'Your proposal',
		summary,
		metrics,
		interventions = [],
		evidence = [],
		assumptions = [],
		mapImage,
		mapCaption = 'The proposal on the transport network',
		carbonRange,
		generatedAt,
		delivery,
		islandImpacts = [],
		version = 'Version unavailable',
		provenance,
		onclose
	}: {
		title?: string;
		location?: string;
		baselineLabel?: string;
		scenarioLabel?: string;
		summary?: string;
		metrics: readonly BriefMetric[];
		interventions?: readonly string[];
		evidence?: readonly BriefEvidence[];
		assumptions?: readonly string[];
		mapImage?: string;
		mapCaption?: string;
		carbonRange?: { low?: number | null; high?: number | null; unit?: string; assumption?: string };
		generatedAt?: string;
		delivery?: PolicyBriefPdfPayload['delivery'];
		islandImpacts?: PolicyBriefPdfPayload['islandImpacts'];
		version?: string;
		provenance?: unknown;
		onclose?: () => void;
	} = $props();
	const briefId = $props.id();
	let evidenceExpanded = $state(false);
	let assumptionsExpanded = $state(false);
	let exporting = $state(false);
	let exportError = $state('');
	function snapshot(): PolicyBriefPdfPayload {
		return {
			title,
			location,
			summary,
			mapImage,
			metrics,
			interventions,
			evidence,
			assumptions,
			delivery,
			islandImpacts,
			carbonRange,
			version,
			date: generatedAt ?? new Date().toISOString().slice(0, 10),
			provenance
		};
	}
	async function exportPdf() {
		exporting = true;
		exportError = '';
		try {
			const { downloadPolicyBriefPdf } = await import('#lib/planning/policyBriefPdf.ts');
			await downloadPolicyBriefPdf(snapshot());
		} catch (error) {
			exportError = `PDF export unavailable: ${String(error)}`;
		} finally {
			exporting = false;
		}
	}
	async function exportEvidence() {
		const { serializePolicyBriefSnapshot } = await import('#lib/planning/policyBriefPdf.ts');
		const url = URL.createObjectURL(
			new Blob([serializePolicyBriefSnapshot(snapshot())], { type: 'application/json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'mobility-policy-evidence.json';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function value(input: number | string | null | undefined, unit = ''): string {
		if (
			input === null ||
			input === undefined ||
			input === '' ||
			(typeof input === 'number' && !Number.isFinite(input))
		)
			return 'Not estimated';
		const formatted =
			typeof input === 'number'
				? new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(input)
				: input;
		return `${formatted}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
	}
</script>

{#snippet evidenceNotes()}
	{#if evidence.length}<ul class="evidence">
			{#each evidence as source, index (index)}<li>
					<div>
						<strong
							>{#if source.url}<a href={source.url} target="_blank" rel="noreferrer"
									>{source.name}</a
								>{:else}{source.name}{/if}</strong
						>{#if source.status}<span class="status">{source.status}</span>{/if}
					</div>
					<p>
						{source.date?.trim() || 'Date not recorded'}{#if source.detail}
							· {source.detail}{/if}
					</p>
					{#if source.url}<span class="print-url">{source.url}</span>{/if}
				</li>{/each}
		</ul>
	{:else}<p class="missing">
			No source inventory supplied. Review the data before using this proposal for a decision.
		</p>{/if}
{/snippet}

{#snippet assumptionNotes()}
	{#if assumptions.length}<ul class="assumptions">
			{#each assumptions as assumption, index (index)}<li>{assumption}</li>{/each}
		</ul>
	{:else}<p class="missing">No additional assumptions supplied.</p>{/if}
{/snippet}

<section class="policy-brief" aria-label="Policy brief">
	<div class="brief-tools">
		<div class="tool-label">
			<strong>Policy brief</strong>
			<span>One-page PDF with the full evidence attached</span>
		</div>
		<div class="brief-actions">
			<button type="button" disabled={exporting} onclick={exportPdf}>
				<svg viewBox="0 0 18 18" aria-hidden="true"
					><path d="M5 6V2.5h8V6M5 13H2.5V6h13v7H13M5 10.5h8v5H5Z" /><path d="M12.5 8h.5" /></svg
				>
				{exporting ? 'Creating PDF…' : 'Download PDF'}
			</button>
			<button type="button" class="evidence-download" onclick={exportEvidence}>Evidence JSON</button
			>
			{#if onclose}<button
					type="button"
					class="close"
					onclick={onclose}
					aria-label="Close policy brief">×</button
				>{/if}
		</div>
	</div>
	{#if exportError}<p role="alert" class="export-error">{exportError}</p>{/if}
	<article>
		<header>
			<div class="masthead">
				<span>MOBILITY SANDBOX MV</span><span class="tag">POLICY BRIEF</span>
			</div>
			<div class="heading">
				<p class="location">{location}</p>
				<h1>{title}</h1>
			</div>
			{#if summary}<p class="summary">{summary}</p>{/if}
		</header>
		{#if mapImage}<figure class="map-snapshot">
				<img src={mapImage} alt={mapCaption} />
				<figcaption>{mapCaption}</figcaption>
			</figure>{/if}

		<section class="comparison" aria-label="Baseline and proposal comparison">
			<div class="table-labels">
				<span>What changes</span><span>{baselineLabel}</span><span>{scenarioLabel}</span>
			</div>
			{#each metrics as metric, index (index)}
				<div class="metric-row">
					<div>
						<strong>{metric.label}</strong>{#if metric.detail}<p>{metric.detail}</p>{/if}
					</div>
					<span class="metric-value baseline" data-label={baselineLabel}
						>{value(metric.before, metric.unit)}</span
					><span
						class="metric-value proposed"
						data-label={scenarioLabel}
						class:favorable={metric.afterTone === 'favorable'}
						class:unfavorable={metric.afterTone === 'unfavorable'}
						>{value(metric.after, metric.unit)}</span
					>
				</div>
			{/each}
			{#if !metrics.length}<p class="no-data">
					Results have not been calculated for this proposal.
				</p>{/if}
		</section>
		{#if carbonRange}<p class="carbon-range">
				<strong>Annual net emissions sensitivity:</strong>
				{value(carbonRange.low, carbonRange.unit ?? 't CO₂e/year')} to {value(
					carbonRange.high,
					carbonRange.unit ?? 't CO₂e/year'
				)}. Positive values add emissions; negative values reduce them.{#if carbonRange.assumption}
					&nbsp;{carbonRange.assumption}{/if}
			</p>{/if}

		<section class="proposal">
			<h2>The proposal</h2>
			{#if interventions.length}<ol>
					{#each interventions as intervention, index (index)}<li>{intervention}</li>{/each}
				</ol>
			{:else}<p>No changes to the network have been selected.</p>{/if}
		</section>
		{#if islandImpacts.length}<section class="island-impacts">
				<h2>Access by island</h2>
				<div class="impact-table">
					{#each islandImpacts as island (island.name)}<div>
							<strong>{island.name}</strong><span>+{value(Math.round(island.gained))} gain</span
							><span>{value(Math.round(island.lost))} lose</span><span
								>{value(Math.round(island.unknown))} unknown</span
							>
						</div>{/each}
				</div>
			</section>{/if}
		{#if delivery}<details class="delivery-notes">
				<summary>Delivery & outstanding verification</summary>
				<p><strong>Responsible agency:</strong> {delivery.agency || 'To be confirmed'}</p>
				<h2>Phases</h2>
				<ol>
					{#each delivery.phases as phase (phase)}<li>{phase}</li>{/each}
				</ol>
				<h2>Verify before investment</h2>
				<ul>
					{#each delivery.verification as item (item)}<li>{item}</li>{/each}
				</ul>
			</details>{/if}

		<div class="screen-notes">
			<section class="note-card">
				<h2 class="disclosure-heading">
					<button
						type="button"
						aria-expanded={evidenceExpanded}
						aria-controls={`${briefId}-evidence`}
						onclick={() => (evidenceExpanded = !evidenceExpanded)}
					>
						<span>Sources</span>
						<span class="note-count">{evidence.length}</span>
						<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
					</button>
				</h2>
				<div id={`${briefId}-evidence`} class="note-body" hidden={!evidenceExpanded}>
					{@render evidenceNotes()}
				</div>
			</section>
			<section class="note-card">
				<h2 class="disclosure-heading">
					<button
						type="button"
						aria-expanded={assumptionsExpanded}
						aria-controls={`${briefId}-assumptions`}
						onclick={() => (assumptionsExpanded = !assumptionsExpanded)}
					>
						<span>Assumptions</span>
						<span class="note-count">{assumptions.length}</span>
						<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
					</button>
				</h2>
				<div id={`${briefId}-assumptions`} class="note-body" hidden={!assumptionsExpanded}>
					{@render assumptionNotes()}
				</div>
			</section>
		</div>
		<div class="print-notes">
			<section>
				<h2>The evidence behind it</h2>
				{@render evidenceNotes()}
			</section>
			<section>
				<h2>Assumptions to keep in view</h2>
				{@render assumptionNotes()}
			</section>
		</div>
		<footer>
			<p>
				Estimates describe this scenario. Missing inputs remain unestimated; a blank result does not
				mean no impact.
			</p>
			{#if generatedAt}<span>{generatedAt}</span>{/if}
		</footer>
	</article>
</section>

<style>
	.export-error {
		margin: 0;
		padding: 12px 20px;
		color: #985724;
		background: #fff3e3;
		font-size: 13px;
	}
	.island-impacts {
		margin-bottom: 18px;
	}
	.impact-table {
		display: grid;
		gap: 6px;
	}
	.impact-table > div {
		display: grid;
		grid-template-columns: 1.2fr repeat(3, 1fr);
		gap: 8px;
		font-size: 12px;
		padding: 9px 10px;
		border-radius: 6px;
		background: #f1f5ed;
	}
	.impact-table span {
		color: #5e7356;
	}
	.delivery-notes {
		padding: 14px;
		border: 1px solid #dfe8d8;
		border-radius: 10px;
		margin: 0 0 14px;
		color: #526a49;
		font-size: 12px;
		line-height: 1.6;
	}
	.delivery-notes summary {
		font-size: 13px;
		font-weight: 650;
		cursor: pointer;
	}
	.delivery-notes h2 {
		margin-top: 14px;
		margin-bottom: 6px;
	}
	.delivery-notes ol,
	.delivery-notes ul {
		padding-left: 18px;
	}
	.policy-brief {
		width: min(100%, 800px);
		min-width: 0;
		margin: 0 auto;
		overflow: clip;
		border: 1px solid #d9e4db;
		border-radius: 16px;
		background: #fffefa;
		color: #263e33;
		text-align: left;
		user-select: text;
		box-shadow: 0 20px 60px rgb(26 58 44 / 15%);
	}
	.policy-brief,
	.policy-brief * {
		box-sizing: border-box;
	}
	.brief-tools {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 20px;
		border-bottom: 1px solid #dfe8dd;
		background: #f4f7ef;
		color: #62755d;
		font-size: 12px;
	}
	.brief-tools > div {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 8px;
	}
	.brief-actions {
		flex: 0 0 auto;
	}
	.brief-tools .tool-label {
		min-width: 0;
		align-items: start;
		flex-direction: column;
		gap: 2px;
	}
	.tool-label strong {
		color: #36563f;
		font-weight: 600;
	}
	.tool-label span {
		font-size: 10px;
		line-height: 1.4;
	}
	.brief-tools button {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-height: 44px;
		padding: 7px 11px;
		border: 1px solid #cbded0;
		border-radius: 8px;
		background: #fff;
		color: #326448;
		font: inherit;
		white-space: nowrap;
		cursor: pointer;
	}
	.brief-tools svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.brief-tools .close {
		width: 44px;
		height: 44px;
		justify-content: center;
		padding: 0;
		font-size: 22px;
	}
	.brief-tools button:focus-visible,
	.evidence a:focus-visible {
		outline: 3px solid #8cbda1;
		outline-offset: 2px;
	}
	article {
		padding: 24px 28px 20px;
	}
	.masthead {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 7px;
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.08em;
	}
	.tag {
		margin-left: auto;
		padding: 4px 7px;
		border: 1px solid #cdddc9;
		border-radius: 4px;
		color: #697962;
		font-size: 9px;
		font-weight: 500;
	}
	.heading {
		margin: 16px 0 12px;
	}
	.location {
		margin: 0 0 6px;
		color: #71916f;
		font-size: 12px;
		font-weight: 550;
	}
	h1 {
		margin: 0;
		color: #284935;
		font-size: 28px;
		font-weight: 600;
		letter-spacing: -0.04em;
		line-height: 1.14;
		overflow-wrap: anywhere;
	}
	.summary {
		margin: 0 0 18px;
		color: #53694f;
		font-size: 14px;
		line-height: 1.55;
	}
	.map-snapshot {
		margin: 0 0 16px;
	}
	.map-snapshot img {
		display: block;
		width: 100%;
		height: 200px;
		object-fit: contain;
		background: #dceef0;
		border: 1px solid #dae4d5;
		border-radius: 10px;
	}
	.map-snapshot figcaption {
		margin-top: 5px;
		color: #7b8e72;
		font-size: 10px;
		line-height: 1.4;
	}
	.carbon-range {
		padding: 10px 12px;
		margin: -6px 0 18px;
		border-radius: 8px;
		background: #f1f6e9;
		color: #5e7950;
		font-size: 12px;
		line-height: 1.6;
	}
	.carbon-range strong {
		font-weight: 600;
	}
	.comparison {
		margin: 0 0 18px;
		overflow: hidden;
		border: 1px solid #dce7d8;
		border-radius: 11px;
	}
	.table-labels,
	.metric-row {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
		align-items: start;
		gap: 14px;
		padding: 12px 16px;
	}
	.table-labels {
		background: #eff5e9;
		color: #63805c;
		font-size: 11px;
		line-height: 1.4;
		font-weight: 600;
	}
	.metric-row {
		border-top: 1px solid #e5ecdf;
		font-size: 13px;
		line-height: 1.5;
	}
	.metric-row strong {
		font-size: 12px;
		font-weight: 550;
	}
	.metric-row p {
		margin: 3px 0 0;
		color: #7a8672;
		font-size: 11px;
		line-height: 1.4;
	}
	.metric-row > span {
		font-variant-numeric: tabular-nums;
	}
	.metric-row > * {
		min-width: 0;
	}
	.metric-value::before {
		display: none;
	}
	.table-labels > span,
	.metric-row {
		overflow-wrap: anywhere;
	}
	.proposed {
		font-weight: 650;
	}
	.proposed.favorable {
		color: #257951;
	}
	.proposed.unfavorable {
		color: #986020;
	}
	h2 {
		margin: 0 0 10px;
		font-size: 13px;
		font-weight: 650;
		line-height: 1.5;
	}
	.proposal {
		margin-bottom: 20px;
	}
	.proposal ol {
		padding-left: 20px;
		margin: 0;
		color: #5b7052;
		font-size: 13px;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.proposal p,
	.no-data {
		color: #73846a;
		font-size: 12px;
		line-height: 1.6;
	}
	.no-data {
		margin: 12px 16px;
	}
	.screen-notes {
		display: grid;
		gap: 8px;
	}
	.note-card {
		min-width: 0;
		border: 1px solid #dfe8d8;
		border-radius: 10px;
		background: #fbfcf8;
	}
	.disclosure-heading {
		margin: 0;
	}
	.disclosure-heading button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 46px;
		padding: 11px 14px;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: #36563f;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.disclosure-heading button:focus-visible {
		outline: 3px solid #8cbda1;
		outline-offset: -3px;
	}
	.note-count {
		padding: 2px 7px;
		border-radius: 5px;
		background: #edf2e7;
		color: #62755d;
		font-size: 10px;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.disclosure-heading svg {
		width: 16px;
		height: 16px;
		margin-left: auto;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.disclosure-heading button[aria-expanded='true'] svg {
		transform: rotate(180deg);
	}
	.note-body {
		padding: 0 14px 14px;
	}
	.print-notes {
		display: none;
	}
	.evidence {
		display: grid;
		gap: 12px;
		padding: 0;
		margin: 0;
		list-style: none;
		overflow-wrap: anywhere;
	}
	.evidence li > div {
		display: flex;
		align-items: center;
		gap: 5px;
		flex-wrap: wrap;
	}
	.evidence strong {
		font-size: 12px;
		line-height: 1.5;
		font-weight: 600;
	}
	.evidence a {
		color: #377052;
		text-decoration: underline;
		text-decoration-color: #b6cbb8;
		text-underline-offset: 2px;
	}
	.print-url {
		display: none;
	}
	.status {
		border-radius: 4px;
		padding: 1px 5px;
		background: #f0f2e7;
		color: #7e8061;
		font-size: 10px;
		line-height: 1.5;
	}
	.evidence p {
		margin: 3px 0 0;
		color: #687b60;
		font-size: 12px;
		line-height: 1.5;
	}
	.assumptions {
		padding-left: 17px;
		margin: 0;
		color: #697e5c;
		font-size: 12px;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.assumptions li + li {
		margin-top: 6px;
	}
	.missing {
		margin: 0;
		color: #819077;
		font-size: 12px;
		line-height: 1.6;
	}
	footer {
		display: flex;
		justify-content: space-between;
		align-items: start;
		gap: 15px;
		flex-wrap: wrap;
		margin-top: 18px;
		padding-top: 12px;
		border-top: 1px solid #dfe8d8;
		color: #8b987e;
		font-size: 11px;
		line-height: 1.5;
	}
	footer p {
		max-width: 440px;
		margin: 0;
	}
	footer span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	@media (hover: hover) and (pointer: fine) {
		.brief-tools button:hover,
		.disclosure-heading button:hover {
			background: #edf3e8;
		}
	}
	@media screen and (max-width: 520px) {
		.brief-tools .tool-label {
			display: none;
		}
		.brief-actions {
			width: 100%;
			justify-content: space-between;
			gap: 6px;
		}
		.brief-tools button {
			padding: 7px 9px;
			font-size: 11px;
		}
		.impact-table > div {
			grid-template-columns: 1fr 1fr;
		}
		article {
			padding: 18px 14px;
		}
		.brief-tools {
			padding: 10px 14px;
		}
		.tool-label span {
			display: none;
		}
		h1 {
			font-size: 25px;
		}
		.table-labels {
			display: none;
		}
		.metric-row {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 10px 12px;
			padding: 12px;
			font-size: 14px;
		}
		.table-labels + .metric-row {
			border-top: 0;
		}
		.metric-row > div {
			grid-column: 1 / -1;
		}
		.metric-row strong {
			font-size: 13px;
		}
		.metric-value::before {
			display: block;
			margin-bottom: 4px;
			color: #73866a;
			font-size: 11px;
			font-weight: 500;
			line-height: 1.4;
			content: attr(data-label);
		}
		.map-snapshot img {
			height: auto;
			min-height: 130px;
			max-height: 220px;
		}
		footer {
			gap: 8px;
		}
	}
	@media screen and (max-width: 375px) {
		.brief-tools {
			flex-wrap: wrap;
			gap: 7px;
		}
		.brief-tools .tool-label {
			flex: 1 1 100%;
		}
		.brief-actions {
			width: 100%;
			justify-content: space-between;
		}
		.masthead {
			font-size: 9px;
			letter-spacing: 0.06em;
		}
	}
	@media screen and (max-height: 520px) {
		.brief-tools {
			padding-block: 6px;
		}
		.tool-label span {
			display: none;
		}
	}
	@media print {
		:global(body) {
			margin: 0;
			height: auto;
			overflow: visible;
			background: #fff;
		}
		:global(body *) {
			visibility: hidden;
		}
		.policy-brief,
		.policy-brief * {
			visibility: visible;
		}
		.policy-brief {
			position: static;
			width: 100%;
			max-width: none;
			height: auto;
			overflow: visible;
			margin: 0;
			border: 0;
			border-radius: 0;
			box-shadow: none;
			print-color-adjust: exact;
			-webkit-print-color-adjust: exact;
		}
		.brief-tools {
			display: none;
		}
		.screen-notes {
			display: none;
		}
		.print-notes {
			display: block;
			padding-top: 16px;
			border-top: 1px solid #dfe8d8;
		}
		.print-notes > section + section {
			margin-top: 18px;
		}
		article {
			padding: 4mm 5mm;
		}
		.proposal,
		.map-snapshot,
		.metric-row,
		.evidence li,
		.assumptions li {
			break-inside: avoid;
		}
		.comparison {
			overflow: visible;
		}
		h2,
		.table-labels {
			break-after: avoid;
		}
		h1 {
			font-size: 24px;
		}
		.heading {
			margin: 13px 0;
		}
		.summary {
			margin-bottom: 15px;
			font-size: 11px;
		}
		.comparison,
		.proposal {
			margin-bottom: 16px;
		}
		.table-labels,
		.metric-row {
			padding: 9px 12px;
		}
		.carbon-range {
			font-size: 10px;
		}
		.evidence {
			gap: 9px;
		}
		.evidence strong,
		.assumptions {
			font-size: 10px;
		}
		.evidence p {
			font-size: 9px;
		}
		.map-snapshot img {
			height: 130px;
		}
		.map-snapshot {
			margin-bottom: 13px;
		}
		.print-url {
			display: block;
			margin-top: 2px;
			color: #7d8d74;
			font-size: 7px;
			line-height: 1.4;
			overflow-wrap: anywhere;
		}
		footer {
			margin-top: 17px;
		}
	}
	@page {
		size: A4;
		margin: 12mm;
	}
</style>
