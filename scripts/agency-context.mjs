import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

/** @typedef {string | number | null} WorkbookCell */
/** @typedef {WorkbookCell[][]} WorkbookRows */
/** @typedef {{id:string,title:string,url:string,publisher:string,referencePeriod:string,coverage:string,units:string,licenseStatus:string,format:string,dataOwner?:string,table?:string}} SourceDefinition */
/** @typedef {SourceDefinition & {status:string,retrievedAt:string,checksum:string,bytes:number,archivePath:string,transformationVersion:string,httpStatus:number,etag:string|null,lastModified:string|null,refreshFailure?:{attemptedAt:string,reason:string}}} SourceRecord */
/** @typedef {{sourceId:string,url?:string,attemptedAt:string,reason:string}} AcquisitionFailure */
/** @typedef {{schemaVersion:number,updatedAt:string,transformationVersion:string,sources:SourceRecord[],failures:AcquisitionFailure[],excludedIntegrations:Record<string,string>[]}} SourceManifest */
/** @typedef {{id:string,metric:string,value:number,unit:string,refPeriod:string,geography:string,sourceId:string,seriesId?:string,aggregation?:string,definition?:string}} Observation */
/** @typedef {{id:string,vesselName:string,activity:string,date:string|null,rawDate:string|null,berth:string|null,grossTonnage:number|null,reportedLao:number|null,reportedLaoUnit:null,timezoneStatus:string,sourceSection:string,sourceRow:number,sourceId:string,qualityFlags:string[],scheduledAt?:string|null,arrivedAt?:string|null,departedAt?:string|null,lastPort?:string|null,arrivalPort?:string|null,berthFrom?:string|null,berthTo?:string|null}} PortCall */
/** @typedef {{observations:Observation[],annualTotals:Record<string,number>,table:string,months:number,totalsMatchMonths:boolean}} MonthlyTable */
/** @typedef {{observations:Observation[],annualTotals:Record<string,Record<string,number>>,table:string,groups:number}} AirlineTable */
/** @typedef {{enabled:boolean,status:string,livePositionsAvailable:boolean,referencePeriod:string,coverage:string,observations:Observation[],gaps:string[],qualityChecks:Record<string,unknown>}} Layer */
/** @typedef {{schemaVersion:number,version:string,generatedAt:string,transformationVersion:string,sources:SourceRecord[],externalAccess:{macl:Record<string,string>},layers:{vessels:Layer & {portCalls:PortCall[]},flights:Layer}}} AgencyDataset */

export const TRANSFORMATION_VERSION = 'agency-context-1.0.0';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const ARCHIVE_DIR = 'data/public/archive/context';
const OUTPUT_DIR = 'data/public/context';
const MANIFEST_FILE = `${OUTPUT_DIR}/source-manifest.json`;
const DATASET_FILE = `${OUTPUT_DIR}/agency-context.json`;
const AIRPORT = 'Velana International Airport (MLE), Hulhulé';
const YEAR = '2025';
const MONTHS = [
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
const LICENSE_NOTE =
	'Publicly downloadable/viewable; no explicit open-data redistribution license identified. Attribute the publisher; original documents are cached locally and excluded from Git.';

/** @type {SourceDefinition[]} */
export const SOURCE_DEFINITIONS = [
	{
		id: 'mpl-vessel-movements',
		title: 'MPL MCH vessel movements — published port tables',
		url: 'https://port.mv/vessel-movements',
		publisher: 'Maldives Ports Limited (MPL)',
		referencePeriod: 'Operator-published snapshot; individual row dates retained',
		coverage: 'MCH/Malé commercial harbour published movements and vessels listed at port',
		units: 'Table rows, gross tonnage (GT), published LAO field (unit not stated), local date text',
		licenseStatus: `${LICENSE_NOTE} MPL footer states All rights reserved.`,
		format: 'html'
	},
	{
		id: 'mbs-yearbook-2026',
		title: 'Statistical Yearbook of Maldives 2026 — source catalogue',
		url: 'https://statisticsmaldives.gov.mv/yearbook/2026/',
		publisher: 'Maldives Bureau of Statistics (MBS)',
		referencePeriod: 'Yearbook 2026; selected aviation tables reference 2025',
		coverage: 'Official downloadable statistical table catalogue',
		units: 'Catalogue',
		licenseStatus: LICENSE_NOTE,
		format: 'html'
	},
	...[
		['11.10', 'Air transport movements by airline, passenger, cargo and mail'],
		['11.13', 'Passenger movement by month'],
		['11.18', 'Aircraft movement by month']
	].flatMap(([table, label]) =>
		['xlsx', 'pdf'].map((format) => ({
			id: `mbs-2026-${table}-${format}`,
			title: `MBS Yearbook 2026, Table ${table}: ${label} at Velana International Airport, 2025`,
			url: `https://statisticsmaldives.gov.mv/yearbook/2026/wp-content/uploads/sites/13/2026/07/${table}.${format}`,
			publisher: 'Maldives Bureau of Statistics (MBS)',
			dataOwner: 'Civil Aviation Authority (CAA)',
			referencePeriod: YEAR,
			coverage: `${AIRPORT}; ${table === '11.10' ? 'annual airline/flight-class aggregates' : '12 monthly observations and published annual totals'}; international and domestic movements`,
			units:
				table === '11.13'
					? 'Passenger movements (arrivals/departures), not unique people'
					: table === '11.18'
						? 'Aircraft movements, not unique aircraft'
						: 'Aircraft movements; passenger movements; cargo and mail kilograms',
			licenseStatus: LICENSE_NOTE,
			format,
			table
		}))
	)
];

export const MPL_SECTIONS = [
	{
		name: 'Estimated Arrivals',
		activity: 'estimated-arrival',
		headers: ['Vessel Name', 'GT', 'LAO', 'ETA', 'Last Port', 'Arrival Port']
	},
	{
		name: 'Arrivals',
		activity: 'arrival',
		headers: ['Vessel Name', 'GT', 'LAO', 'Date', 'Berth From', 'Berth To']
	},
	{
		name: 'Departures',
		activity: 'departure',
		headers: ['Vessel Name', 'GT', 'LAO', 'Date', 'Berth From', 'Berth To']
	},
	{
		name: 'Shifting',
		activity: 'shifting',
		headers: ['Vessel Name', 'GT', 'LAO', 'Date', 'Berth From', 'Berth To']
	},
	{
		name: 'Vessels At Port',
		activity: 'listed-at-port',
		headers: ['Vessel Name', 'GT', 'LAO', 'Arrival Time', 'Last Port', 'Berthed At']
	}
];

/** @param {import('node:crypto').BinaryLike} bytes */
export function checksum(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function requireCondition(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {string} fragment */
export function htmlText(fragment) {
	/** @type {Record<string,string>} */
	const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
	return fragment
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, value) => {
			const code = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value);
			return code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
		})
		.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, value) => {
			return entities[value];
		})
		.replace(/\s+/g, ' ')
		.trim();
}

