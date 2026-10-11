import type {
	PlanningAnalysis,
	PlanningJourney,
	PlanningAssumptions
} from '#lib/planning/types.ts';
import { servicePlaybackFrame } from '#lib/planning/playback.ts';

/** A fixed illustrative trip follows the selected modeled journey; no GPS or traffic inference. */
export function selectedJourneyPlayback(
	journey: PlanningJourney | null,
	analysis: Pick<PlanningAnalysis, 'world'> | null,
	assumptions: PlanningAssumptions,
	sourceReferenceDate: string
) {
	if (!journey || !analysis || journey.status !== 'reachable') return null;
	let at = assumptions.departureMinutes;
	const legs = journey.path.map((leg) => {
		const boarding = at + leg.waitMinutes;
		at = boarding + leg.minutes;
		return { leg, boarding, arrival: at };
	});
	const first = legs.find((item) => item.leg.mode === 'bus' && item.leg.patternId);
	if (!first) return null;
	const original = analysis.world.patterns.find((pattern) => pattern.id === first.leg.patternId);
	if (!original) return null;
	const selected = legs.filter((item) => item.leg.patternId === original.id);
	const start = first.boarding;
	const end = Math.max(...selected.map((item) => item.arrival));
	if (!(end > start)) return null;
	let pattern = original;
	let tripId = first.leg.tripId;
	if (original.timing.kind === 'frequency') {
		const boardIndex = original.stopIds.indexOf(first.leg.from);
		if (boardIndex < 0) return null;
		const segmentMinutes = original.timing.segmentMinutes;
		let clock = start - segmentMinutes.slice(0, boardIndex).reduce((sum, value) => sum + value, 0);
		tripId = `selected-journey-illustration:${start}`;
		pattern = {
			...original,
			provenance: 'assumed',
			timing: {
				kind: 'scheduled',
				trips: [
					{
						id: tripId,
						stopTimes: original.stopIds.map((_, index) => {
							if (index) clock += segmentMinutes[index - 1];
							return { arrivalMinutes: clock, departureMinutes: clock };
						})
					}
				]
			}
		};
	}
	return {
		start,
		end,
		name: original.name,
		qualification: `A dated timetable illustration for the selected option. Movement follows supplied route geometry at uniform progress between stops; it does not show GPS positions, real traffic speed, or the physical fleet. ${original.timing.kind === 'frequency' ? 'One departure is derived from the modeled waiting time and published service interval.' : 'Uses the selected scheduled trip.'}`,
		frame: (clockMinutes: number) =>
			servicePlaybackFrame({
				pattern,
				stops: analysis.world.stops,
				date: assumptions.date,
				clockMinutes,
				tripId,
				sourceReferenceDate
			})
	};
}
