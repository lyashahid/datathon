import type { Coordinates } from './types.js';

export type PresentationTimedStage = { step: number; minutes: number | null | undefined };

export type PresentationPlaybackMode = 'walk' | 'wait' | 'bus' | 'ferry' | 'air' | 'transfer';
export type PresentationPlaybackLeg = {
	mode: PresentationPlaybackMode;
	/** Actual source minutes. Visual weights never change journey duration. */
	minutes: number;
	/** Index of the matching complete, moving scene path. Waits borrow an adjacent path. */
	pathIndex: number;
	/** Relative screen time; omitted weights use the leg's source minutes. */
	weight?: number;
	/** A wait holds the next path's start, or the previous path's end after the last movement. */
	holdAt?: 'start' | 'end';
};
type PresentationSourceLeg = {
	mode: PresentationPlaybackMode;
	minutes: number | null | undefined;
	geometry?: Coordinates[];
};
const knownMinutes = (value: number | null | undefined): value is number =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0;
const progressFraction = (value: number) =>
	Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** Keep the same path order as the scene, without creating a line for stationary waits. */
export function presentationPlaybackLegs(
	legs: PresentationSourceLeg[],
	{ weights = {} }: { weights?: Partial<Record<PresentationPlaybackMode, number>> } = {}
): PresentationPlaybackLeg[] {
	if (!legs.length || legs.some((leg) => !knownMinutes(leg.minutes))) return [];
	const pathIndexes = new Map<number, number>();
	for (const [index, leg] of legs.entries()) {
		if (leg.mode === 'wait') continue;
		const geometry = leg.geometry;
		if (
			!geometry ||
			geometry.length < 2 ||
			geometry.some(
				(point) =>
					point.length !== 2 ||
					!point.every(Number.isFinite) ||
					Math.abs(point[0]) > 180 ||
					Math.abs(point[1]) > 90
			) ||
			!geometry.some((point) => point[0] !== geometry[0][0] || point[1] !== geometry[0][1])
		) {
			// Missing movement geometry must not become an invented wait or joining line.
			return [];
		}
		pathIndexes.set(index, pathIndexes.size);
	}
	if (!pathIndexes.size) return [];
	const modeMinutes = new Map<PresentationPlaybackMode, number>();
	for (const leg of legs) {
		modeMinutes.set(leg.mode, (modeMinutes.get(leg.mode) ?? 0) + leg.minutes!);
	}
	return legs.flatMap((leg, index): PresentationPlaybackLeg[] => {
		if (leg.minutes === 0) return [];
		let pathIndex = pathIndexes.get(index);
		let holdAt: PresentationPlaybackLeg['holdAt'];
		if (leg.mode === 'wait') {
			const next = [...pathIndexes].find(([sourceIndex]) => sourceIndex > index);
			pathIndex = next?.[1] ?? [...pathIndexes.values()].at(-1)!;
			holdAt = next ? 'start' : 'end';
		}
		const requestedWeight = weights[leg.mode];
		return [
			{
				mode: leg.mode,
				minutes: leg.minutes!,
				pathIndex: pathIndex!,
				...(holdAt ? { holdAt } : {}),
				...(requestedWeight != null && Number.isFinite(requestedWeight) && requestedWeight > 0
					? { weight: (requestedWeight * leg.minutes!) / modeMinutes.get(leg.mode)! }
					: {})
			}
		];
	});
}

/** Resolve visual progress into movement and real elapsed time, including stationary waiting. */
export function presentationPlaybackState(progress: number, timeline: PresentationPlaybackLeg[]) {
	if (
		!timeline.length ||
		timeline.some(
			(leg) =>
				!knownMinutes(leg.minutes) ||
				leg.minutes === 0 ||
				!Number.isInteger(leg.pathIndex) ||
				leg.pathIndex < 0
		)
	)
		return null;
	const weights = timeline.map((leg) =>
		leg.weight != null && Number.isFinite(leg.weight) && leg.weight > 0 ? leg.weight : leg.minutes
	);
	const totalWeight = weights.reduce((sum, value) => sum + value, 0);
	const totalMinutes = timeline.reduce((sum, leg) => sum + leg.minutes, 0);
	const target = progressFraction(progress) * totalWeight;
	let previousWeight = 0;
	let previousMinutes = 0;
	for (const [legIndex, leg] of timeline.entries()) {
		const weight = weights[legIndex];
		if (target >= previousWeight + weight && legIndex < timeline.length - 1) {
			previousWeight += weight;
			previousMinutes += leg.minutes;
			continue;
		}
		const fraction = progressFraction((target - previousWeight) / weight);
		const elapsedMinutes = previousMinutes + leg.minutes * fraction;
		const stationary = leg.mode === 'wait';
		return {
			legIndex,
			mode: leg.mode,
			pathIndex: leg.pathIndex,
			pathProgress: stationary ? (leg.holdAt === 'end' ? 1 : 0) : fraction,
			stationary,
			elapsedMinutes,
			totalMinutes,
			clockProgress: elapsedMinutes / totalMinutes
		};
	}
	return null;
}

/** Totals come only from supplied itinerary legs; unavailable durations remain unknown. */
export function presentationJourneySummary(legs: PresentationSourceLeg[]) {
	const sum = (matches: (leg: PresentationSourceLeg) => boolean): number | null => {
		const selected = legs.filter(matches);
		return !legs.length || selected.some((leg) => !knownMinutes(leg.minutes))
			? null
			: selected.reduce((total, leg) => total + leg.minutes!, 0);
	};
	return {
		walkMinutes: sum((leg) => leg.mode === 'walk'),
		waitMinutes: sum((leg) => leg.mode === 'wait'),
		rideMinutes: sum((leg) => leg.mode !== 'walk' && leg.mode !== 'wait'),
		totalMinutes: sum(() => true),
		incomplete: !legs.length || legs.some((leg) => !knownMinutes(leg.minutes))
	};
}

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

/** A calm presenter readout; precise seconds remain available to the clock and map. */
export function formatPresentationElapsedMinutes(seconds: number): string {
	const minutes = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds / 60)) : 0;
	if (minutes >= 1440)
		return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
	return minutes >= 60
		? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
		: `${minutes} min`;
}

export function formatPresentationTotal(seconds: number | null): string {
	if (seconds === null || !Number.isFinite(seconds)) return 'unconfirmed';
	const minutes = Math.max(0, Math.round(seconds / 60));
	if (minutes >= 1440)
		return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h ${minutes % 60}m`;
	return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
}
