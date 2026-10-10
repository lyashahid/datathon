/** True when a keyboard event originates from a text-entry control, so global shortcuts should yield. */
export function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

/** Label for the platform's shortcut modifier, for tooltips and hints ("⌘" or "Ctrl+"). */
export function modifierKeyLabel(): string {
	return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
		? '⌘'
		: 'Ctrl+';
}
