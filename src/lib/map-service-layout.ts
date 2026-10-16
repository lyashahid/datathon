/** Reserve map space above a docked phone editor; longer forms scroll within the card. */
export function serviceCardMaxHeight(width: number, top: number, bottom: number): number {
	const available = Math.max(0, bottom - top);
	return width < 700
		? Math.min(available, 320, Math.max(120, available * 0.55))
		: Math.max(160, available);
}

/** Keep routes above the editor's height cap, including terminal marker hit targets. */
export function mobileServiceRoutePadding(
	height: number,
	top: number,
	bottom: number,
	cardHeight: number
) {
	return {
		top: top + 24,
		bottom: height - bottom + cardHeight + 24,
		left: 40,
		right: 40
	};
}
