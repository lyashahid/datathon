<script lang="ts">
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
		stopPickerOpen = false;
		stopPickerToggle?.focus();
	}
	function searchKey(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		stopPickerOpen = false;
		stopPickerToggle?.focus();
	}
</script>

<section class="connection-editor" aria-label="Bus connection editor">
	<div class="mode-controls" role="group" aria-label="Connection type">
		<button
			type="button"
			class:active={mode === 'new'}
			aria-pressed={mode === 'new'}
			disabled={busy}
			onclick={() => onmodechange('new')}
			><Plus size={16} aria-hidden="true" /><span>New connection</span></button
		>
		<button
			type="button"
			class:active={mode === 'insert'}
			aria-pressed={mode === 'insert'}
			disabled={busy || routeOptions.length === 0}
			onclick={() => onmodechange('insert')}
			><Route size={16} aria-hidden="true" /><span>Add to a route</span></button
		>
	</div>

	<p class="map-instruction">
		{mode === 'new' ? 'Tap stops in order.' : 'Choose the stop to insert.'} Tap a road to place a new
		stop.
	</p>

	{#if mode === 'insert'}
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
	{/if}

	<div class="sequence-heading">
		<h3>{mode === 'new' ? 'Stops in this connection' : 'Stop to insert'}</h3>
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
							aria-label={`Remove ${stop.name} from connection`}
							title="Remove from connection"
							disabled={busy}
							onclick={() => onstopremove(stop.id)}><Trash2 size={16} aria-hidden="true" /></button
						>
					</div>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="empty-sequence">
			<Bus size={18} aria-hidden="true" />{mode === 'new'
				? 'Choose your first stop'
				: 'Choose a stop'} on the map or below.
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
			onclick={() => (stopPickerOpen = !stopPickerOpen)}
			><Search size={16} aria-hidden="true" /><span>Find an existing stop</span><ChevronDown
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
						bind:value={search}
						placeholder="Search stop names"
						aria-label="Search bus stops"
						onkeydown={searchKey}
					/></label
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

	{#if mode === 'new'}
		<details class="service-options">
			<summary
				><span>Service options</span><small
					>Every {headway} min · {fleet === 'electric' ? 'Electric' : 'Diesel'}</small
				><ChevronDown size={16} aria-hidden="true" /></summary
			>
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
		</details>
	{:else if selectedPattern?.timing.kind === 'scheduled'}
		<div class="assumed-service">
			<h3>Proposed schedule</h3>
			<p>This edit uses an assumed 07:00–19:00 MVT service in place of captured departures.</p>
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
			Existing frequency and fleet are retained.
			{#if retainedHeadways.length > 0}<span
					>{retainedHeadways.length === 1
						? `Every ${retainedHeadways[0]} min`
						: `${retainedHeadways.join(' / ')} min headways`}{#if selectedPattern.fleet}
						· {selectedPattern.fleet === 'electric' ? 'Electric' : 'Diesel'}{/if}</span
				>{/if}
		</p>
	{/if}

	{#if previewSummary}<p class="preview-summary" role="status">{previewSummary}</p>{/if}
	{#if reason}<p class="validation-message" class:ready={valid} role="status">{reason}</p>{/if}
	<p class="assumption-note">
		{mode === 'new'
			? 'New service uses an assumed schedule.'
			: 'Changed route times are modeled estimates.'} Access, cost and carbon are estimates.
	</p>
	<div class="connection-actions">
		<button type="button" class="cancel" disabled={busy} onclick={oncancel}>Cancel</button>
		<button type="button" class="apply" disabled={!valid || busy} onclick={onapply}
			><Check size={17} aria-hidden="true" />{busy
				? 'Updating…'
				: mode === 'insert'
					? 'Update route'
					: 'Apply connection'}</button
		>
	</div>
</section>

<style>
	.connection-editor {
		display: grid;
		min-width: 0;
		gap: 14px;
		color: #294e3a;
	}
	button {
		font: inherit;
		cursor: pointer;
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
	button:focus-visible,
	input:focus-visible,
	summary:focus-visible {
		outline: 3px solid #7da470;
		outline-offset: 2px;
	}
	.mode-controls,
	.fleet-controls {
		display: flex;
		min-width: 0;
		gap: 5px;
		padding: 4px;
		border: 1px solid #d7dfd0;
		border-radius: 12px;
		background: #eff3e9;
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
		border-radius: 8px;
		background: transparent;
		color: #52654d;
		font-size: 12px;
		font-weight: 600;
		line-height: 1.3;
	}
	.mode-controls button.active,
	.fleet-controls button.active {
		background: #294e3a;
		color: #fff;
		box-shadow: 0 1px 3px rgb(22 52 35 / 16%);
	}
	button :global(svg) {
		flex-shrink: 0;
	}
	.map-instruction {
		margin: 0;
		color: #62755a;
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
		color: #6b7f61;
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
		border: 1px solid #d7dfd0;
		border-radius: 10px;
		background: #f8faf5;
		color: #294e3a;
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
		outline: 3px solid #7da470;
		outline-offset: 2px;
	}
	.connection-editor :global(.connection-select-trigger[data-state='open']) {
		border-color: #7da470;
		background: #eff3e9;
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
		border: 1px solid #d7dfd0;
		border-radius: 12px;
		background: #fffefb;
		color: #294e3a;
		box-shadow: 0 10px 30px rgb(23 45 30 / 13%);
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
		border-radius: 7px;
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
		background: #edf3e8;
	}
	:global(.connection-select-option[data-selected]) {
		background: #294e3a;
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
		border-radius: 20px;
		background: #e8efdf;
		color: #527348;
		font-size: 11px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
	.stop-sequence {
		display: grid;
		gap: 6px;
		margin: -5px 0 0;
		padding: 0;
		list-style: none;
	}
	.stop-sequence li {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 8px;
		padding: 5px 4px 5px 9px;
		border: 1px solid #dde5d6;
		border-radius: 11px;
		background: #fbfcf8;
	}
	.stop-number {
		display: grid;
		flex-shrink: 0;
		width: 23px;
		height: 23px;
		place-items: center;
		border-radius: 50%;
		background: #e7efe0;
		color: #527348;
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
		border-radius: 8px;
		background: transparent;
		color: #61765a;
	}
	.stop-actions .remove-stop {
		color: #996247;
	}
	.empty-sequence {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: -5px 0 0;
		padding: 12px;
		border: 1px dashed #b9c8b0;
		border-radius: 11px;
		color: #728465;
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
		border: 1px solid #d7dfd0;
		border-radius: 10px;
		background: #f8faf5;
		color: #52654d;
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
		border: 1px solid #d7dfd0;
		border-radius: 12px;
		background: #fffefb;
	}
	.search-field {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-inline: 8px;
		color: #76896b;
	}
	.search-field input {
		width: 100%;
		min-width: 0;
		height: 44px;
		padding: 0 3px;
		border: 0;
		background: transparent;
		color: #294e3a;
		font: inherit;
		font-size: 14px;
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
		border-radius: 7px;
		background: transparent;
		color: #52654d;
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
		color: #7b8b71;
		font-size: 11px;
		line-height: 1.5;
	}
	.service-options {
		border-top: 1px solid #e0e7d9;
		border-bottom: 1px solid #e0e7d9;
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
		color: #7b8b71;
		font-size: 10px;
		font-weight: 500;
	}
	.service-options[open] summary :global(svg) {
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
		padding: 12px;
		border: 1px solid #dedfc6;
		border-radius: 11px;
		background: #f7f8ed;
	}
	.assumed-service p,
	.retained-service {
		margin: 0;
		color: #6b7f61;
		font-size: 12px;
		line-height: 1.5;
	}
	.retained-service span {
		display: block;
		margin-top: 3px;
		color: #527348;
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
		padding: 11px;
		border: 1px solid #cbdcbd;
		border-radius: 11px;
		background: #eff5e9;
		color: #41633b;
		font-size: 13px;
		font-weight: 550;
		line-height: 1.5;
	}
	.validation-message {
		margin: 0;
		color: #9a623e;
		font-size: 12px;
		line-height: 1.5;
	}
	.validation-message.ready {
		color: #537448;
	}
	.assumption-note {
		margin: -3px 0 0;
		color: #829075;
		font-size: 10px;
		line-height: 1.5;
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
		border: 1px solid #d7dfd0;
		border-radius: 10px;
		font-size: 13px;
		font-weight: 600;
		line-height: 1.3;
	}
	.cancel {
		background: #f4f7ee;
		color: #63785b;
	}
	.apply {
		flex: 1;
		border-color: #294e3a !important;
		background: #294e3a;
		color: #fff;
	}
	@media (hover: hover) and (pointer: fine) {
		.stop-actions button:not(:disabled):hover,
		.search-results button:not(:disabled):hover {
			background: #edf3e8;
		}
		.mode-controls button:not(.active):not(:disabled):hover,
		.fleet-controls button:not(.active):not(:disabled):hover,
		.stop-picker-toggle:not(:disabled):hover,
		.cancel:not(:disabled):hover {
			background: #e7eedf;
		}
		.apply:not(:disabled):hover {
			background: #386649;
		}
	}
</style>
