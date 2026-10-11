<script lang="ts">
	import { X, CloudRain, Route, ExternalLink, Trash2, MapPin } from '@lucide/svelte';
	import type {
		OperationsBundle,
		OperationalRoadEvent,
		OperationalNoticeCandidate
	} from '#lib/operations/types.ts';
	import { activeWeatherAlerts } from '#lib/operations/lifecycle.ts';
	import { maldivesDateTime } from '#lib/operations/time.ts';
	import type {
		PlanningAnalysis,
		PlanningAssumptions,
		PlanningBaseline,
		PlanningDisruption
	} from '#lib/planning/types.ts';
	import DiscreteTabs from './controls/DiscreteTabs.svelte';
	import RobustnessPanel from './RobustnessPanel.svelte';
	import NationalCoverageInset from './NationalCoverageInset.svelte';
	import { money, number } from './atlasData.ts';
	let {
		baseline,
		bundle,
		assumptions,
		analysis,
		selectedEdges,
		picking,
		onpick,
		onclear,
		onchange,
		onclose
	}: {
		baseline: PlanningBaseline;
		bundle: OperationsBundle | null;
		assumptions: PlanningAssumptions;
		analysis: PlanningAnalysis | null;
		selectedEdges: string[];
		picking: boolean;
		onpick: () => void;
		onclear: () => void;
		onchange: (patch: Partial<PlanningAssumptions>) => void;
		onclose: () => void;
	} = $props();
	let kind = $state<'closure' | 'delay'>('delay');
	let name = $state('Road delay scenario');
	let delay = $state(5);
	let mode = $state('bus');
	let direction = $state<'both' | 'forward' | 'reverse'>('both');
	// svelte-ignore state_referenced_locally
	let date = $state(assumptions.date);
	// svelte-ignore state_referenced_locally
	let endDate = $state(assumptions.date);
	// svelte-ignore state_referenced_locally
	let start = $state(clock(assumptions.departureMinutes));
	let end = $state('23:59');
	let source = $state<OperationalRoadEvent | null>(null);
	let error = $state('');
	let noticeUrl = $state('');
	let noticeText = $state('');
	let noticeBusy = $state(false);
	let noticeError = $state('');
	let importedNotices = $state.raw<OperationalNoticeCandidate[]>([]);
	const notices = $derived([
		...new Map(
			[...importedNotices, ...(bundle?.roadEvents ?? []), ...(bundle?.noticeCandidates ?? [])].map(
				(event) => [event.id, event]
			)
		).values()
	]);
	const selectedLength = $derived(
		baseline.network.edges
			.filter((e) => selectedEdges.includes(e.id))
			.reduce((s, e) => s + e.distanceM, 0)
	);
	const at = $derived(
		Date.parse(`${assumptions.date}T00:00:00+05:00`) + assumptions.departureMinutes * 60000
	);
	const weather = $derived(bundle ? activeWeatherAlerts(bundle, at) : []);
	async function extractNotice() {
		noticeBusy = true;
		noticeError = '';
		try {
			const response = await fetch('/api/operations/notices', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					sourceUrl: noticeUrl,
					...(noticeText.trim() ? { text: noticeText.trim() } : {})
				})
			});
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error ?? 'Source could not be read.');
			const candidate = payload.candidate;
			if (!candidate?.id) throw new Error('No valid source-linked candidate returned.');
			importedNotices = [candidate, ...importedNotices.filter((e) => e.id !== candidate.id)];
			noticeText = '';
		} catch (e) {
			noticeError = String(e instanceof Error ? e.message : e);
		} finally {
			noticeBusy = false;
		}
	}
	function clock(n: number) {
		return `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(Math.round(n % 60)).padStart(2, '0')}`;
	}
	function minutes(v: string) {
		const [h, m] = v.split(':').map(Number);
		return h * 60 + m;
	}
	function interval() {
		const s = minutes(start),
			e = minutes(end);
		return { startDate: date, endDate, startMinutes: s, endMinutes: e };
	}
	function changeStartDate(value: string) {
		if (endDate === date || endDate < value) endDate = value;
		date = value;
	}
	function makeEvent(eventKind: 'closure' | 'delay', id: string): PlanningDisruption {
		return {
			id,
			name: name.trim(),
			kind: eventKind,
			edgeIds: [...selectedEdges],
			modes: mode === 'both' ? ['bus', 'walk'] : mode === 'walk' ? ['walk'] : ['bus'],
			direction,
			...interval(),
			...(eventKind === 'delay' ? { delayMinutes: delay } : {}),
			provenance: 'assumed',
			enabled: true,
			...(source
				? {
						sourceIds: [source.sourceId],
						sourceUrl: source.sourceUrl,
						evidenceNote: `Mapped scenario from: ${source.title}. ${source.qualification}`
					}
				: {})
		};
	}
	function validate() {
		const from = Date.parse(`${date}T${start}:00+05:00`),
			until = Date.parse(`${endDate}T${end}:00+05:00`);
		error = !name.trim()
			? 'Give this scenario a name.'
			: !selectedEdges.length
				? 'Select at least one road segment on the map.'
				: !Number.isFinite(from) || !Number.isFinite(until) || until <= from
					? 'Choose a valid MVT interval ending after it starts.'
					: until - from > 366 * 24 * 60 * 60 * 1000
						? 'Keep a temporary disruption within 366 days.'
						: kind === 'delay' && (!Number.isFinite(delay) || delay <= 0 || delay > 120)
							? 'Use a delay from 1 to 120 minutes.'
							: '';
		return !error;
	}
	function apply() {
		if (!validate()) return;
		onchange({
			disruptions: [...(assumptions.disruptions ?? []), makeEvent(kind, `road-${Date.now()}`)]
		});
		onclear();
		if (picking) onpick();
		error = '';
	}
	function loadNotice(event: OperationalRoadEvent) {
		source = event;
		name = event.title;
		kind = 'closure';
		const from = event.validFrom ? maldivesDateTime(event.validFrom) : null;
		const until = event.validUntil ? maldivesDateTime(event.validUntil) : null;
		if (from) {
			date = from.date;
			start = from.time;
			endDate = from.date;
		}
		if (until) {
			endDate = until.date;
			end = until.time;
		}
		if (!picking) onpick();
	}
	function stressTest() {
		if (!validate()) return;
		const delayed = makeEvent('delay', 'stress-delay');
		delayed.delayMinutes = 5;
		delayed.modes = ['bus'];
		const blocked = makeEvent('closure', 'stress-closure');
		onchange({
			robustnessStresses: [
				{ id: 'delay', name: '5-minute road delay', disruptions: [delayed] },
				{ id: 'closure', name: 'Selected road closed', disruptions: [blocked] }
			]
		});
	}
