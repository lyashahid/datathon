<script lang="ts">
	import LoadingSkeleton from './LoadingSkeleton.svelte';

	let {
		value,
		label = '',
		size = 'compact',
		loading = false
	}: {
		value: number | null;
		label?: string;
		size?: 'compact' | 'hero';
		loading?: boolean;
	} = $props();

	const decimal = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
	const score = $derived(value !== null && Number.isFinite(value) ? value : null);
</script>

<div class="access-score" class:access-score-hero={size === 'hero'} data-testid="access-score">
	{#if loading && score === null}<div class="score-loading">
			<LoadingSkeleton variant="number" label="Loading access index…" />
		</div>{:else}<div class="score-number">
			<span class="score-sr-only">{label ? `${label}. ` : ''}Access index </span>
			<strong aria-hidden={score === null}>{score === null ? '—' : decimal.format(score)}</strong>
			<span class="score-denominator" aria-hidden="true">/100</span>
			<span class="score-sr-only">{score === null ? 'unavailable' : ' out of 100'}</span>
		</div>{/if}
</div>

<style>
	.access-score {
		container-type: inline-size;
		width: 100%;
		min-width: 0;
	}
	.score-number {
		display: flex;
		align-items: baseline;
		gap: 5px;
		min-width: 0;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.score-loading {
		width: 100%;
		max-width: 120px;
		padding-block: 3px;
	}
	.score-number strong {
		font-size: 54px;
		font-weight: 800;
		letter-spacing: -0.055em;
		line-height: 1.08;
	}
	.score-denominator {
		padding-bottom: 2px;
		color: var(--muted-foreground);
		font-size: 13px;
		font-weight: 500;
		letter-spacing: -0.035em;
	}
	.access-score-hero .score-number strong {
		font-size: 64px;
	}
	.access-score-hero .score-denominator {
		font-size: 15px;
	}
	.score-sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	@container (max-width: 320px) {
		.score-number strong,
		.access-score-hero .score-number strong {
			font-size: 46px;
		}
		.score-denominator,
		.access-score-hero .score-denominator {
			font-size: 12px;
		}
	}
	@container (max-width: 260px) {
		.score-number strong,
		.access-score-hero .score-number strong {
			font-size: 40px;
		}
	}
</style>
