import type { TransitionConfig } from 'svelte/transition';
import { shouldAnimateMotion } from '#lib/motion.js';

/** Keep the map and its data in place while a floating surface enters or leaves. */
export function surfaceMotion(
	_node: Element,
	{
		direction = 'in',
		axis = 'x',
		distance = 12,
		scale = 1,
		origin = 'center',
		duration = direction === 'in' ? 220 : 140,
		delay = 0
	}: {
		direction?: 'in' | 'out';
		axis?: 'x' | 'y';
		distance?: number;
		scale?: number;
		origin?: string;
		duration?: number;
		delay?: number;
	} = {}
): TransitionConfig {
	const animate = shouldAnimateMotion();
	return {
		duration: animate ? duration : 0,
		delay: animate ? delay : 0,
		easing: (value) => 1 - (1 - value) ** 4,
		css: (value) =>
			`opacity:${value};transform-origin:${origin};transform:translate${axis.toUpperCase()}(${(1 - value) * distance}px) scale(${scale + (1 - scale) * value})`
	};
}

/** Unfold directions from the search field without scaling the inputs or their text. */
export function searchExpansion(node: Element): TransitionConfig {
	const height = Math.max(40, node.getBoundingClientRect().height);
	return {
		duration: shouldAnimateMotion() ? 260 : 0,
		easing: (value) => 1 - (1 - value) ** 4,
		css: (value) =>
			`height:${40 + (height - 40) * value}px;min-height:0;overflow:hidden;opacity:${value}`
	};
}
