import { describe, expect, it } from 'vitest';
import { buildIslandOverview } from './island-overview.js';
import type { FerryConnectivity } from './ferry-planning.js';
import type { Accessibility, Facility, IslandProfile } from './types.js';

const profile = (): IslandProfile => ({
	island: { id: 'island:1', name: 'One' },
	population: {
		total: null,
		year: null,
		source: null,
		record_count: 0,
		demographic_breakdown: false
	},
	infrastructure: { items: [], total: 0 },
	transport: { items: [], total: 0 },
	accessibility: null,
	data_quality: {
		warnings: [],
		unresolved_facility_count: 0,
		provisional_facility_count: 0,
		official_facility_count: 0
	}
});
const facility = (id: string, category: string): Facility => ({
	id,
	name: id,
	category,
	island_id: 'island:1',
	geometry: { type: 'Point', coordinates: [73, 4] }
});
const score = (): Accessibility => ({
	island_id: 'island:1',
	score: 56.7,
	confidence: 0.5,
	domains: {
		health: { score: 62, distance_method: 'land_graph', best_distance_m: 264, missing_data: [] },
		education: { score: 72, missing_data: [] },
		transport: { score: 37, missing_data: ['ferry_service_unverified'] }
	},
	missing_data: [],
	explanation: [],
	config: { density_reference_persons_per_km2: 5000 }
});
const connectivity = (): FerryConnectivity => ({
	origin: { id: 'island:1', name: 'One', coordinates: [73, 4] },
	destination: null,
	terminals: { origin: [], destination: [] },
	status: 'dated_service',
	links: [
		{
			id: 'bus:1',
			from_island_id: 'island:1',
			to_island_id: 'island:2',
			name: 'Bus route',
			mode: 'bus',
			evidence: 'dated_service',
			geometry: [],
			departure_count: 12
		}
	],
	reachable_islands: [],
	reasons: [],
	map_features: { type: 'FeatureCollection', features: [] }
});

