import type { FerryConnectivity } from './ferry-planning.js';
import type { Facility, IslandProfile } from './types.js';

type DomainKey = 'health' | 'education' | 'transport';
type PopulationItem = { label: string; value: number; share: number | null };
export interface IslandOverview {
	score: {
		value: number | null;
		label: string;
		summary: string;
		coverage: string;
		domains: {
			key: DomainKey;
			label: string;
			value: number | null;
			evidence: string;
			explanation: string;
		}[];
	};
	services: {
		key: DomainKey;
		label: string;
		total: number | null;
		items: { label: string; value: number | null; unmapped: number | null }[];
		note: string;
	}[];
	population: {
		total: number | null;
		year: number | null;
		source: string;
		sourceUrl: string | null;
		qualification: string;
		groups: { label: string; items: PopulationItem[] }[];
		ageNote: string;
		ageItems: PopulationItem[];
	};
	pressure: { value: number | null; label: string; explanation: string; density: number | null };
	connections: {
		key: 'land' | 'marine' | 'ferry' | 'air';
		label: string;
		status: 'confirmed' | 'mapped' | 'unconfirmed' | 'unknown';
		statusLabel: string;
		note: string;
	}[];
	notes: string[];
}

const count = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const index = (value: unknown): number | null => {
	const result = count(value);
	return result === null ? null : Math.min(100, result);
};
const sumKnown = (values: (number | null)[]): number | null =>
	values.some((value) => value === null)
		? null
		: values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
const formatted = (value: number) => Math.round(value).toLocaleString('en-US');
const share = (value: number, total: number | null) =>
	total !== null && total > 0 && value <= total ? (value / total) * 100 : null;

function unique(items: Facility[], islandId: string): Facility[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		if (item.island_id && item.island_id !== islandId) return false;
		if (seen.has(item.id)) return false;
		seen.add(item.id);
		return true;
	});
}

function mapped(item: Facility): boolean {
	return (
		!!item.geometry &&
		item.geometry_quality !== 'island_context_only' &&
		item.match_status !== 'island_context_only' &&
		item.match_status !== 'osm_provisional_review_required'
	);
}

function transportKind(item: Facility): 'bus' | 'marine' | 'other' | null {
	const tags = item.tags ?? {};
	if (
		['bus_stop', 'bus_station'].includes(item.category) ||
		['yes', 'designated'].includes(tags.bus) ||
		tags.highway === 'bus_stop' ||
		tags.amenity === 'bus_station'
	)
		return 'bus';
	if (
		['ferry_terminal', 'pier'].includes(item.category) ||
		tags.amenity === 'ferry_terminal' ||
		tags.ferry === 'yes'
	)
		return 'marine';
	return item.category === 'public_transport' || item.category === 'terminal' ? 'other' : null;
}

