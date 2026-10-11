<script lang="ts">
	import { ToggleGroup } from 'bits-ui';
	import { HeartPulse, School } from '@lucide/svelte';

	type DestinationGoal = 'healthcare' | 'education';
	let {
		value,
		onchange
	}: {
		value: DestinationGoal;
		onchange: (value: DestinationGoal) => void;
	} = $props();

	function getValue(): DestinationGoal {
		return value;
	}

	function setValue(next: string): void {
		// A destination must stay selected; clicking the active choice keeps it active.
		if ((next === 'healthcare' || next === 'education') && next !== value) onchange(next);
	}
</script>

<div class="destination-picker">
	<ToggleGroup.Root
		type="single"
		bind:value={getValue, setValue}
		orientation="horizontal"
		aria-label="Destination type"
		class="destination-group"
	>
		<ToggleGroup.Item value="healthcare" aria-label="General healthcare" class="destination-option">
			<HeartPulse size={17} strokeWidth={1.8} aria-hidden="true" />
			<span>Healthcare</span>
		</ToggleGroup.Item>
		<ToggleGroup.Item value="education" aria-label="Schools" class="destination-option">
			<School size={17} strokeWidth={1.8} aria-hidden="true" />
			<span>Schools</span>
		</ToggleGroup.Item>
	</ToggleGroup.Root>
</div>

<style>
	.destination-picker {
		max-width: 100%;
		min-width: 0;
		flex-shrink: 0;
	}
	.destination-picker :global(.destination-group) {
		display: flex;
		align-items: center;
		gap: 2px;
		box-sizing: border-box;
		min-width: 0;
		max-width: 100%;
		height: 40px;
		padding: 3px;
		border: 1px solid #d7dfd0;
		border-radius: 12px;
		background: #eff3e9;
	}
	.destination-picker :global(.destination-option) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-width: 0;
		flex: 1;
		height: 32px;
		padding: 0 12px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: #52654d;
		font: inherit;
		font-size: 14px;
		font-weight: 550;
		line-height: 1;
		white-space: nowrap;
		cursor: pointer;
	}
	.destination-picker :global(.destination-option[data-state='on']) {
		background: #294e3a;
		color: #fff;
		box-shadow: 0 1px 3px rgb(22 52 35 / 16%);
	}
	.destination-picker :global(.destination-option:focus-visible) {
		position: relative;
		z-index: 1;
		outline: 2px solid #7da470;
		outline-offset: 2px;
	}
	.destination-picker :global(.destination-option svg) {
		flex-shrink: 0;
	}
	@media (hover: hover) and (pointer: fine) {
		.destination-picker :global(.destination-option[data-state='off']:hover) {
			background: #e3eadb;
			color: #294e3a;
		}
	}
	@media (max-width: 380px) {
		.destination-picker :global(.destination-option) {
			gap: 6px;
			padding: 0 9px;
		}
	}
	@media (pointer: coarse) {
		.destination-picker :global(.destination-group) {
			height: 52px;
		}
		.destination-picker :global(.destination-option) {
			height: 44px;
		}
	}
</style>
