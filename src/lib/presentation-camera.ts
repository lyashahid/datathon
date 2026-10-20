export type PresentationPadding = {
	top: number;
	right: number;
	bottom: number;
	left: number;
};

export type PresentationSafeFrame = {
	left: number;
	right: number;
	top: number;
	bottom: number;
};

/** A time-based response stays the same on 30, 60 and 120 Hz displays. */
export function presentationDamping(elapsedMs: number, responseMs = 140): number {
	if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
	if (!Number.isFinite(responseMs) || responseMs <= 0) return 1;
	return 1 - Math.exp(-elapsedMs / responseMs);
}

/** Turn through north by the short route without a frame-dependent rotation speed. */
export function presentationDampedBearing(
	current: number,
	target: number,
	elapsedMs: number,
	responseMs = 100
): number {
	if (!Number.isFinite(target)) return Number.isFinite(current) ? current : 0;
	if (!Number.isFinite(current)) return target;
	const turn = ((((target - current) % 360) + 540) % 360) - 180;
	return current + turn * presentationDamping(elapsedMs, responseMs);
}

/** Preserve the established departure composition, then continuously track the route. */
export function presentationFollowPoint(
	departureCenter: readonly [number, number],
	departurePoint: readonly [number, number],
	target: readonly [number, number],
	progress: number
): [number, number] {
	const fraction = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress / 0.28)) : 0;
	const remainingOffset = 1 - fraction * fraction * (3 - 2 * fraction);
	return [
		target[0] + (departureCenter[0] - departurePoint[0]) * remainingOffset,
		target[1] + (departureCenter[1] - departurePoint[1]) * remainingOffset
	];
}

/** Ease away from departure framing and return to arrival framing without abrupt zoom changes. */
export function presentationTravelEnvelope(fraction: number): number {
	const progress = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
	const smooth = (value: number) => value * value * (3 - 2 * value);
	if (progress < 0.22) return smooth(progress / 0.22);
	if (progress > 0.76) return smooth((1 - progress) / 0.24);
	return 1;
}

function usableAxis(size: number, start: number, end: number): [number, number] {
	const extent = Number.isFinite(size) ? Math.max(0, size) : 0;
	const leading = Number.isFinite(start) ? Math.max(0, start) : 0;
	const trailing = Number.isFinite(end) ? Math.max(0, end) : 0;
	const scale = Math.min(1, extent / (leading + trailing || 1));
	return [leading * scale, extent - trailing * scale];
}

/** Let the vehicle move naturally within the visible canvas before recentering the camera. */
export function presentationSafeFrame(
	width: number,
	height: number,
	padding: PresentationPadding
): PresentationSafeFrame {
	const [left, right] = usableAxis(width, padding.left, padding.right);
	const [top, bottom] = usableAxis(height, padding.top, padding.bottom);
	const horizontalInset = (right - left) * 0.2;
	const verticalInset = (bottom - top) * 0.18;
	return {
		left: left + horizontalInset,
		right: right - horizontalInset,
		top: top + verticalInset,
		bottom: bottom - verticalInset
	};
}

export function presentationOutsideSafeFrame(
	point: { x: number; y: number },
	frame: PresentationSafeFrame
): boolean {
	return (
		!Number.isFinite(point.x) ||
		!Number.isFinite(point.y) ||
		point.x < frame.left ||
		point.x > frame.right ||
		point.y < frame.top ||
		point.y > frame.bottom
	);
}
