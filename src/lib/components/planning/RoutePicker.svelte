<script lang="ts">
	import { Select } from 'bits-ui';
	import { Check, ChevronDown, Route } from '@lucide/svelte';

	type ConnectionItem = { value: string; label: string };
	let {
		value,
		items,
		onchange
	}: {
		value: string;
		items: readonly ConnectionItem[];
		onchange: (value: string) => void;
	} = $props();

	// Bits UI items need nonempty values. Prefix actual IDs to keep the nearest option distinct.
	const nearest = 'nearest';
	const destinationPrefix = 'destination:';
	const options = $derived([
		{ value: nearest, label: 'Nearest destination' },
		...items
			.filter((item) => item.value !== '')
			.map((item) => ({ value: destinationPrefix + item.value, label: item.label }))
	]);

	function getValue(): string {
		return value === '' ? nearest : destinationPrefix + value;
	}

	function setValue(next: string): void {
		if (!options.some((item) => item.value === next)) return;
		const connection = next === nearest ? '' : next.slice(destinationPrefix.length);
		if (connection !== value) onchange(connection);
	}
</script>

<div class="route-picker">
	<Select.Root type="single" items={options} bind:value={getValue, setValue}>
		<Select.Trigger aria-label="Connection" class="route-picker-trigger">
			<Route size={16} strokeWidth={1.8} aria-hidden="true" />
			<span class="route-picker-label"><Select.Value placeholder="Nearest destination" /></span>
			<ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" class="route-picker-chevron" />
		</Select.Trigger>
		<Select.Portal>
			<Select.Content
				class="route-picker-menu"
				align="start"
				sideOffset={6}
				collisionPadding={8}
				strategy="fixed"
			>
				{#each options as item (item.value)}
					<Select.Item value={item.value} label={item.label} class="route-picker-option">
						{#snippet children({ selected })}
							<span>{item.label}</span>
							<span class="route-picker-check" aria-hidden="true">
								{#if selected}<Check size={16} strokeWidth={2} />{/if}
							</span>
						{/snippet}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Portal>
	</Select.Root>
</div>

<style>
	.route-picker {
		width: 100%;
		min-width: 0;
	}
	.route-picker :global(.route-picker-trigger) {
		display: flex;
		align-items: center;
		gap: 8px;
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		height: 40px;
		padding: 0 12px;
		border: 1px solid #d7dfd0;
		border-radius: 10px;
		background: #f8faf5;
		color: #294e3a;
		font: inherit;
		font-size: 14px;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
	}
	.route-picker-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.route-picker :global(.route-picker-trigger svg) {
		flex-shrink: 0;
	}
	.route-picker :global(.route-picker-chevron) {
		color: #6b7a62;
	}
	.route-picker :global(.route-picker-trigger:focus-visible) {
		outline: 2px solid #7da470;
		outline-offset: 2px;
	}
	.route-picker :global(.route-picker-trigger[data-state='open']) {
		border-color: #7da470;
		background: #eff3e9;
	}
	/* The menu is portaled to body; keep its styles independent of the card's ancestry. */
	:global(.route-picker-menu) {
		z-index: 100;
		box-sizing: border-box;
		width: var(--bits-select-anchor-width);
		max-width: min(400px, calc(100vw - 16px));
		max-height: min(320px, var(--bits-select-content-available-height, 320px), calc(100dvh - 16px));
		overflow-y: auto;
		overscroll-behavior: contain;
		scroll-padding: 5px;
		scrollbar-width: thin;
		scrollbar-color: #b9c8b0 transparent;
		padding: 5px;
		border: 1px solid #d7dfd0;
		border-radius: 12px;
		background: #fffefb;
		color: #294e3a;
		box-shadow:
			0 10px 30px rgb(23 45 30 / 13%),
			0 2px 6px rgb(23 45 30 / 6%);
		font: inherit;
		font-size: 14px;
	}
	:global(.route-picker-option) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		box-sizing: border-box;
		min-height: 40px;
		padding: 9px 10px;
		border-radius: 7px;
		outline: none;
		font-weight: 500;
		line-height: 1.4;
		overflow-wrap: anywhere;
		cursor: pointer;
	}
	:global(.route-picker-option[data-highlighted]) {
		background: #edf3e8;
	}
	:global(.route-picker-option > span:first-child) {
		flex: 1;
		min-width: 0;
	}
	:global(.route-picker-option[data-selected]) {
		background: #294e3a;
		color: #fff;
	}
	:global(.route-picker-option[data-selected][data-highlighted]) {
		box-shadow: inset 0 0 0 2px #8fab7f;
	}
	.route-picker-check {
		display: flex;
		flex: 0 0 16px;
		align-items: center;
		justify-content: center;
	}
	@media (hover: hover) and (pointer: fine) {
		.route-picker :global(.route-picker-trigger:hover) {
			border-color: #b5c5aa;
			background: #eff3e9;
		}
	}
	@media (pointer: coarse) {
		.route-picker :global(.route-picker-trigger) {
			height: 44px;
		}
		:global(.route-picker-option) {
			min-height: 44px;
		}
	}
</style>