</script>

<div class="operations-panel">
	<div class="heading">
		<div>
			<span class="eyebrow">TEST NETWORK RESILIENCE</span>
			<h2>What if this road changes?</h2>
		</div>
		<button class="icon" aria-label="Close disruption tools" onclick={onclose}
			><X size={19} /></button
		>
	</div>
	<p class="intro">
		Select roads, apply a closure or delay, and see who can still reach essential services.
	</p>
	<button class="pick" class:active={picking} onclick={onpick}
		><MapPin size={17} />{picking ? 'Selecting roads · tap segments' : 'Select roads on the map'}<b
			>{selectedEdges.length}</b
		></button
	>
	{#if selectedEdges.length}<div class="selection">
			<span>{number(selectedLength)} m selected</span><button onclick={onclear}>Clear</button>
		</div>{/if}
	<DiscreteTabs
		label="Road change"
		items={[
			{ id: 'delay', label: 'Delay' },
			{ id: 'closure', label: 'Close road' }
		]}
		value={kind}
		onchange={(v) => {
			kind = v as typeof kind;
			name = kind === 'delay' ? 'Road delay scenario' : 'Road closure scenario';
			if (kind === 'delay') mode = 'bus';
		}}
	/>
	<div class="fields">
		<label>Scenario name<input bind:value={name} maxlength="100" /></label>
		{#if kind === 'delay'}<label
				>Added minutes per selected segment<input
					type="number"
					min="1"
					max="120"
					bind:value={delay}
				/></label
			>{/if}
	</div>
	<details>
		<summary>Timing & permitted modes</summary>
		<div class="fields">
			<div class="two">
				<label
					>Starts on<input
						type="date"
						value={date}
						oninput={(event) => changeStartDate(event.currentTarget.value)}
					/></label
				><label>Ends on<input type="date" min={date} bind:value={endDate} /></label>
			</div>
			<div class="two">
				<label>Starts (MVT)<input type="time" bind:value={start} /></label><label
					>Ends (MVT)<input type="time" bind:value={end} /></label
				>
			</div>
		</div>
		<DiscreteTabs
			label="Affected travelers"
			items={kind === 'delay'
				? [{ id: 'bus', label: 'Buses' }]
				: [
						{ id: 'bus', label: 'Buses' },
						{ id: 'walk', label: 'Walking' },
						{ id: 'both', label: 'Both' }
					]}
			value={mode}
			onchange={(v) => (mode = v)}
		/>
		<p class="hint">
			A delay applies to each selected segment. Select a single segment to model one bottleneck.
		</p>
		<DiscreteTabs
			label="Road direction"
			items={[
				{ id: 'both', label: 'Both directions' },
				{ id: 'forward', label: 'From → to' },
				{ id: 'reverse', label: 'To → from' }
			]}
			value={direction}
			onchange={(v) => (direction = v as typeof direction)}
		/>
		<p class="hint">
			Arrows on selected roads show their stored direction. Existing one-way restrictions still
			apply.
		</p>
	</details>
	{#if source}<p class="source">
			Scenario assumption mapped from <a href={source.sourceUrl} target="_blank" rel="noreferrer"
				>{source.title} <ExternalLink size={11} /></a
			>. Confirm the selected extent and time.
			<button onclick={() => (source = null)}>Unlink</button>
		</p>{/if}
	<button class="primary" disabled={!selectedEdges.length} onclick={apply}
		>Apply & recalculate</button
	>
	{#if error}<p role="alert" class="error">{error}</p>{/if}
	<details>
		<summary>Fleet response</summary><DiscreteTabs
			label="Fleet response"
			items={[
				{ id: 'maintain-frequency', label: 'Keep frequency' },
				{ id: 'fixed-fleet', label: 'Keep fleet size' }
			]}
			value={assumptions.fleetResponse ?? 'maintain-frequency'}
			onchange={(v) => onchange({ fleetResponse: v as PlanningAssumptions['fleetResponse'] })}
		/>
		<p class="hint">
			Keeping frequency may require extra vehicles. Keeping fleet size may increase waiting times.
		</p>
	</details>
	{#if analysis?.disruptionImpact && (analysis.disruptionImpact.activeEventIds.length || analysis.disruptionImpact.affectedPatternIds.length || analysis.disruptionImpact.lostAccessResidents > 0 || analysis.disruptionImpact.worsenedJourneyResidents > 0)}<section
			class="impact"
		>
			<h3>Effect on journeys starting at the selected time</h3>
			<p>
				<b>{number(analysis.disruptionImpact.lostAccessResidents)}</b> lose access ·
				<b>{number(analysis.disruptionImpact.worsenedJourneyResidents)}</b> have a slower journey
			</p>
			{#each analysis.disruptionImpact.fleetFeedback as f (f.routeId)}<details>
					<summary>{f.name}</summary>
					<dl>
						<div>
							<dt>Cycle time</dt>
							<dd>{number(f.baselineCycleMinutes)} → {number(f.scenarioCycleMinutes)} min</dd>
						</div>
						<div>
							<dt>Active vehicles</dt>
							<dd>{number(f.requiredFleet)}</dd>
						</div>
						<div>
							<dt>Including reserve</dt>
							<dd>{number(f.requiredProcurementFleet)}</dd>
						</div>
						<div>
							<dt>Additional fleet investment</dt>
							<dd>{money(f.additionalCapitalMvr?.central)}</dd>
						</div>
						<div>
							<dt>Event operations</dt>
							<dd>{money(f.eventOperatingMvr?.central)}</dd>
						</div>
						<div>
							<dt>Transit emissions change</dt>
							<dd>
								{f.eventCarbonKgCo2e
									? `${number(f.eventCarbonKgCo2e.central, 1)} kg CO₂e`
									: 'Unavailable'}
							</dd>
						</div>
						{#if f.eventCarbonKgCo2e}<div>
								<dt>Assumption range</dt>
								<dd>
									{number(f.eventCarbonKgCo2e.low, 1)}–{number(f.eventCarbonKgCo2e.high, 1)} kg
								</dd>
							</div>{/if}
					</dl>
					{#each f.unavailableReasons as reason (reason)}<p class="hint">
							{reason}
						</p>{/each}{#if !f.eventCarbonKgCo2e && !f.unavailableReasons.some( (reason) => /emissions|idle-energy|service activity/i.test(reason) )}<p
							class="hint"
						>
							Event service activity or emissions inputs are unavailable; no private-trip
							displacement is inferred.
						</p>{/if}
				</details>{/each}
			<p class="hint">
				Temporary event costs and transit emissions are separate from annual investment operations.
				No private-trip displacement is assumed.
			</p>
		</section>{/if}
	{#if assumptions.disruptions?.length}<details open>
			<summary>Applied scenarios · {assumptions.disruptions.length}</summary
			>{#each assumptions.disruptions as event (event.id)}<div class="event">
					<span
						><b>{event.name}</b><small
							>{event.kind} · {event.edgeIds.length} segments · {event.startDate}
							{clock(event.startMinutes)}–{event.endDate !== event.startDate
								? `${event.endDate} `
								: ''}{clock(event.endMinutes)} MVT · assumed</small
						></span
					><button
						class="icon"
						aria-label={`Remove ${event.name}`}
						onclick={() =>
							onchange({ disruptions: assumptions.disruptions?.filter((e) => e.id !== event.id) })}
						><Trash2 size={16} /></button
					>
				</div>{/each}
		</details>{/if}
	<details>
		<summary>Compare normal & stressed conditions</summary>
		<p class="hint">
			Test the same investment under normal conditions, a five-minute delay and a closure on your
			selected roads. These are stress scenarios, not forecasts.
		</p>
		<button class="pick" disabled={!selectedEdges.length} onclick={stressTest}
			>Stress-test this proposal</button
		>{#if assumptions.robustnessStresses?.length}<button
				class="link"
				onclick={() => onchange({ robustnessStresses: [] })}>Clear stress tests</button
			>{/if}
	</details>
	<details>
		<summary><CloudRain size={15} /> Weather at the planning time · {weather.length}</summary>
		<p class="hint">
			Public MMS alerts. Weather exposure does not prove that a road or ferry is closed.
		</p>
		{#each weather as alert (alert.id)}<article class="source-card">
				<b>{alert.headline || alert.event}</b>
				<p>{alert.areaLabel} · {alert.severity}</p>
				<p>{alert.validFrom} to {alert.validUntil}</p>
				<a href={alert.sourceUrl} target="_blank" rel="noreferrer"
					>Publisher alert <ExternalLink size={11} /></a
				>
			</article>{:else}<p class="hint">
				No applicable alert found in this cached feed. Coverage is limited to retrieved alerts.
			</p>{/each}
	</details>
	<details>
		<summary><Route size={15} /> Public transport notices</summary>
		<p class="hint">
			Source-linked candidates need a mapped road extent and time before affecting a scenario.
		</p>
		<div class="fields">
			<label
				>Official or Maldives news URL<input
					type="url"
					placeholder="https://…"
					bind:value={noticeUrl}
				/></label
			><label
				>Public excerpt (optional)<textarea
					rows="3"
					maxlength="16000"
					bind:value={noticeText}
					placeholder="Paste an excerpt if the public page cannot be fetched"></textarea></label
			>
		</div>
		<button class="pick" disabled={noticeBusy || !noticeUrl.trim()} onclick={extractNotice}
			>{noticeBusy ? 'Reading public source…' : 'Extract a notice'}</button
		>{#if noticeError}<p class="error" role="alert">
				{noticeError}
			</p>{/if}{#each notices as event (event.id)}<article class="source-card">
				<b>{event.title}</b>
				<p>{event.description}</p>
				<p>{event.qualification}</p>
				{#if 'extractionMethod' in event}<p>
						{event.extractionMethod} · requires mapped extent and validity
					</p>{/if}<a href={event.sourceUrl} target="_blank" rel="noreferrer">Read source</a><button
					class="pick"
					onclick={() => loadNotice(event)}>Map as a scenario</button
				>
			</article>{:else}<p class="hint">
				No public road events were returned. This does not mean all roads are clear.
			</p>{/each}
		<p class="hint">{bundle?.ai.reason ?? 'Notice extraction is unavailable.'}</p>
	</details>
	<RobustnessPanel result={analysis?.robustness} />
	<details>
		<summary>National coverage & expansion</summary>
		<p class="hint">
			Greater Malé is the routing flagship. Other islands show official population projections until
			verified networks, destinations and schedules are available.
		</p>
		<NationalCoverageInset records={bundle?.nationalReadiness ?? []} />
	</details>
	<details>
		<summary>Source dates & gaps</summary>
		<p class="hint">
			Snapshot {bundle?.version ?? 'unavailable'}{bundle?.stale ? ' · last validated cache' : ''}
		</p>
		{#each bundle?.sources ?? [] as s (s.id)}<article class="source-card">
				<a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
				<p>{s.status} · retrieved {s.retrievedAt ?? 'unavailable'}</p>
				<p>{s.coverage}</p>
			</article>{/each}{#each bundle?.gaps ?? ['Operations source bundle is unavailable. Scenario editing still works offline.'] as gap (gap)}<p
				class="hint"
			>
				{gap}
			</p>{/each}
	</details>
</div>

<style>
	textarea {
		resize: vertical;
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		border: 1px solid #d5ded6;
		border-radius: 8px;
		padding: 9px;
		color: #243c39;
	}
	.operations-panel {
		padding: 18px;
		color: #243c39;
		font-size: 14px;
		line-height: 1.45;
	}
	.heading {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: flex-start;
	}
	h2 {
		font-size: 20px;
		line-height: 1.2;
		margin: 5px 0 10px;
	}
	h3 {
		font-size: 15px;
		margin: 0 0 6px;
	}
	.eyebrow {
		font-size: 10px;
		letter-spacing: 0.1em;
		color: #5c7b73;
		font-weight: 700;
	}
	.intro {
		margin: 0 0 14px;
		color: #5b6d66;
	}
	button,
	input {
		font: inherit;
	}
	button {
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button:focus-visible,
	input:focus-visible,
	summary:focus-visible {
		outline: 2px solid #148674;
		outline-offset: 3px;
	}
	.icon {
		border: 0;
		background: transparent;
		display: grid;
		place-items: center;
		padding: 7px;
		border-radius: 8px;
		color: inherit;
	}
	.pick,
	.primary {
		display: flex;
		align-items: center;
		gap: 8px;
		justify-content: center;
		width: 100%;
		padding: 10px 12px;
		border-radius: 10px;
		font-weight: 600;
	}
	.pick {
		border: 1px solid #cdded7;
		background: #f6faf7;
		color: #315f51;
		margin: 10px 0;
	}
	.pick b {
		margin-left: auto;
	}
	.pick.active {
		background: #e0f5ee;
		border-color: #298771;
	}
	.primary {
		background: #1d6c58;
		border: 0;
		color: white;
		margin: 12px 0;
	}
	.selection {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		margin: 0 0 12px;
	}
	.selection button,
	.link,
	.source button {
		border: 0;
		background: transparent;
		color: #1d6c58;
		text-decoration: underline;
		padding: 0;
	}
	.fields {
		display: grid;
		gap: 10px;
		margin: 12px 0;
	}
	label {
		display: grid;
		gap: 5px;
		font-size: 12px;
		font-weight: 600;
	}
	input {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid #d5ded6;
		border-radius: 8px;
		padding: 9px;
		background: #fff;
		color: #243c39;
		min-width: 0;
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 9px;
	}
	details {
		border-top: 1px solid #e3e8df;
		padding: 12px 0;
	}
	summary {
		cursor: pointer;
		font-weight: 600;
		list-style: none;
		display: flex;
		gap: 7px;
		align-items: center;
	}
	summary::after {
		content: '+';
		margin-left: auto;
		color: #7b8e83;
	}
	details[open] > summary::after {
		content: '−';
	}
	.hint,
	.source {
		font-size: 12px;
		color: #6b7d72;
		margin: 9px 0;
	}
	.source a,
	a {
		color: #246f60;
	}
	.source-card {
		padding: 10px;
		background: #f7f9f3;
		border-radius: 9px;
		margin-top: 8px;
		font-size: 12px;
	}
	.source-card p {
		margin: 5px 0;
	}
	.event {
		display: flex;
		gap: 7px;
		align-items: center;
		margin-top: 10px;
	}
	.event span {
		flex: 1;
		min-width: 0;
	}
	.event b {
		font-size: 13px;
		display: block;
	}
	.event small {
		display: block;
		color: #798479;
		font-size: 11px;
	}
	.impact {
		padding: 12px;
		background: #fff6e6;
		border-radius: 9px;
		margin-bottom: 12px;
	}
	.impact p {
		font-size: 12px;
		margin: 5px 0;
	}
	dl {
		font-size: 12px;
	}
	dl div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	dd {
		margin: 0;
		font-weight: 600;
	}
	.error {
		color: #a4372c;
		font-size: 12px;
	}
	@media (hover: hover) {
		.pick:hover {
			background: #e9f2e9;
		}
		.primary:hover {
			background: #175b4a;
		}
		.icon:hover {
			background: #f0f4eb;
		}
	}
</style>
