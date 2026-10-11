<script lang="ts">
	import { MapPinPlus, Route } from '@lucide/svelte';
	import type {
		PlanningAction,
		PlanningServicePattern,
		PlanningStop
	} from '#lib/planning/types.ts';
	import TransportGraphic from './graphics/TransportGraphic.svelte';
	import { patternIsValid } from '#lib/planning/routing.ts';

	let {
		patterns,
		stops,
		onaction,
		onmove,
		onconnect,
		onaddstop,
		onnewconnection,
		disabledPatternIds = [],
		disabledStopIds = []
	}: {
		patterns: readonly PlanningServicePattern[];
		stops: readonly PlanningStop[];
		onaction: (action: PlanningAction) => void;
		onmove: (stopId: string) => void;
		onconnect?: (stopId: string) => void;
		onaddstop?: () => void;
		onnewconnection?: () => void;
		disabledPatternIds?: readonly string[];
		disabledStopIds?: readonly string[];
	} = $props();

	let patternId = $state('');
	let stopId = $state('');
	let managing = $state<'service' | 'stop'>('service');
	let startTime = $state('07:00');
	let endTime = $state('19:00');
	let notice = $state('');
	let error = $state('');
	const selectedPattern = $derived(patterns.find((p) => p.id === patternId) ?? patterns[0]);
	const selectableStops = $derived(
		selectedPattern ? stops.filter((stop) => selectedPattern.stopIds.includes(stop.id)) : stops
	);
	const selectedStop = $derived(
		stops.find((stop) => stop.id === stopId) ?? selectableStops[0] ?? stops[0]
	);
	const serviceDisabled = $derived(
		!!selectedPattern &&
			(selectedPattern.enabled === false || disabledPatternIds.includes(selectedPattern.id))
	);
	const stopDisabled = $derived(
		!!selectedStop && (selectedStop.disabled === true || disabledStopIds.includes(selectedStop.id))
	);
	const stopPatterns = $derived(
		selectedStop ? patterns.filter((pattern) => pattern.stopIds.includes(selectedStop.id)) : []
	);
	const stopHasLoadedService = $derived(
		stopPatterns.some(
			(pattern) =>
				pattern.enabled !== false &&
				!disabledPatternIds.includes(pattern.id) &&
				patternIsValid(pattern)
		)
	);
	const stopServicesPaused = $derived(
		stopPatterns.length > 0 &&
			stopPatterns.every(
				(pattern) => pattern.enabled === false || disabledPatternIds.includes(pattern.id)
			)
	);
	const ferryStop = $derived(
		!!selectedStop &&
			(selectedStop.mode === 'ferry' ||
				patterns.some(
					(pattern) => pattern.mode === 'ferry' && pattern.stopIds.includes(selectedStop.id)
				))
	);
	const frequencyEditable = $derived(selectedPattern?.timing.kind === 'frequency');
	const invalidatedService = $derived(
		typeof selectedPattern?.runtimeUnavailableReason === 'string'
			? selectedPattern.runtimeUnavailableReason
			: null
	);

	const formatTime = (minutes: number) => {
		const whole = Math.round(minutes) % 1440;
		return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
	};
	const hoursSummary = $derived.by(() => {
		const window =
			selectedPattern?.timing.kind === 'frequency' ? selectedPattern.timing.windows[0] : null;
		if (!window) return 'Captured timetable';
		return `${formatTime(window.startMinutes)}–${formatTime(window.endMinutes)} MVT${window.endMinutes >= 1440 ? ' · next day' : ''}`;
	});
	function parseTime(value: string): number | null {
		if (!/^\d{2}:\d{2}$/.test(value)) return null;
		const [hours, minutes] = value.split(':').map(Number);
		return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
	}

	$effect(() => {
		const pattern = selectedPattern;
		const firstWindow = pattern?.timing.kind === 'frequency' ? pattern.timing.windows[0] : null;
		startTime = formatTime(firstWindow?.startMinutes ?? 7 * 60);
		endTime = formatTime(firstWindow?.endMinutes ?? 19 * 60);
		error = '';
	});

	function toggleService() {
		if (!selectedPattern) return;
		const restoring = serviceDisabled;
		if (restoring && invalidatedService) return;
		onaction({
			kind: restoring ? 'enable-service' : 'disable-service',
			patternId: selectedPattern.id
		});
		notice = restoring ? 'Service restored in this proposal.' : 'Service paused in this proposal.';
	}
	function toggleStop() {
		if (!selectedStop) return;
		const restoring = stopDisabled;
		onaction({ kind: restoring ? 'enable-stop' : 'disable-stop', stopId: selectedStop.id });
		notice = restoring
			? 'Stop restored in this proposal.'
			: 'Boarding and alighting paused at this stop.';
	}
	function setHours(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedPattern || !frequencyEditable || serviceDisabled) return;
		const start = parseTime(startTime);
		let end = parseTime(endTime);
		if (start === null || end === null) {
			error = 'Enter a start and finish time.';
			return;
		}
		if (end <= start) end += 1440;
		onaction({
			kind: 'set-hours',
			patternId: selectedPattern.id,
			startMinutes: start,
			endMinutes: end
		});
		error = '';
		notice = 'Operating hours updated for both directions of this route.';
	}
