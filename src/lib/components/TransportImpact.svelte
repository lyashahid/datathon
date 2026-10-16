<script lang="ts">
	import { ArrowRight, BusFront, Clock3, Ship } from '@lucide/svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import {
		bestTransportWaitChange,
		changedIslandConnections,
		changedTransportLines,
		comparableWaitSaving,
		formatImpactClock,
		formatImpactCount,
		formatImpactDate,
		formatImpactMinutes,
		impactNumber,
		serviceAvailability,
		serviceNextDeparture,
		serviceNextWait,
		serviceTravelTime,
		serviceWait,
		transportImpactHeadline,
		waitChangeText,
		type TransportImpactData
	} from '#lib/transport-impact.js';

	let {
		impact = null,
		compact = false,
		preview = false
	}: {
		impact?: TransportImpactData | null;
		compact?: boolean;
		preview?: boolean;
	} = $props();
	const lines = $derived(changedTransportLines(impact));
	const connections = $derived(changedIslandConnections(impact));
	const waitChange = $derived(bestTransportWaitChange(impact));
	const headline = $derived(transportImpactHeadline(impact));
	const addedConnections = $derived(connections.filter((row) => row.change === 'added').length);
	const removedConnections = $derived(connections.filter((row) => row.change === 'removed').length);
	const addedLine = $derived(lines.find((row) => row.change === 'added' && row.after));
	const selectedTime = $derived(
		impactNumber(impact?.departure_minutes) === null
			? null
			: formatImpactClock(impact?.departure_minutes)
	);
	const hasChanges = $derived(lines.length > 0 || connections.length > 0);
	function changeLabel(change: string) {
		return change === 'added'
			? 'New service'
			: change === 'removed'
				? 'Service removed'
				: change === 'improved'
					? 'Improved'
					: change === 'worsened'
						? 'Reduced'
						: 'Changed';
	}
</script>

