<script lang="ts">
	import { onMount, tick, type Snippet } from 'svelte';

	let {
		title,
		summary,
		expanded = $bindable(false),
		children,
		onclose,
		onextent
	}: {
		title: string;
		summary?: string;
		expanded: boolean;
		children: Snippet;
		onclose: () => void;
		onextent?: (height: number) => void;
	} = $props();

	const uid = $props.id();
	const bodyId = `${uid}-body`;
	let sheet: HTMLElement;
	let header: HTMLDivElement;
	let toggle: HTMLButtonElement;
	let body: HTMLDivElement;

	$effect(() => {
		// A hidden form should never leave keyboard focus stranded in the drawer.
		if (!expanded && body?.contains(document.activeElement)) toggle?.focus();
	});

	onMount(() => {
		let mounted = true;
		void tick().then(() => {
			if (mounted) toggle.focus({ preventScroll: true });
		});
		let lastHeight = -1;
		const reportExtent = () => {
			const height = Math.ceil(sheet.getBoundingClientRect().height);
			if (height === lastHeight) return;
			lastHeight = height;
			onextent?.(height);
		};
		const observer = new ResizeObserver(reportExtent);
		observer.observe(sheet);
		reportExtent();

		let gesture: {
			id: number;
			x: number;
			y: number;
			capture: HTMLElement;
		} | null = null;
		let suppressClick = false;

		const startSwipe = (event: PointerEvent) => {
			if (!event.isPrimary || event.button !== 0) return;
			suppressClick = false;
			const target = event.target as Element;
			if (target.closest('[data-sheet-close]')) return;
			// Capture on the original button, so a normal tap still activates it.
			const capture = (target.closest('button') ?? header) as HTMLElement;
			gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, capture };
			capture.setPointerCapture(event.pointerId);
		};
		const finishSwipe = (event: PointerEvent) => {
			if (!gesture || gesture.id !== event.pointerId) return;
			const { x, y, capture } = gesture;
			gesture = null;
			const dy = event.clientY - y;
			const dx = event.clientX - x;
			if (Math.abs(dy) >= 35 && Math.abs(dy) > Math.abs(dx) * 1.2) {
				expanded = dy < 0;
				suppressClick = true;
				event.preventDefault();
			}
			if (capture.hasPointerCapture(event.pointerId))
				capture.releasePointerCapture(event.pointerId);
		};
		const cancelSwipe = () => {
			gesture = null;
			suppressClick = false;
		};
		const preventSwipeClick = (event: MouseEvent) => {
			if (!suppressClick || event.detail === 0) return;
			suppressClick = false;
			event.preventDefault();
			event.stopPropagation();
		};

		header.addEventListener('pointerdown', startSwipe);
		header.addEventListener('pointerup', finishSwipe);
		header.addEventListener('pointercancel', cancelSwipe);
		header.addEventListener('click', preventSwipeClick, true);

		return () => {
			mounted = false;
			observer.disconnect();
			header.removeEventListener('pointerdown', startSwipe);
			header.removeEventListener('pointerup', finishSwipe);
			header.removeEventListener('pointercancel', cancelSwipe);
			header.removeEventListener('click', preventSwipeClick, true);
			onextent?.(0);
		};
	});
</script>

<aside class="mobile-sheet" class:expanded bind:this={sheet} aria-label={title}>
	<div class="sheet-header" bind:this={header}>
		<span class="grab-handle" aria-hidden="true"></span>
		<button
			class="sheet-toggle"
			bind:this={toggle}
			aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title} details`}
			aria-expanded={expanded}
			aria-controls={bodyId}
			onclick={() => (expanded = !expanded)}
		>
			<span class="sheet-heading">
				<strong>{title}</strong>
				<span>{summary ?? (expanded ? 'Return to the map' : 'Open details')}</span>
			</span>
			<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
				<path
					d={expanded ? 'm5 7.5 5 5 5-5' : 'm5 12.5 5-5 5 5'}
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
		<button class="sheet-close" data-sheet-close aria-label="Close selection" onclick={onclose}>
			<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
				<path
					d="m5 5 10 10M15 5 5 15"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
				/>
			</svg>
		</button>
	</div>
	<div class="sheet-body" id={bodyId} bind:this={body} hidden={!expanded}>
		{@render children()}
	</div>
</aside>

<style>
	.mobile-sheet {
		position: fixed;
		z-index: 30;
		inset-inline: 10px;
		bottom: calc(var(--mobile-sheet-bottom, 76px) + env(safe-area-inset-bottom, 0px));
		display: flex;
		flex-direction: column;
		max-height: min(
			68dvh,
			520px,
			calc(
				100dvh - var(--mobile-sheet-top, 160px) - var(--mobile-sheet-bottom, 76px) -
					env(safe-area-inset-bottom, 0px) - 12px
			)
		);
		min-width: 0;
		overflow: hidden;
		border: 1px solid #dce1e3;
		border-radius: var(--surface-radius-mobile, 24px);
		background: #fff;
		color: #223740;
		box-shadow: var(--surface-shadow-raised, 0 12px 36px #102e3418, 0 2px 6px #102e340a);
		transition:
			transform 180ms cubic-bezier(0.32, 0.72, 0, 1),
			opacity 180ms ease-out;
	}

	@starting-style {
		.mobile-sheet {
			transform: translateY(8px);
			opacity: 0;
		}
	}

	.sheet-header {
		position: relative;
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 6px;
		min-height: 82px;
		padding: 17px 12px 9px;
		box-sizing: border-box;
		touch-action: none;
	}

	.grab-handle {
		position: absolute;
		top: 8px;
		left: calc(50% - 18px);
		width: 36px;
		height: 4px;
		border-radius: var(--surface-radius-pill, 999px);
		background: rgb(22 63 82 / 20%);
		pointer-events: none;
	}

	.sheet-toggle,
	.sheet-close {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		border: 0;
		border-radius: var(--surface-radius-pill, 999px);
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.sheet-toggle {
		flex: 1;
		gap: 10px;
		justify-content: space-between;
		min-width: 0;
		padding: 5px 6px;
		text-align: left;
	}

	.sheet-heading {
		display: grid;
		gap: 4px;
		min-width: 0;
	}

	.sheet-heading strong {
		font-size: 16px;
		font-weight: 650;
		line-height: 1.25;
		overflow-wrap: anywhere;
	}

	.sheet-heading > span {
		overflow: hidden;
		color: #5b717a;
		font-size: 13px;
		line-height: 1.3;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sheet-toggle svg {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		color: #077f7d;
	}

	.sheet-close {
		width: 44px;
		flex: 0 0 44px;
		padding: 0;
	}

	.sheet-close svg {
		width: 18px;
		height: 18px;
	}

	.sheet-toggle:focus-visible,
	.sheet-close:focus-visible {
		outline: 2px solid #077f7d;
		outline-offset: 2px;
	}

	.sheet-toggle:active,
	.sheet-close:active {
		background: #eaf4f1;
	}

	.sheet-body {
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
		padding: 0 18px 18px;
		border-top: 1px solid rgb(22 63 82 / 8%);
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
	}

	.sheet-body[hidden] {
		display: none;
	}

	@media (hover: hover) and (pointer: fine) {
		.sheet-toggle:hover,
		.sheet-close:hover {
			background: #edf5f2;
		}
	}

	@media (min-width: 480px) and (max-width: 680px) and (max-height: 500px) {
		.mobile-sheet {
			inset-inline-start: auto;
			inset-inline-end: 10px;
			width: calc(50% - 16px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.mobile-sheet {
			transition: none;
		}
	}
</style>
