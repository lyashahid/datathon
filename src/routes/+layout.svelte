<script lang="ts">
	import './layout.css';
	import { themeCss } from '#lib/theme.js';
	import type { LayoutProps } from './$types';
	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href="data:," />
	<svelte:element this={"style"} id="app-theme">{themeCss}</svelte:element>
</svelte:head>
{@render children()}