/** @param {string} fragment */
function cells(fragment) {
	return [...fragment.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) =>
		htmlText(cell[1])
	);
}

/** @param {string} value */
function nullableText(value) {
	return !value || /^(N\/?A|nil|none|-)$/i.test(value) ? null : value;
}

/** @param {string} value @param {string} label */
function positiveOrUnknown(value, label) {
	if (nullableText(value) === null) return null;
	const number = Number(value.replaceAll(',', ''));
	requireCondition(Number.isFinite(number) && number >= 0, `Invalid ${label}: ${value}`);
	return number;
}

/** Preserve the operator's unspecified timezone: never append Z or invent a UTC offset.
 * @param {string} value
 */
export function parseOperatorDate(value) {
	if (nullableText(value) === null) return null;
	const match =
		/^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2})$/.exec(
			value
		);
	requireCondition(match, `Unrecognized MPL date format: ${value}`);
	const month = MONTHS.findIndex((name) => name.slice(0, 3) === match[2]) + 1;
	const iso = `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}T${match[4]}:${match[5]}:00`;
	requireCondition(
		Number(match[4]) < 24 && Number(match[5]) < 60 && validDate(iso.slice(0, 10)),
		`Invalid MPL date: ${value}`
	);
	return iso;
}

/** @param {unknown} value */
function validDate(value) {
	return (
		typeof value === 'string' &&
		/^\d{4}-\d{2}-\d{2}$/.test(value) &&
		Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
		new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
	);
}

/** @param {string} html @param {string} retrievedAt */
export function parseMplTables(html, retrievedAt) {
	requireCondition(Number.isFinite(Date.parse(retrievedAt)), 'MPL retrieval time is invalid');
	// This is the capture's Maldives calendar date, not a timezone conversion of
	// the operator's unspecified event timestamps.
	const retrievalCalendarDate = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Indian/Maldives',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(retrievedAt));
	const sections = new Map();
	for (const table of html.matchAll(
		/<h2\b[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<table\b[^>]*>([\s\S]*?)<\/table>/g
	)) {
		const name = htmlText(table[1]);
		if (!MPL_SECTIONS.some((section) => section.name === name)) continue;
		requireCondition(!sections.has(name), `Duplicate MPL section: ${name}`);
		sections.set(name, table[2]);
	}
	/** @type {PortCall[]} */
	const portCalls = [];
	/** @type {Record<string,number>} */
	const tableCounts = {};
	for (const section of MPL_SECTIONS) {
		const table = sections.get(section.name);
		requireCondition(table, `MPL table missing: ${section.name}; source structure requires review`);
		const head = table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/)?.[1];
		const body = table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
		requireCondition(
			head !== undefined && body !== undefined,
			`MPL table markup changed: ${section.name}`
		);
		requireCondition(
			JSON.stringify(cells(head)) === JSON.stringify(section.headers),
			`MPL table columns changed: ${section.name}`
		);
		const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) => cells(row[1]));
		tableCounts[section.activity] = rows.length;
		for (const [index, row] of rows.entries()) {
			requireCondition(row.length === 6, `MPL malformed row ${section.name}/${index + 1}`);
			requireCondition(row[0].length > 0, `MPL vessel name missing: ${section.name}/${index + 1}`);
			const date = parseOperatorDate(row[3]);
			const flags = [];
			if (date && section.activity === 'listed-at-port') {
				const days =
					(Date.parse(`${retrievalCalendarDate}T00:00:00Z`) -
						Date.parse(`${date.slice(0, 10)}T00:00:00Z`)) /
					86400000;
				if (days > 90) flags.push('arrival-date-more-than-90-calendar-days-before-retrieval');
			}
			if (
				date &&
				section.activity !== 'estimated-arrival' &&
				date.slice(0, 10) > retrievalCalendarDate
			)
				flags.push('future-dated-non-estimate');
			/** @type {PortCall} */
			const record = {
				id: `mpl-${section.activity}-${checksum(JSON.stringify(row)).slice(0, 12)}-${index + 1}`,
				vesselName: row[0],
				activity: section.activity,
				date,
				rawDate: nullableText(row[3]),
				berth: null,
				grossTonnage: positiveOrUnknown(row[1], 'GT'),
				reportedLao: positiveOrUnknown(row[2], 'published LAO'),
				reportedLaoUnit: null,
				timezoneStatus: 'not-stated',
				sourceSection: section.name,
				sourceRow: index + 1,
				sourceId: 'mpl-vessel-movements',
				qualityFlags: flags
			};
			if (section.activity === 'estimated-arrival') {
				record.scheduledAt = date;
				record.lastPort = nullableText(row[4]);
				record.arrivalPort = nullableText(row[5]);
			} else if (section.activity === 'listed-at-port') {
				record.arrivedAt = date;
				record.lastPort = nullableText(row[4]);
				record.berth = nullableText(row[5]);
			} else {
				record.berthFrom = nullableText(row[4]);
				record.berthTo = nullableText(row[5]);
				record.berth = [record.berthFrom, record.berthTo].filter(Boolean).join(' → ') || null;
				if (section.activity === 'arrival') record.arrivedAt = date;
				if (section.activity === 'departure') record.departedAt = date;
			}
			portCalls.push(record);
		}
	}
	const duplicateRows = portCalls.filter(
		(record, index) =>
			portCalls.findIndex(
				(other) =>
					other.activity === record.activity &&
					other.vesselName === record.vesselName &&
					other.date === record.date &&
					other.berth === record.berth
			) !== index
	);
	return {
		portCalls,
		tableCounts,
		qualityChecks: {
			rowCount: portCalls.length,
			uniquePublishedNames: new Set(portCalls.map((row) => row.vesselName)).size,
			tableCounts,
			duplicateMovementRows: duplicateRows.map((row) => row.id),
			oldArrivalDateRows: portCalls.filter((row) =>
				row.qualityFlags[0]?.startsWith('arrival-date-')
			).length,
			futureDatedNonEstimatedRows: portCalls.filter((row) =>
				row.qualityFlags.includes('future-dated-non-estimate')
			).length,
			retrievalCalendarDate,
			dateReviewBasis:
				'Compare published event date to Maldives calendar date of capture; the operator event timezone remains unspecified.',
			dateTimezone: 'Not supplied by operator; timestamps remain naive local text',
			laoHeader: 'Publisher writes LAO; its definition/unit was not verified and is not corrected',
			identity: 'Names are published labels, not verified IMO/MMSI identities'
		}
	};
}

