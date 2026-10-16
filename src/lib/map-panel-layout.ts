const owners = new WeakMap<HTMLElement, HTMLElement>();

/** Reserve map controls beside the actual panel width without changing map or analysis state. */
export function mapPanelLayout(node: HTMLElement, enabled = true) {
	const workspace = node.closest<HTMLElement>('.map-workspace');
	let active = enabled;
	let previousWidth = -1;
	let frame = 0;
	const update = () => {
		if (!workspace || !active || node.getClientRects().length === 0) return;
		const width = node.offsetWidth;
		if (width > 0 && width !== previousWidth) {
			previousWidth = width;
			owners.set(workspace, node);
			workspace.style.setProperty('--map-panel-width', `${width}px`);
		}
	};
	const observer = new ResizeObserver(() => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(update);
	});
	observer.observe(node);
	update();
	return {
		update(enabled: boolean) {
			cancelAnimationFrame(frame);
			active = enabled;
			previousWidth = -1;
			if (active) update();
			else if (workspace && owners.get(workspace) === node) {
				owners.delete(workspace);
				workspace.style.removeProperty('--map-panel-width');
			}
		},
		destroy() {
			cancelAnimationFrame(frame);
			observer.disconnect();
			// A newly opened panel may already own the same workspace during this one's exit.
			if (workspace && owners.get(workspace) === node) {
				owners.delete(workspace);
				workspace.style.removeProperty('--map-panel-width');
			}
		}
	};
}