/** Present island-wide source records without treating missing evidence as absent services. */
export function buildIslandOverview(
	profile: IslandProfile,
	connectivity?: FerryConnectivity | null
): IslandOverview {
	const islandId = profile.island.id;
	const access = profile.accessibility?.island_id === islandId ? profile.accessibility : null;
	const assessment = access?.assessment;
	const infrastructureKnown = Array.isArray(profile.infrastructure?.items);
	// Official facilities may also appear as OSM POIs in transport. Only this inventory
	// supplies healthcare/school counts, and a repeated source ID counts once.
	const infrastructure = unique(profile.infrastructure?.items ?? [], islandId).filter(
		(item) => !item.id.startsWith('osm:')
	);
	const transportKnown = Array.isArray(profile.transport?.items);
	const transport = unique(profile.transport?.items ?? [], islandId);
	const inventoryItem = (category: string, label: string) => {
		const items = infrastructure.filter((item) => item.category === category);
		return {
			label,
			value: infrastructureKnown ? items.length : null,
			unmapped: infrastructureKnown ? items.filter((item) => !mapped(item)).length : null
		};
	};
	const healthItems = [
		inventoryItem('clinic', 'Clinics'),
		inventoryItem('hospital', 'Hospitals'),
		inventoryItem('health_center', 'Health centres')
	];
	const schoolItems = [inventoryItem('school', 'Schools')];
	const transportCounts =
		access?.domains.transport?.mapped_counts ?? assessment?.components.transport;
	const boardingCount = (kind: 'bus' | 'marine' | 'other') =>
		transportKnown ? transport.filter((item) => transportKind(item) === kind).length : null;
	// The access index intentionally restricts marine evidence on capital islands.
	// Its mapped_counts explain scoring policy, not the complete source inventory.
	const bus = boardingCount('bus');
	const marine = boardingCount('marine');
	// Airports are in infrastructure, not the OSM transport/aerodrome POI collection.
	const airport = inventoryItem('airport', 'Airports').value;
	const scoringBus = count(transportCounts?.bus_stop_count) ?? bus;
	const scoringMarine = count(transportCounts?.marine_terminal_count) ?? marine;
	const scoringAirport = count(transportCounts?.airport_count) ?? airport;
	const connectionItems = [
		{ label: 'Bus stops', value: bus, unmapped: null },
		{ label: 'Marine points', value: marine, unmapped: null },
		{ label: 'Other boarding points', value: boardingCount('other'), unmapped: null }
	];
	if (airport !== null && airport > 0)
		connectionItems.push({ label: 'Airports', value: airport, unmapped: null });

	const population = profile.population;
	const official = profile.official_island_context?.census_demographics;
	const census = official?.island_id === islandId ? official : null;
	const total = count(population?.total) ?? count(census?.residents_total);
	const year = count(population?.year) ?? count(census?.year);
	// Do not mix two census populations when source year or resident total disagrees.
	const comparableCensus =
		census && census.year === year && count(census.residents_total) === total ? census : null;
	const groupItems = (entries: [string, unknown][], denominator = total): PopulationItem[] =>
		entries.flatMap(([label, raw]) => {
			const value = count(raw);
			return value === null ? [] : [{ label, value, share: share(value, denominator) }];
		});
	const groups = [
		{
			label: 'Sex distribution',
			items: groupItems([
				['Female', population?.by_sex?.female ?? comparableCensus?.residents_female],
				['Male', population?.by_sex?.male ?? comparableCensus?.residents_male]
			])
		},
		{
			label: 'Nationality',
			items: groupItems([
				['Maldivian', population?.by_nationality?.Maldivian ?? comparableCensus?.maldivians_total],
				['Foreign', population?.by_nationality?.foreign ?? comparableCensus?.foreigners_total]
			])
		}
	].filter((group) => group.items.length > 0);
	const ageGroups = Object.entries(population?.by_age_sex ?? {}).filter(
		([age]) => age.toLowerCase() !== 'all ages'
	);
	let ageItems = groupItems(ageGroups.map(([label, sexes]) => [label, sexes.both]));
	let ageNote = ageItems.length
		? 'Census age groups for island residents.'
		: 'Island age breakdown unavailable. Published age data is not allocated to this island.';
	if (!ageItems.length && comparableCensus) {
		ageItems = groupItems(
			[
				['Children · 0–14', comparableCensus.maldivian_children_0_14_total],
				['Working age · 15–64', comparableCensus.maldivian_working_age_15_64_total],
				['Older adults · 65+', comparableCensus.maldivian_older_adults_65_plus_total]
			],
			count(comparableCensus.maldivians_total)
		);
		if (ageItems.length)
			ageNote = 'Age counts cover resident Maldivians only; shares use the Maldivian population.';
	}

	const pressurePopulation = access?.population;
	const comparablePressure =
		pressurePopulation &&
		count(pressurePopulation.total) === total &&
		(year === null || pressurePopulation.year === year)
			? pressurePopulation
			: null;
	const pressureValue =
		comparablePressure?.density_data_available === false
			? null
			: index(comparablePressure?.density_pressure_score);
	const density = count(comparablePressure?.density_persons_per_km2);
	const densityReference = count(access?.config?.density_reference_persons_per_km2);
	const hasWalkingRoute = ['health', 'education'].some(
		(key) => access?.domains[key]?.distance_method === 'land_graph'
	);
	const connection = connectivity?.origin.id === islandId ? connectivity : null;
	const ferryLinks = (connection?.links ?? []).filter(
		(link) =>
			link.mode === 'ferry' && (link.from_island_id === islandId || link.to_island_id === islandId)
	);
	const datedFerry = ferryLinks.some((link) => link.evidence === 'dated_service');
	const mappedFerry = ferryLinks.some((link) => link.evidence === 'mapped_route');
	const domains = (
		[
			['health', 'Health'],
			['education', 'Education'],
			['transport', 'Transport']
		] as const
	).map(([key, label]) => {
		const reason = assessment?.reasons.find((reason) => reason.domain === key);
		const domain = access?.domains[key];
		const distance = count(domain?.best_distance_m);
		const confirmedFacilities = count(assessment?.components[key]?.facility_count);
		let evidence = 'Distance evidence unavailable';
		let explanation = 'Travel-distance evidence is unavailable.';
		if (key === 'transport') {
			const parts: string[] = [];
			if (scoringBus !== null)
				parts.push(
					scoringBus
						? `${formatted(scoringBus)} bus stop${scoringBus === 1 ? '' : 's'}`
						: 'No bus stops recorded'
				);
			if (scoringAirport !== null)
				parts.push(
					scoringAirport
						? `${formatted(scoringAirport)} airport${scoringAirport === 1 ? '' : 's'}`
						: 'no airport recorded'
				);
			evidence = parts.length ? parts.join(' · ') : 'Transport evidence unavailable';
			explanation = parts.length ? `${parts.join('; ')}.` : 'Transport locations are unconfirmed.';
			if (
				scoringMarine !== null &&
				scoringMarine > 0 &&
				typeof access?.config.include_unverified_marine === 'boolean'
			)
				explanation += access.config.include_unverified_marine
					? ' Marine points included as an assumption.'
					: ' Marine points excluded from this index.';
			else explanation += ' Ferry service checked separately.';
		} else if (distance !== null) {
			const distanceLabel =
				distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${formatted(distance)} m`;
			evidence = `${distanceLabel} · ${
				domain?.distance_method === 'land_graph'
					? 'walking routes'
					: domain?.distance_method === 'straight_line_fallback'
						? 'straight line'
						: 'route basis unconfirmed'
			}`;
			const basis =
				domain?.distance_method === 'land_graph'
					? ' along walking routes.'
					: domain?.distance_method === 'straight_line_fallback'
						? ' in a straight line.'
						: '; route basis unconfirmed.';
			explanation = `Best recorded connection: ${distanceLabel}${basis}`;
			if (domain?.population_pressure_factor !== undefined && domain.population_pressure_factor < 1)
				explanation += ' Resident demand lowers access.';
		} else if (confirmedFacilities !== null) {
			evidence =
				confirmedFacilities > 0
					? `${formatted(confirmedFacilities)} mapped ${key === 'health' ? 'healthcare location' : 'school'}${confirmedFacilities === 1 ? '' : 's'}`
					: 'No confirmed map position';
			explanation =
				confirmedFacilities > 0
					? `${formatted(confirmedFacilities)} mapped ${key === 'health' ? 'healthcare location' : 'school'}${confirmedFacilities === 1 ? '' : 's'}; travel distances unconfirmed.`
					: 'No confirmed map position; services may still exist.';
		}
		return {
			key,
			label,
			value: index(reason?.score ?? assessment?.components[key]?.score ?? domain?.score),
			evidence,
			explanation
		};
	});
	const scoreValue = index(assessment?.score ?? access?.score);
	const inventoryNote = 'Listed facilities include records without a confirmed map position.';
	const rawSource = population?.source;
	return {
		score: {
			value: scoreValue,
			label: assessment?.label || (scoreValue === null ? 'Not assessed' : 'Island access index'),
			summary:
				assessment?.coverage.note ||
				(scoreValue === null
					? 'An access assessment is not available for this island.'
					: 'Combines service locations, travel distances and estimated resident demand.'),
			coverage: assessment?.coverage.label || 'Evidence coverage not assessed',
			domains
		},
		services: [
			{
				key: 'health',
				label: 'Healthcare',
				total: sumKnown(healthItems.map((item) => item.value)),
				items: healthItems,
				note: inventoryNote
			},
			{
				key: 'education',
				label: 'Education',
				total: sumKnown(schoolItems.map((item) => item.value)),
				items: schoolItems,
				note: inventoryNote
			},
			{
				key: 'transport',
				label: 'Transport',
				total: sumKnown(connectionItems.map((item) => item.value)),
				items: connectionItems,
				note: 'Recorded boarding points and airports; locations do not confirm operating services.'
			}
		],
		population: {
			total,
			year,
			source:
				/^mbs/i.test(rawSource ?? '') || (!rawSource && census)
					? 'Maldives Bureau of Statistics'
					: rawSource || 'Source unavailable',
			sourceUrl:
				population?.source_url ||
				(census &&
					profile.official_island_context?.sources.find((source) =>
						source.id.includes('population')
					)?.url) ||
				null,
			qualification:
				population?.qualification ||
				(total === null
					? 'No island-specific resident count is available; population is unknown.'
					: 'Census resident count for the whole island, not a current-year projection.'),
			groups,
			ageNote,
			ageItems
		},
		pressure: {
			value: pressureValue,
			label:
				pressureValue === null
					? 'Not assessed'
					: pressureValue >= 75
						? 'High'
						: pressureValue >= 25
							? 'Moderate'
							: 'Low',
			density,
			explanation:
				pressureValue === null
					? 'Resident population and island area are needed to estimate density pressure.'
					: `Modeled from census residents and mapped island area${densityReference ? ` against a ${formatted(densityReference)} residents/km² reference` : ''}. This is a planning indicator, not measured service capacity.`
		},
		connections: [
			{
				key: 'land',
				label: 'Land access',
				status: hasWalkingRoute || (bus !== null && bus > 0) ? 'mapped' : 'unknown',
				statusLabel: hasWalkingRoute ? 'Walking routes' : bus ? 'Stops mapped' : 'Unconfirmed',
				note: hasWalkingRoute
					? 'Walking-route evidence is available for at least one island service.'
					: bus
						? 'Bus stops are mapped; this does not establish a road connection to another island.'
						: 'No walking-route or bus-stop evidence is available here.'
			},
			{
				key: 'marine',
				label: 'Marine gateway',
				status: marine !== null && marine > 0 ? 'mapped' : 'unknown',
				statusLabel: marine ? 'Mapped' : 'Unconfirmed',
				note: marine
					? `${formatted(marine)} recorded port or pier${marine === 1 ? '' : 's'}; service availability is checked separately.`
					: 'No port or pier is recorded in the available evidence; this does not establish absence.'
			},
			{
				key: 'ferry',
				label: 'Ferry service',
				status: datedFerry
					? 'confirmed'
					: mappedFerry
						? 'mapped'
						: connection
							? 'unconfirmed'
							: 'unknown',
				statusLabel: datedFerry ? 'Dated service' : mappedFerry ? 'Route mapped' : 'Unconfirmed',
				note: datedFerry
					? 'A ferry link has dated service evidence for the selected travel date.'
					: mappedFerry
						? 'A ferry route is mapped, but a dated operating service is unconfirmed.'
						: 'No verified ferry service evidence is available for this island and date.'
			},
			{
				key: 'air',
				label: 'Air access',
				status: airport !== null && airport > 0 ? 'mapped' : 'unknown',
				statusLabel: airport ? 'Airport listed' : 'Unconfirmed',
				note: airport
					? `${formatted(airport)} airport${airport === 1 ? '' : 's'} in the island inventory; flights are not verified.`
					: 'No airport is listed on this island; nearby airports and transfers are not assessed here.'
			}
		],
		notes: [
			'The access index is out of 100; it is not the percentage of residents served.',
			...(assessment?.limitations ?? []).filter(
				(note) => !note.includes('not a percentage of residents served')
			),
			...(profile.data_quality?.warnings ?? [])
		].filter((note, position, notes) => notes.indexOf(note) === position)
	};
}
