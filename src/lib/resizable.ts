/** Shared, viewport-bounded sizing for desktop panels and dialogs. */
export type ResizeEdge =
	'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type ResizeAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
export type PanelSize = { width: number; height: number };
export type ResizeBounds = {
	minWidth: number;
	minHeight: number;
	maxWidth: number;
	maxHeight: number;
};
type Rect = { left: number; right: number; top: number; bottom: number };
type SizeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type ResizableOptions = {
	/** Stable identity shared by windows which should remember the same size. */
	key: string;
	minWidth?: number;
	minHeight?: number;
	maxWidth?: number;
	maxHeight?: number;
	edges?: ResizeEdge[];
	anchor?: ResizeAnchor;
	breakpoint?: number;
	viewportMargin?: number;
	enabled?: boolean;
};
export type ResizableChange = PanelSize & { custom: boolean; maximized: boolean };

export const PANEL_SIZE_PREFIX = 'vela:panel-size:v1:';
const defaults = { minWidth: 320, minHeight: 300, breakpoint: 760, viewportMargin: 12 };
const controllers = new WeakMap<HTMLElement, { reset: () => void; maximize: () => boolean }>();
const allEdges: ResizeEdge[] = [
	'left',
	'right',
	'top',
	'bottom',
	'top-left',
	'top-right',
	'bottom-left',
	'bottom-right'
];

