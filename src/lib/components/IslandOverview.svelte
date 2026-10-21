<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		Activity,
		Anchor,
		Bus,
		ChevronDown,
		GraduationCap,
		HeartPulse,
		Info,
		LandPlot,
		Plane,
		RefreshCw,
		Ship,
		Users,
		Waypoints
	} from '@lucide/svelte';
	import { buildIslandOverview } from '#lib/island-overview.js';
	import AccessScore from './AccessScore.svelte';
	import LoadingSkeleton from './LoadingSkeleton.svelte';
	import type { FerryConnectivity } from '#lib/ferry-planning.js';
	import type { AirAirport } from '#lib/air-connectivity.js';
	import type { IslandProfile } from '#lib/types.js';

	let {
		profile,
		loading = false,
		error = '',
		connectivity = null,
		connectivityLoading = false,
		connectivityDate = '',
		presentation,
		presentationFact,
		presentationAirport = null,
		mobilityContext,
		onRetry
	}: {
		profile: IslandProfile | null;
		loading?: boolean;
		error?: string;
		connectivity?: FerryConnectivity | null;
		connectivityLoading?: boolean;
		connectivityDate?: string;
		/** A focused native overview for the presenter; normal island pages omit this. */
		presentation?: 'access' | 'population';
		presentationFact?: { label: string; value: string; detail: string };
		/** Retained airport evidence supplements the presenter without changing the access index. */
		presentationAirport?: AirAirport | null;
		/** Optional historical map context, separate from the access assessment. */
		mobilityContext?: Snippet;
		onRetry?: () => void;
	} = $props();

	const number = new Intl.NumberFormat('en-US');
	const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
	const overview = $derived(profile ? buildIslandOverview(profile, connectivity) : null);
	const displayedConnections = $derived(
		overview?.connections.map((connection) => {
			const airport = presentationAirport;
			if (
				presentation &&
				connection.key === 'air' &&
				airport &&
				airport.island_id === profile?.island.id
			) {
				return {
					...connection,
					status: 'mapped' as const,
					statusLabel: `${airport.iata} · Airport recorded`,
					note: `${airport.name} (${airport.iata}) is recorded in the retained air network. This confirms the airport location, not a dated flight operation, and does not change the access index or facility inventory.`
				};
			}
			return connection;
		}) ?? []
	);
	const domainIcons = { health: HeartPulse, education: GraduationCap, transport: Bus };
	const domainLabels = { health: 'Health', education: 'Schools', transport: 'Getting around' };
	const connectionIcons = { land: LandPlot, marine: Anchor, ferry: Ship, air: Plane };
	const bounded = (value: number) => Math.max(0, Math.min(100, value));
	const populationGroups = $derived(
		['Sex distribution', 'Nationality'].map((label) => ({
			label,
			items: overview?.population.groups.find((group) => group.label === label)?.items ?? []
		}))
	);
	const evidenceDate = $derived.by(() => {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(connectivityDate)) return '';
		const date = new Date(`${connectivityDate}T12:00:00Z`);
		return Number.isNaN(date.getTime())
			? ''
			: new Intl.DateTimeFormat('en-GB', {
					day: 'numeric',
					month: 'short',
					year: 'numeric',
					timeZone: 'UTC'
				}).format(date);
	});
</script>

<div
	class="island-overview"
	class:presentation-overview={!!presentation}
	class:population-focus={presentation === 'population'}
	class:fact-focus={!!presentationFact}
	data-testid="island-overview"
	data-presentation={presentation}
	aria-busy={loading}
