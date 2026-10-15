<script lang="ts">
	import { downloadJson } from '#lib/download.js';
	import { onMount, tick, untrack } from 'svelte';
	import type {
		UpdateStatus,
		SourceCheck,
		StagedSchedule,
		NationalItinerary
	} from '#lib/source-updates.js';
	import type { IslandFeature } from '#lib/types.js';
	import { api, ApiError, subscribeApiInvalidation } from '#lib/api.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import {
		RefreshCw,
		FileUp,
		Clock3,
		Ship,
		ArrowRight,
		Download,
		ExternalLink,
		Database,
		Check
	} from '@lucide/svelte';

	let {
		mode = 'evidence',
		islandId = 'island:1443',
		active = true
	}: { mode?: 'evidence' | 'schedules'; islandId?: string; active?: boolean } = $props();
	let sourceData = $state.raw<UpdateStatus | null>(null);
	let islands = $state.raw<IslandFeature[]>([]);
	let busy = $state('');
	let mounted = $state(false);
	let needsRefresh = $state(false);
	let error = $state('');
	let fileInput = $state<HTMLInputElement>();
	let staged = $state.raw<StagedSchedule | null>(null);
	let reviewNote = $state('');
	let reviewed = $state(false);
	let origin = $derived(islandId);
	let destination = $state('');
	let dateTime = $state(new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 16));
	let transfer = $state(30);
	let includeAssumptions = $state(false);
	let journey = $state.raw<NationalItinerary | null>(null);
	let loadController: AbortController | undefined;
	let journeyController: AbortController | undefined;
	const catalogue = $derived(sourceData?.schedules);
	const receipts = $derived(sourceData?.latest_check?.items ?? []);
	const receiptsById = $derived(new Map(receipts.map((receipt) => [receipt.id, receipt])));
	const services = $derived(catalogue?.services ?? []);
	const scopedServices = $derived(
		services.filter((item) => item.from_island_id === origin || item.to_island_id === origin)
	);
	const calendarSources = $derived(
		new Map((catalogue?.sources ?? []).map((item) => [item.id, item]))
	);
	const humanize = (value: string) => value.replaceAll('_', ' ');
	const timeFormatter = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Indian/Maldives',
		dateStyle: 'medium',
		timeStyle: 'short'
	});
	const localTime = (value: string) => timeFormatter.format(new Date(value));
	const message = (cause: unknown) => {
		if (cause instanceof ApiError && cause.status === 422 && Array.isArray(cause.details)) {
			const details = cause.details as { loc?: (string | number)[]; type?: string; msg?: string }[];
			if (details.some((item) => item.loc?.includes('services') && item.type === 'too_short'))
				return 'Add at least one timed service before importing this template.';
			return details
				.slice(0, 3)
				.map(
					(item) =>
						`${item.loc?.slice(1).join(' › ') ?? 'Timetable'}: ${item.msg ?? 'Check this value.'}`
				)
				.join(' ');
		}
		return cause instanceof Error ? cause.message : 'Unable to complete this request.';
	};

	async function load() {
		needsRefresh = false;
		loadController?.abort();
		const request = new AbortController();
		loadController = request;
		busy = 'load';
		error = '';
		try {
			const result = await api<UpdateStatus>('data-updates', undefined, request.signal);
			if (request.signal.aborted) return;
			sourceData = result;
			if (mode === 'schedules') {
				const [first, second] = await Promise.all([
					api<{ items: IslandFeature[] }>('islands?limit=1000', undefined, request.signal),
					api<{ items: IslandFeature[] }>(
						'islands?limit=1000&offset=1000',
						undefined,
						request.signal
					)
				]);
				if (request.signal.aborted) return;
				islands = [...first.items, ...second.items]
					.filter((item) => item.properties.name)
					.sort((a, b) => String(a.properties.name).localeCompare(b.properties.name));
			}
		} catch (cause) {
			if (!request.signal.aborted) error = message(cause);
		} finally {
			if (loadController === request && busy === 'load') busy = '';
		}
	}
	onMount(() => {
		mounted = true;
		const unsubscribe = subscribeApiInvalidation(() => {
			journeyController?.abort();
			journey = null;
			if (busy === 'journey') busy = '';
			needsRefresh = true;
		});
		if (active) void load();
		else needsRefresh = true;
		return () => {
			unsubscribe();
			loadController?.abort();
			journeyController?.abort();
		};
	});
	$effect(() => {
		if (mounted && active && needsRefresh && !busy) untrack(() => void load());
	});
	const journeyInputs = $derived(
		JSON.stringify([origin, destination, dateTime, transfer, includeAssumptions])
	);
	$effect(() => {
		void journeyInputs;
		untrack(() => {
			journeyController?.abort();
			journey = null;
			if (busy === 'journey') busy = '';
		});
	});

	async function checkSources() {
		busy = 'check';
		error = '';
		try {
			const result = await api<SourceCheck>('data-updates/check', {});
			if (sourceData) sourceData = { ...sourceData, latest_check: result };
		} catch (cause) {
			error = message(cause);
		} finally {
			busy = '';
		}
	}
	async function upload(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		busy = 'stage';
		error = '';
		staged = null;
		reviewed = false;
		reviewNote = '';
		try {
			if (file.size > 2000000) throw new Error('Timetable JSON must be smaller than 2 MB.');
			staged = await api<StagedSchedule>(
				'data-updates/schedules/stage',
				JSON.parse(await file.text())
			);
		} catch (cause) {
			error = message(cause);
		} finally {
			busy = '';
			if (fileInput) fileInput.value = '';
		}
	}
	async function accept() {
		if (!staged || !reviewed) return;
		busy = 'accept';
		error = '';
		try {
			await api(`data-updates/schedules/${staged.id}/accept`, {
				reviewed: true,
				review_note: reviewNote
			});
			staged = null;
			journey = null;
			await load();
		} catch (cause) {
			error = message(cause);
		} finally {
			busy = '';
		}
	}
	async function findJourney() {
		await tick();
		journeyController?.abort();
		const request = new AbortController();
		journeyController = request;
		const signature = journeyInputs;
		const parameters = {
			from_island_id: origin,
			to_island_id: destination,
			departure_at: dateTime + ':00+05:00',
			transfer_minutes: Number(transfer),
			include_assumed_runtimes: includeAssumptions
		};
		busy = 'journey';
		error = '';
		journey = null;
		try {
			const result = await api<NationalItinerary>(
				'data-updates/schedules/journey',
				parameters,
				request.signal
			);
			if (!request.signal.aborted && signature === journeyInputs) journey = result;
		} catch (cause) {
			if (!request.signal.aborted) error = message(cause);
		} finally {
			if (journeyController === request && busy === 'journey') busy = '';
		}
	}
	function template() {
		const content = {
			schema_version: 1,
			title: 'Enter operator timetable title',
			timezone: 'Indian/Maldives',
			sources: [
				{
					publisher: 'Enter official publisher',
					url: 'https://rtl.mv/',
					retrieved_at: new Date().toISOString(),
					reference_period: 'Enter dated service validity',
					licence_note: 'Record publisher reuse terms and attribution'
				}
			],
			services: [],
			limitations: [
				'Fill services using the documented schedule contract; do not infer arrivals from opposite-direction departures.'
			]
		};
		downloadJson(content, 'national-timetable-template.json');
	}
