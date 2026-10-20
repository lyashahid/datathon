export type PresentationTimedStage = { step: number; minutes: number | null | undefined };

/** A story clock advances only within travel stages; explanation stages hold their arrival time. */
export function presentationTimeline(
	step: number,
	progress: number,
	stages: PresentationTimedStage[]
): { elapsedSeconds: number; totalSeconds: number | null; incomplete: boolean } {
	const fraction = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
	let elapsed = 0;
	let total = 0;
	let complete = true;
	let incomplete = false;
	for (const stage of stages) {
		const known =
			typeof stage.minutes === 'number' && Number.isFinite(stage.minutes) && stage.minutes >= 0;
		const part = step > stage.step ? 1 : step === stage.step ? fraction : 0;
		if (!known) {
			complete = false;
			if (part > 0) incomplete = true;
			continue;
		}
		const seconds = stage.minutes! * 60;
		total += seconds;
		elapsed += seconds * part;
	}
	return {
		elapsedSeconds: Math.floor(elapsed),
		totalSeconds: complete ? Math.round(total) : null,
		incomplete
	};
}

export function formatPresentationElapsed(seconds: number): string {
	const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
	const hours = Math.floor(value / 3600);
	const minutes = Math.floor((value % 3600) / 60);
	const rest = String(value % 60).padStart(2, '0');
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
		: `${String(minutes).padStart(2, '0')}:${rest}`;
}

export function formatPresentationTotal(seconds: number | null): string {
	if (seconds === null || !Number.isFinite(seconds)) return 'unconfirmed';
	const minutes = Math.max(0, Math.round(seconds / 60));
	return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
}
