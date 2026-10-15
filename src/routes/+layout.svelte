<script lang="ts">
	import './layout.css';
	import type { LayoutProps } from './$types';
	let { children }: LayoutProps = $props();
</script>

<svelte:head><link rel="icon" href="data:," /></svelte:head>
{@render children()}
