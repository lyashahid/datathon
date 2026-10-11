<script lang="ts">
	import TransportGraphic from './graphics/TransportGraphic.svelte';
	import type { GraphicKind } from './graphics/transportGraphics';

	let {
		kind,
		title,
		description,
		detail,
		selected = false,
		disabled = false,
		badge,
		onclick
	}: {
		kind: GraphicKind;
		title: string;
		description: string;
		detail?: string;
		selected?: boolean;
		disabled?: boolean;
		badge?: string;
		onclick?: () => void;
	} = $props();
</script>

<button
	type="button"
	class="intervention-card"
	class:selected
	{disabled}
	aria-pressed={selected}
	{onclick}
>
	<span class="artwork" aria-hidden="true"><TransportGraphic {kind} size={80} /></span>
	<span class="copy">
		<span class="title-row">
			<span class="title">{title}</span>
			{#if badge}<span class="badge">{badge}</span>{/if}
		</span>
		<span class="description">{description}</span>
		{#if detail}<span class="detail">{detail}</span>{/if}
	</span>
	<span class="state" aria-hidden="true">
		{#if selected}
			<svg viewBox="0 0 16 16" fill="none"><path d="m3.5 8 3 3 6-6" /></svg>
		{:else}
			<svg viewBox="0 0 16 16" fill="none"><path d="M8 3.5v9M3.5 8h9" /></svg>
		{/if}
	</span>
</button>

<style>
	.intervention-card {
		position: relative;
		display: flex;
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		align-items: center;
		gap: 12px;
		padding: 12px 14px 12px 8px;
		border: 1px solid #dce7e2;
		border-radius: 16px;
		background: #fff;
		color: #233d37;
		text-align: left;
		font: inherit;
		cursor: pointer;
		box-shadow: 0 2px 4px rgb(29 70 53 / 2%);
		transition:
			border-color 160ms ease,
			background-color 160ms ease,
			box-shadow 160ms ease;
	}
	.artwork {
		display: grid;
		width: 80px;
		height: 80px;
		flex-shrink: 0;
		place-items: center;
		border-radius: 13px;
		background: #f1f7f3;
	}
	.copy {
		display: grid;
		flex: 1;
		gap: 5px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.title-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}
	.title {
		font-size: 14px;
		line-height: 1.3;
		font-weight: 650;
		letter-spacing: -0.02em;
	}
	.description {
		color: #60756d;
		font-size: 12px;
		line-height: 1.45;
	}
	.detail {
		color: #2a7965;
		font-size: 11px;
		line-height: 1.4;
		font-weight: 600;
	}
	.badge {
		border-radius: 5px;
		padding: 2px 5px;
		background: #fff0ce;
		color: #886524;
		font-size: 9px;
		font-weight: 650;
	}
	.state {
		display: grid;
		width: 23px;
		height: 23px;
		flex-shrink: 0;
		place-items: center;
		border: 1px solid #d4e3db;
		border-radius: 50%;
		color: #56806f;
	}
	.state svg {
		width: 15px;
		height: 15px;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.selected {
		border-color: #3a977c;
		background: #f0f8f3;
		box-shadow: 0 0 0 1px #3a977c;
	}
	.selected .state {
		border-color: #187d63;
		background: #187d63;
		color: #fff;
	}
	.intervention-card:focus-visible {
		outline: 3px solid #97c7b9;
		outline-offset: 3px;
	}
	.intervention-card:focus-visible,
	.intervention-card:focus-visible * {
		transition: none;
	}
	.intervention-card:disabled {
		cursor: not-allowed;
		opacity: 0.58;
	}
	@media (hover: hover) and (pointer: fine) {
		.intervention-card:not(:disabled):hover {
			border-color: #80b5a3;
			box-shadow: 0 4px 12px rgb(29 70 53 / 7%);
		}
	}
	@media (max-width: 480px) {
		.intervention-card {
			gap: 9px;
			padding: 10px;
		}
		.artwork {
			width: 60px;
			height: 60px;
		}
		.artwork :global(img) {
			max-width: 60px;
			max-height: 60px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.intervention-card {
			transition: none;
		}
	}
</style>
