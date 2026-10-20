<script lang="ts">
	import { ArrowRight, BusFront, Ship } from '@lucide/svelte';
	import { planningEvidence } from '#lib/planning-evidence.js';
	import { islandServiceChanges } from '#lib/proposal-island-impact.js';
	import { finiteValue, formatAmount, type PlanningIslandImpact } from '#lib/proposal-review.js';
	import {
		formatImpactDate,
		formatImpactMinutes,
		type TransportServiceMetrics
	} from '#lib/transport-impact.js';

	let {
		impacts = [],
		compact = false,
		pending = false,
		stale = false,
		goal = 'transport'
	}: {
		impacts?: PlanningIslandImpact[];
		compact?: boolean;
		pending?: boolean;
		stale?: boolean;
		goal?: string;
	} = $props();
	const walking = $derived(goal === 'transport');
	const destination = $derived(
		goal === 'education'
			? 'education'
			: goal === 'healthcare'
				? 'healthcare'
				: 'the selected service'
	);
	const rows = $derived(
		impacts.map((island) => ({
			island,
			name: island.island_id === 'island:1382' ? 'Vilimalé' : island.island_name,
			services: islandServiceChanges(island).map((service) => ({
				...service,
				name: island.transport_connectivity?.impact?.connections?.some(
					(connection) =>
						connection.to_island_id === 'island:1382' &&
						service.id === `connection:${connection.id}`
				)
					? 'To Vilimalé'
					: service.name
			})),
			before: finiteValue(island.summary.baseline_reachable_residents),
			after: finiteValue(island.summary.scenario_reachable_residents),
			gained: finiteValue(island.summary.gained_residents),
			lost: finiteValue(island.summary.lost_residents),
			unknown: finiteValue(island.summary.unknown_residents),
			evidence: planningEvidence(island.population_basis)
		}))
	);
	function departures(metrics: TransportServiceMetrics | null | undefined, before: boolean) {
		if (metrics === null) return before ? 'Not captured' : 'No modeled service';
		const count = finiteValue(metrics?.departure_count);
		return count === null
			? 'Unavailable'
			: `${formatAmount(count)} ${count === 1 ? 'departure' : 'departures'}`;
	}
</script>