/** @param {unknown} value @param {string} label @param {boolean} integer */
function observedNumber(value, label, integer = true) {
	requireCondition(
		typeof value === 'number' &&
			Number.isFinite(value) &&
			value >= 0 &&
			(!integer || Number.isInteger(value)),
		`Invalid numeric cell: ${label}`
	);
	// Excel floats have binary noise. Retain six decimal places for kilogram quantities.
	return integer ? value : Number(value.toFixed(6));
}

/** @param {string} table @param {string} metric @param {string} seriesId @param {number} value @param {string} unit @param {string} refPeriod @param {string} aggregation @param {string} definition @returns {Observation} */
function observation(table, metric, seriesId, value, unit, refPeriod, aggregation, definition) {
	return {
		id: `${seriesId}-${refPeriod}`,
		metric,
		seriesId,
		value,
		unit,
		refPeriod,
		geography: AIRPORT,
		sourceId: `mbs-2026-${table}-xlsx`,
		aggregation,
		definition
	};
}

/** Parse inspected workbook cells; enforce headers, chronology and published total identities.
 * @param {string} table @param {WorkbookRows} rows @returns {MonthlyTable}
 */
export function parseMonthlyTable(table, rows) {
	requireCondition(['11.13', '11.18'].includes(table), `Unsupported monthly table: ${table}`);
	requireCondition(
		rows.some(
			(row) => typeof row[0] === 'string' && row[0].includes(table) && row[0].includes(YEAR)
		),
		`Table ${table} title/reference year changed`
	);
	requireCondition(
		rows.some((row) => row[0] === 'Source: Civil Aviation Authority'),
		`Table ${table} publisher/source changed`
	);
	const headerIndex = rows.findIndex((row) => row[0] === 'Month');
	requireCondition(headerIndex >= 0, `Table ${table} month header missing`);
	const headers = rows[headerIndex];
	const subheaders = rows[headerIndex + 1];
	/** @type {string[][]} */
	let metrics;
	if (table === '11.13') {
		requireCondition(
			headers[1] === 'International Flights' &&
				headers[3] === 'Domestic Flights' &&
				JSON.stringify(subheaders.slice(1, 5)) ===
					JSON.stringify(['Arrival', 'Departure', 'Arrival', 'Departure']),
			'Table 11.13 columns changed'
		);
		metrics = [
			[
				'International passenger arrivals',
				'international-passenger-arrivals',
				'passenger movements'
			],
			[
				'International passenger departures',
				'international-passenger-departures',
				'passenger movements'
			],
			['Domestic passenger arrivals', 'domestic-passenger-arrivals', 'passenger movements'],
			['Domestic passenger departures', 'domestic-passenger-departures', 'passenger movements']
		];
	} else {
		requireCondition(
			headers[1] === 'Grand total' &&
				headers[2] === 'International Flights' &&
				headers[6] === 'Domestic Flights' &&
				JSON.stringify(subheaders.slice(2, 9)) ===
					JSON.stringify([
						'Total',
						'Scheduled',
						'Chartered',
						'Non-Scheduled',
						'Total',
						'Scheduled',
						'Non-Scheduled'
					]),
			'Table 11.18 columns changed'
		);
		metrics = [
			['Total aircraft movements', 'total-aircraft-movements', 'aircraft movements'],
			[
				'International aircraft movements',
				'international-aircraft-movements',
				'aircraft movements'
			],
			[
				'International scheduled aircraft movements',
				'international-scheduled-aircraft-movements',
				'aircraft movements'
			],
			[
				'International chartered aircraft movements',
				'international-chartered-aircraft-movements',
				'aircraft movements'
			],
			[
				'International non-scheduled aircraft movements',
				'international-nonscheduled-aircraft-movements',
				'aircraft movements'
			],
			['Domestic aircraft movements', 'domestic-aircraft-movements', 'aircraft movements'],
			[
				'Domestic scheduled aircraft movements',
				'domestic-scheduled-aircraft-movements',
				'aircraft movements'
			],
			[
				'Domestic non-scheduled aircraft movements',
				'domestic-nonscheduled-aircraft-movements',
				'aircraft movements'
			]
		];
	}
	const dataRows = rows.slice(headerIndex + 2, headerIndex + 15);
	requireCondition(
		JSON.stringify(dataRows.map((row) => row[0])) === JSON.stringify(['Total', ...MONTHS]),
		`Table ${table} must contain published Total and exactly twelve ordered months`
	);
	const observations = [];
	/** @type {Record<string,number>} */
	const annualTotals = {};
	for (const [metricIndex, [metric, suffix, unit]] of metrics.entries()) {
		const values = dataRows.map((row) =>
			observedNumber(row[metricIndex + 1], `${table}/${row[0]}/${suffix}`)
		);
		const sum = values.slice(1).reduce((total, value) => total + value, 0);
		requireCondition(
			sum === values[0],
			`Table ${table} published total does not match months: ${suffix}`
		);
		annualTotals[suffix] = values[0];
		for (const [rowIndex, value] of values.entries()) {
			observations.push(
				observation(
					table,
					metric,
					`caa-${table}-${suffix}`,
					value,
					unit,
					rowIndex === 0 ? YEAR : `${YEAR}-${String(rowIndex).padStart(2, '0')}`,
					rowIndex === 0 ? 'published-total' : 'reported-month',
					`CAA administrative counts published in MBS Table ${table}. Movements are events, not unique passengers/aircraft; annual total and monthly components must not be added together.`
				)
			);
		}
	}
	if (table === '11.18') {
		for (const row of dataRows) {
			const numeric = row.slice(1, 9).map((value) => observedNumber(value, '11.18 split'));
			requireCondition(
				numeric[0] === numeric[1] + numeric[5],
				`Table 11.18 total split failed: ${row[0]}`
			);
			requireCondition(
				numeric[1] === numeric[2] + numeric[3] + numeric[4],
				`Table 11.18 international split failed: ${row[0]}`
			);
			requireCondition(
				numeric[5] === numeric[6] + numeric[7],
				`Table 11.18 domestic split failed: ${row[0]}`
			);
		}
	}
	return { observations, annualTotals, table, months: 12, totalsMatchMonths: true };
}

