<script lang="ts">
	let {
		label = 'Loading…',
		variant = 'rows',
		rows = 3
	}: {
		label?: string;
		variant?: 'rows' | 'overview' | 'route' | 'score' | 'number' | 'chart' | 'ring' | 'metrics';
		rows?: number;
	} = $props();
</script>

<div class={`loading-skeleton loading-skeleton-${variant}`} role="status" aria-label={label}>
	<div class="skeleton-shapes" aria-hidden="true">
		{#if variant === 'overview'}
			<div class="skeleton-panel skeleton-overview-hero">
				<span class="skeleton-line skeleton-label"></span>
				<span class="skeleton-line skeleton-number"></span>
				<div class="skeleton-columns">
					{#each [0, 1, 2] as item (item)}<span class="skeleton-line skeleton-metric"></span>{/each}
				</div>
			</div>
			<div class="skeleton-columns">
				{#each [0, 1] as item (item)}<div class="skeleton-panel skeleton-overview-section">
						<span class="skeleton-line skeleton-label"></span>
						{#each [0, 1, 2] as item (item)}<span class="skeleton-line"></span>{/each}
					</div>{/each}
			</div>
			<div class="skeleton-panel">
				<span class="skeleton-line skeleton-label"></span><span class="skeleton-line"></span>
			</div>
		{:else if variant === 'number'}
			<span class="skeleton-line skeleton-number"></span>
		{:else if variant === 'score'}
			<span class="skeleton-line skeleton-label"></span>
			<span class="skeleton-line skeleton-number"></span>
			<span class="skeleton-line"></span>
		{:else if variant === 'route'}
			<div class="skeleton-route-summary">
				<span class="skeleton-line skeleton-number"></span>
				<span class="skeleton-line skeleton-label"></span>
			</div>
			{#each [0, 1] as item (item)}<div class="skeleton-row">
					<span class="skeleton-line skeleton-icon"></span>
					<div class="skeleton-copy">
						<span class="skeleton-line"></span><span class="skeleton-line skeleton-detail"></span>
					</div>
				</div>{/each}
		{:else if variant === 'metrics'}
			<div class="skeleton-metrics">
				{#each [0, 1, 2, 3] as item (item)}<div class="skeleton-copy">
						<span class="skeleton-line skeleton-number"></span>
						<span class="skeleton-line skeleton-label"></span>
					</div>{/each}
			</div>
		{:else if variant === 'ring'}
			<span class="skeleton-line skeleton-ring"></span>
		{:else if variant === 'chart'}
			<div class="skeleton-chart">
				{#each [38, 64, 48, 84, 58, 72, 43, 61] as height (height)}<span
						class="skeleton-line skeleton-bar"
						style:height={`${height}%`}
					></span>{/each}
			</div>
		{:else}
			{#each [...Array(rows).keys()] as item (item)}<div class="skeleton-row">
					<span class="skeleton-line skeleton-icon"></span>
					<div class="skeleton-copy">
						<span class="skeleton-line"></span><span class="skeleton-line skeleton-detail"></span>
					</div>
				</div>{/each}
		{/if}
	</div>
</div>

<style>
	.loading-skeleton {
		width: 100%;
		min-width: 0;
	}
	.skeleton-shapes {
		display: grid;
		gap: 14px;
	}
	.skeleton-line {
		position: relative;
		display: block;
		width: 100%;
		height: 12px;
		overflow: hidden;
		border-radius: 5px;
		background: color-mix(in srgb, var(--muted-foreground) 13%, var(--background));
	}
	.skeleton-line::after {
		position: absolute;
		inset: 0;
		content: '';
		background: linear-gradient(
			100deg,
			transparent 15%,
			rgb(255 255 255 / 55%) 50%,
			transparent 85%
		);
		transform: translateX(-100%);
		animation: skeleton-shimmer 1.6s linear infinite;
	}
	.skeleton-label {
		width: 45%;
	}
	.skeleton-number {
		width: 42%;
		height: 42px;
		border-radius: 8px;
	}
	.loading-skeleton-number .skeleton-number {
		width: 100%;
		height: var(--skeleton-number-height, 46px);
	}
	.skeleton-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 40px;
	}
	.skeleton-icon {
		flex: 0 0 32px;
		width: 32px;
		height: 32px;
		border-radius: 9px;
	}
	.skeleton-copy {
		display: grid;
		flex: 1;
		gap: 8px;
	}
	.skeleton-detail {
		width: 62%;
		height: 8px;
	}
	.skeleton-panel {
		display: grid;
		gap: 18px;
		padding: 18px;
		border: 1px solid var(--border);
		border-radius: 13px;
	}
	.skeleton-columns {
		display: flex;
		gap: 12px;
	}
	.skeleton-columns > * {
		flex: 1;
		min-width: 0;
	}
	.skeleton-metric {
		height: 38px;
	}
	.skeleton-overview-hero {
		min-height: 190px;
	}
	.skeleton-overview-section {
		min-height: 215px;
	}
	.skeleton-route-summary {
		display: grid;
		gap: 10px;
		margin-bottom: 8px;
	}
	.loading-skeleton-route .skeleton-number {
		height: 23px;
		width: 36%;
	}
	.skeleton-chart {
		display: flex;
		align-items: flex-end;
		justify-content: space-around;
		gap: 12px;
		height: var(--skeleton-chart-height, 210px);
		padding: 24px 10px 18px;
		border-bottom: 1px solid var(--border);
	}
	.skeleton-bar {
		max-width: 38px;
		border-radius: 5px 5px 0 0;
	}
	.skeleton-ring {
		width: var(--skeleton-ring-size, 172px);
		height: var(--skeleton-ring-size, 172px);
		margin: 14px auto;
		border-radius: 50%;
		mask: radial-gradient(transparent 49%, black 50%);
	}
	.skeleton-metrics {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 24px;
	}
	.skeleton-metrics .skeleton-number {
		width: 60%;
		height: 28px;
	}
	@keyframes skeleton-shimmer {
		to {
			transform: translateX(100%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.skeleton-line::after {
			animation: none;
			display: none;
		}
	}
</style>