</script>

<div class="service-manager">
	<div class="manager-content">
		{#if onaddstop || onnewconnection}
			<div class="creation-toolbar" aria-label="Build transport connections" role="group">
				{#if onaddstop}
					<button type="button" class="secondary-button" onclick={onaddstop}
						><MapPinPlus size={17} aria-hidden="true" />Place a stop</button
					>
				{/if}
				{#if onnewconnection}
					<button type="button" class="secondary-button" onclick={onnewconnection}
						><Route size={17} aria-hidden="true" />Draw a connection</button
					>
				{/if}
			</div>
		{/if}
		<div class="mode-switch" role="group" aria-label="What to manage">
			<button
				type="button"
				aria-pressed={managing === 'service'}
				onclick={() => {
					managing = 'service';
					notice = '';
					error = '';
				}}>Services</button
			>
			<button
				type="button"
				aria-pressed={managing === 'stop'}
				onclick={() => {
					managing = 'stop';
					notice = '';
					error = '';
				}}>Stops</button
			>
		</div>
		{#if managing === 'service'}
			<section aria-label="Service management">
				<label class="field">
					<span class="field-heading"
						><TransportGraphic
							kind={selectedPattern?.mode === 'ferry' ? 'ferry' : 'bus'}
							size={23}
						/>Service direction</span
					>
					<select
						value={selectedPattern?.id ?? ''}
						onchange={(e) => {
							patternId = e.currentTarget.value;
							stopId = '';
							notice = '';
						}}
						disabled={!patterns.length}
					>
						{#if !patterns.length}<option value="">No loaded services</option>{/if}
						{#each patterns as pattern (pattern.id)}
							<option value={pattern.id}
								>{pattern.name}{pattern.enabled === false || disabledPatternIds.includes(pattern.id)
									? ' · paused'
									: ''}</option
							>
						{/each}
					</select>
				</label>
				{#if selectedPattern}
					<div class="status-row">
						<span class:paused={serviceDisabled} class="status"
							>{serviceDisabled ? 'Paused in proposal' : 'Included in proposal'}</span
						>
						<button
							type="button"
							class="text-button"
							onclick={toggleService}
							disabled={serviceDisabled && !!invalidatedService}
							>{serviceDisabled ? 'Restore service' : 'Pause service'}</button
						>
					</div>
					{#if invalidatedService}
						<p class="move-warning">
							{invalidatedService} Rebuild the affected service before restoring it.
						</p>
					{/if}
					<p class="source-note">
						Published timetables reflect their source date. Edited services are proposals; they do
						not change actual operations.
					</p>
					<details class="hours-disclosure">
						<summary>
							<span class="summary-copy"
								><strong>Operating hours</strong><span>{hoursSummary}</span></span
							>
							<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"
								><path d="m4 6 4 4 4-4" /></svg
							>
						</summary>
						{#if frequencyEditable}
							<form onsubmit={setHours}>
								<div class="hours-fields">
									<label class="field"
										><span>Starts · MVT</span><input
											type="time"
											bind:value={startTime}
											disabled={serviceDisabled}
											required
										/></label
									>
									<label class="field"
										><span>Finishes · MVT</span><input
											type="time"
											bind:value={endTime}
											disabled={serviceDisabled}
											required
										/></label
									>
								</div>
								<p class="helper">
									Applies to both directions. A finish at or before the start continues into the
									next day.
								</p>
								{#if serviceDisabled}<p class="disabled-reason">
										Restore this service to change its hours.
									</p>{/if}
								<button class="secondary-button" type="submit" disabled={serviceDisabled}
									>Apply hours</button
								>
							</form>
						{:else}
							<p class="helper disclosure-copy">
								These published times are a captured timetable. Add an assumed service to test
								different operating hours.
							</p>
						{/if}
					</details>
				{:else}
					<p class="helper">No services have been loaded for this network.</p>
				{/if}
			</section>
		{:else}
			<section aria-label="Stop management">
				<label class="field">
					<span class="field-heading"><TransportGraphic kind="terminal" size={23} />Stop</span>
					<select
						value={selectedStop?.id ?? ''}
						onchange={(e) => {
							stopId = e.currentTarget.value;
							notice = '';
						}}
						disabled={!stops.length}
					>
						{#if !stops.length}<option value="">No mapped stops</option>{/if}
						{#if selectableStops.length}
							<optgroup label="Selected direction">
								{#each selectableStops as stop (stop.id)}<option value={stop.id}
										>{stop.name}{stop.disabled === true || disabledStopIds.includes(stop.id)
											? ' · paused'
											: ''}</option
									>{/each}
							</optgroup>
						{/if}
						{#if stops.some((stop) => !selectableStops.includes(stop))}
							<optgroup label="Other mapped stops">
								{#each stops.filter((stop) => !selectableStops.includes(stop)) as stop (stop.id)}<option
										value={stop.id}
										>{stop.name}{stop.disabled === true || disabledStopIds.includes(stop.id)
											? ' · paused'
											: ''}</option
									>{/each}
							</optgroup>
						{/if}
					</select>
				</label>
				{#if selectedStop}
					<div class="status-row">
						<span class:paused={stopDisabled} class="status"
							>{stopDisabled
								? 'Paused in proposal'
								: selectedStop.pickupAllowed === false
									? 'Drop-off only'
									: !stopPatterns.length
										? 'No loaded service'
										: stopServicesPaused
											? 'Service paused in proposal'
											: stopHasLoadedService
												? 'Linked to loaded service'
												: 'Service timing unavailable'}</span
						>
						<button type="button" class="text-button" onclick={toggleStop}
							>{stopDisabled ? 'Restore stop' : 'Pause stop'}</button
						>
					</div>
					{#if stopDisabled}<p class="disabled-reason">
							Passengers cannot board or alight here. Restore the stop before moving it.
						</p>{/if}
					{#if !stopPatterns.length}<p class="helper">
							{selectedStop.sourceIds.length
								? 'Operator-listed location; current boarding operation is unverified.'
								: 'Proposed stop; no service is connected.'}
							Add a proposed connection to test service.
						</p>{:else if stopServicesPaused}<p class="helper">
							All loaded connections are paused in this proposal. This does not establish real-world
							closure.
						</p>{:else if !stopHasLoadedService}<p class="helper">
							Connected service timing is unavailable and excluded from routing. Review or replace
							the connection to test service.
						</p>{/if}
					<div class="stop-edit-actions">
						<button
							type="button"
							class="secondary-button"
							disabled={stopDisabled}
							onclick={() => {
								onmove(selectedStop.id);
								notice = 'Choose the new position on the map.';
							}}>Move stop on map</button
						>
						{#if onconnect}
							<button
								type="button"
								class="secondary-button"
								disabled={stopDisabled || ferryStop}
								onclick={() => onconnect?.(selectedStop.id)}
								><Route size={16} aria-hidden="true" />Connect this stop</button
							>
						{/if}
					</div>
					{#if onconnect && ferryStop}<p class="helper">
							Ferry stops use published crossings. Bus connections can be added at bus stops.
						</p>{/if}
					<details class="explanation">
						<summary>How stop changes affect service</summary>
						<p class="helper">
							A paused stop cannot be used to board or alight; services still pass through it.
						</p>
						<p class="helper">
							Moving a bus stop keeps its connections by default, with road travel times
							recalculated as proposed estimates. Move options also let you pause the affected
							connections instead.
						</p>
						<p class="helper">
							Published times remain dated source evidence. Edited routes use proposed travel times.
						</p>
					</details>
				{:else}
					<p class="helper">No stops have been mapped for this network.</p>
				{/if}
			</section>
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<p class="notice" aria-live="polite">{notice}</p>
	</div>
</div>

<style>
	.service-manager {
		width: 100%;
		min-width: 0;
		overflow-wrap: anywhere;
		color: #294239;
		font-size: 14px;
	}
	summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		cursor: pointer;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.summary-copy {
		display: grid;
		min-width: 0;
		gap: 4px;
	}
	.summary-copy strong {
		font-size: 14px;
		font-weight: 650;
	}
	.summary-copy > span {
		color: #6f8074;
		font-size: 12px;
		line-height: 1.45;
	}
	.chevron {
		width: 17px;
		height: 17px;
		flex-shrink: 0;
		fill: none;
		stroke: #688371;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.hours-disclosure[open] > summary .chevron {
		transform: rotate(180deg);
	}
	.manager-content {
		display: grid;
		min-width: 0;
		gap: 14px;
		padding: 0 0 16px;
	}
	.creation-toolbar,
	.stop-edit-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		min-width: 0;
	}
	.creation-toolbar .secondary-button,
	.stop-edit-actions .secondary-button {
		display: flex;
		flex: 1 1 140px;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 44px;
	}
	.creation-toolbar :global(svg),
	.stop-edit-actions :global(svg) {
		flex-shrink: 0;
	}
	.source-note {
		margin: 0;
		color: #7c8a74;
		font-size: 11px;
		line-height: 1.5;
	}
	.mode-switch {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 4px;
		padding: 3px;
		border: 1px solid #e0e8dc;
		border-radius: 10px;
		background: #f2f6ef;
	}
	.mode-switch button {
		min-width: 0;
		min-height: 36px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: #64796a;
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}
	.mode-switch button[aria-pressed='true'] {
		background: #fff;
		color: #2d644c;
		font-weight: 650;
		box-shadow: 0 1px 3px #2942390d;
	}
	section {
		display: grid;
		min-width: 0;
		gap: 12px;
	}
	.field {
		display: grid;
		min-width: 0;
		gap: 8px;
	}
	.field > span {
		font-size: 12px;
		color: #64796a;
	}
	.field-heading {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 24px;
	}
	select,
	input {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		border: 1px solid #d8e3d8;
		border-radius: 8px;
		color: #294239;
		background: #fff;
		font: inherit;
		padding: 9px 10px;
		min-height: 40px;
	}
	select {
		text-overflow: ellipsis;
	}
	.status-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: wrap;
		min-height: 32px;
	}
	.status {
		color: #397f67;
		font-size: 12px;
		line-height: 1.45;
	}
	.status.paused {
		color: #957442;
	}
	.text-button {
		min-height: 32px;
		padding: 7px 0;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: 12px;
		color: #467e68;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.hours-disclosure {
		border: 1px solid #e0e7dc;
		border-radius: 10px;
	}
	.hours-disclosure > summary {
		padding: 12px;
		min-height: 40px;
	}
	.hours-disclosure .summary-copy strong {
		font-size: 12px;
		font-weight: 600;
	}
	form {
		display: grid;
		min-width: 0;
		gap: 12px;
		padding: 0 12px 12px;
	}
	.hours-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}
	.helper {
		margin: 0;
		color: #687e6e;
		font-size: 12px;
		line-height: 1.5;
	}
	.disclosure-copy {
		padding: 0 12px 12px;
	}
	.secondary-button {
		min-width: 0;
		max-width: 100%;
		border: 1px solid #d7e2d6;
		background: #f9fbf5;
		border-radius: 8px;
		padding: 9px 12px;
		min-height: 40px;
		color: #42725c;
		font: inherit;
		font-size: 12px;
		cursor: pointer;
		transition:
			background 160ms ease,
			border-color 160ms ease;
	}
	.explanation {
		border-top: 1px solid #e5ebe2;
	}
	.explanation > summary {
		display: list-item;
		list-style: revert;
		padding: 12px 0 0;
		font-size: 12px;
		color: #64796a;
	}
	.explanation > summary::-webkit-details-marker {
		display: revert;
	}
	.explanation .helper {
		margin-top: 10px;
	}
	.move-warning,
	.disabled-reason {
		padding-left: 9px;
		border-left: 2px solid #d8bd83;
		color: #85734f;
		font-size: 12px;
		line-height: 1.5;
		margin: 0;
	}
	.notice,
	.error {
		font-size: 12px;
		line-height: 1.5;
		margin: 0;
	}
	.notice:empty {
		display: none;
	}
	.notice {
		color: #397f67;
	}
	.error {
		color: #a2553e;
	}
	button:disabled,
	input:disabled,
	select:disabled {
		cursor: default;
		opacity: 0.55;
	}
	button:focus-visible,
	input:focus-visible,
	select:focus-visible,
	summary:focus-visible {
		outline: 2px solid #35876d;
		outline-offset: 3px;
		transition: none;
	}
	@media (hover: hover) and (pointer: fine) {
		.secondary-button:hover:not(:disabled) {
			background: #eff5e9;
			border-color: #acc5a9;
		}
		.mode-switch button:hover:not([aria-pressed='true']) {
			background: #eaf1e4;
		}
	}
	@media (max-width: 420px) {
		.hours-fields {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (pointer: coarse) {
		.mode-switch button,
		.text-button,
		.secondary-button,
		select,
		input,
		summary {
			min-height: 44px;
		}
		select,
		input {
			font-size: 16px;
		}
		.explanation > summary {
			padding: 12px 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.secondary-button {
			transition: none;
		}
	}
</style>
