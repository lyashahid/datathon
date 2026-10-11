<script lang="ts">
	import { tick } from 'svelte';
	import { Select } from 'bits-ui';
	import {
		ArrowDown,
		ArrowUp,
		Bus,
		Check,
		ChevronDown,
		Plus,
		Route,
		Search,
		Trash2,
		X,
		Zap
	} from '@lucide/svelte';
	import type { PlanningServicePattern, PlanningStop } from '#lib/planning/types.ts';
	import DurationPicker from './controls/DurationPicker.svelte';

	let {
		stops,
		selectedStops,
		patterns,
		mode,
		patternId,
		afterStopId,
		headway,
		fleet,
		reason,
		valid,
		busy,
		dock = false,
		previewSummary = '',
		onmodechange,
		onpatternchange,
		onafterchange,
		onheadwaychange,
		onfleetchange,
		onstopadd,
		onstopremove,
		onstopreorder,
		onapply,
		oncancel
	}: {
		stops: PlanningStop[];
		selectedStops: PlanningStop[];
		patterns: PlanningServicePattern[];
		mode: 'new' | 'insert';
		patternId: string;
		afterStopId: string;
		headway: number;
		fleet: 'diesel' | 'electric';
		reason: string;
		valid: boolean;
		busy: boolean;
		dock?: boolean;
		previewSummary?: string;
		onmodechange: (mode: 'new' | 'insert') => void;
		onpatternchange: (patternId: string) => void;
		onafterchange: (stopId: string) => void;
		onheadwaychange: (minutes: number) => void;
		onfleetchange: (fleet: 'diesel' | 'electric') => void;
		onstopadd: (stopId: string) => void;
		onstopremove: (stopId: string) => void;
		onstopreorder: (stopId: string, direction: -1 | 1) => void;
		onapply: () => void;
		oncancel: () => void;
	} = $props();

	const uid = $props.id();
	let search = $state('');
	let stopPickerOpen = $state(false);
	let stopPickerToggle: HTMLButtonElement;
	let stopSearchInput = $state<HTMLInputElement>();
	const routeOptions = $derived(
		patterns
			.filter((pattern) => pattern.mode === 'bus' && pattern.enabled !== false)
			.map((pattern) => {
				const duplicateName = patterns.some(
					(other) =>
						other.id !== pattern.id &&
						other.mode === 'bus' &&
						other.enabled !== false &&
						other.name === pattern.name
				);
				const endStop = stops.find((stop) => stop.id === pattern.stopIds.at(-1));
				return {
					value: pattern.id,
					label: duplicateName && endStop ? `${pattern.name} · to ${endStop.name}` : pattern.name
				};
			})
	);
	const selectedPattern = $derived(patterns.find((pattern) => pattern.id === patternId));
	const retainedHeadways = $derived(
		selectedPattern?.timing.kind === 'frequency'
			? [...new Set(selectedPattern.timing.windows.map((window) => window.headwayMinutes))]
			: []
	);
	const insertionOptions = $derived(
		[...new Set(selectedPattern?.stopIds ?? [])].map((id) => ({
			value: id,
			label: stops.find((stop) => stop.id === id)?.name ?? id
		}))
	);
	const availableStops = $derived(
		stops.filter(
			(stop) =>
				stop.mode !== 'ferry' &&
				!stop.disabled &&
				!selectedStops.some((selected) => selected.id === stop.id) &&
				stop.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
		)
	);
	const stopChoices = $derived(availableStops.slice(0, 12));
	const displayedPreviewSummary = $derived(
		dock ? previewSummary.replace(/ · preview shown (?:above|on the map)$/u, '') : previewSummary
	);

	function getPattern(): string {
		return patternId;
	}
	function setPattern(next: string): void {
		if (routeOptions.some((option) => option.value === next) && next !== patternId) {
			onpatternchange(next);
		}
	}
	function getAfter(): string {
		return afterStopId;
	}
	function setAfter(next: string): void {
		if (insertionOptions.some((option) => option.value === next) && next !== afterStopId) {
			onafterchange(next);
		}
	}
	function addStop(id: string): void {
		onstopadd(id);
		search = '';
		closeStopPicker();
	}
	function closeStopPicker(): void {
		stopPickerOpen = false;
		void tick().then(() => stopPickerToggle?.focus({ preventScroll: true }));
	}
	function searchKey(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		closeStopPicker();
	}
	async function toggleStopPicker(): Promise<void> {
		stopPickerOpen = !stopPickerOpen;
		if (stopPickerOpen) {
			await tick();
			stopSearchInput?.focus({ preventScroll: true });
		}
	}
