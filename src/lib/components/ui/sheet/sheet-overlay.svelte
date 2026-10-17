<script lang="ts">
	import { Dialog as SheetPrimitive } from 'bits-ui';
	import { cn } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: SheetPrimitive.OverlayProps = $props();
</script>

<SheetPrimitive.Overlay
	bind:ref
	data-slot="sheet-overlay"
	class={cn(
		'motion-sheet-overlay bg-foreground/10 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 z-50 duration-150 ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:duration-75',
		className
	)}
	{...restProps}
/>

<style>
	:global(html[data-motion-input='keyboard'] .motion-sheet-overlay[data-state]) {
		animation: none;
	}
</style>