{#if rows.length}
	<section
		class="island-impacts"
		class:compact
		data-outdated={pending || stale}
		aria-label="Proposal impact by island"
	>
		<header class="impacts-heading">
			<div>
				<span class="eyebrow">The complete proposal</span>
				<h2>Impact on {rows.length === 2 ? 'both islands' : 'each island'}</h2>
			</div>
			<span class="model-label">Modeled comparison</span>
		</header>
		<p class="section-note">
			The same complete proposal is evaluated for each island. Resident access and scheduled service
			are separate outcomes.
		</p>
		{#if pending || stale}<p class="retained-note" role="status">
				{pending
					? 'Updating · previous calculation'
					: 'Previous calculation · update impact for your latest changes'}
			</p>{/if}
		<p class="comparison-key">
			<span>Current services</span><ArrowRight size={13} aria-label="compared with" /><strong
				>With proposal</strong
			>
		</p>
		<div class="island-grid">
			{#each rows as row (row.island.island_id)}
				<article
					class="island-result"
					data-island-id={row.island.island_id}
					data-gained-residents={row.gained ?? 'unavailable'}
				>
					<header>
						<h3>{row.name}</h3>
						<span>{formatImpactDate(row.island.transport_connectivity?.impact?.service_date)}</span>
					</header>
					<div class="resident-result">
						<small
							>{walking
								? 'Walking access to a boarding point'
								: `Resident access to ${destination}`}{#if row.island.target_minutes != null}
								· {row.island.target_minutes} min{/if}</small
						>
						<div class="resident-comparison">
							<span>{formatAmount(row.before)}</span><ArrowRight
								size={16}
								aria-label="changes to"
							/><strong>{formatAmount(row.after)}</strong><small>residents within target</small>
						</div>
						<p class="resident-change" class:gained={row.gained !== null && row.gained > 0}>
							<strong>{formatAmount(row.gained)}</strong> newly within target{#if row.lost !== null && row.lost > 0}<span
								>
									· {formatAmount(row.lost)} move outside</span
								>{/if}
						</p>
						{#if row.gained === 0}<p class="zero-note">
								No additional residents {walking
									? 'gain walking access to a boarding point'
									: 'move within the journey target'}. A service improvement can still appear below.
							</p>{:else if row.gained === null}<p class="zero-note">
								Resident access change is unavailable for this island.
							</p>{/if}
						{#if row.unknown !== null && row.unknown > 0}<p class="zero-note">
								{formatAmount(row.unknown)} residents have unavailable journey estimates.
							</p>{/if}
					</div>
					{#if row.services.length}<div class="service-results">
							{#each row.services as service (service.id)}
								<div class="service-result" data-mode={service.mode}>
									<div class="service-title">
										{#if service.mode === 'ferry'}<Ship size={15} />{:else}<BusFront
												size={15}
											/>{/if}
										<div><strong>{service.name}</strong><small>{service.detail}</small></div>
									</div>
									<dl>
										<div>
											<dt>Departures on this date</dt>
											<dd>
												<span>{departures(service.before, true)}</span><ArrowRight
													size={13}
													aria-label="changes to"
												/><strong>{departures(service.after, false)}</strong>
											</dd>
										</div>
										<div>
											<dt>Expected timetable wait</dt>
											<dd>
												<span>{formatImpactMinutes(service.before?.expected_wait_minutes)}</span
												><ArrowRight size={13} aria-label="changes to" /><strong
													>{formatImpactMinutes(service.after?.expected_wait_minutes)}</strong
												>
											</dd>
										</div>
										<div>
											<dt>{service.mode === 'ferry' ? 'Crossing' : 'Ride'} time</dt>
											<dd>
												<span>{formatImpactMinutes(service.before?.crossing_minutes)}</span
												><ArrowRight size={13} aria-label="changes to" /><strong
													>{formatImpactMinutes(service.after?.crossing_minutes)}</strong
												>
											</dd>
										</div>
									</dl>
								</div>
							{/each}
						</div>{:else}<p class="no-service-change">
							No changed outbound island connection or local bus timetable is reported.
						</p>{/if}
					{#if row.services.some((service) => service.before === null)}<p class="source-note">
							“Not captured” means missing source evidence, not proof that no operator runs a
							service.
						</p>{/if}
					{#if !compact}<details class="evidence">
							<summary>Methods and source qualifications</summary>
							<div>
								{#if row.island.access_method}<p>
										{row.island.access_method}
									</p>{/if}{#if row.evidence.population}<p>
										{row.evidence.population}
									</p>{/if}{#if row.evidence.distribution}<p>
										{row.evidence.distribution}
									</p>{/if}{#if row.evidence.qualification}<p>
										{row.evidence.qualification}
									</p>{/if}{#if row.island.transport_connectivity?.impact?.qualification}<p>
										{row.island.transport_connectivity.impact.qualification}
									</p>{/if}{#if row.island.transport_connectivity?.impact?.wait_method}<p>
										{row.island.transport_connectivity.impact.wait_method}
									</p>{/if}{#each [...new Set( [...(row.island.warnings ?? []), ...row.evidence.warnings] )] as warning (warning)}<p
									>
										{warning}
									</p>{/each}
							</div>
						</details>{/if}
				</article>
			{/each}
		</div>
		<p class="section-note final-note">
			Timetable waits are modeled from dated departures. Passenger demand, vessel capacity and
			actual queues are not estimated. Costs elsewhere cover the combined proposal once.
		</p>
	</section>
{/if}

<style>
	.island-impacts {
		margin-bottom: 20px;
		padding: 24px;
		border: 1px solid var(--border);
		border-radius: 18px;
		background: var(--card);
		color: var(--foreground);
	}
	.impacts-heading,
	.island-result > header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.eyebrow,
	.model-label {
		color: var(--muted-foreground);
		font-size: 10px;
		font-weight: 650;
	}
	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.8px;
	}
	h2 {
		margin: 5px 0 0;
		font-size: 23px;
		line-height: 1.25;
		letter-spacing: -0.5px;
	}
	.model-label {
		padding: 5px 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		white-space: nowrap;
	}
	.section-note {
		margin: 10px 0 18px;
		color: var(--muted-foreground);
		font-size: 12px;
		line-height: 1.6;
	}
	.island-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
		gap: 16px;
	}
	.comparison-key {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 0 0 12px;
		font-size: 10px;
		color: var(--muted-foreground);
	}
	.comparison-key strong {
		font-weight: 600;
		color: var(--foreground);
	}
	.island-result {
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 12px;
		overflow: hidden;
	}
	.island-result > header {
		padding: 16px 18px;
		background: var(--theme-color-f7faf8);
		border-bottom: 1px solid var(--border);
	}
	h3 {
		margin: 0;
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.3px;
	}
	.island-result > header > span {
		color: var(--muted-foreground);
		font-size: 10px;
		white-space: nowrap;
		padding-top: 3px;
	}
	.resident-result {
		padding: 17px 18px;
	}
	.resident-result > small {
		display: block;
		font-size: 11px;
		line-height: 1.5;
		color: var(--muted-foreground);
	}
	.resident-comparison {
		display: flex;
		align-items: baseline;
		gap: 9px;
		flex-wrap: wrap;
		margin-top: 8px;
		font-size: 26px;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.7px;
	}
	.resident-comparison > span {
		color: var(--muted-foreground);
	}
	.resident-comparison > strong {
		font-weight: 650;
	}
	.resident-comparison > small {
		flex-basis: 100%;
		margin-top: -6px;
		color: var(--muted-foreground);
		font-size: 10px;
		letter-spacing: 0;
	}
	.resident-change {
		margin: 12px 0 0;
		font-size: 12px;
	}
	.resident-change > strong {
		font-variant-numeric: tabular-nums;
	}
	.resident-change.gained {
		color: var(--theme-color-16866e);
	}
	.zero-note,
	.source-note,
	.no-service-change,
	.retained-note {
		font-size: 11px;
		line-height: 1.55;
		color: var(--muted-foreground);
	}
	.zero-note {
		margin: 7px 0 0;
	}
	.service-results {
		border-top: 1px solid var(--border);
	}
	.service-result {
		padding: 15px 18px;
	}
	.service-result + .service-result {
		border-top: 1px solid var(--border);
	}
	.service-title {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.service-title > :global(svg) {
		color: var(--theme-color-437c8b);
		flex-shrink: 0;
	}
	.service-title > div {
		min-width: 0;
		display: grid;
		gap: 3px;
	}
	.service-title strong {
		font-size: 13px;
		line-height: 1.4;
	}
	.service-title small {
		font-size: 10px;
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}
	dl {
		display: grid;
		gap: 9px;
		margin: 13px 0 0;
	}
	dl > div {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 14px;
	}
	dt {
		font-size: 11px;
		color: var(--muted-foreground);
	}
	dd {
		margin: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
		flex-wrap: wrap;
		text-align: right;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	dd > span {
		color: var(--muted-foreground);
	}
	dd strong {
		font-weight: 600;
	}
	dd > :global(svg),
	.resident-comparison > :global(svg) {
		flex-shrink: 0;
		color: var(--muted-foreground);
	}
	.source-note,
	.no-service-change {
		margin: 0;
		padding: 13px 18px;
		border-top: 1px solid var(--border);
	}
	.evidence {
		border-top: 1px solid var(--border);
		padding: 13px 18px;
		font-size: 11px;
	}
	.evidence summary {
		cursor: pointer;
		font-weight: 600;
		line-height: 1.5;
	}
	.evidence summary:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
		border-radius: 2px;
	}
	.evidence p {
		margin: 10px 0 0;
		line-height: 1.6;
		color: var(--muted-foreground);
	}
	.final-note {
		margin-bottom: 0;
		font-size: 10px;
	}
	.retained-note {
		margin: 0 0 14px;
	}
	[data-outdated='true'] .resident-comparison > strong,
	[data-outdated='true'] .resident-change {
		color: var(--muted-foreground);
	}
	.compact {
		padding: 16px;
		border-radius: 12px;
	}
	.compact h2 {
		font-size: 18px;
	}
	.compact .model-label {
		display: none;
	}
	.compact .section-note {
		font-size: 11px;
		margin-bottom: 12px;
	}
	.compact .island-grid {
		gap: 12px;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
	}
	.compact h3 {
		font-size: 15px;
	}
	.compact .island-result > header {
		padding: 12px;
	}
	.compact .resident-result,
	.compact .service-result {
		padding: 12px;
	}
	.compact .resident-comparison {
		font-size: 22px;
	}
	.compact .source-note,
	.compact .no-service-change {
		padding: 11px 12px;
	}
	.compact .final-note {
		margin-bottom: 0;
		font-size: 10px;
	}
	@media (max-width: 600px) {
		.island-impacts {
			padding: 16px;
		}
		h2 {
			font-size: 20px;
		}
		.model-label {
			display: none;
		}
	}
</style>