{#if impact}
	<section
		class="transport-impact"
		class:compact
		aria-label="Transport service impact"
		data-preview={preview}
	>
		<header class="impact-heading">
			<h3><Clock3 size={16} /> Beyond walking access</h3>
			<Badge variant="outline">{preview ? 'Preview' : 'Timetable model'}</Badge>
		</header>
		<p class="impact-context">
			{formatImpactDate(impact.service_date)}{#if selectedTime}
				· timetable checked at {selectedTime}{/if}
		</p>
		{#if hasChanges}
			{#if !compact && headline}<p class="impact-headline">{headline}</p>{/if}
			<div class="impact-metrics">
				<div class="impact-metric">
					{#if waitChange}
						<small>Expected wait · {waitChange.line.name}</small>
						<strong class="metric-comparison">
							<span>{formatImpactMinutes(waitChange.line.before?.expected_wait_minutes)}</span>
							<ArrowRight size={14} aria-label="changes to" />
							<span>{formatImpactMinutes(waitChange.line.after?.expected_wait_minutes)}</span>
						</strong>
						<span class="metric-note" class:reduced={waitChange.saved < 0}>
							{waitChangeText(waitChange.saved)}
						</span>
					{:else if addedConnections || removedConnections}
						<small>Island-to-island connections</small>
						<strong
							>{addedConnections || removedConnections}
							{addedConnections ? 'new' : 'removed'}</strong
						>
						<span class="metric-note">One direction counted separately</span>
					{:else if addedLine}
						<small>Expected wait · {addedLine.name}</small>
						<strong>{serviceWait(addedLine.after)}</strong>
						<span class="metric-note">New service · no previous wait to compare</span>
					{:else}
						<small>Service changes</small>
						<strong>{lines.length}</strong>
						<span class="metric-note">Review the dated timetable below</span>
					{/if}
				</div>
				<div class="impact-metric">
					<small>Island service departures</small>
					<strong class="metric-comparison">
						<span>{formatImpactCount(impact.summary?.departures_before)}</span>
						<ArrowRight size={14} aria-label="changes to" />
						<span>{formatImpactCount(impact.summary?.departures_after)}</span>
					</strong>
					<span class="metric-note">Without → With · selected island and edited routes</span>
				</div>
			</div>
			<details class="impact-details" open={!compact}>
				<summary>Route and island connection details</summary>
				<div class="detail-content">
					{#each lines as line (line.id)}
						{@const saved = comparableWaitSaving(line)}
						<article class="service-row">
							<div class="service-heading">
								<div>
									{#if line.mode === 'ferry'}<Ship size={16} />{:else}<BusFront size={16} />{/if}
									<h4>{line.name}</h4>
								</div>
								<Badge
									variant={line.change === 'removed' || line.change === 'worsened'
										? 'destructive'
										: 'secondary'}>{changeLabel(line.change)}</Badge
								>
							</div>
							{#if line.from_stop_name && line.to_stop_name}
								<p class="service-route">{line.from_stop_name} → {line.to_stop_name}</p>
							{/if}
							<dl class="service-values">
								<div>
									<dt>Expected wait</dt>
									<dd>{serviceWait(line.before)} → {serviceWait(line.after)}</dd>
								</div>
								<div>
									<dt>Dated departures</dt>
									<dd>{serviceAvailability(line.before)} → {serviceAvailability(line.after)}</dd>
								</div>
								<div>
									<dt>
										Next departure{#if selectedTime}
											after {selectedTime}{/if}
									</dt>
									<dd>
										{serviceNextDeparture(line.before)} → {serviceNextDeparture(line.after)}
									</dd>
								</div>
								<div>
									<dt>Wait for that departure</dt>
									<dd>
										{serviceNextWait(line.before)} → {serviceNextWait(line.after)}
									</dd>
								</div>
								{#if impactNumber(line.before?.crossing_minutes) !== null || impactNumber(line.after?.crossing_minutes) !== null}
									<div>
										<dt>{line.mode === 'ferry' ? 'Sailing time' : 'In-vehicle time'}</dt>
										<dd>{serviceTravelTime(line.before)} → {serviceTravelTime(line.after)}</dd>
									</div>
								{/if}
							</dl>
							{#if saved !== null}
								<p class="service-benefit" class:reduced={saved < 0}>{waitChangeText(saved)}</p>
								{#if impactNumber(line.after?.expected_wait_window_start_minutes) !== null && impactNumber(line.after?.expected_wait_window_end_minutes) !== null}
									<p class="service-note">
										Compared over the same {formatImpactClock(
											line.after?.expected_wait_window_start_minutes
										)}–{formatImpactClock(line.after?.expected_wait_window_end_minutes)} operating window.
									</p>
								{/if}
							{:else if line.expected_wait_comparison_reason}
								<p class="service-note">{line.expected_wait_comparison_reason}</p>
							{/if}
						</article>
					{/each}
					{#if connections.length}
						<div class="connections-heading">
							<Ship size={15} />
							<h4>Island-to-island directions</h4>
						</div>
						<p class="service-note">
							Each direction is assessed separately. A scheduled link does not establish passenger
							capacity or infrastructure approval.
						</p>
						{#each connections as connection (connection.id)}
							{@const saved = comparableWaitSaving(connection)}
							<article class="service-row connection-row">
								<div class="service-heading">
									<h4>{connection.from_island_name} → {connection.to_island_name}</h4>
									<Badge
										variant={connection.change === 'removed' || connection.change === 'worsened'
											? 'destructive'
											: 'secondary'}
										>{connection.change === 'added'
											? 'New connection'
											: changeLabel(connection.change)}</Badge
									>
								</div>
								<dl class="service-values">
									<div>
										<dt>Scheduled availability</dt>
										<dd>
											{serviceAvailability(connection.before)} → {serviceAvailability(
												connection.after
											)}
										</dd>
									</div>
									<div>
										<dt>Expected wait</dt>
										<dd>{serviceWait(connection.before)} → {serviceWait(connection.after)}</dd>
									</div>
									<div>
										<dt>{connection.mode === 'ferry' ? 'Sailing time' : 'Travel time'}</dt>
										<dd>
											{serviceTravelTime(connection.before)} → {serviceTravelTime(connection.after)}
										</dd>
									</div>
									<div>
										<dt>
											Next departure{#if selectedTime}
												after {selectedTime}{/if}
										</dt>
										<dd>
											{serviceNextDeparture(connection.before)} → {serviceNextDeparture(
												connection.after
											)}
										</dd>
									</div>
								</dl>
								{#if saved !== null}<p class="service-benefit" class:reduced={saved < 0}>
										{waitChangeText(saved)}
									</p>{:else if connection.expected_wait_comparison_reason}<p class="service-note">
										{connection.expected_wait_comparison_reason}
									</p>{/if}
							</article>
						{/each}
					{/if}
				</div>
			</details>
		{:else}
			<p class="no-service-change">No bus or ferry timetable changes on this date.</p>
		{/if}
		<p class="impact-qualification">
			Based on available dated service records. These are timetable estimates, not observed
			passenger waits or ridership. Walking access is assessed separately.
		</p>
		{#if !compact && (impact.wait_method || impact.qualification)}
			<details class="method-details">
				<summary>How waiting and connections are assessed</summary>
				{#if impact.wait_method}<p>{impact.wait_method}</p>{/if}
				{#if impact.qualification}<p>{impact.qualification}</p>{/if}
			</details>
		{/if}
	</section>
{/if}

<style>
	.transport-impact {
		min-width: 0;
		border: 1px solid var(--border, #dce5df);
		border-radius: 16px;
		padding: 20px;
		background: var(--card, #fff);
		color: var(--foreground, #243a36);
	}
	.impact-heading,
	.service-heading,
	.service-heading > div,
	.connections-heading {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.impact-heading,
	.service-heading {
		justify-content: space-between;
	}
	.impact-heading h3,
	.service-heading h4,
	.connections-heading h4 {
		margin: 0;
		font-weight: 600;
	}
	.impact-heading h3 {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		line-height: 1.4;
	}
	.impact-heading :global([data-slot='badge']) {
		font-size: 10px;
	}
	.impact-context,
	.impact-qualification,
	.service-note,
	.metric-note,
	.service-route {
		color: var(--muted-foreground, #687a70);
		font-size: 11px;
		line-height: 1.5;
	}
	.impact-context {
		margin: 5px 0 14px;
	}
	.impact-headline {
		margin: 0 0 14px;
		color: #24664f;
		font-size: 15px;
		font-weight: 600;
	}
	.impact-metrics {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.impact-metric {
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 5px;
		padding: 13px;
		border-radius: 12px;
		background: #f3f7f2;
	}
	.impact-metric small {
		font-size: 11px;
		line-height: 1.45;
		color: #586e61;
		overflow-wrap: anywhere;
	}
	.impact-metric strong {
		font-size: 21px;
		line-height: 1.3;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.metric-comparison {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 7px;
	}
	.metric-comparison > span:first-child {
		color: #6d7971;
		font-weight: 400;
	}
	.metric-note {
		color: #326c53;
	}
	.reduced {
		color: #ad4b3d;
	}
	.impact-details {
		margin-top: 14px;
	}
	summary {
		cursor: pointer;
		font-size: 12px;
		font-weight: 500;
		line-height: 1.5;
		border-radius: 5px;
	}
	summary:focus-visible {
		outline: 2px solid #0d817b;
		outline-offset: 4px;
	}
	.detail-content {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 12px;
	}
	.service-row {
		min-width: 0;
		border-top: 1px solid var(--border, #dce5df);
		padding-top: 12px;
	}
	.service-heading {
		align-items: flex-start;
		gap: 10px;
	}
	.service-heading > div {
		min-width: 0;
		align-items: flex-start;
	}
	.service-heading :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
		color: #2d6b57;
	}
	.service-heading h4 {
		font-size: 13px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.service-heading :global([data-slot='badge']) {
		flex-shrink: 0;
		font-size: 10px;
	}
	.service-route {
		margin: 4px 0 9px;
	}
	.service-values {
		display: grid;
		gap: 8px;
		margin: 10px 0 0;
	}
	.service-values > div {
		display: grid;
		grid-template-columns: minmax(90px, 0.7fr) minmax(0, 1fr);
		align-items: baseline;
		gap: 10px;
	}
	dt {
		font-size: 11px;
		color: #6b7b70;
		line-height: 1.45;
	}
	dd {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	.service-benefit {
		margin: 10px 0 0;
		font-size: 12px;
		font-weight: 600;
		color: #287254;
	}
	.service-benefit.reduced {
		color: #ad4b3d;
	}
	.service-note {
		margin: 6px 0 0;
	}
	.connections-heading {
		margin-top: 7px;
		color: #2d6b57;
	}
	.connections-heading h4 {
		font-size: 12px;
	}
	.impact-qualification {
		margin: 14px 0 0;
	}
	.method-details {
		margin-top: 10px;
	}
	.method-details p {
		font-size: 11px;
		line-height: 1.6;
		color: #687a70;
		margin: 8px 0 0;
	}
	.no-service-change {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
	}
	.compact {
		padding: 13px;
		border-radius: 12px;
	}
	.compact .impact-heading h3 {
		font-size: 12px;
	}
	.compact .impact-metrics {
		gap: 8px;
	}
	.compact .impact-metric {
		padding: 10px;
		gap: 4px;
	}
	.compact .impact-metric strong {
		font-size: 16px;
	}
	.compact .impact-context,
	.compact .impact-qualification,
	.compact .metric-note {
		font-size: 10px;
	}
	.compact .service-values > div {
		grid-template-columns: 1fr;
		gap: 2px;
	}
	@media (max-width: 480px) {
		.transport-impact {
			padding: 14px;
		}
		.compact {
			padding: 12px;
		}
		.impact-heading {
			align-items: flex-start;
		}
		.impact-metric strong {
			font-size: 18px;
		}
		.service-values > div {
			grid-template-columns: 1fr;
			gap: 2px;
		}
	}
</style>
