import type { TransitionConfig } from 'svelte/transition';
import { shouldAnimateMotion } from '#lib/motion.js';

/** Keep the map and its data in place while a floating surface enters or leaves. */
export function surfaceMotion(
	_node: Element,
	{ direction = 'in' }: { direction?: 'in' | 'out' } = {}
): TransitionConfig {
	return {
		duration: shouldAnimateMotion() ? (direction === 'in' ? 220 : 140) : 0,
		easing: (value) => 1 - (1 - value) ** 4,
		css: (value) => `opacity:${value};transform:translateX(${(1 - value) * 12}px)`
	};
}