/** @param {WorkbookRows} rows @returns {AirlineTable} */
export function parseAirlineSummary(rows) {
	requireCondition(
		rows.some(
			(row) => typeof row[0] === 'string' && row[0].includes('Table 11.10') && row[0].includes(YEAR)
		),
		'Table 11.10 title/reference year changed'
	);
	requireCondition(
		rows.some((row) => row[0] === 'Source: Civil Aviation Authority'),
		'Table 11.10 source changed'
	);
	const headerIndex = rows.findIndex((row) => row[0] === 'Airline');
	requireCondition(
		headerIndex >= 0 &&
			rows[headerIndex + 1][1] === 'Flight Movements' &&
			JSON.stringify(rows[headerIndex + 1].slice(2, 5)) ===
				JSON.stringify(['In', 'Out', 'Transit']) &&
			rows[headerIndex - 1][6] === 'Cargo (kg)' &&
			rows[headerIndex - 1][10] === 'Mail (kg)',
		'Table 11.10 columns changed'
	);
	const groups = [
		'Total',
		'International Flights',
		'International Scheduled',
		'International Charter',
		'International Non-Scheduled',
		'Domestic flights'
	];
	/** @type {[number,string,string,string][]} */
	const metrics = [
		[1, 'Aircraft movements', 'aircraft-movements', 'aircraft movements'],
		[2, 'Passenger arrivals', 'passenger-arrivals', 'passenger movements'],
		[3, 'Passenger departures', 'passenger-departures', 'passenger movements'],
		[4, 'Transit passenger movements', 'transit-passengers', 'passenger movements'],
		[6, 'Cargo in', 'cargo-in', 'kg'],
		[7, 'Cargo out', 'cargo-out', 'kg'],
		[8, 'Transit cargo', 'cargo-transit', 'kg'],
		[10, 'Mail in', 'mail-in', 'kg'],
		[11, 'Mail out', 'mail-out', 'kg']
	];
	/** @type {Record<string,Record<string,number>>} */
	const annualTotals = {};
	const observations = [];
	for (const group of groups) {
		const matching = rows.filter((row) => row[0] === group);
		requireCondition(matching.length === 1, `Table 11.10 group missing/duplicated: ${group}`);
		const row = matching[0];
		annualTotals[group] = {};
		for (const [column, metric, suffix, unit] of metrics) {
			const value = observedNumber(row[column], `11.10/${group}/${suffix}`, unit !== 'kg');
			annualTotals[group][suffix] = value;
			const groupId = group.toLowerCase().replaceAll(' ', '-');
			observations.push(
				observation(
					'11.10',
					`${group}: ${metric}`,
					`caa-11.10-${groupId}-${suffix}`,
					value,
					unit,
					YEAR,
					'published-total',
					'CAA annual airline-table subtotal published by MBS. Total, flight-class subtotals and transit passenger movements overlap; do not add them together or combine with Tables 11.13/11.18.'
				)
			);
		}
	}
	return { observations, annualTotals, table: '11.10', groups: groups.length };
}

