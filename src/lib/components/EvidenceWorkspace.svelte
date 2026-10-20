<script lang="ts">
	import { backendUrl } from '#lib/app-paths.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import {
		ArrowUpRight,
		Download,
		FileCheck2,
		Globe2,
		Hospital,
		Users,
		BusFront,
		ShieldCheck,
		Layers,
		Route,
		FlaskConical,
		Radio,
		ExternalLink,
		Database,
		Info,
		Check,
		CircleDashed
	} from '@lucide/svelte';
	import type { NationalSummary } from '../types';
	import SourceUpdatesWorkspace from './SourceUpdatesWorkspace.svelte';
	import LoadingSkeleton from './LoadingSkeleton.svelte';

	let {
		summary,
		onExplore,
		onExport,
		canExport,
		active = true
	}: {
		summary: NationalSummary | null;
		onExplore: () => void;
		onExport: () => void;
		canExport: boolean;
		active?: boolean;
	} = $props();

	const count = (value: number | undefined) => (value === undefined ? '—' : value.toLocaleString());
	const humanize = (value: string) => value.replaceAll('_', ' ');
	const matchingLabels: Record<string, string> = {
		exact_normalized_name: 'Exact normalized name',
		exact_source_identifier: 'Exact source identifier',
		reviewed_osm_match: 'Reviewed OSM match',
		osm_best_effort: 'Best-effort OSM match',
		osm_match_review_required: 'OSM match · review required',
		osm_provisional_review_required: 'Provisional · review required',
		island_context_only: 'Island context only',
		source_not_in_osm: 'Source absent from OSM'
	};
	const matching = $derived(
		Object.entries(summary?.facility_match_status ?? {}).sort((a, b) => b[1] - a[1])
	);
	const categories = $derived(
		Object.entries(summary?.facility_categories ?? {}).sort((a, b) => b[1] - a[1])
	);
	const linkedPopulationPercent = $derived(
		summary?.population_record_count
			? (summary.population_attached_count / summary.population_record_count) * 100
			: 0
	);
	const available = [
		{
			icon: Globe2,
			title: 'National island atlas',
			detail: 'Find islands, public facilities and population totals across the Maldives.'
		},
		{
			icon: ShieldCheck,
			title: 'Island accessibility scores',
			detail: 'Compare access to essential services, with the scoring method shown.'
		},
		{
			icon: Route,
			title: 'Shortest-distance routes',
			detail: 'Explore road and sea connections between destinations.'
		},
		{
			icon: FlaskConical,
			title: 'Compare proposals',
			detail: 'Test transport and facility changes, compare results, and prioritise investments.'
		},
		{
			icon: Radio,
			title: 'Live vehicle positions',
			detail: 'See current vehicle positions where a live feed is available.'
		},
		{
			icon: Users,
			title: 'Passenger outlooks and backtests',
			detail:
				'Compare forecasting methods, review past accuracy, and save forecasts for later evaluation.'
		},
		{
			icon: BusFront,
			title: 'Scheduled journeys and service design',
			detail:
				'Departure-time journeys, transfers, timed returns, timetable changes and fleet requirements.'
		},
		{
			icon: Hospital,
			title: 'Resident access and investment',
			detail:
				'Compare residents’ travel times, test hospitals and schools, and review costs, budgets and emissions.'
		},
		{
			icon: Database,
			title: 'Dataset and notice workspaces',
			detail: 'Compare datasets, create charts, export findings, and review public notices.'
		},
		{
			icon: Globe2,
			title: 'Places, weather and traffic',
			detail:
				'Find places, photos, reviews, directions and Street View; check weather and sea forecasts.'
		}
	];
	const missing = [
		{
			title: 'Passenger data freshness and uncertainty',
			detail:
				'Published histories remain sparse and dated. Forecast ranges show measured holdout coverage, not a guaranteed confidence level.'
		},
		{
			title: 'Nationwide scheduled coverage',
			detail:
				'Walking times use roads, facilities and stops. Scheduled journeys require departure times, journey durations and valid timetables; availability varies by island.'
		},
		{
			title: 'Verified ferry arrivals and service exceptions',
			detail:
				'Frequency calendars do not supply crossing times or actual operation. Added runtimes remain explicit scenario assumptions.'
		},
		{
			title: 'Resident distribution and equity',
			detail:
				'Population-weighted origins use source-specific methods, including approximate building or uniform allocations. Audited small-area demographic cohorts and individual travel behaviour remain unavailable.'
		},
		{
			title: 'Procurement-grade costs and emissions',
			detail:
				'Costs and energy factors are editable planning assumptions with sensitivity ranges. Actual tenders, occupancies and grid factors require validation.'
		},
		{
			title: 'Live provider coverage',
			detail:
				'Model weather is separate from official warnings. Consumer place adapters can return partial data; cycling and Street View coverage are provider dependent.'
		},
		{
			title: 'Reviewed operational notices',
			detail:
				'Notice extraction requires human mapping and validity review before it changes a proposal.'
		}
	];
	const sources = [
		{
			name: 'OneMap Maldives',
			category: 'Geography',
			href: 'https://services7.arcgis.com/yvCbn3q8PPtPLZIM/arcgis/rest/services/island_20240509/FeatureServer/0',
			detail:
				'Island boundaries and identifiers. Geography does not establish an operating transport service.'
		},
		{
			name: 'Ministry of Health · HEMS',
			category: 'Healthcare',
			href: 'https://hems.health.gov.mv/establishments',
			detail:
				'Official establishment records. A name match does not confirm an audited entrance, hours or capacity.'
		},
		{
			name: 'Ministry of Education',
			category: 'Schools',
			href: 'https://www.moe.gov.mv/en/schools',
			detail:
				'School directory records. Locations and matching quality remain attached to each facility.'
		},
		{
			name: 'Civil Aviation Authority',
			category: 'Airports',
			href: 'https://caa.gov.mv/operations/air-operations/status-of-certification-of-aerodromes',
			detail:
				'Aerodrome records and official identifiers. These do not provide passenger forecasts or arrival times.'
		},
		{
			name: 'Maldives Bureau of Statistics',
			category: 'Population',
			href: 'https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/07/P3.xlsx',
			detail:
				'Census 2022 population context. Repeated totals and missing island links require care when aggregating.'
		},
		{
			name: 'OpenStreetMap',
			category: 'Transport',
			href: 'https://www.openstreetmap.org/copyright',
			detail:
				'Roads, routes, stops and terminals. Passenger journey times also require a valid timetable.'
		}
	];