>
	{#if loading && !overview}
		<LoadingSkeleton variant="overview" label="Loading the island overview…" />
	{:else if !overview}
		<div class="overview-empty" role={error ? 'alert' : 'status'}>
			<Info size={22} strokeWidth={1.7} aria-hidden="true" />
			<h3>{error ? 'Island overview couldn’t load' : 'Island overview unavailable'}</h3>
			<p>{error || 'Select an island to explore its access, services and population.'}</p>
			{#if error && onRetry}<button class="retry-button" onclick={onRetry}
					><RefreshCw size={14} />Try again</button
				>{/if}
		</div>
	{:else}
		{#snippet expandedOverview(overview: ReturnType<typeof buildIslandOverview>)}
			{#if !presentation}
				<section class="access-hero" aria-label="Island access index">
					<div class="hero-topline">
						<h3>Island access index</h3>
						<span class="assessment-label">{overview.score.label}</span>
					</div>
					<div class="overall-score" data-testid="island-overview-score">
						<AccessScore value={overview.score.value} label={overview.score.label} size="hero" />
					</div>
					<div class="domain-grid" aria-label="What drives the access index">
						{#each overview.score.domains as domain (domain.key)}
							{@const Icon = domainIcons[domain.key]}
							<div class="domain" data-domain={domain.key}>
								<div class="domain-heading">
									<h4>
										<Icon size={12} strokeWidth={1.8} aria-hidden="true" />{domainLabels[
											domain.key
										]}
									</h4>
									<strong
										>{domain.value === null ? '—' : decimal.format(domain.value)}<span
											class="sr-only"
										>
											out of 100</span
										></strong
									>
								</div>
								{#if domain.value !== null}
									<div
										class="metric-track"
										role="meter"
										aria-label={`${domainLabels[domain.key]} access index`}
										aria-valuemin={0}
										aria-valuemax={100}
										aria-valuenow={domain.value}
										aria-valuetext={`${decimal.format(domain.value)} out of 100`}
									>
										<span style:width={`${bounded(domain.value)}%`}></span>
									</div>
								{:else}<div class="metric-track" aria-hidden="true"></div>{/if}
								<p class="domain-evidence">{domain.evidence}</p>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			{#if !presentation && mobilityContext}{@render mobilityContext()}{/if}
			<div class="overview-grid">
				<section class="overview-card services-section" aria-label="Island services">
					<div class="section-heading">
						<h3><Waypoints size={15} strokeWidth={1.7} aria-hidden="true" />Services</h3>
						<span class="section-meta">Recorded</span>
					</div>
					<div class="service-list">
						{#each overview.services as service (service.key)}
							{@const Icon = domainIcons[service.key]}
							{@const visibleItems = service.items.filter(
								(item) => item.value === null || item.value > 0
							)}
							<div class="service-row" data-domain={service.key}>
								<div class="service-heading">
									<h4>
										<Icon size={13} strokeWidth={1.7} aria-hidden="true" />{service.key ===
										'transport'
											? 'Connections'
											: service.label}
									</h4>
									<strong class="service-count"
										>{service.total === null ? '—' : number.format(service.total)}</strong
									>
								</div>
								{#if visibleItems.length}
									<dl class="service-items">
										{#each visibleItems as item (item.label)}
											<div>
												<dt>{item.label}</dt>
												<dd>
													<strong>{item.value === null ? '—' : number.format(item.value)}</strong
													>{#if item.unmapped}<span>{number.format(item.unmapped)} not mapped</span
														>{/if}
												</dd>
											</div>
										{/each}
									</dl>
								{:else}<p class="service-empty">
										{service.total === null ? 'Inventory unavailable' : 'None recorded'}
									</p>{/if}
							</div>
						{/each}
					</div>
				</section>

				<section class="overview-card population-section" aria-label="Island population">
					<div class="section-heading">
						<h3><Users size={15} strokeWidth={1.7} aria-hidden="true" />People &amp; needs</h3>
						<span class="section-meta">{overview.population.year ?? 'Census'}</span>
					</div>
					<div class="population-total">
						<strong data-testid={presentation ? undefined : 'island-overview-population'}
							>{overview.population.total === null
								? '—'
								: number.format(overview.population.total)}</strong
						><span
							>{overview.population.total === null ? 'Island total unavailable' : 'residents'}</span
						>
					</div>
					<div class="population-groups">
						{#each populationGroups as group, groupIndex (group.label)}
							{@const chartAvailable =
								group.items.length > 0 &&
								group.items.every((item) => item.share !== null) &&
								group.items.reduce((sum, item) => sum + (item.share ?? 0), 0) <= 100.05}
							<div class="composition-group" class:nationality={groupIndex === 1}>
								<h4>{group.label}</h4>
								{#if group.items.length}
									<div class="composition-visual" class:numbers-only={!chartAvailable}>
										{#if chartAvailable}
											<svg
												class="composition-ring"
												viewBox="0 0 80 80"
												role="img"
												aria-label={`${group.label}: ${group.items.map((item) => `${item.label}, ${decimal.format(item.share ?? 0)}%`).join('; ')}`}
											>
												<circle
													class="ring-track"
													cx="40"
													cy="40"
													r="31"
													fill="none"
													stroke-width="9"
												/>
												{#each group.items as item, index (item.label)}
													<circle
														class="ring-segment"
														class:overview-secondary={index % 2 !== 0}
														cx="40"
														cy="40"
														r="31"
														fill="none"
														stroke-width="9"
														pathLength="100"
														stroke-dasharray={`${bounded(item.share ?? 0)} ${100 - bounded(item.share ?? 0)}`}
														stroke-dashoffset={-group.items
															.slice(0, index)
															.reduce((sum, part) => sum + (part.share ?? 0), 0)}
														transform="rotate(-90 40 40)"
													/>
												{/each}
											</svg>
										{/if}
										<dl class="composition-values">
											{#each group.items as item, index (item.label)}
												<div>
													<dt>
														<span
															class="composition-dot"
															class:overview-secondary={index % 2 !== 0}
															aria-hidden="true"
														></span>{item.label}{#if item.share !== null}<span
																class="composition-share">{decimal.format(item.share)}%</span
															>{/if}
													</dt>
													<dd>{number.format(item.value)}</dd>
												</div>
											{/each}
										</dl>
									</div>
								{:else}<p class="breakdown-empty">Breakdown unavailable</p>{/if}
							</div>
						{/each}
					</div>
					{#if overview.population.ageItems.length}
						<div class="age-breakdown">
							<h4>Age distribution</h4>
							<dl>
								{#each overview.population.ageItems as item (item.label)}
									<div class="age-row">
										<dt>{item.label}</dt>
										<dd>
											<strong>{number.format(item.value)}</strong>{#if item.share !== null}<span
													>{decimal.format(item.share)}%</span
												>{/if}
										</dd>
										{#if item.share !== null}<div class="age-track" aria-hidden="true">
												<span style:width={`${bounded(item.share)}%`}></span>
											</div>{/if}
									</div>
								{/each}
							</dl>
						</div>
					{/if}
					{#if overview.population.ageNote}<p class="data-note">
							<Info size={12} strokeWidth={1.7} aria-hidden="true" /><span
								>{overview.population.ageNote}</span
							>
						</p>{/if}
				</section>
			</div>

			<section class="overview-card pressure-section" aria-label="Pressure and connections">
				<div class="section-heading">
					<h3>
						<Activity size={15} strokeWidth={1.7} aria-hidden="true" />Pressure &amp; connections
					</h3>
					<span
						class="pressure-label"
						class:elevated={overview.pressure.value !== null && overview.pressure.value >= 75}
						>{overview.pressure.label}</span
					>
				</div>
				<div class="pressure-summary">
					<div class="pressure-gauge">
						<svg
							viewBox="0 0 132 76"
							role="img"
							aria-label={`Modeled crowding pressure: ${overview.pressure.value === null ? 'not assessed' : `${decimal.format(overview.pressure.value)} out of 100, ${overview.pressure.label}`}`}
						>
							<path
								class="gauge-track"
								d="M 10 66 A 56 56 0 0 1 122 66"
								fill="none"
								stroke-width="8"
								stroke-linecap="round"
							/>
							{#if overview.pressure.value !== null}<path
									class="gauge-value"
									d="M 10 66 A 56 56 0 0 1 122 66"
									fill="none"
									stroke-width="8"
									stroke-linecap="round"
									pathLength="100"
									stroke-dasharray={`${bounded(overview.pressure.value)} 100`}
								/>{/if}
							<text x="66" y="55" class="gauge-number" text-anchor="middle"
								>{overview.pressure.value === null
									? '—'
									: decimal.format(overview.pressure.value)}</text
							><text x="66" y="70" class="gauge-denominator" text-anchor="middle">/100</text>
						</svg>
					</div>
					<div class="pressure-description">
						<h4>Modeled crowding pressure</h4>
						{#if overview.pressure.density !== null}<p>
								<strong>{number.format(Math.round(overview.pressure.density))}</strong><span>
									residents / km²</span
								>
							</p>{:else}<p class="density-empty">Density unavailable</p>{/if}
					</div>
				</div>
				<div class="connection-grid" aria-busy={connectivityLoading}>
					{#each displayedConnections as connection (connection.key)}
						{@const Icon = connectionIcons[connection.key]}
						<div class="overview-connection" data-status={connection.status}>
							<Icon size={16} strokeWidth={1.7} aria-hidden="true" />
							<div>
								<h4>{connection.label}</h4>
								<p>
									{connectivityLoading && connection.key === 'ferry'
										? 'Checking service…'
										: connection.statusLabel}
								</p>
							</div>
						</div>
					{/each}
				</div>
			</section>

			<details class="overview-data-details">
				<summary
					><span
						><Info size={14} strokeWidth={1.7} aria-hidden="true" />Sources &amp; data notes</span
					><ChevronDown size={15} strokeWidth={1.7} aria-hidden="true" /></summary
				>
				<div class="data-details-content">
					<h4>How the access index is built</h4>
					<p>{overview.score.summary}</p>
					{#if overview.score.coverage}<p>{overview.score.coverage}</p>{/if}
					<dl>
						{#each overview.score.domains as domain (domain.key)}<div>
								<dt>{domainLabels[domain.key]}</dt>
								<dd>{domain.explanation}</dd>
							</div>{/each}
					</dl>
					<h4>Service inventory</h4>
					{#each [...new Set(overview.services.map((service) => service.note))] as note (note)}<p>
							{note}
						</p>{/each}
					<h4>Population</h4>
					{#if overview.population.source}<p>
							{#if overview.population.sourceUrl}<a
									href={overview.population.sourceUrl}
									target="_blank"
									rel="noreferrer">{overview.population.source}</a
								>{:else}{overview.population.source}{/if}{#if overview.population.year}
								· {overview.population.year}{/if}
						</p>{/if}{#if overview.population.qualification}<p>
							{overview.population.qualification}
						</p>{/if}
					<h4>Pressure &amp; connections</h4>
					<p>{overview.pressure.explanation}</p>
					<dl>
						{#each displayedConnections as connection (connection.key)}<div>
								<dt>{connection.label}</dt>
								<dd>{connection.note}</dd>
							</div>{/each}
					</dl>
					{#if evidenceDate}<p>Ferry service evidence · {evidenceDate}</p>{/if}
					{#if overview.notes.length}<h4>Index methodology &amp; evidence</h4>
						<ul>
							{#each overview.notes as note (note)}<li>{note}</li>{/each}
						</ul>{/if}
				</div>
			</details>
		{/snippet}
		{#snippet populationFact(overview: ReturnType<typeof buildIslandOverview>)}
			<section class="presentation-residents" aria-label="Island population">
				<div class="presentation-fact-heading">
					<h3><Users size={18} strokeWidth={1.7} aria-hidden="true" />Residents</h3>
					<span>{overview.population.year ?? 'Census unavailable'}</span>
				</div>
				<strong data-testid="island-overview-population"
					>{overview.population.total === null
						? 'Unknown'
						: number.format(overview.population.total)}</strong
				>
				<p>
					{overview.population.total === null
						? 'Island-specific resident count unavailable'
						: 'Census residents · Whole island'}
				</p>
				{#if presentation === 'population' && overview.pressure.density !== null}
					<div class="presentation-density">
						<strong>{number.format(Math.round(overview.pressure.density))}</strong><span
							>residents / km²</span
						>
					</div>
				{/if}
			</section>
		{/snippet}
		{#if presentation}
			{@const transport = overview.score.domains.find((domain) => domain.key === 'transport')}
			<div class="presentation-primary">
				{#if presentationFact}
					{#key presentationFact.label}
						<section class="presentation-story-fact" aria-label={presentationFact.label}>
							<h3>{presentationFact.label}</h3>
							<strong>{presentationFact.value}</strong>
							<p>{presentationFact.detail}</p>
						</section>
					{/key}
				{/if}
				{#if presentation === 'population'}{@render populationFact(overview)}{/if}
				<section class="presentation-access" aria-label="Island access index">
					<div class="hero-topline">
						<h3>Island access index</h3>
						<span class="assessment-label">{overview.score.label}</span>
					</div>
					<div class="presentation-metrics">
						<div class="presentation-metric" data-testid="island-overview-score">
							<h4>Overall access</h4>
							<div class="presentation-value" class:unavailable={overview.score.value === null}>
								<strong
									>{overview.score.value === null
										? 'Not assessed'
										: decimal.format(overview.score.value)}</strong
								>{#if overview.score.value !== null}<span>/100</span>{/if}
							</div>
						</div>
						<div class="presentation-metric" data-domain="transport">
							<h4><Bus size={16} strokeWidth={1.8} aria-hidden="true" />Transport access</h4>
							<div class="presentation-value" class:unavailable={transport?.value == null}>
								<strong
									>{transport?.value == null
										? 'Not assessed'
										: decimal.format(transport.value)}</strong
								>{#if transport?.value != null}<span>/100</span>{/if}
							</div>
						</div>
					</div>
					<p class="presentation-coverage">
						{overview.score.value === null ? overview.score.summary : overview.score.coverage}
					</p>
				</section>
			</div>
			{#key `${profile?.island.id}:${presentation}`}
				<details class="presentation-details">
					<summary
						><span>Connections, services &amp; data</span><ChevronDown
							size={18}
							strokeWidth={1.7}
							aria-hidden="true"
						/></summary
					>
					<div class="presentation-details-content">
						{#if presentation !== 'population'}{@render populationFact(overview)}{/if}
						<section
							class="presentation-connections"
							aria-label="Island connections"
							aria-busy={connectivityLoading}
						>
							{#each displayedConnections as connection (connection.key)}
								{@const Icon = connectionIcons[connection.key]}
								<div
									class="overview-connection"
									data-status={connection.status}
									title={connection.note}
								>
									<Icon size={18} strokeWidth={1.7} aria-hidden="true" />
									<div>
										<h4>{connection.label}</h4>
										<p>
											{connectivityLoading && connection.key === 'ferry'
												? 'Checking service…'
												: connection.statusLabel}
										</p>
									</div>
								</div>
							{/each}
						</section>
						{@render expandedOverview(overview)}
					</div>
				</details>
			{/key}
		{:else}
			{@render expandedOverview(overview)}
		{/if}
		{#if error}<p class="refresh-status" role="status">
				Some island information couldn’t refresh.{#if onRetry}<button onclick={onRetry}
						>Try again</button
					>{/if}
			</p>{/if}
	{/if}
</div>

<style>
	.island-overview {
		container: island-overview / inline-size;
		color: var(--theme-color-273732);
		font-variant-numeric: tabular-nums;
		min-width: 0;
	}
	.island-overview p,
	.island-overview h3,
	.island-overview h4,
	.island-overview dl,
	.island-overview dd {
		margin: 0;
	}
	.access-hero,
	.overview-card {
		border: 1px solid var(--theme-color-e7ece7);
		border-radius: 13px;
		padding: 15px;
		background: var(--theme-color-ffffff);
	}
	.access-hero {
		background: linear-gradient(115deg, var(--theme-color-f7faf7), var(--theme-color-ffffff));
		border-color: var(--theme-color-d7e2df);
	}
	.hero-topline,
	.section-heading,
	.service-heading,
	.domain-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.hero-topline h3 {
		font-size: 11px;
		font-weight: 600;
		color: var(--theme-color-48665d);
	}
	.assessment-label,
	.pressure-label {
		color: var(--theme-color-365b54);
		background: var(--theme-color-eef6f4);
		border-radius: 6px;
		padding: 4px 6px;
		font-size: 10px;
		line-height: 1.3;
		font-weight: 550;
	}
	.assessment-label {
		max-width: 55%;
		text-align: right;
	}
	.overall-score {
		margin: 8px 0 16px;
	}
	.domain-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 15px;
		padding-top: 13px;
		border-top: 1px solid var(--theme-color-e7ece7);
	}
	[data-domain='health'] {
		--domain-color: var(--theme-color-9072dd);
	}
	[data-domain='education'] {
		--domain-color: var(--theme-color-32ae89);
	}
	[data-domain='transport'] {
		--domain-color: var(--theme-color-d18c34);
	}
	.domain {
		min-width: 0;
	}
	.domain-heading {
		align-items: baseline;
		gap: 4px;
		margin-bottom: 8px;
	}
	.domain-heading h4 {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		font-weight: 550;
		line-height: 1.35;
	}
	.domain-heading h4 :global(svg) {
		color: var(--domain-color);
		flex-shrink: 0;
	}
	.domain-heading strong {
		font-size: 12px;
		font-weight: 650;
		letter-spacing: -0.025em;
		white-space: nowrap;
	}
	.metric-track {
		height: 5px;
		border-radius: 99px;
		background: var(--theme-color-e7ece7);
		overflow: hidden;
	}
	.metric-track > span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--domain-color);
	}
	.island-overview .domain-evidence {
		margin-top: 7px;
		color: var(--theme-color-6f8177);
		font-size: 10px;
		line-height: 1.5;
	}
	.overview-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 12px;
		margin-top: 12px;
		align-items: start;
	}
	.section-heading {
		margin-bottom: 14px;
	}
	.section-heading h3 {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		line-height: 1.35;
		font-weight: 650;
		letter-spacing: -0.02em;
	}
	.section-heading h3 :global(svg) {
		flex-shrink: 0;
		color: var(--theme-color-6f8177);
	}
	.section-meta {
		font-size: 10px;
		line-height: 1.35;
		color: var(--theme-color-6f8177);
		white-space: nowrap;
	}
	.service-row + .service-row {
		margin-top: 15px;
		padding-top: 13px;
		border-top: 1px solid var(--theme-color-e7ece7);
	}
	.service-heading h4 {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		font-weight: 550;
	}
	.service-heading h4 :global(svg) {
		color: var(--domain-color);
		flex-shrink: 0;
	}
	.service-count {
		font-size: 20px;
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.04em;
	}
	.service-items {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 10px !important;
	}
	.service-items > div {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 6px;
		font-size: 10px;
	}
	.service-items dt {
		color: var(--theme-color-6f8177);
		min-width: 0;
	}
	.service-items dd {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		text-align: right;
	}
	.service-items dd strong {
		font-size: 11px;
		font-weight: 600;
	}
	.service-items dd span {
		font-size: 9px;
		line-height: 1.4;
		color: var(--theme-color-6f8177);
		white-space: nowrap;
	}
	.island-overview .service-empty {
		margin-top: 9px;
		font-size: 10px;
		color: var(--theme-color-6f8177);
	}
	.population-total {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 7px;
		margin-bottom: 17px;
	}
	.population-total > strong {
		font-size: 27px;
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.045em;
	}
	.population-total > span {
		font-size: 10px;
		line-height: 1.4;
		color: var(--theme-color-6f8177);
	}
	.population-groups {
		display: flex;
		flex-direction: column;
		gap: 15px;
	}
	.composition-group {
		--composition-primary: var(--theme-color-9072dd);
		--composition-secondary: color-mix(in srgb, var(--theme-color-9072dd) 35%, white);
	}
	.composition-group.nationality {
		--composition-primary: var(--theme-color-32ae89);
		--composition-secondary: color-mix(in srgb, var(--theme-color-32ae89) 30%, white);
	}
	.composition-group h4,
	.age-breakdown h4 {
		font-size: 10px;
		font-weight: 550;
		color: var(--theme-color-48665d);
		margin-bottom: 7px;
	}
	.composition-visual {
		display: grid;
		grid-template-columns: 64px minmax(0, 1fr);
		align-items: center;
		gap: 9px;
	}
	.composition-visual.numbers-only {
		grid-template-columns: 1fr;
	}
	.composition-ring {
		width: 64px;
		height: 64px;
		overflow: visible;
	}
	.ring-track {
		stroke: var(--theme-color-e7ece7);
	}
	.ring-segment {
		stroke: var(--composition-primary);
	}
	.ring-segment.overview-secondary {
		stroke: var(--composition-secondary);
	}
	.composition-values {
		display: flex;
		flex-direction: column;
		gap: 7px;
		min-width: 0;
	}
	.composition-values dt {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		line-height: 1.3;
		color: var(--theme-color-6f8177);
	}
	.composition-dot {
		width: 5px;
		height: 5px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--composition-primary);
	}
	.composition-dot.overview-secondary {
		background: var(--composition-secondary);
	}
	.composition-share {
		margin-left: auto;
		color: var(--theme-color-6f8177);
		font-size: 9px;
		white-space: nowrap;
	}
	.composition-values dd {
		padding-left: 9px;
		padding-top: 2px;
		font-size: 12px;
		font-weight: 550;
		line-height: 1.2;
	}
	.breakdown-empty {
		color: var(--theme-color-6f8177);
		font-size: 10px;
		line-height: 1.4;
	}
	.age-breakdown {
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid var(--theme-color-e7ece7);
	}
	.age-breakdown dl {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}
	.age-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 5px;
		font-size: 10px;
	}
	.age-row dt {
		color: var(--theme-color-6f8177);
	}
	.age-row dd {
		display: flex;
		gap: 6px;
		align-items: baseline;
	}
	.age-row dd strong {
		font-weight: 550;
	}
	.age-row dd > span {
		color: var(--theme-color-6f8177);
		font-size: 9px;
	}
	.age-track {
		grid-column: 1 / -1;
		height: 4px;
		overflow: hidden;
		border-radius: 9px;
		background: var(--theme-color-e7ece7);
	}
	.age-track > span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--theme-color-9072dd);
	}
	.island-overview .data-note {
		display: flex;
		align-items: flex-start;
		gap: 5px;
		padding-top: 11px;
		margin-top: 13px;
		border-top: 1px solid var(--theme-color-e7ece7);
		font-size: 10px;
		line-height: 1.5;
		color: var(--theme-color-6f8177);
	}
	.data-note :global(svg) {
		margin-top: 1px;
		flex-shrink: 0;
	}
	.pressure-section {
		margin-top: 12px;
	}
	.pressure-section .section-heading {
		margin-bottom: 9px;
	}
	.pressure-label.elevated {
		background: var(--theme-color-fcf8ed);
		color: var(--theme-color-995e29);
	}
	.pressure-summary {
		display: flex;
		align-items: center;
		gap: 18px;
	}
	.pressure-gauge {
		width: 118px;
		flex-shrink: 0;
	}
	.pressure-gauge svg {
		display: block;
		width: 100%;
	}
	.gauge-track {
		stroke: var(--theme-color-e7ece7);
	}
	.gauge-value {
		stroke: var(--theme-color-9072dd);
	}
	.gauge-number {
		font-size: 25px;
		font-weight: 600;
		letter-spacing: -0.04em;
		fill: var(--theme-color-273732);
	}
	.gauge-denominator {
		font-size: 10px;
		fill: var(--theme-color-6f8177);
	}
	.pressure-description {
		min-width: 0;
	}
	.pressure-description h4 {
		font-size: 11px;
		font-weight: 500;
		color: var(--theme-color-6f8177);
		line-height: 1.5;
	}
	.pressure-description p {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 3px 5px;
		margin-top: 6px;
	}
	.pressure-description strong {
		font-size: 21px;
		font-weight: 550;
		letter-spacing: -0.03em;
		line-height: 1;
	}
	.pressure-description span,
	.density-empty {
		font-size: 10px;
		line-height: 1.5;
		color: var(--theme-color-6f8177);
	}
	.connection-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
		margin-top: 16px;
		padding-top: 13px;
		border-top: 1px solid var(--theme-color-e7ece7);
	}
	.overview-connection {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		min-width: 0;
	}
	.overview-connection > :global(svg) {
		color: var(--theme-color-6f8177);
		flex-shrink: 0;
		margin-top: 1px;
	}
	.overview-connection h4 {
		font-size: 10px;
		font-weight: 500;
		color: var(--theme-color-6f8177);
		line-height: 1.4;
	}
	.overview-connection p {
		font-size: 10px;
		font-weight: 550;
		line-height: 1.5;
		margin-top: 2px;
	}
	.overview-connection[data-status='confirmed'] p,
	.overview-connection[data-status='mapped'] p {
		color: var(--theme-color-32857a);
	}
	.overview-data-details {
		margin-top: 10px;
	}
	.overview-data-details summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 40px;
		cursor: pointer;
		list-style: none;
		color: var(--theme-color-6f8177);
		font-size: 10px;
		border-radius: 4px;
	}
	.overview-data-details summary::-webkit-details-marker {
		display: none;
	}
	.overview-data-details summary > span {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.overview-data-details summary > :global(svg) {
		transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.overview-data-details[open] summary > :global(svg) {
		transform: rotate(180deg);
	}
	.overview-data-details summary:focus-visible,
	button:focus-visible,
	a:focus-visible {
		outline: 2px solid var(--theme-color-32857a);
		outline-offset: 3px;
	}
	.data-details-content {
		padding: 0 0 8px;
		color: var(--theme-color-6f8177);
		font-size: 11px;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.data-details-content h4 {
		color: var(--theme-color-48665d);
		font-weight: 600;
		font-size: 11px;
		margin: 15px 0 6px;
	}
	.data-details-content > h4:first-child {
		margin-top: 2px;
	}
	.data-details-content p + p {
		margin-top: 6px;
	}
	.data-details-content dl {
		margin-top: 9px;
	}
	.data-details-content dl > div + div {
		margin-top: 7px;
	}
	.data-details-content dt {
		font-weight: 550;
		color: var(--theme-color-48665d);
	}
	.data-details-content a {
		color: var(--theme-color-32857a);
		text-underline-offset: 2px;
	}
	.data-details-content ul {
		padding-left: 15px;
		margin: 6px 0 0;
	}
	.data-details-content li + li {
		margin-top: 6px;
	}
	.overview-empty {
		padding: 35px 18px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 11px;
		color: var(--theme-color-6f8177);
	}
	.overview-empty h3 {
		color: var(--theme-color-273732);
		font-size: 14px;
		font-weight: 600;
	}
	.overview-empty p {
		font-size: 11px;
		line-height: 1.6;
	}
	.retry-button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 44px;
		padding: 7px 11px;
		border: 1px solid var(--theme-color-cbdcd6);
		border-radius: 8px;
		color: var(--theme-color-365b54);
		background: var(--theme-color-ffffff);
		cursor: pointer;
		font: inherit;
		font-size: 11px;
	}
	.retry-button:active {
		transform: scale(0.97);
	}
	.island-overview .refresh-status {
		margin-top: 12px;
		color: var(--theme-color-6f8177);
		font-size: 10px;
		line-height: 1.6;
	}
	.presentation-primary {
		display: grid;
		gap: 12px;
	}
	.presentation-story-fact {
		padding: 18px 18px 22px;
		border: 1px solid #d7e2df;
		border-radius: 14px;
		background: linear-gradient(115deg, #eef6f4, #ffffff);
		animation: fact-enter 400ms cubic-bezier(0.23, 1, 0.32, 1) both;
	}
	.presentation-story-fact h3 {
		font-size: 14px;
		font-weight: 500;
		color: #48665d;
	}
	.presentation-story-fact > strong {
		display: block;
		margin: 12px 0 8px;
		font-size: 62px;
		font-weight: 600;
		letter-spacing: -0.055em;
		line-height: 1;
	}
	.island-overview .presentation-story-fact p {
		font-size: 12px;
		color: #6f8177;
		line-height: 1.5;
	}
	.fact-focus .presentation-access,
	.population-focus .presentation-access {
		padding: 14px 16px;
	}
	.fact-focus .presentation-value strong,
	.population-focus .presentation-value strong {
		font-size: 30px;
	}
	.fact-focus .presentation-value,
	.population-focus .presentation-value {
		min-height: 32px;
		margin-top: 4px;
	}
	.fact-focus .presentation-metrics,
	.population-focus .presentation-metrics {
		margin: 12px 0 8px;
	}
	.fact-focus .presentation-access .assessment-label,
	.population-focus .presentation-access .assessment-label {
		display: none;
	}
	.presentation-overview:not(.fact-focus):not(.population-focus)
		.presentation-metric[data-domain='transport']
		.presentation-value
		strong {
		font-size: 32px;
	}
	.presentation-details-content > .presentation-residents,
	.presentation-details-content > .presentation-connections {
		margin-bottom: 12px;
	}
	@keyframes fact-enter {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.presentation-access,
	.presentation-residents,
	.presentation-connections {
		padding: 18px;
		border: 1px solid var(--theme-color-d7e2df);
		border-radius: 14px;
		background: var(--theme-color-ffffff);
	}
	.presentation-access {
		background: linear-gradient(115deg, var(--theme-color-f7faf7), var(--theme-color-ffffff));
	}
	.presentation-access .hero-topline h3,
	.presentation-fact-heading h3 {
		font-size: 14px;
		font-weight: 600;
		line-height: 1.4;
		color: var(--theme-color-48665d);
	}
	.presentation-access .assessment-label {
		font-size: 11px;
		padding: 5px 7px;
	}
	.presentation-metrics {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
		margin: 19px 0 14px;
	}
	.presentation-metric {
		min-width: 0;
	}
	.presentation-metric + .presentation-metric {
		padding-left: 16px;
		border-left: 1px solid var(--theme-color-d7e2df);
	}
	.presentation-metric h4 {
		display: flex;
		align-items: center;
		gap: 5px;
		min-height: 20px;
		font-size: 12px;
		font-weight: 500;
		line-height: 1.4;
		color: var(--theme-color-48665d);
	}
	.presentation-metric h4 :global(svg) {
		flex-shrink: 0;
		color: var(--domain-color);
	}
	.presentation-value {
		display: flex;
		align-items: baseline;
		gap: 5px;
		margin-top: 8px;
		min-height: 56px;
	}
	.presentation-value strong {
		font-size: 54px;
		font-weight: 600;
		letter-spacing: -0.055em;
		line-height: 1;
	}
	.presentation-metric[data-domain='transport'] .presentation-value strong {
		color: var(--domain-color);
	}
	.presentation-value > span {
		font-size: 13px;
		color: var(--theme-color-6f8177);
	}
	.presentation-value.unavailable {
		align-items: center;
	}
	.presentation-value.unavailable strong {
		font-size: 21px;
		letter-spacing: -0.025em;
		line-height: 1.2;
		color: var(--theme-color-6f8177);
	}
	.island-overview .presentation-coverage {
		padding-top: 12px;
		border-top: 1px solid var(--theme-color-e7ece7);
		font-size: 12px;
		line-height: 1.55;
		color: var(--theme-color-6f8177);
	}
	.presentation-fact-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 13px;
	}
	.presentation-fact-heading h3 {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.presentation-fact-heading > span {
		font-size: 11px;
		line-height: 1.4;
		text-align: right;
		color: var(--theme-color-6f8177);
	}
	.presentation-residents > strong {
		display: block;
		font-size: 39px;
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: -0.045em;
	}
	.island-overview .presentation-residents > p {
		margin-top: 5px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--theme-color-6f8177);
	}
	.population-focus .presentation-residents {
		background: linear-gradient(115deg, var(--theme-color-eef6f4), var(--theme-color-ffffff));
		animation: fact-enter 400ms cubic-bezier(0.23, 1, 0.32, 1) both;
	}
	.population-focus .presentation-residents > strong {
		font-size: 62px;
	}
	.presentation-density {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 5px 8px;
		margin-top: 16px;
		padding-top: 14px;
		border-top: 1px solid var(--theme-color-d7e2df);
	}
	.presentation-density strong {
		font-size: 24px;
		font-weight: 550;
		letter-spacing: -0.035em;
	}
	.presentation-density > span {
		font-size: 12px;
		color: var(--theme-color-6f8177);
	}
	.presentation-connections {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 15px 12px;
	}
	.presentation-connections .overview-connection {
		gap: 8px;
	}
	.presentation-connections .overview-connection h4 {
		font-size: 12px;
	}
	.presentation-connections .overview-connection p {
		font-size: 13px;
	}
	.presentation-details {
		margin-top: 8px;
	}
	.presentation-details > summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 48px;
		padding: 4px 3px;
		border-radius: 5px;
		font-size: 13px;
		font-weight: 500;
		line-height: 1.5;
		color: var(--theme-color-48665d);
		list-style: none;
		cursor: pointer;
	}
	.presentation-details > summary::-webkit-details-marker {
		display: none;
	}
	.presentation-details > summary :global(svg) {
		flex-shrink: 0;
	}
	.presentation-details[open] > summary :global(svg) {
		transform: rotate(180deg);
	}
	.presentation-details > summary:focus-visible {
		outline: 2px solid var(--theme-color-32857a);
		outline-offset: 3px;
	}
	.presentation-details-content {
		padding-top: 3px;
	}
	.presentation-details-content .overview-grid {
		margin-top: 0;
	}
	.refresh-status button {
		margin-left: 6px;
		border: none;
		padding: 0;
		font: inherit;
		color: var(--theme-color-32857a);
		background: transparent;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	@container island-overview (max-width: 440px) {
		.overview-grid {
			grid-template-columns: 1fr;
		}
		.service-items {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 8px 18px;
		}
		.service-items > div {
			flex-wrap: wrap;
		}
		.service-items dd {
			align-items: flex-start;
			text-align: left;
		}
		.service-items dd span {
			white-space: normal;
		}
		.population-total {
			margin-bottom: 15px;
		}
		.population-groups {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 18px;
		}
		.composition-visual {
			grid-template-columns: 1fr;
			gap: 10px;
		}
		.composition-ring {
			width: 66px;
			height: 66px;
		}
		.composition-values > div {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: 6px;
		}
		.composition-values dt {
			flex-wrap: wrap;
		}
		.composition-values dd {
			padding: 0;
			font-size: 11px;
		}
		.composition-share {
			margin-left: 0;
		}
		.connection-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.overview-data-details summary {
			min-height: 44px;
		}
	}
	@container island-overview (max-width: 350px) {
		.presentation-access,
		.presentation-residents,
		.presentation-connections {
			padding: 14px;
		}
		.presentation-metrics {
			gap: 12px;
		}
		.presentation-metric + .presentation-metric {
			padding-left: 12px;
		}
		.presentation-value strong {
			font-size: 46px;
		}
		.presentation-value.unavailable strong {
			font-size: 18px;
		}
		.population-focus .presentation-residents > strong {
			font-size: 54px;
		}
		.access-hero,
		.overview-card {
			padding: 13px;
		}
		.domain-grid {
			grid-template-columns: 1fr;
			gap: 10px;
		}
		.domain {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 90px;
			align-items: center;
			gap: 3px 14px;
		}
		.domain-heading {
			margin: 0;
		}
		.domain-evidence {
			grid-column: 1 / -1;
			margin-top: 0 !important;
		}
		.domain-heading h4 {
			font-size: 11px;
		}
		.pressure-summary {
			gap: 12px;
		}
		.pressure-gauge {
			width: 99px;
		}
		.pressure-description h4 {
			font-size: 10px;
		}
		.pressure-description strong {
			font-size: 19px;
		}
		.population-groups {
			gap: 14px;
		}
		.composition-values > div {
			display: block;
		}
		.composition-values dd {
			padding-left: 9px;
			padding-top: 2px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.presentation-story-fact,
		.population-focus .presentation-residents {
			animation: none;
		}
		.overview-data-details summary > :global(svg) {
			transition: none;
		}
		.retry-button:active {
			transform: none;
		}
	}
</style>