/** @param {MonthlyTable} passengers @param {MonthlyTable} aircraft @param {AirlineTable} airline */
export function comparePublishedTables(passengers, aircraft, airline) {
	/** @type {[string,number,number,string,string][]} */
	const checks = [
		[
			'International passenger arrivals',
			airline.annualTotals['International Flights']['passenger-arrivals'],
			passengers.annualTotals['international-passenger-arrivals'],
			'11.10',
			'11.13'
		],
		[
			'International passenger departures',
			airline.annualTotals['International Flights']['passenger-departures'],
			passengers.annualTotals['international-passenger-departures'],
			'11.10',
			'11.13'
		],
		[
			'Domestic passenger arrivals',
			airline.annualTotals['Domestic flights']['passenger-arrivals'],
			passengers.annualTotals['domestic-passenger-arrivals'],
			'11.10',
			'11.13'
		],
		[
			'Domestic passenger departures',
			airline.annualTotals['Domestic flights']['passenger-departures'],
			passengers.annualTotals['domestic-passenger-departures'],
			'11.10',
			'11.13'
		],
		[
			'Total aircraft movements',
			airline.annualTotals.Total['aircraft-movements'],
			aircraft.annualTotals['total-aircraft-movements'],
			'11.10',
			'11.18'
		],
		[
			'International aircraft movements',
			airline.annualTotals['International Flights']['aircraft-movements'],
			aircraft.annualTotals['international-aircraft-movements'],
			'11.10',
			'11.18'
		]
	];
	return checks.map(([metric, left, right, leftTable, rightTable]) => ({
		metric,
		leftTable,
		rightTable,
		leftValue: left,
		rightValue: right,
		differenceRightMinusLeft: right - left,
		matched: left === right,
		sourceIds: [`mbs-2026-${leftTable}-xlsx`, `mbs-2026-${rightTable}-xlsx`],
		qualification:
			'Published tables differ. Preserve both definitions and reported values; no reconciliation or correction has been invented.'
	}));
}

/** @param {string} root @param {string} path */
function archivePath(root, path) {
	const full = resolve(root, path);
	const within = relative(resolve(root, ARCHIVE_DIR), full);
	requireCondition(
		within && !within.startsWith('..') && !isAbsolute(within),
		`Archive path escapes context archive: ${path}`
	);
	return full;
}

/** @param {string} root @param {SourceRecord} source */
export async function verifySource(root, source) {
	requireCondition(
		/^[a-f0-9]{64}$/.test(source.checksum ?? ''),
		`Source checksum invalid: ${source.id}`
	);
	const bytes = await readFile(archivePath(root, source.archivePath));
	requireCondition(
		bytes.length === source.bytes && checksum(bytes) === source.checksum,
		`Cached source checksum/size mismatch: ${source.id}`
	);
	return bytes;
}

/** @param {string} path @returns {Promise<SourceManifest|null>} */
async function readJsonIfPresent(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
		throw error;
	}
}

/** @param {string} root @param {string} name @param {unknown} value */
async function writeJson(root, name, value) {
	const path = resolve(root, name);
	await mkdir(dirname(path), { recursive: true });
	const pending = `${path}.pending`;
	await writeFile(pending, `${JSON.stringify(value, null, 2)}\n`);
	// Windows readers/indexers can briefly lock an existing snapshot. Retry the atomic
	// replacement; never unlink the last valid output to force a write through.
	for (let attempt = 0; ; attempt += 1) {
		try {
			await rename(pending, path);
			break;
		} catch (error) {
			const transient =
				error instanceof Error &&
				'code' in error &&
				['EPERM', 'EBUSY', 'EACCES'].includes(String(error.code));
			if (!transient || attempt >= 5) throw error;
			await delay(25 * 2 ** attempt);
		}
	}
}

/** @param {{root?:string,refresh?:boolean,fetchImpl?:typeof fetch}} options @returns {Promise<SourceManifest>} */
export async function fetchSources({
	root = DEFAULT_ROOT,
	refresh = false,
	fetchImpl = fetch
} = {}) {
	const previous = await readJsonIfPresent(resolve(root, MANIFEST_FILE));
	const oldSources = new Map((previous?.sources ?? []).map((source) => [source.id, source]));
	const attemptedAt = new Date().toISOString();
	/** @type {SourceRecord[]} */
	const sources = [];
	/** @type {AcquisitionFailure[]} */
	const failures = [];
	await mkdir(resolve(root, ARCHIVE_DIR), { recursive: true });
	const results = await Promise.allSettled(
		SOURCE_DEFINITIONS.map(async (definition) => {
			const old = oldSources.get(definition.id);
			if (old && !refresh) {
				await verifySource(root, old);
				return old;
			}
			try {
				const response = await fetchImpl(definition.url, {
					signal: AbortSignal.timeout(30000),
					headers: { 'User-Agent': 'MobilitySandboxMV public-statistics-context/1.0' }
				});
				requireCondition(response.ok, `${definition.id}: HTTP ${response.status}`);
				const bytes = Buffer.from(await response.arrayBuffer());
				requireCondition(bytes.length > 100, `${definition.id}: empty/unusable response`);
				if (definition.format === 'pdf')
					requireCondition(
						bytes.subarray(0, 5).toString() === '%PDF-',
						`${definition.id}: expected PDF`
					);
				if (definition.format === 'xlsx')
					requireCondition(
						bytes.subarray(0, 2).toString() === 'PK',
						`${definition.id}: expected XLSX ZIP`
					);
				if (definition.format === 'html')
					requireCondition(
						/<html\b|<!doctype html/i.test(bytes.toString()),
						`${definition.id}: expected HTML`
					);
				const hash = checksum(bytes);
				const cachedPath = `${ARCHIVE_DIR}/${definition.id}-${hash.slice(0, 16)}.${definition.format}`;
				await writeFile(resolve(root, cachedPath), bytes);
				return {
					...definition,
					status: 'downloaded',
					retrievedAt: new Date().toISOString(),
					checksum: hash,
					bytes: bytes.length,
					archivePath: cachedPath,
					transformationVersion: TRANSFORMATION_VERSION,
					httpStatus: response.status,
					etag: response.headers.get('etag'),
					lastModified: response.headers.get('last-modified')
				};
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				failures.push({ sourceId: definition.id, url: definition.url, attemptedAt, reason });
				if (old) {
					await verifySource(root, old);
					return { ...old, refreshFailure: { attemptedAt, reason } };
				}
				return null;
			}
		})
	);
	for (const [index, result] of results.entries()) {
		if (result.status === 'rejected') {
			failures.push({
				sourceId: SOURCE_DEFINITIONS[index].id,
				attemptedAt,
				reason: result.reason.message
			});
		} else if (result.value) sources.push(result.value);
	}
	/** @type {SourceManifest} */
	const manifest = {
		schemaVersion: 1,
		updatedAt: new Date().toISOString(),
		transformationVersion: TRANSFORMATION_VERSION,
		sources,
		failures,
		excludedIntegrations: [
			{
				id: 'macl-direct',
				status: 'permission-required',
				url: 'https://macl.aero/insights',
				termsUrl: 'https://macl.aero/terms-of-service',
				reason:
					'MACL July2026 terms prohibit automated scraping/mirroring without prior written authorization; direct datasets and flight schedules are not acquired by this command.'
			}
		]
	};
	await writeJson(root, MANIFEST_FILE, manifest);
	return manifest;
}

