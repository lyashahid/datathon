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
		'Resident distribution varies by island. Some islands use approximate allocations; check the method before comparing neighbourhoods.',
	worldpop_calibrated:
		'Resident estimates use WorldPop density weights scaled to the official island total. Neighbourhood counts are estimates.',
	uniform_mapped_residential_area:
		'Residents are estimated evenly across residential land. Local density and complete residential coverage are unverified.',
	residential_building_footprint_area:
		'Resident estimates follow residential building footprints. Occupancy, floor counts and complete building coverage are unverified.',
	assumed_uniform_land:
		'Residents are estimated evenly across the island, including potentially uninhabited land. This is an approximate distribution.'
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
				? 'Journeys use timetables valid for the selected date.'
				: coverage?.timetable_status === 'unavailable'
					? 'A timetable is unavailable here. Walking times to stops are estimated; service times need confirmation.'
					: 'Stop locations are shown. Scheduled journeys also require a timetable valid for the selected date.'
	};
}
