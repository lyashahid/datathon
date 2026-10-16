/** Small, shared motion primitives. Measurements happen on changes, never on an animation loop. */
type SelectionOptions = { selector?: string };

let inputUsers = 0;
let releaseInput: (() => void) | undefined;

function trackInput() {
	if (inputUsers++ === 0) {
		const root = document.documentElement;
		const pointer = () => (root.dataset.motionInput = 'pointer');
		const keyboard = () => (root.dataset.motionInput = 'keyboard');
		const click = (event: MouseEvent) => {
			if (event.detail === 0) keyboard();
		};
		root.dataset.motionInput = 'pointer';
		document.addEventListener('pointerdown', pointer, true);
		document.addEventListener('keydown', keyboard, true);
		document.addEventListener('click', click, true);
		releaseInput = () => {
			document.removeEventListener('pointerdown', pointer, true);
			document.removeEventListener('keydown', keyboard, true);
			document.removeEventListener('click', click, true);
			delete root.dataset.motionInput;
		};
	}
	return () => {
		if (--inputUsers === 0) releaseInput?.();
	};
}

export function shouldAnimateMotion() {
	return (
		typeof window !== 'undefined' &&
		document.documentElement.dataset.motionInput !== 'keyboard' &&
		!window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}

/** One decorative bubble, with the existing buttons and their keyboard semantics left intact. */
export function animatedSelection(node: HTMLElement, options: SelectionOptions = {}) {
	let selector = options.selector ?? '[role="tab"][data-state="active"]';
	const stopInput = trackInput();
	const indicator = document.createElement('span');
	indicator.dataset.selectionIndicator = '';
	indicator.setAttribute('aria-hidden', 'true');
	node.append(indicator);
	node.classList.add('selection-track');
	let frame = 0;
	let pendingAnimate = false;
	let animation: Animation | undefined;
	let selected: Element | null = null;
	let lastGeometry: { x: number; y: number; width: number; height: number } | undefined;
	let ready = false;
	let destroyed = false;
	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

	function measure(animate = false) {
		const target = node.querySelector<HTMLElement>(selector);
		if (!target || !node.getClientRects().length || !target.getClientRects().length) {
			indicator.style.opacity = '0';
			ready = false;
			return;
		}
		const container = node.getBoundingClientRect();
		const rect = target.getBoundingClientRect();
		if (!rect.width || !rect.height) return;
		const vertical = node.dataset.orientation === 'vertical';
		const line = node.dataset.variant === 'line';
		const x =
			line && vertical
				? node.clientWidth - 2
				: rect.left - container.left - node.clientLeft + node.scrollLeft;
		const y =
			line && !vertical
				? node.clientHeight - 2
				: rect.top - container.top - node.clientTop + node.scrollTop;
		const width = line && vertical ? 2 : rect.width;
		const height = line && !vertical ? 2 : rect.height;
		if (
			ready &&
			target === selected &&
			lastGeometry &&
			Math.abs(lastGeometry.x - x) < 0.01 &&
			Math.abs(lastGeometry.y - y) < 0.01 &&
			Math.abs(lastGeometry.width - width) < 0.01 &&
			Math.abs(lastGeometry.height - height) < 0.01
		)
			return;
		const previous = ready ? indicator.getBoundingClientRect() : null;
		animation?.cancel();
		Object.assign(indicator.style, {
			width: `${width}px`,
			height: `${height}px`,
			transform: `translate(${x}px, ${y}px)`,
			opacity: '1'
		});
		node.dataset.selectionReady = '';
		if (animate && previous && shouldAnimateMotion() && target !== selected) {
			const dx = previous.left - (container.left + node.clientLeft - node.scrollLeft + x);
			const dy = previous.top - (container.top + node.clientTop - node.scrollTop + y);
			animation = indicator.animate(
				[
					{
						transform: `translate(${x + dx}px, ${y + dy}px) scale(${previous.width / width}, ${previous.height / height})`
					},
					{ transform: `translate(${x}px, ${y}px) scale(1, 1)` }
				],
				{ duration: 260, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }
			);
		}
		ready = true;
		selected = target;
		lastGeometry = { x, y, width, height };
	}
	function schedule(animate = false) {
		pendingAnimate ||= animate;
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			const requested = pendingAnimate;
			pendingAnimate = false;
			measure(requested);
		});
	}
	const resize = new ResizeObserver(() => schedule());
	function observeSizes() {
		resize.disconnect();
		resize.observe(node);
		for (const tab of node.querySelectorAll<HTMLElement>('button, [role="tab"]'))
			resize.observe(tab);
	}
	const mutations = new MutationObserver((records) => {
		if (records.some((record) => record.type === 'childList')) observeSizes();
		schedule(true);
	});
	mutations.observe(node, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: [
			'data-state',
			'aria-current',
			'data-orientation',
			'data-variant',
			'hidden',
			'class'
		]
	});
	const onScroll = () => schedule();
	const onReducedMotion = () => {
		animation?.cancel();
		schedule();
	};
	node.addEventListener('scroll', onScroll, { passive: true });
	reduceMotion.addEventListener('change', onReducedMotion);
	observeSizes();
	measure();
	void document.fonts.ready.then(() => {
		if (!destroyed) schedule();
	});
	return {
		update(next: SelectionOptions = {}) {
			selector = next.selector ?? '[role="tab"][data-state="active"]';
			schedule(true);
		},
		destroy() {
			destroyed = true;
			cancelAnimationFrame(frame);
			animation?.cancel();
			resize.disconnect();
			mutations.disconnect();
			node.removeEventListener('scroll', onScroll);
			reduceMotion.removeEventListener('change', onReducedMotion);
			indicator.remove();
			node.classList.remove('selection-track');
			delete node.dataset.selectionReady;
			stopInput();
		}
	};
}

/** Reveals retained workspace roots, without remounting expensive maps or losing drafts. */
export function workspaceReveal(node: HTMLElement) {
	const stopInput = trackInput();
	const running = new Map<HTMLElement, Animation>();
	const observer = new MutationObserver((records) => {
		for (const record of records) {
			if (!(record.target instanceof HTMLElement) || record.target.parentElement !== node) continue;
			const panel = record.target;
			running.get(panel)?.cancel();
			running.delete(panel);
			if (panel.hidden || !shouldAnimateMotion()) continue;
			const map = panel.classList.contains('map-workspace');
			const animation = panel.animate(
				[
					{ opacity: 0.35, transform: map ? 'none' : 'translateY(4px)' },
					{ opacity: 1, transform: 'none' }
				],
				{ duration: 170, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
			);
			running.set(panel, animation);
			void animation.finished.then(
				() => running.delete(panel),
				() => {}
			);
		}
	});
	observer.observe(node, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
	return {
		destroy() {
			observer.disconnect();
			for (const animation of running.values()) animation.cancel();
			stopInput();
		}
	};
}
