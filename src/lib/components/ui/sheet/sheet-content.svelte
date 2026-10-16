<script lang="ts" module>
	export type Side = 'top' | 'right' | 'bottom' | 'left';
</script>

<script lang="ts">
	import { Dialog as SheetPrimitive } from 'bits-ui';
	import { X } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { resizable } from '#lib/resizable.js';
	import { cn, type WithoutChildrenOrChild } from '#lib/utils.js';
	import SheetOverlay from './sheet-overlay.svelte';
	import SheetPortal from './sheet-portal.svelte';
	import type { Snippet } from 'svelte';
	import type { ComponentProps } from 'svelte';

	let {
		ref = $bindable(null),
		class: className,
		side = 'right',
		showCloseButton = true,
		resizeKey,
		portalProps,
		children,
		...restProps
	}: WithoutChildrenOrChild<SheetPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof SheetPortal>>;
		side?: Side;
		showCloseButton?: boolean;
		/** Remember a desktop drawer size across openings. Omit to keep the default size. */
		resizeKey?: string;
		children: Snippet;
	} = $props();
	$effect(() => {
		if (!ref || !resizeKey) return;
		const resize = resizable(ref, {
			key: resizeKey,
			minWidth: 340,
			minHeight: 360,
			maxWidth: 900,
			anchor: side === 'left' ? 'top-left' : side === 'right' ? 'top-right' : 'center',
			edges:
				side === 'right'
					? ['left', 'bottom', 'bottom-left']
					: side === 'left'
						? ['right', 'bottom', 'bottom-right']
						: undefined,
			viewportMargin: 0
		});
		return () => resize.destroy();
	});
</script>

<SheetPortal {...portalProps}>
	<SheetOverlay />
	<SheetPrimitive.Content
		bind:ref
		data-slot="sheet-content"
		data-side={side}
		data-resize-enabled={resizeKey ? 'true' : undefined}
		class={cn(
			'motion-sheet bg-popover text-popover-foreground fixed z-50 flex flex-col gap-4 bg-clip-padding text-sm shadow-lg data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
		{#if showCloseButton}
			<SheetPrimitive.Close data-slot="sheet-close">
				{#snippet child({ props })}
					<Button variant="ghost" class="absolute top-4 right-4" size="icon-sm" {...props}>
						<X />
						<span class="sr-only">Close</span>
					</Button>
				{/snippet}
			</SheetPrimitive.Close>
		{/if}
	</SheetPrimitive.Content>
</SheetPortal>

<style>
	:global(.motion-sheet) {
		--sheet-enter-x: 0px;
		--sheet-enter-y: 0px;
	}
	:global(.motion-sheet[data-side='left']) {
		--sheet-enter-x: -18px;
	}
	:global(.motion-sheet[data-side='right']) {
		--sheet-enter-x: 18px;
	}
	:global(.motion-sheet[data-side='top']) {
		--sheet-enter-y: -18px;
	}
	:global(.motion-sheet[data-side='bottom']) {
		--sheet-enter-y: 18px;
	}
	:global(.motion-sheet[data-state='open']) {
		animation: sheet-enter 230ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	:global(.motion-sheet[data-state='closed']) {
		animation: sheet-exit 150ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	:global(.motion-sheet[data-resize-enabled='true']) {
		max-width: min(900px, 100vw);
	}
	@keyframes sheet-enter {
		from {
			opacity: 0;
			transform: translate3d(var(--sheet-enter-x), var(--sheet-enter-y), 0);
		}
		to {
			opacity: 1;
			transform: translate3d(0, 0, 0);
		}
	}
	@keyframes sheet-exit {
		from {
			opacity: 1;
			transform: translate3d(0, 0, 0);
		}
		to {
			opacity: 0;
			transform: translate3d(var(--sheet-enter-x), var(--sheet-enter-y), 0);
		}
	}
	:global(html[data-motion-input='keyboard'] .motion-sheet[data-state]) {
		animation: none;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.motion-sheet[data-state][data-side]) {
			--sheet-enter-x: 0px;
			--sheet-enter-y: 0px;
			animation-duration: 80ms;
		}
	}
</style>