</script>

<section
	class="connection-editor"
	class:dock
	class:searching={stopPickerOpen}
	aria-label="Bus route editor"
	aria-busy={busy}
>
	{#if !dock}
		<div class="editor-heading">
			<div class="mode-controls" role="group" aria-label="Connection type">
				<button
					type="button"
					class:active={mode === 'new'}
					aria-pressed={mode === 'new'}
					disabled={busy}
					onclick={() => onmodechange('new')}
					><Plus size={16} aria-hidden="true" /><span>New route</span></button
				>
				<button
					type="button"
					class:active={mode === 'insert'}
					aria-pressed={mode === 'insert'}
					disabled={busy || routeOptions.length === 0}
					onclick={() => onmodechange('insert')}
					><Route size={16} aria-hidden="true" /><span>Add to route</span></button
				>
			</div>

			<p class="map-instruction">
				{mode === 'new'
					? 'Select stops in order. Tap a road to add a new stop.'
					: 'Select a stop on the map, then choose where it joins the route.'}
			</p>
		</div>
	{/if}

	{#snippet routeFields()}
		<div class="insertion-fields">
			<div class="select-field">
				<span id={`${uid}-route-label`}>Existing route</span>
				<Select.Root
					type="single"
					items={routeOptions}
					bind:value={getPattern, setPattern}
					disabled={busy}
				>
					<Select.Trigger class="connection-select-trigger" aria-labelledby={`${uid}-route-label`}>
						<Route size={16} aria-hidden="true" />
						<span><Select.Value placeholder="Choose a route" /></span>
						<ChevronDown size={16} aria-hidden="true" />
					</Select.Trigger>
					<Select.Portal>
						<Select.Content
							class="connection-select-menu"
							align="start"
							sideOffset={6}
							collisionPadding={8}
							strategy="fixed"
						>
							{#each routeOptions as option (option.value)}
								<Select.Item
									value={option.value}
									label={option.label}
									class="connection-select-option"
								>
									{#snippet children({ selected })}
										<span>{option.label}</span>{#if selected}<Check
												size={16}
												aria-hidden="true"
											/>{/if}
									{/snippet}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Portal>
				</Select.Root>
			</div>
			<div class="select-field">
				<span id={`${uid}-after-label`}>Insert after</span>
				<Select.Root
					type="single"
					items={insertionOptions}
					bind:value={getAfter, setAfter}
					disabled={busy || !selectedPattern}
				>
					<Select.Trigger class="connection-select-trigger" aria-labelledby={`${uid}-after-label`}>
						<span><Select.Value placeholder="Choose a stop" /></span>
						<ChevronDown size={16} aria-hidden="true" />
					</Select.Trigger>
					<Select.Portal>
						<Select.Content
							class="connection-select-menu"
							align="start"
							sideOffset={6}
							collisionPadding={8}
							strategy="fixed"
						>
							{#each insertionOptions as option (option.value)}
								<Select.Item
									value={option.value}
									label={option.label}
									class="connection-select-option"
								>
									{#snippet children({ selected })}
										<span>{option.label}</span>{#if selected}<Check
												size={16}
												aria-hidden="true"
											/>{/if}
									{/snippet}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Portal>
				</Select.Root>
			</div>
		</div>
	{/snippet}

	<div class="editor-columns">
		<div class="sequence-column">
			<div class="sequence-heading">
				<h3>{mode === 'new' ? 'Stops in order' : 'Selected stop'}</h3>
				<span>{selectedStops.length}</span>
			</div>
			{#if selectedStops.length > 0}
				<ol class="stop-sequence">
					{#each selectedStops as stop, index (stop.id)}
						<li>
							<span class="stop-number" aria-hidden="true">{index + 1}</span>
							<span class="stop-name">{stop.name}</span>
							<div class="stop-actions">
								{#if mode === 'new'}
									<button
										type="button"
										aria-label={`Move ${stop.name} earlier`}
										title="Move earlier"
										disabled={busy || index === 0}
										onclick={() => onstopreorder(stop.id, -1)}
										><ArrowUp size={16} aria-hidden="true" /></button
									>
									<button
										type="button"
										aria-label={`Move ${stop.name} later`}
										title="Move later"
										disabled={busy || index === selectedStops.length - 1}
										onclick={() => onstopreorder(stop.id, 1)}
										><ArrowDown size={16} aria-hidden="true" /></button
									>
								{/if}
								<button
									type="button"
									class="remove-stop"
									aria-label={`Remove ${stop.name} from route`}
									title="Remove from route"
									disabled={busy}
									onclick={() => onstopremove(stop.id)}
									><Trash2 size={16} aria-hidden="true" /></button
								>
							</div>
						</li>
					{/each}
				</ol>
			{:else}
				<p class="empty-sequence">
					<Bus size={18} aria-hidden="true" />{mode === 'new'
						? 'Tap stops in order, or tap a road to add a new one.'
						: 'Choose a stop to add, or place a new one on a road.'}
				</p>
			{/if}

			<div class="stop-picker">
				<button
					type="button"
					class="stop-picker-toggle"
					bind:this={stopPickerToggle}
					aria-expanded={stopPickerOpen}
					aria-controls={`${uid}-stop-search`}
					disabled={busy}
					onclick={toggleStopPicker}
					><Search size={16} aria-hidden="true" /><span
						>{dock ? 'Find a stop' : 'Find an existing stop'}</span
					><ChevronDown
						size={16}
						class={stopPickerOpen ? 'rotated' : ''}
						aria-hidden="true"
					/></button
				>
				{#if stopPickerOpen}
					<div
						id={`${uid}-stop-search`}
						class="stop-search"
						role="group"
						aria-label="Find an existing bus stop"
					>
						<label class="search-field"
							><Search size={16} aria-hidden="true" /><input
								type="search"
								bind:this={stopSearchInput}
								bind:value={search}
								placeholder="Search stop names"
								aria-label="Search bus stops"
								onkeydown={searchKey}
							/>
							{#if dock}<button
									type="button"
									class="close-stop-search"
									aria-label="Close stop search"
									onclick={closeStopPicker}><X size={16} aria-hidden="true" /></button
								>{/if}</label
						>
						<div class="search-results">
							{#each stopChoices as stop (stop.id)}
								<button
									type="button"
									disabled={busy}
									onclick={() => addStop(stop.id)}
									onkeydown={searchKey}
									><Bus size={15} aria-hidden="true" /><span>{stop.name}</span><Plus
										size={16}
										aria-hidden="true"
									/></button
								>
							{:else}<p>No matching stops. You can place a new one on the map.</p>{/each}
						</div>
						{#if availableStops.length > stopChoices.length}<p class="search-hint">
								Showing 12 stops. Type a name to narrow the list.
							</p>{/if}
					</div>
				{/if}
			</div>
		</div>
		<div class="settings-column">
			{#if mode === 'insert'}{@render routeFields()}{/if}

			{#if mode === 'new'}
				<svelte:element this={dock ? 'div' : 'details'} class="service-options">
					{#if !dock}
						<summary
							><span>Bus service</span><small
								>Every {headway} min · {fleet === 'electric' ? 'Electric' : 'Diesel'}</small
							><ChevronDown size={16} aria-hidden="true" /></summary
						>
					{/if}
					<div class="service-options-body">
						<DurationPicker
							value={headway}
							onchange={onheadwaychange}
							label="Departures every"
							min={5}
							max={180}
							disabled={busy}
						/>
						<div class="fleet-field">
							<span>Vehicle type</span>
							<div class="fleet-controls" role="group" aria-label="Vehicle type">
								<button
									type="button"
									class:active={fleet === 'diesel'}
									aria-pressed={fleet === 'diesel'}
									disabled={busy}
									onclick={() => onfleetchange('diesel')}
									><Bus size={16} aria-hidden="true" />Diesel</button
								>
								<button
									type="button"
									class:active={fleet === 'electric'}
									aria-pressed={fleet === 'electric'}
									disabled={busy}
									onclick={() => onfleetchange('electric')}
									><Zap size={16} aria-hidden="true" />Electric</button
								>
							</div>
						</div>
					</div>
				</svelte:element>
			{:else if selectedPattern?.timing.kind === 'scheduled'}
				<div class="assumed-service">
					{#if !dock}
						<h3>Proposed service · 07:00–19:00 MVT</h3>
						<p>Applying this route replaces the captured departures with the frequency below.</p>
					{/if}
					<DurationPicker
						value={headway}
						onchange={onheadwaychange}
						label="Departures every"
						min={5}
						max={180}
						disabled={busy}
					/>
				</div>
			{:else if selectedPattern?.timing.kind === 'frequency'}
				<p class="retained-service">
					Existing frequency and vehicle type stay the same.
					{#if retainedHeadways.length > 0}<span
							>{retainedHeadways.length === 1
								? `Every ${retainedHeadways[0]} min`
								: `${retainedHeadways.join(' / ')} min headways`}{#if selectedPattern.fleet}
								· {selectedPattern.fleet === 'electric' ? 'Electric' : 'Diesel'}{/if}</span
						>{/if}
				</p>
			{/if}
		</div>
	</div>

	<footer class="editor-footer">
		<div class="review-notes">
			{#if displayedPreviewSummary}<p class="preview-summary" role="status">
					{displayedPreviewSummary}
				</p>{/if}
			{#if reason && (!dock || !valid)}<p
					class="validation-message"
					class:ready={valid}
					role="status"
				>
					{reason}
				</p>{/if}
			{#if dock && mode === 'insert' && selectedPattern?.timing.kind === 'scheduled'}
				<p class="schedule-note">Proposed 07:00–19:00 MVT service replaces captured departures.</p>
			{/if}
			<p class="assumption-note">
				{dock
					? 'Proposed service · model estimates'
					: mode === 'new'
						? 'Proposed service; access, cost and emissions are estimates.'
						: 'Proposed route; changed travel times, access and costs are estimates.'}
			</p>
		</div>
		<div class="connection-actions">
			<button type="button" class="cancel" disabled={busy} onclick={oncancel}>Cancel</button>
			<button type="button" class="apply" disabled={!valid || busy} onclick={onapply}
				><Check size={17} aria-hidden="true" />{busy
					? 'Updating…'
					: mode === 'insert'
						? 'Update route'
						: 'Apply route'}</button
			>
		</div>
	</footer>
</section>

<style>
	.connection-editor {
		display: grid;
		min-width: 0;
		gap: 14px;
		color: #263c46;
	}
	.editor-heading,
	.sequence-column,
	.settings-column,
	.review-notes {
		display: grid;
		min-width: 0;
		align-content: start;
		gap: 10px;
	}
	.editor-columns {
		display: grid;
		min-width: 0;
		gap: 16px;
	}
	.editor-footer {
		display: grid;
		gap: 12px;
		min-width: 0;
		padding-top: 12px;
		border-top: 1px solid #dfe6e8;
	}
	.review-notes {
		gap: 4px;
	}
	button {
		font: inherit;
		cursor: pointer;
		transition:
			background-color 140ms ease,
			transform 140ms ease-out;
	}
	button:not(:disabled):active {
		transform: scale(0.97);
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
	button:focus-visible,
	input:focus-visible,
	summary:focus-visible {
		outline: 3px solid #377d73;
		outline-offset: 2px;
	}
	.mode-controls,
	.fleet-controls {
		display: flex;
		min-width: 0;
		gap: 5px;
		padding: 4px;
		border: 1px solid #dfe6e8;
		border-radius: var(--surface-radius-pill, 999px);
		background: #f5f8f8;
	}
	.mode-controls button,
	.fleet-controls button {
		display: flex;
		flex: 1;
		min-width: 0;
		min-height: 44px;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 7px;
		border: 0;
		border-radius: var(--surface-radius-pill, 999px);
		background: transparent;
		color: #536974;
		font-size: 12px;
		font-weight: 600;
		line-height: 1.3;
	}
	.mode-controls button.active,
	.fleet-controls button.active {
		background: #1d645c;
		color: #fff;
		box-shadow: 0 1px 3px rgb(22 52 35 / 16%);
	}
	button :global(svg) {
		flex-shrink: 0;
	}
	.map-instruction {
		margin: 0;
		color: #62747d;
		font-size: 13px;
		line-height: 1.5;
	}
	.insertion-fields {
		display: grid;
		gap: 12px;
	}
	.select-field {
		display: grid;
		min-width: 0;
		gap: 6px;
	}
	.select-field > span,
	.fleet-field > span {
		color: #62747d;
		font-size: 12px;
		font-weight: 600;
	}
	.connection-editor :global(.connection-select-trigger) {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 44px;
		padding: 9px 11px;
		border: 1px solid #dfe6e8;
		border-radius: var(--surface-radius-field, 14px);
		background: #fff;
		color: #1d645c;
		font: inherit;
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}
	.connection-editor :global(.connection-select-trigger > span) {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.connection-editor :global(.connection-select-trigger:focus-visible) {
		outline: 3px solid #377d73;
		outline-offset: 2px;
	}
	.connection-editor :global(.connection-select-trigger[data-state='open']) {
		border-color: #377d73;
		background: #f5f8f8;
	}
	.connection-editor :global(.connection-select-trigger:disabled) {
		cursor: not-allowed;
		opacity: 0.45;
	}
	:global(.connection-select-menu) {
		z-index: 100;
		box-sizing: border-box;
		width: var(--bits-select-anchor-width);
		max-width: min(400px, calc(100vw - 16px));
		max-height: min(300px, var(--bits-select-content-available-height, 300px), calc(100dvh - 16px));
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		padding: 5px;
		border: 1px solid #dfe6e8;
		border-radius: var(--surface-radius-mobile, 24px);
		background: #fff;
		color: #1d645c;
		box-shadow: var(--surface-shadow-raised, 0 12px 36px #102e3418, 0 2px 6px #102e340a);
		font: inherit;
		font-size: 13px;
	}
	:global(.connection-select-option) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		box-sizing: border-box;
		min-height: 44px;
		padding: 9px 10px;
		border-radius: var(--surface-radius-inner, 16px);
		outline: none;
		font-weight: 500;
		line-height: 1.4;
		overflow-wrap: anywhere;
		cursor: pointer;
	}
	:global(.connection-select-option > span) {
		flex: 1;
		min-width: 0;
	}
	:global(.connection-select-option[data-highlighted]) {
		background: #edf4f3;
	}
	:global(.connection-select-option[data-selected]) {
		background: #1d645c;
		color: #fff;
	}
	.sequence-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 650;
	}
	.sequence-heading > span {
		display: grid;
		min-width: 24px;
		height: 24px;
		place-items: center;
		padding-inline: 5px;
		border-radius: var(--surface-radius-pill, 999px);
		background: #e6f1ef;
		color: #25665c;
		font-size: 11px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
	.stop-sequence {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.stop-sequence li {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 8px;
		padding: 5px 4px 5px 9px;
		border: 1px solid #dfe6e8;
		border-radius: var(--surface-radius-inner, 16px);
		background: #fff;
	}
	.stop-number {
		display: grid;
		flex-shrink: 0;
		width: 23px;
		height: 23px;
		place-items: center;
		border-radius: 50%;
		background: #e6f1ef;
		color: #25665c;
		font-size: 11px;
		font-weight: 650;
	}
	.stop-name {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		font-weight: 550;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.stop-actions {
		display: flex;
		flex-shrink: 0;
		gap: 0;
	}
	.stop-actions button {
		display: grid;
		width: 44px;
		height: 44px;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: var(--surface-radius-pill, 999px);
		background: transparent;
		color: #62747d;
	}
	.stop-actions .remove-stop {
		color: #996247;
	}
	.empty-sequence {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		padding: 12px;
		border: 1px dashed #dfe6e8;
		border-radius: var(--surface-radius-inner, 16px);
		color: #64767e;
		font-size: 12px;
		line-height: 1.5;
	}
	.empty-sequence :global(svg) {
		flex-shrink: 0;
	}
	.stop-picker {
		min-width: 0;
	}
	.stop-picker-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 44px;
		padding: 8px 10px;
		border: 1px solid #dfe6e8;
		border-radius: var(--surface-radius-pill, 999px);
		background: #fff;
		color: #536974;
		font-size: 13px;
		font-weight: 550;
		text-align: left;
	}
	.stop-picker-toggle span {
		flex: 1;
		min-width: 0;
	}
	.stop-picker-toggle :global(.rotated) {
		transform: rotate(180deg);
	}
	.stop-search {
		margin-top: 8px;
		padding: 6px;
		border: 1px solid #dfe6e8;
		border-radius: var(--surface-radius-inner, 16px);
		background: #fff;
	}
	.search-field {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-inline: 8px;
		color: #72828a;
	}
	.search-field input {
		width: 100%;
		min-width: 0;
		height: 44px;
		padding: 0 3px;
		border: 0;
		background: transparent;
		color: #1d645c;
		font: inherit;
		font-size: 14px;
	}
	.close-stop-search {
		display: grid;
		flex: 0 0 44px;
		width: 44px;
		height: 44px;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: var(--surface-radius-pill, 999px);
		background: transparent;
		color: #62747d;
	}
	.search-results {
		max-height: 190px;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
	}
	.search-results button {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 44px;
		padding: 8px;
		border: 0;
		border-radius: var(--surface-radius-field, 14px);
		background: transparent;
		color: #536974;
		font-size: 13px;
		text-align: left;
	}
	.search-results button span {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.search-results p,
	.search-hint {
		margin: 6px 8px;
		color: #72828a;
		font-size: 11px;
		line-height: 1.5;
	}
	.service-options {
		border-bottom: 1px solid #dfe6e8;
	}
	.service-options summary {
		display: flex;
		min-height: 44px;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		padding-block: 7px;
		list-style: none;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.service-options summary::-webkit-details-marker {
		display: none;
	}
	.service-options summary > span {
		flex: 1;
	}
	.service-options summary small {
		color: #72828a;
		font-size: 10px;
		font-weight: 500;
	}
	.connection-editor :global(details.service-options[open] summary svg) {
		transform: rotate(180deg);
	}
	.service-options-body {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		padding: 4px 0 14px;
	}
	.assumed-service {
		display: grid;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid #e9e3d7;
		border-radius: var(--surface-radius-inner, 16px);
		background: #fbfaf6;
	}
	.assumed-service p,
	.retained-service {
		margin: 0;
		color: #62747d;
		font-size: 12px;
		line-height: 1.5;
	}
	.retained-service span {
		display: block;
		margin-top: 3px;
		color: #25665c;
		font-size: 11px;
	}
	.fleet-field {
		display: grid;
		min-width: 0;
		gap: 7px;
	}
	.fleet-controls {
		padding: 3px;
	}
	.fleet-controls button {
		padding-inline: 10px;
	}
	.preview-summary {
		margin: 0;
		color: #405863;
		font-size: 12px;
		font-weight: 550;
		line-height: 1.5;
	}
	.validation-message {
		margin: 0;
		color: #86593c;
		font-size: 12px;
		line-height: 1.5;
	}
	.validation-message.ready {
		color: #25665c;
	}
	.assumption-note {
		margin: 0;
		color: #72828a;
		font-size: 10px;
		line-height: 1.5;
	}
	.schedule-note {
		margin: 0;
		color: #86593c;
		font-size: 11px;
		line-height: 1.4;
	}
	.connection-actions {
		display: flex;
		gap: 8px;
	}
	.connection-actions button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 44px;
		padding: 9px 12px;
		border: 1px solid #dfe6e8;
		border-radius: var(--surface-radius-pill, 999px);
		font-size: 13px;
		font-weight: 600;
		line-height: 1.3;
	}
	.cancel {
		background: #fff;
		color: #536974;
	}
	.apply {
		flex: 1;
		border-color: #1d645c !important;
		background: #1d645c;
		color: #fff;
	}
	.dock {
		gap: 4px;
	}
	.dock .editor-heading {
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 18px;
	}
	.dock .mode-controls {
		width: 270px;
		max-width: 100%;
		padding: 0;
		border: 0;
	}
	.dock .map-instruction {
		font-size: 12px;
	}
	.dock .editor-columns {
		grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
		gap: 24px;
	}
	.dock .settings-column {
		padding-left: 24px;
		border-left: 1px solid #e5eaec;
	}
	.dock .stop-sequence {
		max-height: 132px;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		gap: 0;
		padding: 0;
		border: 1px solid #e2e8ea;
		border-radius: var(--surface-radius-inner, 16px);
	}
	.dock .stop-sequence li {
		min-height: 44px;
		padding-block: 0;
		border: 0;
		border-radius: 0;
		box-shadow: inset 0 -1px #edf0f1;
	}
	.dock .sequence-heading {
		padding-inline: 2px;
	}
	.dock .service-options summary {
		padding-top: 0;
	}
	.dock .service-options {
		border: 0;
	}
	.dock .service-options-body {
		gap: 10px 16px;
		padding: 0;
	}
	.dock .fleet-controls {
		padding: 0;
		border: 0;
	}
	.dock .assumed-service {
		padding: 0;
		border: 0;
		background: transparent;
	}
	.dock :global(.duration-picker .segment) {
		min-height: 44px;
		background: #f0f5f4;
	}
	.dock :global(.duration-field) {
		color: #263c46;
		gap: 4px;
	}
	.dock :global(.duration-field .field-label) {
		color: #62747d;
	}
	.dock .editor-footer {
		position: sticky;
		bottom: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 18px;
		padding-block: 8px 2px;
		background: #fff;
	}
	.dock .review-notes {
		flex: 1;
	}
	.dock .assumption-note {
		font-size: 11px;
		line-height: 1.4;
	}
	.dock .connection-actions {
		flex: 0 0 auto;
	}
	.dock .connection-actions .apply {
		min-width: 136px;
	}
	@media (min-width: 681px) {
		.dock .sequence-column {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 4px 10px;
		}
		.dock .sequence-heading {
			grid-column: 1;
			grid-row: 1;
			min-height: 44px;
			justify-content: start;
		}
		.dock .stop-picker {
			display: contents;
		}
		.dock .stop-picker-toggle {
			grid-column: 2;
			grid-row: 1;
			width: 150px;
			font-size: 12px;
		}
		.dock .stop-sequence,
		.dock .empty-sequence,
		.dock .stop-search {
			grid-column: 1 / -1;
			grid-row: 2;
		}
		.dock .stop-sequence {
			max-height: 132px;
		}
		.dock .empty-sequence {
			padding: 10px 0;
			border: 0;
			font-size: 12px;
		}
		.dock.searching .stop-sequence,
		.dock.searching .empty-sequence,
		.dock.searching .sequence-heading,
		.dock.searching .stop-picker-toggle {
			display: none;
		}
		.dock .stop-search {
			grid-row: 1;
			margin-top: 0;
			padding: 0;
		}
		.dock .search-results {
			max-height: 88px;
			overflow-y: auto;
		}
		.dock .search-hint {
			display: none;
		}
		.dock .insertion-fields {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			gap: 10px;
		}
		.dock .settings-column {
			max-height: 144px;
			gap: 8px;
			overflow-y: auto;
			overscroll-behavior: contain;
			scrollbar-width: thin;
			padding-right: 2px;
		}
		.dock .select-field,
		.dock .fleet-field {
			gap: 4px;
		}
		.dock .select-field > span,
		.dock .fleet-field > span {
			font-size: 11px;
			line-height: 1.4;
		}
	}
	@media (max-width: 850px) {
		.dock .editor-columns {
			gap: 16px;
		}
		.dock .settings-column {
			padding-left: 16px;
		}
		.dock .editor-heading {
			grid-template-columns: 1fr;
			gap: 8px;
		}
	}
	@media (max-width: 680px) {
		.dock .editor-columns {
			grid-template-columns: minmax(0, 1fr);
		}
		.dock .mode-controls {
			width: auto;
		}
		.dock .settings-column {
			padding-left: 0;
			border-left: 0;
		}
		.dock .editor-footer {
			display: grid;
			gap: 6px;
			padding-block: 6px 0;
		}
		.dock .review-notes {
			gap: 2px;
		}
		.dock .preview-summary {
			line-height: 1.4;
		}
		.dock .connection-actions {
			width: 100%;
		}
		.dock .connection-actions .apply {
			min-width: 0;
		}
		.dock .stop-sequence {
			max-height: 132px;
			grid-column: 1 / -1;
			grid-row: 2;
		}
		.dock .sequence-column {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 4px 8px;
		}
		.dock .sequence-heading {
			grid-column: 1;
			grid-row: 1;
			min-height: 44px;
			justify-content: start;
			gap: 6px;
			padding-inline: 0;
		}
		.dock .sequence-heading h3 {
			font-size: 12px;
		}
		.dock .sequence-heading > span {
			min-width: 20px;
			height: 20px;
			padding-inline: 3px;
		}
		.dock .stop-picker {
			display: contents;
		}
		.dock .stop-picker-toggle {
			grid-column: 2;
			grid-row: 1;
			width: 130px;
			gap: 6px;
			padding-inline: 8px;
			font-size: 12px;
		}
		.dock .empty-sequence,
		.dock .stop-search {
			grid-column: 1 / -1;
			grid-row: 2;
		}
		.dock .empty-sequence {
			padding: 8px 0;
			border: 0;
		}
		.dock.searching .stop-sequence,
		.dock.searching .empty-sequence,
		.dock.searching .sequence-heading,
		.dock.searching .stop-picker-toggle {
			display: none;
		}
		.dock .stop-search {
			grid-row: 1;
			margin-top: 0;
			padding: 0;
		}
		.dock .search-results {
			max-height: 88px;
		}
		.dock .search-hint {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		button {
			transition: none;
		}
	}
	@media (hover: hover) and (pointer: fine) {
		.stop-actions button:not(:disabled):hover,
		.search-results button:not(:disabled):hover {
			background: #edf4f3;
		}
		.mode-controls button:not(.active):not(:disabled):hover,
		.fleet-controls button:not(.active):not(:disabled):hover,
		.stop-picker-toggle:not(:disabled):hover,
		.cancel:not(:disabled):hover {
			background: #eef4f3;
		}
		.apply:not(:disabled):hover {
			background: #17544d;
		}
	}
</style>