function positive(value: number | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function clampPanelSize(size: PanelSize, bounds: ResizeBounds): PanelSize {
	return {
		width: Math.round(Math.max(bounds.minWidth, Math.min(bounds.maxWidth, size.width))),
		height: Math.round(Math.max(bounds.minHeight, Math.min(bounds.maxHeight, size.height)))
	};
}

/** Anchor and containing block determine how much space a window can actually use. */
export function panelResizeBounds(
	options: ResizableOptions,
	viewport: PanelSize,
	rect: Rect,
	boundary?: Rect
): ResizeBounds {
	const margin = Math.max(0, options.viewportMargin ?? defaults.viewportMargin);
	const left = Math.max(margin, boundary ? boundary.left + margin : margin);
	const right = Math.min(viewport.width - margin, boundary ? boundary.right - margin : Infinity);
	const top = Math.max(margin, boundary ? boundary.top + margin : margin);
	const bottom = Math.min(viewport.height - margin, boundary ? boundary.bottom - margin : Infinity);
	const anchor = options.anchor ?? 'center';
	const centerX = (rect.left + rect.right) / 2;
	const centerY = (rect.top + rect.bottom) / 2;
	const availableWidth =
		anchor === 'center'
			? 2 * Math.min(centerX - left, right - centerX)
			: anchor.endsWith('right')
				? Math.min(rect.right, right) - left
				: right - Math.max(rect.left, left);
	const availableHeight =
		anchor === 'center'
			? 2 * Math.min(centerY - top, bottom - centerY)
			: anchor.startsWith('bottom')
				? Math.min(rect.bottom, bottom) - top
				: bottom - Math.max(rect.top, top);
	const maxWidth = Math.max(1, Math.min(positive(options.maxWidth, Infinity), availableWidth));
	const maxHeight = Math.max(1, Math.min(positive(options.maxHeight, Infinity), availableHeight));
	return {
		minWidth: Math.min(positive(options.minWidth, defaults.minWidth), maxWidth),
		minHeight: Math.min(positive(options.minHeight, defaults.minHeight), maxHeight),
		maxWidth,
		maxHeight
	};
}

/** Centered windows expand symmetrically; anchored drawers keep their docked edge. */
export function resizedPanelSize(
	initial: PanelSize,
	delta: { x: number; y: number },
	edge: ResizeEdge,
	anchor: ResizeAnchor,
	bounds: ResizeBounds
): PanelSize {
	const multiplier = anchor === 'center' ? 2 : 1;
	return clampPanelSize(
		{
			width:
				initial.width +
				(edge.includes('left') ? -delta.x : edge.includes('right') ? delta.x : 0) * multiplier,
			height:
				initial.height +
				(edge.includes('top') ? -delta.y : edge.includes('bottom') ? delta.y : 0) * multiplier
		},
		bounds
	);
}

export function readPanelSize(storage: SizeStorage | null, key: string): PanelSize | null {
	try {
		const raw = storage?.getItem(PANEL_SIZE_PREFIX + key);
		if (!raw) return null;
		const saved = JSON.parse(raw);
		return saved?.version === 1 &&
			Number.isFinite(saved.width) &&
			Number.isFinite(saved.height) &&
			saved.width > 0 &&
			saved.height > 0
			? { width: saved.width, height: saved.height }
			: null;
	} catch {
		return null;
	}
}

export function savePanelSize(
	storage: SizeStorage | null,
	key: string,
	size: PanelSize | null
): void {
	try {
		if (size) storage?.setItem(PANEL_SIZE_PREFIX + key, JSON.stringify({ version: 1, ...size }));
		else storage?.removeItem(PANEL_SIZE_PREFIX + key);
	} catch {
		// Private browsing and full storage must never prevent interaction.
	}
}

function localStorageOrNull(): Storage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function installStyles(): void {
	if (document.getElementById('vela-window-resize-styles')) return;
	const style = document.createElement('style');
	style.id = 'vela-window-resize-styles';
	style.textContent = `
		[data-resizable="true"] > .window-resize-handle {
			all: unset; box-sizing: border-box; position: absolute; z-index: 30;
			display: flex; align-items: center; justify-content: center;
			color: #78938e; touch-action: none; user-select: none;
		}
		.window-resize-handle::after { content: ''; opacity: .42; border-radius: 3px; transition: opacity 130ms ease; }
		.window-resize-handle:hover::after, .window-resize-handle:focus-visible::after { opacity: 1; }
		.window-resize-handle:focus-visible { outline: 2px solid #0a8176; outline-offset: -2px; border-radius: 5px; }
		.window-resize-handle[data-edge="left"], .window-resize-handle[data-edge="right"] { top: 25px; bottom: 25px; width: 10px; cursor: ew-resize; }
		.window-resize-handle[data-edge="left"] { left: 0; }
		.window-resize-handle[data-edge="right"] { right: 0; }
		.window-resize-handle[data-edge="left"]::after, .window-resize-handle[data-edge="right"]::after { width: 3px; height: 28px; background: currentColor; }
		.window-resize-handle[data-edge="top"], .window-resize-handle[data-edge="bottom"] { left: 25px; right: 25px; height: 10px; cursor: ns-resize; }
		.window-resize-handle[data-edge="top"] { top: 0; }
		.window-resize-handle[data-edge="bottom"] { bottom: 0; }
		.window-resize-handle[data-edge="top"]::after, .window-resize-handle[data-edge="bottom"]::after { height: 3px; width: 28px; background: currentColor; }
		.window-resize-handle[data-edge*="-"] { width: 24px; height: 24px; }
		.window-resize-handle[data-edge^="top-"] { top: 0; }
		.window-resize-handle[data-edge^="bottom-"] { bottom: 0; }
		.window-resize-handle[data-edge$="-left"] { left: 0; }
		.window-resize-handle[data-edge$="-right"] { right: 0; }
		.window-resize-handle[data-edge="top-left"], .window-resize-handle[data-edge="bottom-right"] { cursor: nwse-resize; }
		.window-resize-handle[data-edge="top-right"], .window-resize-handle[data-edge="bottom-left"] { cursor: nesw-resize; }
		.window-resize-handle[data-edge*="-"]::after { width: 10px; height: 10px; background: repeating-linear-gradient(135deg, transparent 0 2px, currentColor 2px 3px, transparent 3px 5px); clip-path: polygon(100% 0,100% 100%,0 100%); }
		.window-resize-handle[data-edge="bottom-left"]::after { transform: rotate(90deg); }
		.window-resize-handle[data-edge="top-left"]::after { transform: rotate(180deg); }
		.window-resize-handle[data-edge="top-right"]::after { transform: rotate(270deg); }
		[data-resizable="true"].is-resizing { transition: none !important; animation: none !important; user-select: none; }
		@media (prefers-reduced-motion: reduce) { .window-resize-handle::after { transition: none; } }
	`;
	document.head.append(style);
}

/** Restore the responsive CSS default and forget the saved preference. */
export function resetResizable(node: HTMLElement): void {
	controllers.get(node)?.reset();
}

/** Maximize without replacing the user's remembered restore size. */
export function toggleResizableMaximized(node: HTMLElement): boolean {
	return controllers.get(node)?.maximize() ?? false;
}

export function resizable(node: HTMLElement, initialOptions: ResizableOptions) {
	let options = initialOptions;
	let preferred = readPanelSize(localStorageOrNull(), options.key);
	let maximized = false;
	let active = false;
	let frame = 0;
	let layoutFrame = 0;
	let pending: PanelSize | null = null;
	let handles: HTMLButtonElement[] = [];
	let liveStatus: HTMLSpanElement | null = null;
	let stopDrag: (() => void) | null = null;
	const dimensionProperties = [
		'width',
		'height',
		'min-width',
		'min-height',
		'max-width',
		'max-height'
	];
	const original = new Map(
		dimensionProperties.map((property) => [
			property,
			{
				value: node.style.getPropertyValue(property),
				priority: node.style.getPropertyPriority(property)
			}
		])
	);
	const originalPosition = node.style.position;
	let positioned = false;

	function restoreDimensions() {
		for (const [property, { value, priority }] of original) {
			if (value) node.style.setProperty(property, value, priority);
			else node.style.removeProperty(property);
		}
		node.style.removeProperty('--resizable-width');
		node.style.removeProperty('--resizable-height');
	}

	function currentSize(): PanelSize {
		return { width: node.offsetWidth, height: node.offsetHeight };
	}

	function bounds(): ResizeBounds {
		const parent = node.offsetParent;
		const parentRect = parent instanceof HTMLElement ? parent.getBoundingClientRect() : undefined;
		return panelResizeBounds(
			options,
			{ width: window.innerWidth, height: window.innerHeight },
			node.getBoundingClientRect(),
			parentRect && parentRect.width > 0 && parentRect.height > 0 ? parentRect : undefined
		);
	}

	function applyBounds(limits: ResizeBounds) {
		node.style.minWidth = `${limits.minWidth}px`;
		node.style.minHeight = `${limits.minHeight}px`;
		node.style.maxWidth = `${limits.maxWidth}px`;
		node.style.maxHeight = `${limits.maxHeight}px`;
	}

	function applySize(size: PanelSize) {
		node.style.width = `${size.width}px`;
		node.style.height = `${size.height}px`;
		node.style.setProperty('--resizable-width', `${size.width}px`);
		node.style.setProperty('--resizable-height', `${size.height}px`);
	}

	function flags() {
		node.dataset.resized = String(Boolean(preferred));
		node.dataset.resizableMaximized = String(maximized);
	}

	function announce() {
		flags();
		const detail: ResizableChange = { ...currentSize(), custom: Boolean(preferred), maximized };
		if (liveStatus)
			liveStatus.textContent = `Window size ${detail.width} by ${detail.height} pixels`;
		node.dispatchEvent(new CustomEvent('resizablechange', { detail }));
	}

	function reset() {
		stopDrag?.();
		preferred = null;
		maximized = false;
		savePanelSize(localStorageOrNull(), options.key, null);
		restoreDimensions();
		if (active) applyBounds(bounds());
		announce();
	}

	function maximize(): boolean {
		if (!active) return false;
		stopDrag?.();
		maximized = !maximized;
		const limits = bounds();
		applyBounds(limits);
		if (maximized) applySize({ width: limits.maxWidth, height: limits.maxHeight });
		else if (preferred) applySize(clampPanelSize(preferred, limits));
		else {
			restoreDimensions();
			applyBounds(bounds());
		}
		announce();
		return maximized;
	}

	function queueSize(size: PanelSize) {
		pending = size;
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			if (pending) applySize(pending);
		});
	}

	function pointerStart(event: PointerEvent, edge: ResizeEdge, handle: HTMLButtonElement) {
		event.stopPropagation();
		if (event.button !== 0 || !event.isPrimary || stopDrag) return;
		event.preventDefault();
		const initial = currentSize();
		const limits = bounds();
		const previous = preferred;
		const previousMaximized = maximized;
		const pointerId = event.pointerId;
		const x = event.clientX;
		const y = event.clientY;
		maximized = false;
		node.classList.add('is-resizing');
		node.dispatchEvent(new CustomEvent('resizablestart'));
		try {
			handle.setPointerCapture(pointerId);
		} catch {
			// Window listeners below also cover unavailable pointer capture.
		}
		function move(moveEvent: PointerEvent) {
			if (moveEvent.pointerId !== pointerId) return;
			moveEvent.preventDefault();
			moveEvent.stopPropagation();
			queueSize(
				resizedPanelSize(
					initial,
					{ x: moveEvent.clientX - x, y: moveEvent.clientY - y },
					edge,
					options.anchor ?? 'center',
					limits
				)
			);
		}
		function finish(commit: boolean) {
			if (!stopDrag) return;
			stopDrag = null;
			if (frame) cancelAnimationFrame(frame);
			frame = 0;
			if (commit) {
				preferred = pending ?? initial;
				applySize(preferred);
				savePanelSize(localStorageOrNull(), options.key, preferred);
			} else {
				preferred = previous;
				maximized = previousMaximized;
				if (previous || previousMaximized) applySize(initial);
				else {
					restoreDimensions();
					applyBounds(limits);
				}
			}
			pending = null;
			node.classList.remove('is-resizing');
			window.removeEventListener('pointermove', move, true);
			window.removeEventListener('pointerup', up, true);
			window.removeEventListener('pointercancel', cancel, true);
			window.removeEventListener('keydown', escape, true);
			handle.removeEventListener('lostpointercapture', cancel);
			if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
			announce();
			node.dispatchEvent(new CustomEvent('resizableend'));
		}
		function up(upEvent: PointerEvent) {
			if (upEvent.pointerId !== pointerId) return;
			upEvent.stopPropagation();
			finish(true);
		}
		function cancel(cancelEvent: PointerEvent) {
			if (cancelEvent.pointerId === pointerId) finish(false);
		}
		function escape(keyEvent: KeyboardEvent) {
			if (keyEvent.key !== 'Escape') return;
			keyEvent.preventDefault();
			keyEvent.stopPropagation();
			finish(false);
		}
		stopDrag = () => finish(false);
		window.addEventListener('pointermove', move, { capture: true, passive: false });
		window.addEventListener('pointerup', up, true);
		window.addEventListener('pointercancel', cancel, true);
		window.addEventListener('keydown', escape, true);
		handle.addEventListener('lostpointercapture', cancel);
	}

	function keyResize(event: KeyboardEvent, edge: ResizeEdge) {
		if (event.key === 'Home') {
			event.preventDefault();
			event.stopPropagation();
			reset();
			return;
		}
		const horizontal = edge.includes('left') || edge.includes('right');
		const vertical = edge.includes('top') || edge.includes('bottom');
		const step = event.shiftKey ? 48 : 16;
		const x = horizontal
			? event.key === 'ArrowLeft'
				? -step
				: event.key === 'ArrowRight'
					? step
					: 0
			: 0;
		const y = vertical
			? event.key === 'ArrowUp'
				? -step
				: event.key === 'ArrowDown'
					? step
					: 0
			: 0;
		if (!x && !y) return;
		event.preventDefault();
		event.stopPropagation();
		preferred = resizedPanelSize(
			currentSize(),
			{ x, y },
			edge,
			options.anchor ?? 'center',
			bounds()
		);
		maximized = false;
		applySize(preferred);
		savePanelSize(localStorageOrNull(), options.key, preferred);
		announce();
	}

	function removeHandles() {
		for (const handle of handles) handle.remove();
		handles = [];
		liveStatus?.remove();
		liveStatus = null;
	}

	function addHandles() {
		installStyles();
		if (getComputedStyle(node).position === 'static') {
			node.style.position = 'relative';
			positioned = true;
		}
		for (const edge of new Set(options.edges ?? allEdges)) {
			const handle = document.createElement('button');
			handle.type = 'button';
			handle.className = 'window-resize-handle';
			handle.dataset.edge = edge;
			handle.setAttribute('aria-label', `Resize window from ${edge.replace('-', ' ')}`);
			handle.title =
				'Drag to resize. Arrow keys resize; Shift for larger steps. Home or double-click resets.';
			handle.addEventListener('pointerdown', (event) => pointerStart(event, edge, handle));
			handle.addEventListener('keydown', (event) => keyResize(event, edge));
			for (const name of ['click', 'mousedown', 'touchstart']) {
				handle.addEventListener(name, (event) => event.stopPropagation());
			}
			handle.addEventListener('dblclick', (event) => {
				event.preventDefault();
				event.stopPropagation();
				reset();
			});
			node.append(handle);
			handles.push(handle);
		}
		liveStatus = document.createElement('span');
		liveStatus.setAttribute('role', 'status');
		liveStatus.style.cssText =
			'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);';
		node.append(liveStatus);
	}

	function refresh() {
		stopDrag?.();
		const shouldActivate =
			options.enabled !== false && window.innerWidth >= (options.breakpoint ?? defaults.breakpoint);
		if (!shouldActivate) {
			active = false;
			removeHandles();
			restoreDimensions();
			if (positioned) {
				node.style.position = originalPosition;
				positioned = false;
			}
			delete node.dataset.resizable;
			delete node.dataset.resized;
			delete node.dataset.resizableMaximized;
			return;
		}
		// A native dialog is mounted before showModal(). Measuring display:none would
		// otherwise save a 1px maximum which prevents it from ever opening correctly.
		if (!node.getClientRects().length || node.offsetWidth <= 0 || node.offsetHeight <= 0) return;
		if (!active) {
			active = true;
			node.dataset.resizable = 'true';
			addHandles();
		}
		const limits = bounds();
		applyBounds(limits);
		if (maximized) applySize({ width: limits.maxWidth, height: limits.maxHeight });
		else if (preferred) applySize(clampPanelSize(preferred, limits));
		flags();
	}

	controllers.set(node, { reset, maximize });
	window.addEventListener('resize', refresh);
	const visibilityObserver = new MutationObserver(() => refresh());
	visibilityObserver.observe(node, { attributes: true, attributeFilter: ['open', 'hidden'] });
	// Also covers a panel becoming visible because an ancestor's display changes.
	// Schedule activation outside ResizeObserver's delivery phase. Adding handles
	// and applying bounds can change layout; writing synchronously here would
	// cause the browser's "undelivered notifications" warning even on first open.
	// Once active, our own resize writes must never interrupt a pointer drag.
	const initialLayoutObserver = new ResizeObserver(() => {
		if (
			active ||
			stopDrag ||
			layoutFrame ||
			options.enabled === false ||
			window.innerWidth < (options.breakpoint ?? defaults.breakpoint) ||
			!node.offsetWidth ||
			!node.offsetHeight
		)
			return;
		layoutFrame = requestAnimationFrame(() => {
			layoutFrame = 0;
			if (!active && !stopDrag) refresh();
		});
	});
	initialLayoutObserver.observe(node);
	refresh();
	return {
		update(next: ResizableOptions) {
			if (JSON.stringify(next) === JSON.stringify(options)) return;
			stopDrag?.();
			const keyChanged = next.key !== options.key;
			const edgesChanged = JSON.stringify(next.edges) !== JSON.stringify(options.edges);
			options = next;
			if (keyChanged) {
				preferred = readPanelSize(localStorageOrNull(), options.key);
				maximized = false;
				restoreDimensions();
			}
			if (edgesChanged && active) {
				removeHandles();
				addHandles();
			}
			refresh();
		},
		destroy() {
			stopDrag?.();
			if (frame) cancelAnimationFrame(frame);
			if (layoutFrame) cancelAnimationFrame(layoutFrame);
			window.removeEventListener('resize', refresh);
			visibilityObserver.disconnect();
			initialLayoutObserver.disconnect();
			removeHandles();
			restoreDimensions();
			if (positioned) node.style.position = originalPosition;
			delete node.dataset.resizable;
			delete node.dataset.resized;
			delete node.dataset.resizableMaximized;
			controllers.delete(node);
		}
	};
}
