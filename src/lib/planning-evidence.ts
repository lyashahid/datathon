export type PopulationBasis =
	| string
	| {
			spatial_method?: string;
			spatialMethod?: string;
			method?: string;
			spatial_quality?: string;
			spatialQuality?: string;
			population_source?: string;
			populationSource?: string;
			population_year?: number | string;
			populationYear?: number | string;
			qualification?: string;
			warnings?: string[];
	  };

export type PlanningCoverage = {
	resident_origins?: number;
	walking_nodes?: number;
	walking_edges?: number;
	healthcare_destinations?: number;
	education_destinations?: number;
	transport_stops?: number;
	scheduled_patterns?: number;
	spatial_quality?: string;
	spatial_method?: string;
	timetable_status?: 'available' | 'unavailable';
	warnings?: string[];
};

const distributionNotes: Record<string, string> = {
	mixed_island_allocations:
		'Mixed resident allocation: some islands use approximate spatial assumptions. Inspect each island’s evidence before interpreting neighbourhood differences.',
	worldpop_calibrated:
		'Modeled distribution: screened WorldPop weights calibrated to the official island total. These are not observed neighbourhood counts.',
	uniform_mapped_residential_area:
		'Approximate distribution: residents spread uniformly across mapped residential land. Local density and mapping completeness are unverified.',
	residential_building_footprint_area:
		'Approximate distribution: residents allocated by mapped residential building footprints. Occupancy, floor counts and mapping completeness are unverified.',
	assumed_uniform_land:
		'Approximate distribution: residents spread uniformly across island land, including potentially uninhabited land. This is not an observed settlement map.'
};

/** Resident allocation and dated transport evidence are independent model capabilities. */
export function planningEvidence(
	basis?: PopulationBasis | null,
	coverage?: PlanningCoverage | null,
	allocation?: { spatial_method?: string; spatial_quality?: string }
) {
	const structured = basis && typeof basis === 'object' ? basis : null;
	const method =
		allocation?.spatial_method ??
		structured?.spatial_method ??
		structured?.spatialMethod ??
		structured?.method ??
		coverage?.spatial_method;
	const quality =
		allocation?.spatial_quality ??
		structured?.spatial_quality ??
		structured?.spatialQuality ??
		coverage?.spatial_quality;
	const approximate = !!quality?.includes('coarse_assumption') || !!method?.includes('uniform');
	const source = structured?.population_source ?? structured?.populationSource;
	const year = structured?.population_year ?? structured?.populationYear;
	const population = source
		? `Resident total: ${source}${year == null ? '' : ` (${year})`}.`
		: year == null
			? null
			: `Resident total reference year: ${year}.`;
	const distribution = method
		? (distributionNotes[method] ??
			(approximate
				? 'Approximate modeled resident distribution; neighbourhood counts are not observed.'
				: null))
		: approximate
			? 'Approximate modeled resident distribution; neighbourhood counts are not observed.'
			: null;
	const qualification = typeof basis === 'string' ? basis : structured?.qualification;
	const warnings = [
		...new Set([...(structured?.warnings ?? []), ...(coverage?.warnings ?? [])])
	].filter((warning) => warning !== qualification && warning !== distribution);
	return {
		approximate,
		population,
		distribution,
		qualification: qualification && qualification !== distribution ? qualification : null,
		warnings,
		timetable:
			coverage?.timetable_status === 'available'
				? 'Dated service evidence is available. Journeys use only services valid for the selected date.'
				: coverage?.timetable_status === 'unavailable'
					? 'No dated timetable is available here. Walking to mapped stops can still be modeled; this does not establish whether transport services operate.'
					: 'Mapped stops show locations. Timetable-based journeys require dated service evidence.'
	};
}
