<script lang="ts">
	import { onDestroy } from 'svelte';
	import { shouldAnimateMotion } from '#lib/motion.js';

	let {
		value,
		format = (number: number) => number.toLocaleString(),
		empty = '—',
		animate = true,
		context = '',
		class: className = ''
	}: {
		value: number | null | undefined;
		format?: (value: number) => string;
		empty?: string;
		animate?: boolean;
		context?: string;
		class?: string;
	} = $props();
	const text = $derived(
		value !== null && value !== undefined && Number.isFinite(value) ? format(value) : empty
	);
	let element: HTMLSpanElement;
	let previous: { text: string; context: string } | undefined;
	let animation: Animation | undefined;

	$effect(() => {
		const next = { text, context };
		const changed = previous && previous.context === context && previous.text !== text;
		previous = next;
		animation?.cancel();
		// Display the real result immediately; motion never interpolates invented values.
		if (changed && animate && element && shouldAnimateMotion()) {
			animation = element.animate(
				[
					{ opacity: 0.5, transform: 'translateY(2px)' },
					{ opacity: 1, transform: 'none' }
				],
				{ duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
			);
		}
	});
	onDestroy(() => animation?.cancel());
</script>

<span bind:this={element} class="animated-number {className}">{text}</span>

<style>
	.animated-number {
		display: inline-block;
		font-variant-numeric: tabular-nums;
	}
</style>
