import type { AccessConditions, DisruptionId, DisruptionScenario } from '#lib/types/disruption.ts';
import { SEA_CROSSING_EQUIVALENT_M } from './scoring.ts';

/** Day-to-day assumptions; every accessibility score defaults to these. */
export const NORMAL_CONDITIONS: AccessConditions = {
	seaCrossingAvailable: true,
	seaCrossingEquivalentM: SEA_CROSSING_EQUIVALENT_M,
	ferryTerminalsInService: true
};

/** Reduced frequency and longer waits make a crossing count this many times its normal cost. */
const MODERATE_CROSSING_MULTIPLIER = 2.5;

export const DISRUPTION_SCENARIOS: readonly DisruptionScenario[] = [
	{
		id: 'normal',
		label: 'Normal Operations',
		shortLabel: 'Normal',
		summary: 'Ferries run to their usual pattern.',
		assumptions: [
			`A sea crossing counts as ${SEA_CROSSING_EQUIVALENT_M.toLocaleString('en-GB')} m of extra travel`,
			'All ferry terminals are in service'
		],
		representativeConditions: 'Calm to moderate seas',
		conditions: NORMAL_CONDITIONS
	},
	{
		id: 'moderateMarine',
		label: 'Moderate Marine Disruption',
		shortLabel: 'Moderate',
		summary: 'Ferries keep sailing on a reduced timetable.',
		assumptions: [
			`Sea crossings take ${MODERATE_CROSSING_MULTIPLIER}× longer (reduced frequency, longer waits): ${(SEA_CROSSING_EQUIVALENT_M * MODERATE_CROSSING_MULTIPLIER).toLocaleString('en-GB')} m equivalent`,
			'All ferry terminals stay in service',
			'Walking, buses and facilities are unaffected'
		],
		representativeConditions: 'Rough seas (waves around 2.5–4 m)',
		conditions: {
			seaCrossingAvailable: true,
			seaCrossingEquivalentM: SEA_CROSSING_EQUIVALENT_M * MODERATE_CROSSING_MULTIPLIER,
			ferryTerminalsInService: true
		}
	},
	{
		id: 'severeMarine',
		label: 'Severe Marine Disruption',
		shortLabel: 'Severe',
		summary: 'All ferry crossings are suspended.',
		assumptions: [
			'No sea crossings: residents can only reach facilities on their own island',
			'Ferry terminals give no transport access',
			'Walking, buses and facilities are unaffected'
		],
		representativeConditions: 'Very rough seas (waves above 4 m) or a port closure',
		conditions: {
			seaCrossingAvailable: false,
			seaCrossingEquivalentM: SEA_CROSSING_EQUIVALENT_M,
			ferryTerminalsInService: false
		}
	}
];

export function getDisruption(id: DisruptionId): DisruptionScenario {
	const scenario = DISRUPTION_SCENARIOS.find((d) => d.id === id);
	if (!scenario) throw new Error(`Unknown disruption scenario: ${id}`);
	return scenario;
}

export const DISRUPTION_LABELS = {
	kind: 'Planning scenario',
	assumptions: 'Simulation assumptions',
	disclaimer:
		'Chosen manually to test resilience. Not a forecast, and not triggered by live weather data.'
} as const;
