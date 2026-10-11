<script lang="ts">
	/**
	 * Svelte application adaptation of useLayouts Discrete Tabs.
	 * Copyright (c) 2025 Urvish Mali. MIT License: docs/licenses/uselayouts.txt.
	 * Source registry: https://uselayouts.com/r/discrete-tabs.json
	 * Upstream: https://github.com/iurvish/uselayouts
	 * Retains separate pill buttons, compact inactive state and an expanding
	 * active label; uses native buttons, roving keyboard focus and CSS, without React/Motion.
	 */
	let {
		items,
		value,
		onchange,
		label = 'View',
		compact = false,
		disabled = false
	}: {
		items: readonly { id: string; label: string }[];
		value: string;
		onchange: (value: string) => void;
		label?: string;
		compact?: boolean;
		disabled?: boolean;
	} = $props();
	let container: HTMLDivElement;
	function move(event: KeyboardEvent, index: number) {
		if (disabled) return;
		const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
		if (!direction && event.key !== 'Home' && event.key !== 'End') return;
		event.preventDefault();
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? items.length - 1
					: (index + direction + items.length) % items.length;
		const item = items[next];
		if (!item) return;
		onchange(item.id);
		container.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
	}
</script>

<div class="discrete-tabs" class:compact bind:this={container} role="group" aria-label={label}>
	{#each items as item, index (item.id)}
		<button
			type="button"
			class:active={value === item.id}
			{disabled}
			aria-pressed={value === item.id}
			aria-label={item.label}
			title={item.label}
			tabindex={value === item.id || (!items.some((entry) => entry.id === value) && index === 0)
				? 0
				: -1}
			onclick={() => onchange(item.id)}
			onkeydown={(event) => move(event, index)}
		>
			<span class="tab-symbol" aria-hidden="true"
				>{#if value === item.id}<svg viewBox="0 0 16 16"><path d="m3.5 8 3 3 6-6" /></svg
					>{:else}<span class="dot"></span>{/if}</span
			>
			<span class="tab-label">{item.label}</span>
		</button>
	{/each}
</div>

<style>
	.discrete-tabs {
		display: flex;
		min-width: 0;
		max-width: 100%;
		align-items: center;
		flex-wrap: wrap;
		gap: 7px;
	}
	button {
		display: flex;
		min-width: 0;
		max-width: 100%;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 34px;
		padding: 7px 11px;
		border: 1px solid #dce6d4;
		border-radius: 20px;
		background: #f6f8ef;
		color: #718568;
		font: inherit;
		font-size: 11px;
		font-weight: 550;
		line-height: 1.25;
		cursor: pointer;
	}
	button.active {
		border-color: #9ebb8a;
		background: #e5efda;
		color: #427340;
		box-shadow: 0 1px 2px rgb(42 81 30 / 5%);
	}
	button:disabled {
		cursor: wait;
		opacity: 0.65;
	}
	.tab-symbol {
		display: grid;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		place-items: center;
	}
	.tab-symbol svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: #a6b79d;
	}
	.tab-label {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.compact button:not(.active) {
		width: 34px;
		padding: 7px;
	}
	.compact button:not(.active) .tab-label {
		display: none;
	}
	button:focus-visible {
		outline: 3px solid #a3bd8d;
		outline-offset: 3px;
	}
	@media (hover: hover) and (pointer: fine) {
		button:not(.active):hover {
			border-color: #b2c7a2;
			background: #eef4e7;
		}
	}
	@media (pointer: coarse) {
		button {
			min-height: 44px;
			min-width: 44px;
		}
		.compact button:not(.active) {
			width: 44px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		button,
		.tab-label {
			transition: none;
		}
	}
</style>
