<script lang="ts">
	import './layout.css';
	import type { LayoutProps } from './$types';
	import MobilityWorkspace from '#lib/components/workspace/MobilityWorkspace.svelte';
	import { page } from '$app/state';

	let { children, data }: LayoutProps = $props();
	const pathname = $derived(page.url.pathname);
</script>

<svelte:head>
	<link rel="icon" href="data:," />
</svelte:head>

{#if ['/', '/forecasts', '/decisions', '/evidence'].includes(pathname)}
	<MobilityWorkspace {data} />
{:else}
	{@render children()}
{/if}
