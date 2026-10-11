<script lang="ts">
	import PlanningAtlas from '#lib/components/planning/PlanningAtlas.svelte';
	import { APP_CONFIG } from '#lib/config/app.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{APP_CONFIG.productName}</title>
</svelte:head>

{#if data.planning}
	<PlanningAtlas
		baseline={data.planning}
		snapshotStale={data.snapshotStale}
		transportContext={data.transportContext}
		policyEvidence={data.policyEvidence}
	/>
{:else}
	<main class="snapshot-unavailable">
		<span>Mobility Sandbox MV</span>
		<h1>The public data snapshot is unavailable.</h1>
		<p>{data.unavailable}</p>
		<a href="/">Retry loading the snapshot</a>
	</main>
{/if}

<style>
	.snapshot-unavailable {
		max-width: 700px;
		padding: clamp(24px, 12vh, 100px) clamp(16px, 5vw, 32px);
		margin: auto;
		color: #173b47;
		height: 100dvh;
		overflow: auto;
		overflow-wrap: anywhere;
	}
	.snapshot-unavailable span {
		color: #087c79;
		font-weight: 700;
	}
	.snapshot-unavailable h1 {
		font-size: clamp(24px, 4vw, 32px);
		margin: 24px 0;
	}
	.snapshot-unavailable p {
		line-height: 1.7;
	}
	.snapshot-unavailable a {
		display: inline-block;
		margin-top: 24px;
		color: #087c79;
	}
</style>
