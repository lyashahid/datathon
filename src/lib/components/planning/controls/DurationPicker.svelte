<script lang="ts">
	/**
	 * Svelte application adaptation of Rare UI's DurationPicker.
	 * Copyright (c) 2026 Swami Malode. MIT + Commons Clause + Attribution.
	 * Original: https://github.com/swamimalode07/rare-ui/blob/main/components/ui/duration-picker.tsx
	 * Full license: docs/licenses/rare-ui.txt. Rare UI: https://rareui.com
	 * Retains editable duration segments, field clamping, and pen/save control;
	 * replaces Motion/squircle dependencies with native controls and restrained CSS.
	 */
	import { tick } from 'svelte';

	let {
		value,
		onchange,
		label = 'Departures every',
		min = 1,
		max = 180,
		disabled = false
	}: {
		value: number;
		onchange: (minutes: number) => void;
		label?: string;
		min?: number;
		max?: number;
		disabled?: boolean;
	} = $props();
	const PEN_PATH =
		'M3.78181 16.3092L3 21L7.69086 20.2182C8.50544 20.0825 9.25725 19.6956 9.84119 19.1116L20.4198 8.53288C21.1934 7.75922 21.1934 6.5049 20.4197 5.73126L18.2687 3.58024C17.495 2.80658 16.2406 2.80659 15.4669 3.58027L4.88841 14.159C4.30447 14.7429 3.91757 15.4947 3.78181 16.3092Z';
	const TICK_PATH =
		'M7.959 20.513L1.592 12.872L3.128 11.592L8.041 17.487L20.947 3.587L22.413 4.948L7.959 20.513Z';
	const uid = $props.id();
	let editing = $state(false);
	let hoursText = $state('0');
	let minutesText = $state('0');
	let error = $state('');
	let hoursInput = $state<HTMLInputElement>();
	const known = $derived(Number.isInteger(value) && value >= min && value <= max);
	const hours = $derived(known ? Math.floor(value / 60) : null);
	const minutes = $derived(known ? Math.trunc(value) % 60 : null);
	const clampField = (raw: number, maximum: number) =>
		Math.min(maximum, Math.max(0, Math.trunc(raw)));

	function save() {
		if (
			hoursText.trim() === '' ||
			minutesText.trim() === '' ||
			!Number.isInteger(Number(hoursText)) ||
			!Number.isInteger(Number(minutesText))
		) {
			error = 'Enter whole hours and minutes.';
			return;
		}
		const next =
			clampField(Number(hoursText), Math.floor(max / 60)) * 60 +
			clampField(Number(minutesText), 59);
		if (
			Number(hoursText) < 0 ||
			Number(minutesText) < 0 ||
			Number(minutesText) > 59 ||
			Number(hoursText) > Math.floor(max / 60) ||
			next < min ||
			next > max
		) {
			error = `Choose a duration from ${min} to ${max} minutes; the minute field runs from 0 to 59.`;
			return;
		}
		onchange(next);
		editing = false;
		error = '';
	}
	async function toggle() {
		if (disabled) return;
		if (editing) {
			save();
			return;
		}
		hoursText = known ? String(hours) : '0';
		minutesText = known ? String(minutes) : '';
		error = '';
		editing = true;
		await tick();
		hoursInput?.focus();
		hoursInput?.select();
	}
	function keydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			save();
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			editing = false;
			error = '';
		}
	}
</script>