/** @param {string} path @param {string} sheet @returns {WorkbookRows} */
function readWorkbook(path, sheet) {
	const bundled = join(
		homedir(),
		'.cache',
		'codex-runtimes',
		'codex-primary-runtime',
		'dependencies',
		'python',
		process.platform === 'win32' ? 'python.exe' : 'bin/python'
	);
	const candidates = [
		process.env.MOBILITY_PYTHON,
		existsSync(bundled) ? bundled : undefined,
		'python',
		'python3'
	].filter((candidate) => typeof candidate === 'string');
	const python = candidates.find(
		(command) => spawnSync(command, ['--version'], { windowsHide: true }).status === 0
	);
	requireCondition(
		python,
		'Python with openpyxl is required; run npm run data:setup or set MOBILITY_PYTHON.'
	);
	const code =
		'import openpyxl,json,sys; w=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=True); print(json.dumps([list(r)[:13] for r in w[sys.argv[2]].values],ensure_ascii=True)); w.close()';
	const result = spawnSync(python, ['-c', code, path, sheet], {
		encoding: 'utf8',
		windowsHide: true,
		maxBuffer: 8 * 1024 * 1024
	});
	requireCondition(
		result.status === 0,
		`Workbook ${sheet} extraction failed: ${result.stderr?.trim() || result.error?.message}`
	);
	return JSON.parse(result.stdout);
}