describe('island overview source semantics', () => {
	it('keeps missing population, score, density and connection evidence unknown', () => {
		const overview = buildIslandOverview(profile());
		expect(overview.score.value).toBeNull();
		expect(overview.population.total).toBeNull();
		expect(overview.population.groups).toEqual([]);
		expect(overview.population.ageItems).toEqual([]);
		expect(overview.pressure.value).toBeNull();
		expect(overview.connections.every((connection) => connection.status === 'unknown')).toBe(true);
		expect(
			overview.connections.some((connection) => connection.statusLabel === 'Unavailable')
		).toBe(false);
		const incomplete = buildIslandOverview({
			island: { id: 'island:1', name: 'One' }
		} as IslandProfile);
		expect(incomplete.services.map((service) => service.total)).toEqual([null, null, null]);
		expect(incomplete.population.total).toBeNull();
		expect(incomplete.score.domains.map((domain) => domain.evidence)).toEqual([
			'Distance evidence unavailable',
			'Distance evidence unavailable',
			'Transport evidence unavailable'
		]);
	});

	it.each([
		{ method: 'land_graph', distance: 264, evidence: '264 m · walking routes' },
		{ method: 'straight_line_fallback', distance: 1250, evidence: '1.3 km · straight line' },
		{ method: undefined, distance: 264, evidence: '264 m · route basis unconfirmed' },
		{ method: 'land_graph', distance: 0, evidence: '0 m · walking routes' },
		{ method: 'land_graph', distance: null, evidence: 'Distance evidence unavailable' }
	])('qualifies compact distance evidence as $evidence', ({ method, distance, evidence }) => {
		const source = profile();
		source.accessibility = score();
		source.accessibility.domains.health.distance_method = method;
		source.accessibility.domains.health.best_distance_m = distance;
		source.accessibility.domains.health.population_pressure_factor = 0.8;
		const health = buildIslandOverview(source).score.domains[0];
		expect(health.evidence).toBe(evidence);
		if (distance !== null) expect(health.explanation).toContain('Resident demand lowers access.');
		expect(health.evidence).not.toContain('Resident demand');
	});

	it('uses confirmed mapped counts when distances are missing without claiming absent services', () => {
		const source = profile();
		source.accessibility = score();
		source.accessibility.domains.health.best_distance_m = null;
		source.accessibility.assessment = {
			score: 56.7,
			out_of: 100,
			label: 'Moderate access index',
			summary: '',
			reasons: [],
			components: {
				health: { score: 62, facility_count: 2 },
				education: { score: 72, facility_count: 0 }
			},
			coverage: {
				status: 'partial',
				label: 'Partial evidence',
				note: '',
				population_available: false,
				scored_domains: 2,
				total_domains: 3
			},
			limitations: []
		};
		const [health, education] = buildIslandOverview(source).score.domains;
		expect(health.evidence).toBe('2 mapped healthcare locations');
		expect(health.explanation).toContain('travel distances unconfirmed');
		expect(education.evidence).toBe('No confirmed map position');
		expect(education.explanation).toContain('services may still exist');
	});

	it('counts official records once and qualifies unlocated facilities without adding OSM duplicates', () => {
		const source = profile();
		const clinic = facility('facility:health:1', 'clinic');
		const unlocated = { ...facility('facility:school:1', 'school'), geometry: undefined };
		const provisional = {
			...facility('facility:health:2', 'hospital'),
			match_status: 'osm_provisional_review_required'
		};
		source.infrastructure.items = [clinic, clinic, provisional, unlocated];
		source.transport.items = [
			facility('osm:clinic:1', 'clinic'),
			facility('osm:school:1', 'school'),
			facility('osm:bus:1', 'bus_stop'),
			{
				...facility('osm:ferry:1', 'public_transport'),
				tags: { ferry: 'yes', public_transport: 'stop_position' }
			}
		] as IslandProfile['transport']['items'];
		const overview = buildIslandOverview(source);
		expect(overview.services[0].total).toBe(2);
		expect(overview.services[0].items.find((item) => item.label === 'Hospitals')?.unmapped).toBe(1);
		expect(overview.services[1].total).toBe(1);
		expect(overview.services[1].items[0].unmapped).toBe(1);
		expect(overview.services[2].total).toBe(2);
		expect(overview.services[2].items.map((item) => item.value)).toEqual([1, 1, 0]);
	});

	it('keeps scoring-specific transport evidence separate from the actual inventory', () => {
		const source = profile();
		source.infrastructure.items = [facility('airport:1', 'airport')];
		source.transport.items = [
			facility('osm:bus:1', 'bus_stop'),
			facility('osm:ferry:1', 'ferry_terminal'),
			facility('osm:ferry:1', 'ferry_terminal')
		] as IslandProfile['transport']['items'];
		source.accessibility = score();
		source.accessibility.domains.transport.mapped_counts = {
			bus_stop_count: 21,
			marine_terminal_count: 2
		};
		source.accessibility.config.include_unverified_marine = false;
		source.accessibility.assessment = {
			score: 56.7,
			out_of: 100,
			label: 'Moderate access index',
			summary: 'Accessibility score: 56.7/100. 3 of 3 service areas have data.',
			reasons: [
				{ domain: 'health', score: 62, text: 'Detailed healthcare reasoning: 62/100.' },
				{ domain: 'transport', score: 37, text: 'No ferry ports are listed.' }
			],
			components: {},
			coverage: {
				status: 'partial',
				label: 'Partial evidence',
				note: '3 of 3 service areas have data.',
				population_available: false,
				scored_domains: 3,
				total_domains: 3
			},
			limitations: ['Inventory locations do not verify operating services.']
		};
		source.data_quality.warnings = ['Some map positions need review.'];
		const overview = buildIslandOverview(source);
		expect(overview.services[2].total).toBe(3);
		expect(overview.services[2].items.map((item) => item.value)).toEqual([1, 1, 0, 1]);
		expect(overview.connections.find((connection) => connection.key === 'air')?.status).toBe(
			'mapped'
		);
		expect(overview.connections.find((connection) => connection.key === 'land')?.statusLabel).toBe(
			'Walking routes'
		);
		expect(overview.score.value).toBe(56.7);
		expect(overview.score.domains[0].explanation).toContain('264 m along walking routes');
		expect(overview.score.domains[2].explanation).toBe(
			'21 bus stops; 1 airport. Marine points excluded from this index.'
		);
		expect(overview.score.domains[2].evidence).toBe('21 bus stops · 1 airport');
		expect(overview.score.summary).toBe('3 of 3 service areas have data.');
		expect(overview.score.domains[0].explanation).not.toContain('62/100');
		expect(overview.score.domains[0].evidence).toBe('264 m · walking routes');
		expect(overview.notes).not.toContain('Detailed healthcare reasoning: 62/100.');
		expect(overview.notes).not.toContain('No ferry ports are listed.');
		expect(overview.notes).toEqual([
			'The access index is out of 100; it is not the percentage of residents served.',
			'Inventory locations do not verify operating services.',
			'Some map positions need review.'
		]);
	});

	it('retains OSM ferry and bus inventory when the scoring policy excludes their evidence', () => {
		const source = profile();
		source.transport.items = [
			facility('osm:ferry:1', 'ferry_terminal'),
			facility('osm:ferry:1', 'ferry_terminal'),
			facility('osm:bus:1', 'bus_stop')
		] as IslandProfile['transport']['items'];
		source.accessibility = score();
		source.accessibility.domains.transport.mapped_counts = {
			bus_stop_count: 0,
			marine_terminal_count: 0,
			airport_count: 0
		};
		const overview = buildIslandOverview(source);
		expect(overview.services[2].total).toBe(2);
		expect(overview.services[2].items.map((item) => item.value)).toEqual([1, 1, 0]);
		expect(overview.connections.find((connection) => connection.key === 'marine')?.status).toBe(
			'mapped'
		);
		expect(overview.connections.find((connection) => connection.key === 'marine')?.note).toContain(
			'1 recorded port or pier'
		);
		expect(overview.score.domains[2].explanation).toContain(
			'No bus stops recorded; no airport recorded.'
		);
		expect(overview.score.domains[2].evidence).toBe('No bus stops recorded · no airport recorded');
	});

	it('never confirms a ferry from bus-only dated service or an unrelated island route', () => {
		const source = profile();
		const connection = connectivity();
		connection.links.push({
			...connection.links[0],
			id: 'ferry:remote',
			mode: 'ferry',
			from_island_id: 'island:3',
			to_island_id: 'island:4'
		});
		expect(
			buildIslandOverview(source, connection).connections.find((item) => item.key === 'ferry')
				?.status
		).toBe('unconfirmed');
		connection.links.push({
			...connection.links[0],
			id: 'ferry:local',
			mode: 'ferry',
			evidence: 'mapped_route'
		});
		expect(
			buildIslandOverview(source, connection).connections.find((item) => item.key === 'ferry')
				?.status
		).toBe('mapped');
		connection.links.at(-1)!.evidence = 'dated_service';
		expect(
			buildIslandOverview(source, connection).connections.find((item) => item.key === 'ferry')
				?.status
		).toBe('confirmed');
	});

	it('keeps census composition and Maldivian age denominators distinct', () => {
		const source = profile();
		source.population = {
			...source.population,
			total: 1000,
			year: 2022,
			source: 'mbs-census-P5',
			by_sex: { female: 450, male: 550 },
			by_nationality: { Maldivian: 800, foreign: 200 }
		};
		source.official_island_context = {
			status: 'available',
			geography_grain: 'administrative_island',
			census_demographics: {
				island_id: 'island:1',
				year: 2022,
				residents_total: 1000,
				maldivians_total: 800,
				maldivian_children_0_17_total: 240,
				maldivian_children_0_14_total: 200,
				maldivian_working_age_15_64_total: 520,
				maldivian_older_adults_65_plus_total: 80
			},
			employment: [],
			projections: [],
			transform_version: null,
			sources: [],
			qualifications: []
		};
		const overview = buildIslandOverview(source);
		expect(overview.population.groups[0].items[0].share).toBe(45);
		expect(overview.population.groups[1].items[0].share).toBe(80);
		expect(overview.population.ageItems.map((item) => item.share)).toEqual([25, 65, 10]);
		expect(overview.population.ageNote).toContain('Maldivians only');
		source.official_island_context.census_demographics!.island_id = 'island:2';
		expect(buildIslandOverview(source).population.ageItems).toEqual([]);
	});

	it('preserves a real zero and labels modeled density pressure without inventing a population', () => {
		const source = profile();
		source.population.total = 0;
		source.accessibility = score();
		source.accessibility.score = 0;
		source.accessibility.population = {
			total: 0,
			year: null,
			density_pressure_score: 0,
			density_persons_per_km2: 0,
			density_data_available: true
		};
		const overview = buildIslandOverview(source);
		expect(overview.score.value).toBe(0);
		expect(overview.population.total).toBe(0);
		expect(overview.pressure.value).toBe(0);
		expect(overview.pressure.explanation).toContain('planning indicator');
		expect(overview.pressure.explanation).toContain('5,000 residents/km²');
		source.accessibility.population.total = 1000;
		expect(buildIslandOverview(source).pressure.value).toBeNull();
		source.accessibility.island_id = 'island:2';
		expect(buildIslandOverview(source).pressure.value).toBeNull();
		expect(buildIslandOverview(source).score.value).toBeNull();
	});
});
