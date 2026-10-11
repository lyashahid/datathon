import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import {
	MPL_SECTIONS,
	SOURCE_DEFINITIONS,
	TRANSFORMATION_VERSION,
	checksum,
	comparePublishedTables,
	fetchSources,
	htmlText,
	parseAirlineSummary,
	parseMonthlyTable,
	parseMplTables,
	parseOperatorDate,
	prepareDataset,
	validateDataset,
	validateSnapshot,
	verifySource
} from './agency-context.mjs';

const QA_DIR = resolve('artifacts/qa/agency-context-tests');
/** @type {string} */
let temporaryRoot;

before(async () => {
	await mkdir(QA_DIR, { recursive: true });
	temporaryRoot = await mkdtemp(resolve(QA_DIR, 'workspace-qa-'));
});

after(async () => {
	// Verify the absolute target before recursive cleanup. Never touch the original source bundle.
	const within = relative(QA_DIR, temporaryRoot);
	assert.ok(
		within && !within.startsWith('..') && basename(temporaryRoot).startsWith('workspace-qa-')
	);
	await rm(temporaryRoot, { recursive: true, force: true });
});

/** @param {Record<string,string[][]>} rowsByActivity */
function mplHtml(rowsByActivity = {}) {
	return `<html>${MPL_SECTIONS.map((section) => {
		const headers = section.headers.map((text) => `<td><h3>${text}</h3></td>`).join('');
		const body = (rowsByActivity[section.activity] ?? [])
			.map((row) => `<tr>${row.map((cell) => `<td><div>${cell}</div></td>`).join('')}</tr>`)
			.join('');
		return `<h2>${section.name}</h2><table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
	}).join('')}</html>`;
}

/** @returns {import('./agency-context.mjs').WorkbookRows} */
function passengerCells() {
	const months = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];
	return [
		['Table 11.13: PASSENGER MOVEMENT, 2025'],
		['Month', 'International Flights', null, 'Domestic Flights', null],
		[null, 'Arrival', 'Departure', 'Arrival', 'Departure'],
		['Total', 120, 240, 360, 480],
		...months.map((month) => [month, 10, 20, 30, 40]),
		['Source: Civil Aviation Authority']
	];
}

/** @returns {import('./agency-context.mjs').WorkbookRows} */
function aircraftCells() {
	const months = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];
	return [
		['Table 11.18: AIRCRAFT MOVEMENT, 2025'],
		['Month', 'Grand total', 'International Flights', null, null, null, 'Domestic Flights'],
		[
			null,
			null,
			'Total',
			'Scheduled',
			'Chartered',
			'Non-Scheduled',
			'Total',
			'Scheduled',
			'Non-Scheduled'
		],
		['Total', 1200, 360, 240, 60, 60, 840, 240, 600],
		...months.map((month) => [month, 100, 30, 20, 5, 5, 70, 20, 50]),
		['Source: Civil Aviation Authority']
	];
}

/** @returns {import('./agency-context.mjs').WorkbookRows} */
function airlineCells() {
	const groups = [
		'Total',
		'International Flights',
		'International Scheduled',
		'International Charter',
		'International Non-Scheduled',
		'Domestic flights'
	];
	return [
		['Table 11.10: AIR TRANSPORT, 2025'],
		[null, null, 'Passengers', null, null, null, 'Cargo (kg)', null, null, null, 'Mail (kg)'],
		['Airline'],
		[null, 'Flight Movements', 'In', 'Out', 'Transit'],
		...groups.map((group) => [
			group,
			100,
			120,
			240,
			5,
			null,
			0.30000000000000004,
			2.5,
			3.1,
			null,
			4,
			5
		]),
		['Source: Civil Aviation Authority']
	];
}

/** @param {string} root @param {string} html */
async function cacheMpl(root, html) {
	const definition = SOURCE_DEFINITIONS.find((source) => source.id === 'mpl-vessel-movements');
	assert.ok(definition);
	const archivePath = 'data/public/archive/context/mpl-test.html';
	await mkdir(resolve(root, 'data/public/archive/context'), { recursive: true });
	await mkdir(resolve(root, 'data/public/context'), { recursive: true });
	await writeFile(resolve(root, archivePath), html);
	/** @type {import('./agency-context.mjs').SourceRecord} */
	const source = {
		...definition,
		status: 'downloaded',
		retrievedAt: '2026-10-10T14:30:00Z',
		checksum: checksum(html),
		bytes: Buffer.byteLength(html),
		archivePath,
		transformationVersion: TRANSFORMATION_VERSION,
		httpStatus: 200,
		etag: null,
		lastModified: null
	};
	await writeFile(
		resolve(root, 'data/public/context/source-manifest.json'),
		JSON.stringify({
			schemaVersion: 1,
			sources: [source],
			failures: []
		})
	);
	return source;
}

test('operator dates remain timezone-free and reject invalid dates/times', () => {
	assert.equal(parseOperatorDate('11 Oct 2026 08:00'), '2026-10-11T08:00:00');
	assert.equal(parseOperatorDate('NA'), null);
	assert.throws(() => parseOperatorDate('31 Feb 2026 08:00'), /Invalid MPL date/);
	assert.throws(() => parseOperatorDate('10 Oct 2026 24:00'), /Invalid MPL date/);
	assert.throws(() => parseOperatorDate('10/10/2026'), /Unrecognized MPL date/);
	assert.equal(htmlText('<span>Male&#39; &amp; M&#x61;lé</span>'), "Male' & Malé");
});

test('all five vessel sections are preserved, including empty departures, old listings and future arrival flags', () => {
	const html = mplHtml({
		'estimated-arrival': [
			['Niumath III', '298', '49.43', '11 Oct 2026 13:00', 'Tuticorin', 'Male&#39;']
		],
		arrival: [
			[
				'TAN BINH129',
				'14446',
				'150.52',
				'11 Oct 2026 08:00',
				'Outer Channel',
				'Thilafushi Anchorage'
			]
		],
		'listed-at-port': [['Virgo 9', '150', '22.29', '17 Jul 2019 08:55', 'Tuticorin', 'NA']]
	});
	const parsed = parseMplTables(html, '2026-10-10T14:30:00Z');
	assert.equal(parsed.portCalls.length, 3);
	assert.equal(parsed.tableCounts.departure, 0);
	assert.equal(parsed.portCalls[0].arrivalPort, "Male'");
	assert.equal(parsed.portCalls[0].scheduledAt, '2026-10-11T13:00:00');
	assert.equal(parsed.portCalls[0].qualityFlags.length, 0);
	assert.equal(parsed.qualityChecks.futureDatedNonEstimatedRows, 1);
	assert.equal(parsed.qualityChecks.oldArrivalDateRows, 1);
	assert.equal(parsed.portCalls[2].berth, null);
	assert.equal(parsed.portCalls[2].reportedLaoUnit, null);
	assert.ok(parsed.portCalls.every((row) => !('coordinates' in row)));
});

test('structural changes and invalid tonnage fail explicitly rather than silently create an empty feed', () => {
	const html = mplHtml();
	assert.throws(
		() => parseMplTables(html.replace('Estimated Arrivals', 'Upcoming'), '2026-10-10T00:00:00Z'),
		/table missing/
	);
	assert.throws(
		() => parseMplTables(html.replace('LAO', 'LOA'), '2026-10-10T00:00:00Z'),
		/columns changed/
	);
	assert.throws(
		() =>
			parseMplTables(
				mplHtml({ arrival: [['Vessel', '-5', '10', '10 Oct 2026 09:00', 'A', 'B']] }),
				'2026-10-10T00:00:00Z'
			),
		/Invalid GT/
	);
});

test('duplicate published rows retain separate source-row IDs and expose a quality finding', () => {
	const row = ['A', '100', '10', '10 Oct 2026 09:00', 'A', 'B'];
	const parsed = parseMplTables(mplHtml({ arrival: [row, row] }), '2026-10-10T00:00:00Z');
	assert.notEqual(parsed.portCalls[0].id, parsed.portCalls[1].id);
	assert.equal(parsed.qualityChecks.duplicateMovementRows.length, 1);
});

test('airport monthly tables keep published annual totals separate and enforce full month coverage', () => {
	const passengers = parseMonthlyTable('11.13', passengerCells());
	const aircraft = parseMonthlyTable('11.18', aircraftCells());
	assert.equal(passengers.observations.length, 52);
	assert.equal(aircraft.observations.length, 104);
	assert.equal(passengers.annualTotals['international-passenger-arrivals'], 120);
	assert.equal(passengers.observations[0].aggregation, 'published-total');
	assert.equal(passengers.observations[1].refPeriod, '2025-01');
	assert.equal(passengers.observations[1].aggregation, 'reported-month');
	const missing = passengerCells();
	missing.splice(5, 1);
	assert.throws(() => parseMonthlyTable('11.13', missing), /exactly twelve/);
	const wrongTotal = passengerCells();
	wrongTotal[3][1] = 121;
	assert.throws(() => parseMonthlyTable('11.13', wrongTotal), /total does not match/);
	const wrongCount = passengerCells();
	wrongCount[4][1] = -1;
	assert.throws(() => parseMonthlyTable('11.13', wrongCount), /Invalid numeric cell/);
});

test('aircraft component identities, airline headers and source attribution are validated', () => {
	const rows = aircraftCells();
	rows[3][1] = 1212;
	rows[4][1] = 112;
	assert.throws(() => parseMonthlyTable('11.18', rows), /total split failed/);
	const airline = parseAirlineSummary(airlineCells());
	assert.equal(airline.observations.length, 54);
	assert.equal(airline.annualTotals.Total['cargo-in'], 0.3);
	const bad = airlineCells();
	bad[3][1] = 'Passengers';
	assert.throws(() => parseAirlineSummary(bad), /columns changed/);
	const source = passengerCells();
	source.at(-1)?.splice(0, 1, 'Source: Unverified provider');
	assert.throws(() => parseMonthlyTable('11.13', source), /source changed/);
});

test('published table differences are recorded with both definitions without correcting a value', () => {
	const passengers = parseMonthlyTable('11.13', passengerCells());
	const aircraft = parseMonthlyTable('11.18', aircraftCells());
	const airline = parseAirlineSummary(airlineCells());
	const comparisons = comparePublishedTables(passengers, aircraft, airline);
	assert.equal(comparisons.length, 6);
	assert.equal(comparisons[0].matched, true);
	assert.equal(comparisons[4].differenceRightMinusLeft, 1100);
	assert.equal(airline.annualTotals.Total['aircraft-movements'], 100);
});

test('partial preparation keeps both layers enabled and never fabricates unavailable aviation observations', async () => {
	const root = resolve(temporaryRoot, 'partial');
	await cacheMpl(root, mplHtml({ arrival: [['A', '100', '10', '10 Oct 2026 09:00', 'A', 'B']] }));
	const first = await prepareDataset({ root });
	const second = await prepareDataset({ root });
	assert.equal(first.version, second.version);
	assert.equal(first.layers.vessels.enabled, true);
	assert.equal(first.layers.flights.enabled, true);
	assert.equal(first.layers.flights.status, 'unavailable');
	assert.equal(first.layers.flights.observations.length, 0);
	assert.equal(first.layers.flights.livePositionsAvailable, false);
	assert.equal(first.externalAccess.macl.status, 'permission-required');
	assert.equal((await validateSnapshot({ root })).portCalls, 1);
	const withCoordinates = structuredClone(first);
	Object.assign(withCoordinates.layers.vessels.portCalls[0], { coordinates: [73.5, 4.1] });
	assert.throws(() => validateDataset(withCoordinates), /must not invent/);
	const badSource = structuredClone(first);
	badSource.layers.vessels.observations[0].sourceId = 'missing';
	assert.throws(() => validateDataset(badSource), /unknown source/);
});

test('bad source structure/checksum preserves the existing validated output', async () => {
	const root = resolve(temporaryRoot, 'preserve');
	await cacheMpl(root, mplHtml());
	await prepareDataset({ root });
	const outputPath = resolve(root, 'data/public/context/agency-context.json');
	const original = await readFile(outputPath, 'utf8');
	const changed = await cacheMpl(root, mplHtml().replace('LAO', 'LOA'));
	await assert.rejects(prepareDataset({ root }), /columns changed/);
	assert.equal(await readFile(outputPath, 'utf8'), original);
	await writeFile(resolve(root, changed.archivePath), 'corrupt');
	await assert.rejects(prepareDataset({ root }), /checksum\/size mismatch/);
	assert.equal(await readFile(outputPath, 'utf8'), original);
	await assert.rejects(
		verifySource(root, { ...changed, archivePath: '../outside.html' }),
		/escapes context archive/
	);
});

test('offline cached fetch does no network; failed refresh retains verified originals with explicit failure metadata', async () => {
	const root = resolve(temporaryRoot, 'fetch');
	/** @type {typeof fetch} */
	const fetchImpl = async (input) => {
		const url = String(input);
		const body = url.endsWith('.xlsx')
			? `PK${'x'.repeat(150)}`
			: url.endsWith('.pdf')
				? `%PDF-${'x'.repeat(150)}`
				: `<html>${'x'.repeat(150)}</html>`;
		return new Response(body, { status: 200 });
	};
	const acquired = await fetchSources({ root, fetchImpl });
	assert.equal(acquired.sources.length, 8);
	assert.equal(acquired.failures.length, 0);
	/** @type {typeof fetch} */
	const failingFetch = async () => {
		throw new Error('Test network unavailable');
	};
	const cached = await fetchSources({ root, fetchImpl: failingFetch });
	assert.equal(cached.failures.length, 0);
	const refreshed = await fetchSources({ root, refresh: true, fetchImpl: failingFetch });
	assert.equal(refreshed.failures.length, 8);
	assert.equal(refreshed.sources.length, 8);
	assert.equal(refreshed.sources[0].checksum, acquired.sources[0].checksum);
	assert.ok(
		refreshed.sources.every((source) =>
			source.refreshFailure?.reason.includes('Test network unavailable')
		)
	);
	assert.ok(refreshed.sources.every((source) => !source.url.includes('macl.aero')));
});
