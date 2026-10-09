import { FINDING_THRESHOLDS, POPULATION_COVERAGE } from '#lib/config/analysis.ts';
import type { InfrastructureType } from '#lib/types/domain.ts';
import { formatDistance, formatPopulation } from '#lib/utils/format.ts';
import type {
	CoverageMetrics,
	Finding,
	NearbyServices,
	ScoreBreakdown,
	ScoreComponentId
} from '#lib/types/analysis.ts';

/**
 * Rule-based strengths and concerns. Each rule reads one metric and cites it, so every
 * bullet can be traced to a number shown elsewhere in the inspector.
 */
export function deriveFindings(input: {
	originType: InfrastructureType;
	coverage: CoverageMetrics;
	nearby: NearbyServices;
	accessibility: ScoreBreakdown;
}): { strengths: Finding[]; concerns: Finding[] } {
	const { originType, coverage, nearby, accessibility } = input;
	const strengths: Finding[] = [];
	const concerns: Finding[] = [];
	const t = FINDING_THRESHOLDS;

	const band = coverage.bands.find((b) => b.minutes === POPULATION_COVERAGE.bandMinutes);
	if (band && band.population >= t.strongCoveragePopulation) {
		strengths.push({
			id: 'coverage-strong',
			basis: 'coverage',
			text: `${formatPopulation(band.population)} residents live within a ${band.minutes}-minute walk.`
		});
	} else if (band && band.population < t.weakCoveragePopulation) {
		concerns.push({
			id: 'coverage-weak',
			basis: 'coverage',
			text: `Only ${formatPopulation(band.population)} residents live within a ${band.minutes}-minute walk.`
		});
	}

	const component = (id: ScoreComponentId) => accessibility.components.find((c) => c.id === id);
	const connectivity = component('connectivity');
	if (connectivity && connectivity.score >= t.strongComponentScore) {
		strengths.push({
			id: 'connectivity-strong',
			basis: 'connectivity',
			text: `Well connected. ${connectivity.explanation}`
		});
	} else if (connectivity && connectivity.score <= t.weakComponentScore) {
		concerns.push({
			id: 'connectivity-weak',
			basis: 'connectivity',
			text: `Few transport connections. ${connectivity.explanation}`
		});
	}

	const nearestHospital = nearby.hospitals[0];
	if (
		nearestHospital?.sameIsland &&
		nearestHospital.walkMinutes !== null &&
		nearestHospital.walkMinutes <= 10
	) {
		strengths.push({
			id: 'hospital-near',
			basis: 'nearby',
			text: `${nearestHospital.name} is about ${Math.round(nearestHospital.walkMinutes)} minutes away on foot.`
		});
	}
	if (originType !== 'hospital') {
		if (!nearestHospital) {
			concerns.push({
				id: 'hospital-none',
				basis: 'nearby',
				text: `No hospital within ${formatDistance(nearby.searchRadiusM)}.`
			});
		} else if (!nearestHospital.sameIsland) {
			concerns.push({
				id: 'hospital-crossing',
				basis: 'nearby',
				text: `No hospital on this island; the nearest (${nearestHospital.name}, ${formatDistance(nearestHospital.distanceM)}) needs a sea crossing.`
			});
		}
	}

	const service = component('serviceAccess');
	if (service && service.score <= t.weakComponentScore) {
		concerns.push({
			id: 'services-far',
			basis: 'serviceAccess',
			text: `Weak access to core services. ${service.explanation}`
		});
	}

	for (const penalty of accessibility.penalties) {
		concerns.push({ id: `penalty-${penalty.id}`, basis: penalty.id, text: penalty.explanation });
	}

	return { strengths, concerns };
}
