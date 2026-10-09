<script lang="ts">
	import AppShell from '#lib/components/layout/AppShell.svelte';
	import { APP_CONFIG } from '#lib/config/app.ts';
	import { Baseline } from '#lib/stores/baseline.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const baseline = $derived(new Baseline(data.infrastructure, data.routes));
</script>

<svelte:head>
	<title>{APP_CONFIG.productName}</title>
</svelte:head>

<AppShell {baseline} />
