import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.MOBILITY_API_QA_URL ?? 'http://127.0.0.1:8000';
const apiBase = (process.env.MOBILITY_API_QA_BASE ?? origin + '/api/v1').replace(/\/$/, '');
/** @type {{origin:string, apiBase:string, startedAt:string, finishedAt?:string, checks:Array<{name:string,status:string,milliseconds:number,details:unknown}>,failure?:{message:string,stack?:string}}} */
const report = { origin, apiBase, startedAt: new Date().toISOString(), checks: [] };
const output = path.resolve(process.env.MOBILITY_API_QA_OUTPUT ?? 'artifacts/qa/policy-expansion');
await mkdir(output, { recursive: true });
/** @param {string} endpoint @param {unknown} [body] @returns {Promise<any>} */
async function request(endpoint, body) {
	const response = await fetch(apiBase + '/' + endpoint, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(90000)
	});
	const result = await response.json();
	assert.equal(response.status, 200, `${endpoint}: ${JSON.stringify(result)}`);
	return result;
}
/** @param {string} name @param {() => Promise<unknown>} work */
async function check(name, work) {
	const started = Date.now();
	const details = await work();
	report.checks.push({ name, status: 'passed', milliseconds: Date.now() - started, details });
	console.log('PASS', name);
}
try {
	await check('Passenger history and leakage-separated forecasts', async () => {
		const payload = await request('forecasts?target_month=2026-11');
		assert.equal(payload.monthly.length, 3);
		for (const series of payload.monthly) {
			assert(series.history.length > 0);
			assert(series.history.every((/** @type {{value:number}} */ p) => Number.isFinite(p.value)));
			if (series.status === 'exploratory') {
				assert(Number.isFinite(series.estimate));
				assert(series.evaluation.n > 0);
				assert(series.benchmarks.length >= 5);
				assert(series.selection.lastTargetMonth <= series.selection.firstEvaluationTrainingCutoff);
				assert(series.selection.lastTargetMonth < series.evaluation.firstTargetMonth);
			}
		}
		return payload.monthly.map((/** @type {any} */ s) => ({
			id: s.seriesId,
			lastActual: s.lastActualMonth,
			estimate: s.estimate,
			mae: s.evaluation?.mae,
			coverage: s.empiricalRange?.historicalCoverage,
			source: s.sourceUrl
		}));
	});
	await check('Complete dataset catalogue and compatible comparison', async () => {
		const catalogue = await request('datasets');
		assert.equal(catalogue.total, catalogue.items.length);
		assert.equal(
			new Set(catalogue.items.map((/** @type {any} */ item) => item.id)).size,
			catalogue.total
		);
		for (const id of [
			'resident-origins',
			'national-planning-islands',
			'national-resident-origins',
			'national-planning-destinations',
			'national-planning-stops',
			'island-census-demographics',
			'island-employment-indicators',
			'island-population-projections'
		]) {
			assert(
				catalogue.items.some(
					(/** @type {any} */ item) => item.id === id && item.status === 'available'
				),
				`${id} is available`
			);
		}
		const chart = await request('datasets/resident-origins/chart', {
			group_by: 'islandId',
			measure: 'population2026',
			aggregation: 'sum',
			limit: 100
		});
		assert.equal(chart.items.length, 3);
		const result = await request('datasets/compare', {
			primary: {
				dataset_id: 'resident-origins',
				query: { group_by: 'islandId', measure: 'population2026', aggregation: 'sum', limit: 100 }
			},
			comparison: {
				dataset_id: 'resident-origins',
				query: { group_by: 'islandId', measure: 'population2030', aggregation: 'sum', limit: 100 }
			},
			mode: 'indexed',
			alignment: 'common',
			key_domain: 'island-id'
		});
		return { datasets: catalogue.total, chart_rows: chart.items.length, comparison: result };
	});
	await check('National resident charts consume every prepared island allocation', async () => {
		const model = JSON.parse(
			await readFile('data/public/national-population-origins.json', 'utf8')
		);
		/** @type {Map<string, number>} */
		const expected = new Map();
		for (const origin of model.origins) {
			expected.set(origin.islandId, (expected.get(origin.islandId) ?? 0) + origin.population2026);
		}
		assert(expected.has('island:1152'), 'Addu Hithadhoo has resident origins');
		assert(expected.has('island:697'), 'Laamu Hithadhoo has resident origins');
		const chart = await request('datasets/national-resident-origins/chart', {
			group_by: 'islandId',
			measure: 'population2026',
			aggregation: 'sum',
			limit: 500
		});
		assert.equal(chart.truncated, false);
		assert.equal(chart.items.length, expected.size);
		assert.equal(chart.matched_rows, model.origins.length);
		for (const item of chart.items) {
			assert(expected.has(item.group), `Expected national island ${item.group}`);
			assert(Math.abs(item.value - (expected.get(item.group) ?? 0)) < 0.02);
		}
		return {
			islands: expected.size,
			origins: model.origins.length,
			hithadhooResidents2026: expected.get('island:1152')
		};
	});
	await check('Capital and national islands expose resident-backed heatmap meshes', async () => {
		/** @type {Array<unknown>} */
		const results = [];
		for (const [id, expectedHexagons] of /** @type {Array<[string, number]>} */ ([
			['island:1443', 298],
			['island:1442', 591],
			['island:1152', 152],
			['island:697', 83]
		])) {
			const detail = await request(`planning/opportunities/${id}`);
			assert.equal(detail.planning_supported, true);
			assert(detail.coverage.resident_origins > 0);
			assert.equal(detail.hex_grid.features.length, expectedHexagons);
			/** @type {Map<string, number>} */
			const shares = new Map();
			for (const cell of detail.hex_grid.features) {
				assert(['Polygon', 'MultiPolygon'].includes(cell.geometry.type));
				assert.equal(cell.properties.island_id, id);
				assert(cell.properties.contributions.length > 0);
				for (const contribution of cell.properties.contributions) {
					assert(contribution.share > 0 && contribution.share <= 1 + 1e-12);
					shares.set(
						contribution.origin_id,
						(shares.get(contribution.origin_id) ?? 0) + contribution.share
					);
				}
			}
			assert.equal(shares.size, detail.coverage.resident_origins);
			assert([...shares.values()].every((share) => Math.abs(share - 1) < 1e-7));
			if (id === 'island:1152') {
				assert.equal(detail.coverage.transport_stops, 53);
				assert.equal(detail.coverage.scheduled_patterns, 0);
				assert.equal(detail.coverage.timetable_status, 'unavailable');
			}
			results.push({ id, hexagons: expectedHexagons, origins: shares.size });
		}
		const profile = await request('islands/island:1152/profile');
		const context = profile.official_island_context;
		assert.equal(context.status, 'available');
		assert.equal(context.census_demographics.residents_total, 13759);
		assert(
			context.projections.some(
				(/** @type {any} */ row) => row.year === 2026 && row.residents_total > 14000
			)
		);
		assert.equal(profile.accessibility.domains.transport.mapped_counts.bus_stop_count, 53);
		return {
			islands: results,
			hithadhooOfficialCensusResidents: context.census_demographics.residents_total,
			hithadhooBusStops: 53
		};
	});
	const baseline = await request('planning/baseline?island_id=island:1443');
	const assumptions = {
		date: '2026-10-10',
		departure_minutes: 920,
		target_minutes: 15,
		goal: 'healthcare',
		population_year: 2026
	};
	await check('Resident population reconciliation and no-op invariants', async () => {
		const response = await request('planning/evaluate', {
			island_id: 'island:1443',
			assumptions,
			operations: []
		});
		assert.equal(response.summary.gained_residents, 0);
		assert.equal(response.summary.lost_residents, 0);
		const weighted = response.origins.reduce(
			(/** @type {number} */ total, /** @type {{population:number}} */ origin) =>
				total + origin.population,
			0
		);
		assert(Math.abs(weighted - response.summary.population) < 0.02);
		for (const bins of /** @type {Array<Array<{residents:number}>>} */ (
			Object.values(response.travel_time_bands)
		)) {
			assert(
				Math.abs(bins.reduce((n, b) => n + (b.residents ?? 0), 0) - response.summary.population) <
					0.02
			);
		}
		return response.summary;
	});
	await check('New hospital recomputes access, budget and emissions', async () => {
		const origin = baseline.origins[Math.floor(baseline.origins.length / 2)];
		const response = await request('planning/evaluate', {
			island_id: 'island:1443',
			assumptions: {
				...assumptions,
				capital_budget_mvr: 100000000,
				annual_operating_budget_mvr: 15000000
			},
			operations: [
				{
					type: 'add_hospital',
					island_id: 'island:1443',
					name: 'QA modeled hospital',
					coordinates: [origin.lon, origin.lat],
					opening_date: '2026-10-10'
				}
			]
		});
		assert(
			response.summary.scenario_reachable_residents >= response.summary.baseline_reachable_residents
		);
		assert.equal(response.economics.delta.capital_mvr, 120000000);
		assert.equal(response.economics.delta.annual_operating_mvr, 20000000);
		assert.equal(response.economics.budget.capital_within_budget, false);
		assert.equal(response.economics.budget.capital_remaining_mvr, -20000000);
		assert.equal(response.economics.delta.net_annual_kg_co2e, null);
		assert.equal(response.economics.delta.embodied_facility_kg_co2e, null);
		return {
			summary: response.summary,
			costs: response.economics.delta,
			budget: response.economics.budget
		};
	});
	await check(
		'School emissions use explicit estimates and separate construction carbon',
		async () => {
			const origin = baseline.origins[0];
			const response = await request('planning/evaluate', {
				island_id: 'island:1443',
				assumptions: { ...assumptions, goal: 'education' },
				operations: [
					{
						type: 'add_school',
						island_id: 'island:1443',
						name: 'QA modeled school',
						coordinates: [origin.lon, origin.lat],
						opening_date: '2026-10-10',
						metadata: { costs: { annual_operating_kg_co2e: 125000, embodied_kg_co2e: 850000 } }
					}
				]
			});
			assert.equal(response.economics.delta.capital_mvr, 25000000);
			assert.equal(response.economics.delta.annual_facility_operating_kg_co2e, 125000);
			assert.equal(response.economics.delta.embodied_facility_kg_co2e, 850000);
			return response.economics.delta;
		}
	);
	await check('Appointment journey and same-destination return', async () => {
		const response = await request('planning/journey', {
			island_id: 'island:1443',
			assumptions,
			operations: [],
			origin_id: baseline.origins[0].id,
			appointment_minutes: 60,
			return_deadline_minutes: 1200
		});
		assert.equal(response.outward.status, 'reachable');
		assert.equal(response.return_journey.status, 'reachable');
		assert.equal(response.return_journey.destination_id, baseline.origins[0].id);
		assert.equal(response.return_departure_minutes, response.outward.arrival_minutes + 60);
		return response;
	});
	await check('Timetable and fleet are dated evidence', async () => {
		const body = { island_id: 'island:1443', assumptions, operations: [] };
		const [timetable, fleet] = await Promise.all([
			request('planning/timetable', body),
			request('planning/fleet', body)
		]);
		assert(timetable.patterns.length > 0);
		return { patterns: timetable.patterns.length, fleet };
	});
	await check('Outside-snapshot policy results are unavailable', async () => {
		const response = await request('planning/evaluate', {
			island_id: 'island:99999',
			assumptions,
			operations: []
		});
		assert.equal(response.coverage.status, 'outside_snapshot');
		assert.equal(response.summary.population, null);
		return response.coverage;
	});
	await check('Live model weather and sea with attribution receipts', async () => {
		const [weather, marine] = await Promise.all([
			request('conditions/weather'),
			request('conditions/marine')
		]);
		for (const forecast of [weather, marine]) {
			assert.equal(forecast.receipt.data_kind, 'model_forecast');
			assert(forecast.receipt.retrieved_at);
			assert(forecast.current.time);
			assert(forecast.receipt.url.startsWith('https://'));
		}
		return { weather, marine };
	});
	await check('Preserved notice evidence and complete place API', async () => {
		const [operations, places] = await Promise.all([
			request('operations/snapshot'),
			request('places/status')
		]);
		assert.equal(operations.data_kind, 'preserved_public_evidence');
		assert(operations.generatedAt);
		return { snapshot: operations.generatedAt, alerts: operations.weatherAlerts.length, places };
	});
	report.finishedAt = new Date().toISOString();
} catch (error) {
	report.failure = {
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined
	};
	console.error(report.failure.message);
	process.exitCode = 1;
} finally {
	await writeFile(path.join(output, 'api-report.json'), JSON.stringify(report, null, 2));
}