/** @param {AgencyDataset} dataset */
export function validateDataset(dataset) {
	requireCondition(dataset?.schemaVersion === 1, 'Context schemaVersion must be1');
	requireCondition(
		/^agency-context-[a-f0-9]{16}$/.test(dataset.version ?? ''),
		'Context version invalid'
	);
	requireCondition(Number.isFinite(Date.parse(dataset.generatedAt)), 'Context generatedAt invalid');
	requireCondition(
		dataset.transformationVersion === TRANSFORMATION_VERSION,
		'Context transformationVersion invalid'
	);
	requireCondition(Array.isArray(dataset.sources), 'Context sources missing');
	const sourceIds = new Set();
	for (const source of dataset.sources) {
		requireCondition(
			source.id && !sourceIds.has(source.id),
			'Context source IDs missing/duplicated'
		);
		sourceIds.add(source.id);
		/** @type {(keyof SourceRecord)[]} */
		const metadataFields = [
			'title',
			'publisher',
			'referencePeriod',
			'coverage',
			'units',
			'licenseStatus'
		];
		for (const field of metadataFields) {
			const value = source[field];
			requireCondition(typeof value === 'string' && value.length, `${source.id}: ${field} missing`);
		}
		requireCondition(/^https:\/\//.test(source.url), `${source.id}: source URL invalid`);
		requireCondition(/^[a-f0-9]{64}$/.test(source.checksum), `${source.id}: checksum invalid`);
		requireCondition(
			Number.isFinite(Date.parse(source.retrievedAt)),
			`${source.id}: retrievedAt invalid`
		);
		requireCondition(
			source.transformationVersion === TRANSFORMATION_VERSION,
			`${source.id}: transformationVersion invalid`
		);
		requireCondition(
			Number.isInteger(source.bytes) && source.bytes > 0,
			`${source.id}: source bytes invalid`
		);
	}
	/** @type {('vessels'|'flights')[]} */
	const layerNames = ['vessels', 'flights'];
	for (const name of layerNames) {
		const layer = dataset.layers?.[name];
		requireCondition(layer?.enabled === true, `${name} must remain enabled`);
		requireCondition(
			layer.livePositionsAvailable === false,
			`${name}: no source provides live positions`
		);
		requireCondition(
			['available', 'partial', 'unavailable'].includes(layer.status),
			`${name}: invalid status`
		);
		requireCondition(
			Array.isArray(layer.observations) && Array.isArray(layer.gaps),
			`${name}: observations/gaps missing`
		);
		const ids = new Set();
		for (const observation of layer.observations) {
			requireCondition(
				observation.id && !ids.has(observation.id),
				`${name}: duplicate observation ID`
			);
			ids.add(observation.id);
			requireCondition(sourceIds.has(observation.sourceId), `${name}: unknown source reference`);
			requireCondition(
				typeof observation.value === 'number' &&
					Number.isFinite(observation.value) &&
					observation.value >= 0,
				`${name}: observation must be finite/nonnegative`
			);
			/** @type {(keyof Observation)[]} */
			const fields = ['metric', 'unit', 'refPeriod', 'geography'];
			for (const key of fields) {
				const value = observation[key];
				requireCondition(typeof value === 'string' && value.length, `${name}: ${key} missing`);
			}
			requireCondition(!('coordinates' in observation), `${name}: unsupported coordinates`);
		}
	}
	const ids = new Set();
	requireCondition(Array.isArray(dataset.layers.vessels.portCalls), 'Port-call array missing');
	for (const record of dataset.layers.vessels.portCalls) {
		requireCondition(record.id && !ids.has(record.id), 'Duplicate port-call ID');
		ids.add(record.id);
		requireCondition(
			record.vesselName?.length &&
				MPL_SECTIONS.some((section) => section.activity === record.activity),
			'Invalid vessel/activity'
		);
		requireCondition(sourceIds.has(record.sourceId), 'Port-call source not found');
		requireCondition(
			!('coordinates' in record) && !('lat' in record) && !('lon' in record),
			'Port calls must not invent vessel positions'
		);
		requireCondition(record.timezoneStatus === 'not-stated', 'MPL timezone must not be inferred');
		requireCondition(
			record.date === parseOperatorDate(record.rawDate ?? ''),
			'Port-call date/raw date mismatch'
		);
		requireCondition(Array.isArray(record.qualityFlags), 'Port-call quality flags missing');
	}
	requireCondition(
		dataset.externalAccess?.macl?.status === 'permission-required',
		'Direct MACL restriction must be explicit'
	);
	return {
		sources: dataset.sources.length,
		portCalls: dataset.layers.vessels.portCalls.length,
		vesselObservations: dataset.layers.vessels.observations.length,
		flightObservations: dataset.layers.flights.observations.length,
		version: dataset.version
	};
}

/** @param {{root?:string}} options @returns {Promise<AgencyDataset>} */
export async function prepareDataset({ root = DEFAULT_ROOT } = {}) {
	const manifest = await readJsonIfPresent(resolve(root, MANIFEST_FILE));
	requireCondition(
		manifest?.schemaVersion === 1,
		'Run agency-context.mjs fetch first; source manifest missing/invalid'
	);
	const sources = manifest.sources;
	const verified = new Map();
	for (const source of sources) verified.set(source.id, await verifySource(root, source));
	const lookup = new Map(sources.map((source) => [source.id, source]));
	/** @param {string} id */
	const missing = (id) => !verified.has(id);
	const mplSource = lookup.get('mpl-vessel-movements');
	const vesselGaps = [
		'No vessel coordinates, speed, heading, IMO/MMSI identity or AIS positions are supplied by these tables.',
		'An estimated arrival is a schedule, not a confirmed arrival; vessels listed at port are not independently verified live occupancy.',
		'Listed-at-port arrival dates include long-duration entries. Dates older than90calendar days are flagged, retained and never presented as fresh location fixes.',
		'Operator timestamps do not state a timezone. Original date text is retained; no UTC conversion is applied.',
		'Published LAO column definition/unit is unverified. Gross tonnage is GT, not vessel mass.',
		'MPL public viewing does not establish an open redistribution license; its footer reserves rights.'
	];
	/** @type {{portCalls:PortCall[],tableCounts:Record<string,number>,qualityChecks:Record<string,unknown>}} */
	let parsedMpl = { portCalls: [], tableCounts: {}, qualityChecks: {} };
	if (mplSource) {
		const bytes = verified.get(mplSource.id);
		requireCondition(bytes, 'MPL verified source bytes missing');
		parsedMpl = parseMplTables(bytes.toString('utf8'), mplSource.retrievedAt);
	} else
		vesselGaps.unshift(
			'Official MPL vessel-movements source could not be acquired; no records are fabricated.'
		);
	if (mplSource?.refreshFailure)
		vesselGaps.unshift(
			`MPL refresh failed at ${mplSource.refreshFailure.attemptedAt}; last checksum-validated snapshot retained.`
		);
	if (Number(parsedMpl.qualityChecks.futureDatedNonEstimatedRows) > 0)
		vesselGaps.unshift(
			`${parsedMpl.qualityChecks.futureDatedNonEstimatedRows} row(s) in non-estimated sections are dated after the Maldives calendar date of capture. Their original table classification/date is preserved and flagged; this does not confirm a future arrival.`
		);
	const vesselObservations = mplSource
		? MPL_SECTIONS.map((section) => ({
				id: `mpl-snapshot-${section.activity}-rows`,
				metric: `Published ${section.name.toLowerCase()} rows`,
				value: parsedMpl.tableCounts[section.activity],
				unit: 'published table rows',
				refPeriod: mplSource.retrievedAt,
				geography: 'MPL MCH/Malé commercial harbour published port tables',
				sourceId: mplSource.id
			}))
		: [];
	const flightGaps = [
		'Official airport observations reference2025; these are historical counts, not current aircraft positions or flight tracking.',
		'Passenger movements count arrivals/departures, not unique visitors, residents or occupancy on individual flights.',
		'International and domestic, monthly and annual, and subtotal observations overlap. Do not add those rows together.',
		'Direct MACL Insights/flight feeds require written authorization under MACL July2026 terms; this acquisition command does not scrape or reproduce them.',
		'The requested MASL publisher was not identified. The official airport operator is Maldives Airports Company Limited (MACL); these implemented tables are MBS publications sourced to Civil Aviation Authority.',
		'No aircraft coordinates, callsigns, flight-level passengers, route-level airport access demand or live arrivals feed are available in these statistical tables.'
	];
	/** @type {Record<string,MonthlyTable|AirlineTable>} */
	const tables = {};
	for (const table of ['11.10', '11.13', '11.18']) {
		const id = `mbs-2026-${table}-xlsx`;
		if (missing(id)) {
			flightGaps.unshift(
				`MBS Table ${table} XLSX acquisition unavailable; its observations are omitted.`
			);
			continue;
		}
		const source = lookup.get(id);
		requireCondition(source, `Source lookup missing: ${id}`);
		const rows = readWorkbook(archivePath(root, source.archivePath), table);
		tables[table] = table === '11.10' ? parseAirlineSummary(rows) : parseMonthlyTable(table, rows);
		if (source.refreshFailure)
			flightGaps.unshift(
				`Table ${table} refresh failed; previous checksum-validated snapshot retained, retrieved ${source.retrievedAt}.`
			);
	}
	const comparisons =
		tables['11.10'] && tables['11.13'] && tables['11.18']
			? comparePublishedTables(
					/** @type {MonthlyTable} */ (tables['11.13']),
					/** @type {MonthlyTable} */ (tables['11.18']),
					/** @type {AirlineTable} */ (tables['11.10'])
				)
			: [];
	if (comparisons.some((comparison) => !comparison.matched))
		flightGaps.unshift(
			'Published CAA tables contain cross-table total differences; reported values remain separate with inspectable comparisons. No reconciliation is assumed.'
		);
	const versionHash = checksum(
		JSON.stringify({
			transformationVersion: TRANSFORMATION_VERSION,
			scriptChecksum: checksum(await readFile(SCRIPT_PATH)),
			sources: sources.map((source) => ({
				id: source.id,
				checksum: source.checksum,
				retrievedAt: source.retrievedAt,
				refreshFailure: source.refreshFailure ?? null
			})),
			externalRestrictionReviewedAt: '2026-10-10'
		})
	).slice(0, 16);
	/** @type {AgencyDataset} */
	const dataset = {
		schemaVersion: 1,
		version: `agency-context-${versionHash}`,
		generatedAt: new Date().toISOString(),
		transformationVersion: TRANSFORMATION_VERSION,
		sources,
		externalAccess: {
			macl: {
				status: 'permission-required',
				publisher: 'Maldives Airports Company Limited (MACL)',
				insightsUrl: 'https://macl.aero/insights',
				termsUrl: 'https://macl.aero/terms-of-service',
				reviewedAt: '2026-10-10',
				reason:
					'July2026 terms prohibit automated scraping and mirroring without prior written authorization. Direct MACL data are excluded; public statistical facts are sourced from downloadable MBS/CAA tables instead.'
			}
		},
		layers: {
			vessels: {
				enabled: true,
				status: mplSource ? 'partial' : 'unavailable',
				livePositionsAvailable: false,
				referencePeriod: mplSource?.retrievedAt ?? 'Unavailable',
				coverage:
					'MPL MCH published vessel movements; all five source sections retained separately',
				portCalls: parsedMpl.portCalls,
				observations: vesselObservations,
				gaps: vesselGaps,
				qualityChecks: parsedMpl.qualityChecks
			},
			flights: {
				enabled: true,
				status: Object.keys(tables).length ? 'partial' : 'unavailable',
				livePositionsAvailable: false,
				referencePeriod: YEAR,
				coverage: `${AIRPORT}; CAA annual and monthly passenger, aircraft, cargo and mail counts published by MBS`,
				observations: Object.values(tables).flatMap((table) => table.observations),
				gaps: flightGaps,
				qualityChecks: {
					monthlyCoverage: Object.values(tables)
						.filter((table) => 'months' in table)
						.map((table) =>
							'months' in table
								? {
										table: table.table,
										months: table.months,
										totalsMatchMonths: table.totalsMatchMonths
									}
								: null
						),
					annualTotals: Object.fromEntries(
						Object.entries(tables).map(([id, table]) => [id, table.annualTotals])
					),
					crossTableComparisons: comparisons,
					integerMovements: true,
					kilogramPrecision:
						'Six decimal places remove Excel binary representation noise; no count values are rounded.'
				}
			}
		}
	};
	validateDataset(dataset);
	// All source checks and parsing finish before replacing the last valid output.
	await writeJson(root, DATASET_FILE, dataset);
	return dataset;
}

/** @param {{root?:string}} options */
export async function validateSnapshot({ root = DEFAULT_ROOT } = {}) {
	const dataset = JSON.parse(await readFile(resolve(root, DATASET_FILE), 'utf8'));
	const summary = validateDataset(dataset);
	for (const source of dataset.sources) await verifySource(root, source);
	return summary;
}

async function main() {
	const command = process.argv[2];
	const args = process.argv.slice(3);
	requireCondition(
		args.every((arg) => arg === '--refresh'),
		'Only supported optional argument: --refresh'
	);
	if (command === 'fetch' || command === 'all') {
		const manifest = await fetchSources({ refresh: args.includes('--refresh') });
		console.log(
			`Context sources: ${manifest.sources.length} cached; ${manifest.failures.length} acquisition failures.`
		);
		for (const failure of manifest.failures)
			console.error(`${failure.sourceId}: ${failure.reason}`);
		if (manifest.failures.length) process.exitCode = 1;
	}
	if (command === 'prepare' || command === 'all') {
		const dataset = await prepareDataset();
		console.log(JSON.stringify(validateDataset(dataset)));
	}
	if (command === 'validate' || command === 'all')
		console.log(JSON.stringify(await validateSnapshot()));
	requireCondition(
		['fetch', 'prepare', 'validate', 'all'].includes(command),
		'Usage: node scripts/agency-context.mjs fetch|prepare|validate|all [--refresh]'
	);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
	main().catch((error) => {
		console.error(
			`Agency context failed: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exitCode = 1;
	});
}