</script>

<div class="evidence-page">
	<div class="page-heading">
		<div>
			<span class="eyebrow">DATA AND METHODOLOGY</span>
			<h1>Data and sources</h1>
			<p>See the datasets, sources and methods behind each planning result.</p>
		</div>
		<Button variant="outline" onclick={onExplore}
			>Back to planning map <ArrowUpRight size={16} /></Button
		>
	</div>
	<div class="evidence-grid">
		<Card.Root class="evidence-card coverage-card">
			<div class="card-heading">
				<div class="heading-icon green"><Database size={19} /></div>
				<div>
					<span class="card-eyebrow">SOURCE COVERAGE</span>
					<h3>The national inventory</h3>
				</div>
				<Badge variant="secondary" class="evidence-badge"
					>{summary ? 'Current inventory' : 'Loading'}</Badge
				>
			</div>
			{#if !summary}<div class="inventory-skeleton">
					<LoadingSkeleton variant="metrics" label="Loading the national inventory…" />
				</div>{:else}<div class="inventory-grid">
					<div>
						<Globe2 size={16} /><strong>{count(summary?.island_count)}</strong><span>Islands</span>
					</div>
					<div>
						<Hospital size={16} /><strong>{count(summary?.facility_count)}</strong><span
							>Official facilities</span
						>
					</div>
					<div>
						<Users size={16} /><strong>{count(summary?.population_record_count)}</strong><span
							>Population records</span
						>
					</div>
					<div>
						<BusFront size={16} /><strong
							>{count(summary?.transport?.feature_count ?? summary?.osm.feature_count)}</strong
						><span>Transport records</span>
					</div>
				</div>{/if}
			<div class="population-linking">
				<div>
					<span>Population records linked to an island</span><strong
						>{summary ? `${linkedPopulationPercent.toFixed(1)}%` : '—'}</strong
					>
				</div>
				<div class="coverage-track" aria-hidden="true">
					<span style:width={`${linkedPopulationPercent}%`}></span>
				</div>
				<p>
					{count(summary?.population_attached_count)} of {count(summary?.population_record_count)} records
					have an island link. This counts records, not unique islands or residents.
				</p>
			</div>
			{#if categories.length}<div class="category-tags">
					{#each categories as [category, amount] (category)}<Badge
							variant="outline"
							class="category-badge">{humanize(category)} <span>{count(amount)}</span></Badge
						>{/each}
				</div>{/if}
			<div class="evidence-note">
				<Info size={13} /><span
					>Missing population or facility coordinates mean incomplete evidence. They do not
					establish zero residents or zero service.</span
				>
			</div>
		</Card.Root>
		<Card.Root class="evidence-card matching-card">
			<div class="card-heading">
				<div class="heading-icon lavender"><ShieldCheck size={19} /></div>
				<div>
					<span class="card-eyebrow">LOCATION CONFIDENCE</span>
					<h3>Official facility matching</h3>
				</div>
			</div>
			<p class="card-intro">See how each official facility is linked to its location.</p>
			{#if matching.length}<div class="matching-list">
					{#each matching as [status, amount] (status)}<div
							class="matching-row"
							class:needs-review={status.includes('review_required')}
						>
							<div>
								<span>{matchingLabels[status] ?? humanize(status)}</span><strong
									>{count(amount)}</strong
								>
							</div>
							<div class="match-track" aria-hidden="true">
								<span
									style:width={`${summary?.facility_count ? (amount / summary.facility_count) * 100 : 0}%`}
								></span>
							</div>
						</div>{/each}
				</div>{:else if !summary}<div class="matching-skeleton">
					<LoadingSkeleton rows={4} label="Loading facility matching…" />
				</div>{/if}
			<div class="evidence-note">
				<Info size={13} /><span
					>An identity match does not prove an exact entrance, audited service suitability, capacity
					or opening hours. Unlocated records stay out of the default map.</span
				>
			</div>
		</Card.Root>
		<Card.Root class="evidence-card capability-card">
			<div class="card-heading">
				<div class="heading-icon green"><Check size={19} /></div>
				<div>
					<span class="card-eyebrow">AVAILABLE TODAY</span>
					<h3>What you can do</h3>
				</div>
				<Badge variant="secondary" class="evidence-badge">Available</Badge>
			</div>
			<div class="capability-list">
				{#each available as capability (capability.title)}<div>
						<span class="capability-icon"><capability.icon size={16} /></span>
						<div>
							<strong>{capability.title}</strong>
							<p>{capability.detail}</p>
						</div>
					</div>{/each}
			</div>
			<div class="evidence-note">
				<Layers size={13} /><span
					>Each workspace keeps source receipts, coverage and assumptions attached to its results.
					Resident access results identify each island’s distribution method, road coverage and
					timetable availability.</span
				>
			</div>
		</Card.Root>
		<Card.Root class="evidence-card missing-card">
			<div class="card-heading">
				<div class="heading-icon lavender"><CircleDashed size={19} /></div>
				<div>
					<span class="card-eyebrow">DATA AND OPERATIONAL LIMITS</span>
					<h3>Data limitations</h3>
				</div>
			</div>
			<p class="card-intro">
				These inputs affect the detail and reliability of planning estimates.
			</p>
			<div class="missing-list">
				{#each missing as feature (feature.title)}<div>
						<CircleDashed size={13} />
						<div>
							<strong>{feature.title}</strong>
							<p>{feature.detail}</p>
						</div>
					</div>{/each}
			</div>
			<div class="scope-note">
				Resident, service and economic results are modeled comparisons under the displayed
				assumptions. Check scenario scope, source dates and missing inputs before using them for a
				policy decision.
			</div>
		</Card.Root>
	</div>
	<Card.Root class="evidence-provenance">
		<div class="provenance-heading">
			<div>
				<span class="card-eyebrow">TRACE THE FOUNDATION</span>
				<h3>Dataset sources</h3>
				<p>
					The atlas uses versioned datasets from these sources. Live feeds are identified
					separately.
				</p>
			</div>
			<Button
				variant="outline"
				size="sm"
				href={backendUrl('national/summary')}
				target="_blank"
				rel="noopener noreferrer">View inventory summary <ExternalLink size={14} /></Button
			>
		</div>
		<div class="provenance-grid">
			{#each sources as source (source.name)}<article>
					<Badge variant="outline" class="source-badge">{source.category}</Badge><a
						href={source.href}
						target="_blank"
						rel="noopener noreferrer">{source.name}<ExternalLink size={13} /></a
					>
					<p>{source.detail}</p>
				</article>{/each}
		</div>
	</Card.Root>
	<SourceUpdatesWorkspace {active} />
	<Card.Root class="evidence-next"
		><FileCheck2 size={24} />
		<div>
			<h3>Keep the decision and its evidence together.</h3>
			<p>
				{canExport
					? 'Export the proposal, results, comparison and methodology.'
					: 'Run a proposal in the planning workspace to create a decision brief.'}
			</p>
		</div>
		<Button disabled={!canExport} onclick={onExport}
			>Export decision brief <Download size={16} /></Button
		></Card.Root
	>
</div>

<style>
	.card-heading {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 20px;
	}
	.card-heading > div:nth-child(2) {
		flex: 1;
		min-width: 0;
	}
	.card-heading h3 {
		font-size: 16px;
		margin: 5px 0 0;
		font-weight: 560;
		letter-spacing: -0.3px;
	}
	.card-eyebrow {
		display: block;
		color: var(--theme-color-9793a6);
		font-size: 9px;
		font-weight: 550;
		letter-spacing: 1.2px;
	}
	.heading-icon {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 12px;
		flex-shrink: 0;
	}
	.heading-icon.green {
		color: var(--theme-color-709267);
		background: var(--theme-color-eef3e9);
	}
	.heading-icon.lavender {
		color: var(--theme-color-8d7aa3);
		background: var(--theme-color-f1edf8);
	}
	.evidence-page :global(.evidence-badge) {
		font-size: 9px;
		color: var(--theme-color-8f8a9c);
		background: var(--theme-color-f3f1f7);
		padding: 4px 8px;
		height: auto;
	}
	.inventory-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0;
		border: 1px solid var(--theme-color-eae8f0);
		border-radius: 13px;
		overflow: hidden;
	}
	.inventory-grid > div {
		padding: 19px 20px;
		position: relative;
	}
	.inventory-grid > div:nth-child(odd) {
		border-right: 1px solid var(--theme-color-eeecf3);
	}
	.inventory-grid > div:nth-child(-n + 2) {
		border-bottom: 1px solid var(--theme-color-eeecf3);
	}
	.inventory-grid :global(svg) {
		position: absolute;
		right: 17px;
		top: 19px;
		color: var(--theme-color-b7afc7);
	}
	.inventory-grid strong {
		display: block;
		color: var(--theme-color-3f3b4c);
		font-size: 28px;
		line-height: 1.2;
		font-weight: 530;
		letter-spacing: -1px;
		font-variant-numeric: tabular-nums;
	}
	.inventory-grid span {
		display: block;
		margin-top: 7px;
		color: var(--theme-color-9691a3);
		font-size: 10px;
	}
	.population-linking {
		margin-top: 23px;
	}
	.population-linking > div:first-child {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		color: var(--theme-color-878294);
		font-size: 11px;
	}
	.population-linking strong {
		color: var(--theme-color-80966f);
		font-weight: 550;
		font-variant-numeric: tabular-nums;
	}
	.coverage-track {
		height: 5px;
		border-radius: 9px;
		background: var(--theme-color-eff1ea);
		margin: 10px 0;
		overflow: hidden;
	}
	.coverage-track span {
		display: block;
		height: 100%;
		background: var(--theme-color-acc799);
		border-radius: inherit;
	}
	.population-linking p {
		color: var(--theme-color-a09aa9);
		font-size: 10px;
		line-height: 1.7;
	}
	.category-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 17px;
	}
	.evidence-page :global(.category-badge) {
		color: var(--theme-color-928ba0);
		font-size: 9px;
		height: auto;
		padding: 4px 7px;
		text-transform: capitalize;
		gap: 7px;
		background: var(--theme-color-fcfbfd);
		border-color: var(--theme-color-ece8f1);
	}
	.category-tags span {
		color: var(--theme-color-64616e);
		font-variant-numeric: tabular-nums;
	}
	.card-intro {
		font-size: 11px;
		line-height: 1.7;
		color: var(--theme-color-9691a3);
		margin: -4px 0 20px;
	}
	.matching-list {
		display: grid;
		gap: 14px;
	}
	.matching-row > div:first-child {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 15px;
		font-size: 11px;
		color: var(--theme-color-817c8b);
	}
	.matching-row strong {
		color: var(--theme-color-6e697b);
		font-size: 11px;
		font-weight: 550;
		font-variant-numeric: tabular-nums;
	}
	.match-track {
		margin-top: 7px;
		height: 4px;
		background: var(--theme-color-f3f1f7);
		border-radius: 10px;
		overflow: hidden;
	}
	.match-track span {
		display: block;
		height: 100%;
		background: var(--theme-color-b4c9a4);
		border-radius: inherit;
	}
	.needs-review .match-track span {
		background: var(--theme-color-bca9d4);
	}
	.evidence-note {
		margin-top: 21px;
		padding-top: 16px;
		border-top: 1px solid var(--theme-color-efedf3);
		display: flex;
		align-items: flex-start;
		gap: 8px;
		color: var(--theme-color-a39cac);
		font-size: 10px;
		line-height: 1.7;
	}
	.evidence-note :global(svg) {
		flex-shrink: 0;
		color: var(--theme-color-ada3bc);
		margin-top: 2px;
	}
	.inventory-skeleton {
		padding-block: 24px;
	}
	.matching-skeleton {
		padding-top: 14px;
	}
	.capability-list,
	.missing-list {
		display: grid;
		gap: 19px;
	}
	.capability-list > div,
	.missing-list > div {
		display: flex;
		align-items: flex-start;
		gap: 11px;
	}
	.capability-icon {
		color: var(--theme-color-91a881);
		margin-top: 2px;
		flex-shrink: 0;
	}
	.capability-list strong,
	.missing-list strong {
		display: block;
		font-size: 12px;
		font-weight: 550;
		color: var(--theme-color-64606f);
	}
	.capability-list p,
	.missing-list p {
		margin: 4px 0 0;
		color: var(--theme-color-a09aaa);
		font-size: 11px;
		line-height: 1.7;
	}
	.evidence-page :global(.missing-card) {
		background: var(--theme-color-f7f4fc);
		border-color: var(--theme-color-eae3f3);
	}
	.missing-list {
		gap: 15px;
	}
	.missing-list :global(svg) {
		color: var(--theme-color-b1a0c4);
		margin-top: 3px;
		flex-shrink: 0;
	}
	.scope-note {
		margin-top: 20px;
		padding: 13px 15px;
		border: 1px solid var(--theme-color-e9e1f2);
		border-radius: 10px;
		background: var(--theme-color-f0eaf8);
		color: var(--theme-color-9484a6);
		font-size: 10px;
		line-height: 1.7;
	}
	.evidence-page :global(.evidence-provenance) {
		padding: 27px;
		gap: 0;
		margin-top: 24px;
	}
	.provenance-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
	}
	.provenance-heading h3 {
		font-size: 17px;
		letter-spacing: -0.3px;
		font-weight: 550;
		margin-top: 7px;
	}
	.provenance-heading p {
		margin-top: 8px;
		font-size: 11px;
		color: var(--theme-color-a19aaa);
	}
	.provenance-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 24px 32px;
		margin-top: 25px;
		padding-top: 24px;
		border-top: 1px solid var(--theme-color-efedf4);
	}
	.evidence-page :global(.source-badge) {
		border-color: var(--theme-color-e8e1f0);
		color: var(--theme-color-a298ae);
		font-size: 8px;
		height: auto;
		padding: 3px 7px;
		background: var(--theme-color-fbf9fd);
	}
	.provenance-grid a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-top: 11px;
		font-size: 12px;
		color: var(--theme-color-716780);
		font-weight: 520;
	}
	.provenance-grid a :global(svg) {
		color: var(--theme-color-b1a4bd);
		flex-shrink: 0;
	}
	.provenance-grid p {
		margin-top: 8px;
		color: var(--theme-color-a09aab);
		font-size: 10px;
		line-height: 1.8;
	}
	@media (max-width: 1050px) {
		.card-heading {
			flex-wrap: wrap;
		}
		.provenance-grid {
			grid-template-columns: 1fr 1fr;
		}
		.provenance-heading {
			flex-direction: column;
			align-items: flex-start;
		}
	}
	@media (max-width: 600px) {
		.inventory-grid > div {
			padding: 17px 15px;
		}
		.inventory-grid strong {
			font-size: 25px;
		}
		.inventory-grid :global(svg) {
			right: 12px;
			top: 16px;
		}
		.provenance-grid {
			grid-template-columns: 1fr;
			gap: 22px;
		}
		.evidence-page :global(.evidence-provenance) {
			padding: 23px;
		}
	}
</style>