<div class="duration-field">
	<span class="field-label" id={`${uid}-label`}>{label}</span>
	<div
		class="duration-picker"
		class:editing
		class:disabled
		data-slot="duration-picker"
		role="group"
		aria-labelledby={`${uid}-label`}
	>
		{#if editing || (hours !== null && hours > 0)}
			<div class="segment hours" data-slot="duration-picker-segment">
				{#if editing}<input
						bind:this={hoursInput}
						type="number"
						min="0"
						max={Math.floor(max / 60)}
						step="1"
						value={hoursText}
						oninput={(event) => {
							hoursText = event.currentTarget.value;
							error = '';
						}}
						onkeydown={keydown}
						aria-label={`${label}, hours`}
						aria-invalid={!!error}
						aria-describedby={error ? `${uid}-error` : undefined}
						{disabled}
					/>
				{:else}<span class="number">{hours}</span>{/if}
				<span class="unit">hr</span>
			</div>
		{/if}
		<div class="segment minutes" data-slot="duration-picker-segment">
			{#if editing}<input
					id={`${uid}-minutes`}
					type="number"
					min="0"
					max="59"
					step="1"
					value={minutesText}
					oninput={(event) => {
						minutesText = event.currentTarget.value;
						error = '';
					}}
					onkeydown={keydown}
					aria-label={`${label}, minutes`}
					aria-invalid={!!error}
					aria-describedby={error ? `${uid}-error` : undefined}
					{disabled}
				/>
			{:else}<span class="number">{minutes ?? '—'}</span>{/if}
			<span class="unit">min</span>
		</div>
		<button
			type="button"
			class="segment toggle"
			data-slot="duration-picker-toggle"
			onclick={toggle}
			{disabled}
			aria-label={editing ? `Save ${label.toLowerCase()}` : `Edit ${label.toLowerCase()}`}
			aria-expanded={editing}
		>
			<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
				><path d={editing ? TICK_PATH : PEN_PATH} fill="currentColor" />{#if !editing}<path
						d="M14 6L18 10"
						fill="none"
						stroke="#f1f5ed"
						stroke-width="1.5"
						stroke-linecap="round"
					/>{/if}</svg
			>
		</button>
	</div>
	{#if error}<p id={`${uid}-error`} class="error" role="alert">{error}</p>{/if}
	{#if editing}<p class="hint">Enter to save · Escape to cancel</p>{/if}
</div>

<style>
	.duration-field {
		display: grid;
		min-width: 0;
		max-width: 100%;
		overflow-wrap: anywhere;
		justify-items: start;
		gap: 7px;
		color: #294634;
	}
	.field-label {
		color: #6b7f61;
		font-size: 11px;
		font-weight: 550;
	}
	.duration-picker {
		display: flex;
		flex-wrap: wrap;
		max-width: 100%;
		align-items: center;
		gap: 0;
	}
	.segment {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		min-height: 40px;
		min-width: 0;
		box-sizing: border-box;
		padding: 0 10px;
		background: #eff4e9;
	}
	.hours {
		border-radius: 11px 0 0 11px;
	}
	.minutes {
		border-radius: 11px 0 0 11px;
	}
	.hours + .minutes {
		border-radius: 0;
		padding-left: 0;
	}
	.number {
		min-width: 22px;
		color: #315942;
		font-size: 17px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	.unit {
		color: #7a8c6e;
		font-size: 12px;
		font-weight: 550;
	}
	.toggle {
		width: 39px;
		border: 0;
		border-radius: 0 11px 11px 0;
		color: #769168;
		cursor: pointer;
		flex-shrink: 0;
	}
	.editing {
		gap: 6px;
	}
	.editing .segment {
		border-radius: 11px;
	}
	.editing .hours + .minutes {
		padding-left: 10px;
	}
	.editing .toggle {
		background: #e0edd7;
		color: #4a7851;
	}
	input {
		width: 37px;
		min-width: 0;
		height: 31px;
		padding: 0 2px;
		border: 0;
		border-bottom: 1px solid #a7c299;
		outline: none;
		background: transparent;
		color: #315942;
		font: inherit;
		font-size: 16px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		text-align: center;
		appearance: textfield;
	}
	input::-webkit-inner-spin-button,
	input::-webkit-outer-spin-button {
		appearance: none;
		margin: 0;
	}
	input:focus-visible {
		outline: 2px solid #8eb47b;
		outline-offset: 2px;
		border-radius: 4px;
	}
	button:focus-visible {
		outline: 3px solid #8eb47b;
		outline-offset: 2px;
	}
	input[aria-invalid='true'] {
		border-color: #b86548;
	}
	.disabled {
		opacity: 0.55;
	}
	button:disabled {
		cursor: not-allowed;
	}
	.error {
		max-width: 300px;
		margin: 0;
		color: #9a5038;
		font-size: 11px;
		line-height: 1.5;
	}
	.hint {
		margin: 0;
		color: #7e8c73;
		font-size: 10px;
	}
	@media (hover: hover) and (pointer: fine) {
		.toggle:not(:disabled):hover {
			background: #e4eedc;
		}
	}
	@media (pointer: coarse) {
		.segment {
			min-height: 44px;
		}
		.toggle {
			width: 44px;
		}
		input {
			width: 44px;
			height: 44px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.duration-picker,
		.segment {
			transition: none;
		}
	}
</style>