</script>

<section
	class:standalone={mode === 'schedules'}
	class="source-updates"
	aria-label={mode === 'schedules' ? 'Nationwide timetables' : 'Official source updates'}
>
	<div class="heading">
		<div>
			<span class="eyebrow"
				>{mode === 'schedules' ? 'CONNECTING ISLANDS' : 'KEEP THE EVIDENCE CURRENT'}</span
			>
			<h2>{mode === 'schedules' ? 'Nationwide timetables' : 'Official source updates'}</h2>
			<p>
				{mode === 'schedules'
					? 'Explore published calendars and build dated itineraries from reviewed operator schedules.'
					: 'Check publisher releases and document changes before they enter a planning model.'}
			</p>
		</div>
		<Button variant="outline" disabled={!!busy} onclick={checkSources}
			><RefreshCw size={15} />{busy === 'check'
				? 'Checking publishers…'
				: 'Check official sources'}</Button
		>
	</div>
	{#if error}<div role="alert" class="error">{error}</div>{/if}
	{#if busy === 'load'}<p class="empty" role="status">Loading source receipts…</p>{/if}
	{#if mode === 'evidence'}
		<div class="receipts">
			{#each sourceData?.sources ?? [] as source (source.id)}
				{@const receipt = receiptsById.get(source.id)}
				<Card.Root class="receipt"
					><div>
						<Database size={16} /><a href={source.url} target="_blank" rel="noreferrer"
							>{source.title}<ExternalLink size={12} /></a
						>
					</div>
					<span class="status" class:known={receipt && receipt.status !== 'unavailable'}
						>{receipt ? humanize(receipt.status) : 'Not checked this session'}</span
					>{#if receipt?.latest_published_month}<p>
							Latest published month: <strong>{receipt.latest_published_month}</strong>
						</p>{/if}{#if receipt?.http_status}<p>
							Publisher HTTP {receipt.http_status}
						</p>{/if}{#if receipt?.sha256}<details>
							<summary>Source receipt</summary><code>{receipt.sha256}</code>
							<p>{receipt.bytes.toLocaleString()} bytes · {localTime(receipt.retrieved_at)} MVT</p>
						</details>{/if}{#if receipt?.qualification}<p>
							{receipt.qualification}
						</p>{/if}</Card.Root
				>
			{/each}
		</div>
		<p class="qualification">
			{sourceData?.latest_check
				? 'Checked ' + localTime(sourceData.latest_check.checked_at) + ' MVT. '
				: ''}Source checks archive receipts and preserve the current baseline. Passenger updates can
			be reviewed in Passenger outlook; cost and energy evidence can be calibrated in proposal
			Delivery.
		</p>
	{:else}
		<div class="schedule-summary">
			<div>
				<strong>{catalogue?.published_calendars?.length ?? 0}</strong><span
					>Published departure calendars</span
				>
			</div>
			<div><strong>{services.length}</strong><span>Reviewed timed services</span></div>
			<div>
				<strong>{catalogue?.snapshots?.filter((item) => item.accepted).length ?? 0}</strong><span
					>Accepted source snapshots</span
				>
			</div>
		</div>
		<div class="schedule-grid">
			<Card.Root class="journey-card"
				><div class="card-heading">
					<Clock3 size={18} />
					<h3>Plan an island connection</h3>
				</div>
				<p class="qualification">
					Times use Maldives time (UTC+5). Only dated services with reviewed arrivals enter the
					planner.
				</p>
				<div class="fields">
					<div>
						<Label for="national-from">From island</Label><NativeSelect.Root
							id="national-from"
							bind:value={origin}
							>{#each islands as island (island.properties.id)}<NativeSelect.Option
									value={island.properties.id}
									>{island.properties.name} · {island.properties.atoll ??
										'Maldives'}</NativeSelect.Option
								>{/each}</NativeSelect.Root
						>
					</div>
					<div>
						<Label for="national-to">To island</Label><NativeSelect.Root
							id="national-to"
							bind:value={destination}
							><NativeSelect.Option value="">Choose a destination</NativeSelect.Option
							>{#each islands as island (island.properties.id)}<NativeSelect.Option
									value={island.properties.id}
									>{island.properties.name} · {island.properties.atoll ??
										'Maldives'}</NativeSelect.Option
								>{/each}</NativeSelect.Root
						>
					</div>
					<div>
						<Label for="national-departure">Leave after · MVT</Label><Input
							id="national-departure"
							type="datetime-local"
							bind:value={dateTime}
						/>
					</div>
					<div>
						<Label for="national-transfer">Transfer allowance · minutes</Label><Input
							id="national-transfer"
							type="number"
							min="0"
							max="240"
							bind:value={transfer}
						/>
					</div>
				</div>
				<label class="check-row"
					><input type="checkbox" bind:checked={includeAssumptions} /> Include explicitly assumed crossing
					runtimes</label
				><Button
					disabled={!!busy ||
						!services.length ||
						!destination ||
						origin === destination ||
						!dateTime}
					onclick={findJourney}
					>{busy === 'journey' ? 'Finding itinerary…' : 'Find a dated itinerary'}<ArrowRight
						size={15}
					/></Button
				>
				{#if !services.length}<p class="empty">
						No reviewed timed services have been imported. The published calendars below show
						departures; their opposite-direction columns do not establish arrival times.
					</p>{/if}
				{#if journey}<div class="itinerary" aria-live="polite">
						<h4>
							{journey.status === 'found'
								? 'Arrival ' + localTime(journey.arrival_at) + ' MVT'
								: 'No verified itinerary'}
						</h4>
						<p>{journey.qualification}</p>
						{#each journey.legs as leg (leg.id + leg.departure_at)}<div class="journey-leg">
								<Ship size={16} />
								<div>
									<strong>{leg.name}</strong><span>{leg.from_terminal} → {leg.to_terminal}</span
									><span>{localTime(leg.departure_at)} → {localTime(leg.arrival_at)} MVT</span
									><small
										>{humanize(leg.timing_basis)} ·
										<a href={leg.source.url} target="_blank" rel="noreferrer">Source</a></small
									>
								</div>
							</div>{/each}
					</div>{/if}
			</Card.Root>
			<Card.Root class="import-card"
				><div class="card-heading">
					<FileUp size={18} />
					<h3>Bring an operator timetable</h3>
				</div>
				<p>
					Import departures, arrivals, weekdays and validity dates linked to OneMap island IDs.
					Review the source and assumptions before accepting it.
				</p>
				<div class="actions">
					<Button variant="outline" disabled={!!busy} onclick={() => fileInput?.click()}
						><FileUp size={15} />Review timetable JSON</Button
					><Button variant="ghost" onclick={template}><Download size={15} />Blank template</Button>
				</div>
				<input
					class="file-input"
					type="file"
					accept=".json,application/json"
					bind:this={fileInput}
					onchange={upload}
				/>
				<p class="qualification">
					Original source files stay preserved. Accepted snapshots remain versioned locally; a newer
					snapshot replaces matching service IDs without erasing its predecessor.
				</p>
				{#if staged}<div class="review">
						<h4>{staged.snapshot.title}</h4>
						<p>
							{staged.review.services} services · {staged.review.islands} islands · {staged.review
								.assumed_runtimes} assumed runtimes
						</p>
						{#if staged.review.replaces_service_ids.length}<p>
								Replaces {staged.review.replaces_service_ids.length} existing service IDs.
							</p>{/if}
						<p>{staged.qualification}</p>
						<Label for="schedule-review-note">Review note</Label><Input
							id="schedule-review-note"
							placeholder="How you checked the source, validity and arrivals"
							bind:value={reviewNote}
						/><label class="check-row"
							><input type="checkbox" bind:checked={reviewed} /> I checked the source, dates and timing
							assumptions.</label
						><Button
							disabled={!!busy || !reviewed || reviewNote.trim().length < 10 || staged.accepted}
							onclick={accept}
							><Check size={15} />{staged.accepted
								? 'Already accepted'
								: 'Accept reviewed timetable'}</Button
						>
					</div>{/if}
				{#each catalogue?.snapshots ?? [] as snapshot (snapshot.id)}<div class="snapshot">
						<strong>{snapshot.title}</strong><span
							>{snapshot.accepted ? 'Accepted' : 'Awaiting review'} · {snapshot.review.services} services</span
						>{#if snapshot.review_note}<small>{snapshot.review_note}</small>{/if}
					</div>{/each}
			</Card.Root>
		</div>
		{#if scopedServices.length}<Card.Root class="calendar-card"
				><h3>Reviewed services touching this island</h3>
				<div class="table-scroll">
					<table>
						<thead
							><tr
								><th>Route</th><th>Depart → arrive</th><th>Validity</th><th>Timing evidence</th></tr
							></thead
						><tbody
							>{#each scopedServices as service (service.id)}<tr
									><td>{service.name}<small>{service.from_name} → {service.to_name}</small></td><td
										>{service.departure.slice(0, 5)} → {service.arrival?.slice(0, 5) ??
											service.runtime_minutes + ' min assumed'}</td
									><td>{service.effective_from} to {service.effective_until}</td><td
										>{humanize(service.timing_basis)}</td
									></tr
								>{/each}</tbody
						>
					</table>
				</div></Card.Root
			>{/if}
		<div class="calendar-heading">
			<h3>Published ferry departure calendars</h3>
			<p>Preserved official evidence, with the boundaries of what each document establishes.</p>
		</div>
		<div class="calendars">
			{#each catalogue?.published_calendars ?? [] as calendar (calendar.id)}{@const source =
					calendarSources.get(calendar.sourceId)}<Card.Root class="calendar-card"
					><div class="card-heading">
						<Ship size={18} />
						<h3>
							Malé ↔ {calendar.route === 'vilimale'
								? 'Vilimalé'
								: calendar.route === 'hulhumale'
									? 'Hulhumalé'
									: humanize(calendar.route)}
						</h3>
					</div>
					<span class="status"
						>{calendar.effectiveFrom
							? 'Effective ' + calendar.effectiveFrom
							: 'Historical · confirm validity'}</span
					>{#if source}<a class="source-link" href={source.url} target="_blank" rel="noreferrer"
							>Official operator document<ExternalLink size={12} /></a
						>{/if}{#each calendar.dayTypes as dayType (dayType.label)}<details>
							<summary>{dayType.label}</summary>{#if dayType.noScheduledService}<p>
									No scheduled service printed for this day type.
								</p>{:else if dayType.frequencyWindows}<div class="table-scroll">
									<table>
										<thead><tr><th>Local window</th><th>Frequency</th></tr></thead><tbody
											>{#each dayType.frequencyWindows as window (window.start + window.end)}<tr
													><td>{window.start}–{window.end}</td><td
														>Every {window.headwayMinutes} min</td
													></tr
												>{/each}</tbody
										>
									</table>
								</div>
								{#each dayType.noServiceWindows ?? [] as window (window.start)}<p>
										{window.start}–{window.end}: {window.reason}
									</p>{/each}{:else}<p>
									<strong>From Malé:</strong>
									{(dayType.departuresFromMale ?? []).join(' · ')}
								</p>
								<p>
									<strong>From island:</strong>
									{(dayType.departuresFromIsland ?? []).join(' · ')}
								</p>{/if}
						</details>{/each}
					<p class="qualification">{calendar.limitations.join(' ')}</p></Card.Root
				>{/each}
		</div>
	{/if}
</section>

<style>
	.source-updates {
		min-width: 0;
		margin-top: 36px;
	}
	.standalone {
		max-width: 1500px;
		margin: auto;
		padding: 32px clamp(16px, 4vw, 58px) 64px;
	}
	.heading {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 20px;
		margin-bottom: 24px;
	}
	.heading h2 {
		font-size: clamp(23px, 3vw, 34px);
		letter-spacing: -1px;
		font-weight: 520;
	}
	.heading p,
	.calendar-heading p {
		color: #747183;
		font-size: 12px;
		max-width: 650px;
		margin-top: 10px;
		line-height: 1.7;
	}
	.eyebrow {
		color: #827299;
		font-size: 9px;
		letter-spacing: 1.5px;
	}
	.receipts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	.source-updates :global(.receipt),
	.source-updates :global(.calendar-card),
	.source-updates :global(.journey-card),
	.source-updates :global(.import-card) {
		min-width: 0;
		padding: 22px;
		gap: 15px;
		box-shadow: none;
	}
	.source-updates :global(.receipt > div),
	.card-heading {
		display: flex;
		gap: 10px;
		align-items: center;
		color: #5e7b69;
	}
	.source-updates :global(.receipt a),
	.source-link {
		display: inline-flex;
		gap: 6px;
		align-items: center;
		font-size: 12px;
		color: #526e62;
	}
	.source-updates :global(.receipt p),
	.source-updates :global(.import-card > p),
	.itinerary p,
	.review p,
	details p {
		font-size: 11px;
		line-height: 1.8;
		color: #767582;
	}
	.status {
		align-self: flex-start;
		font-size: 10px;
		padding: 6px 9px;
		border-radius: 6px;
		background: #f1edf7;
		color: #7c668f;
	}
	.status.known {
		background: #edf4e8;
		color: #557447;
	}
	details {
		border-top: 1px solid #edeaf1;
		padding-top: 12px;
		font-size: 11px;
	}
	summary {
		cursor: pointer;
		color: #71687e;
	}
	code {
		font-size: 9px;
		overflow-wrap: anywhere;
		display: block;
		margin-top: 10px;
	}
	.qualification {
		font-size: 11px;
		line-height: 1.8;
		color: #898494;
		margin-top: 15px;
	}
	.schedule-summary {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
		background: #ebe6f4;
		padding: 22px 26px;
		border-radius: 16px;
		margin-bottom: 24px;
	}
	.schedule-summary strong {
		font-size: 30px;
		font-weight: 500;
		color: #75628e;
		display: block;
	}
	.schedule-summary span {
		font-size: 11px;
		color: #81718d;
		display: block;
		margin-top: 5px;
	}
	.schedule-grid,
	.calendars {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 20px;
	}
	h3 {
		font-size: 16px;
		letter-spacing: -0.3px;
		font-weight: 550;
	}
	h4 {
		font-size: 13px;
		font-weight: 600;
	}
	.fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
	}
	.fields > div {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.check-row {
		display: flex;
		gap: 9px;
		align-items: flex-start;
		font-size: 11px;
		line-height: 1.7;
		color: #716f7d;
	}
	.check-row input {
		accent-color: #7d6797;
		margin-top: 3px;
	}
	.empty {
		background: #f5f2f9;
		color: #80718e;
		padding: 15px;
		border-radius: 10px;
		font-size: 11px;
		line-height: 1.9;
	}
	.error {
		background: #fbebea;
		color: #a94a46;
		padding: 15px;
		border-radius: 10px;
		margin: 15px 0;
		font-size: 12px;
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.file-input {
		display: none;
	}
	.review,
	.itinerary {
		display: flex;
		flex-direction: column;
		gap: 12px;
		background: #f4f1f8;
		padding: 18px;
		border-radius: 12px;
	}
	.snapshot {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding-top: 14px;
		border-top: 1px solid #eae6f0;
		font-size: 11px;
	}
	.snapshot span,
	.snapshot small {
		color: #857b91;
	}
	.journey-leg {
		display: flex;
		gap: 12px;
		padding-top: 12px;
		border-top: 1px solid #e1dce9;
	}
	.journey-leg div {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 11px;
	}
	.journey-leg small {
		color: #84798f;
	}
	.calendar-heading {
		margin: 32px 0 20px;
	}
	.table-scroll {
		max-width: 100%;
		overflow-x: auto;
	}
	table {
		width: 100%;
		font-size: 11px;
		border-collapse: collapse;
	}
	th,
	td {
		padding: 10px;
		text-align: left;
		border-bottom: 1px solid #eeebf3;
	}
	th {
		font-weight: 500;
		color: #8b8296;
		white-space: nowrap;
	}
	td small {
		display: block;
		color: #8b8296;
		margin-top: 4px;
	}
	@media (max-width: 850px) {
		.receipts {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.schedule-grid {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 560px) {
		.heading {
			flex-direction: column;
			gap: 14px;
		}
		.receipts,
		.calendars,
		.fields {
			grid-template-columns: 1fr;
		}
		.schedule-summary {
			gap: 12px;
			padding: 18px;
		}
		.schedule-summary strong {
			font-size: 24px;
		}
		.schedule-summary span {
			font-size: 10px;
		}
		.source-updates :global(.receipt),
		.source-updates :global(.calendar-card),
		.source-updates :global(.journey-card),
		.source-updates :global(.import-card) {
			padding: 18px;
		}
	}
</style>
