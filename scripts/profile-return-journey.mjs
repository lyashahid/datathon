import { readFileSync, writeFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { performance } from 'node:perf_hooks';
import { createDefaultAssumptions, PLANNING_MODEL_VERSION } from '../src/lib/planning/defaults.ts';
import { derivePlanningWorld } from '../src/lib/planning/scenario.ts';
import {
	computeAppointmentJourney,
	findAppointmentDepartureWindows
} from '../src/lib/planning/returnJourney.ts';

/** @type {import('../src/lib/planning/types.ts').PlanningBaseline} */
const baseline = JSON.parse(
	readFileSync(new URL('../data/public/planning-baseline.json', import.meta.url), 'utf8')
);
const catalog = JSON.parse(
	readFileSync(new URL('../static/demo/catalog.json', import.meta.url), 'utf8')
);
const inputs = JSON.parse(
	readFileSync(new URL('../static/demo/01-bus-investment.json', import.meta.url), 'utf8')
);
assert.equal(
	catalog.datasetVersion,
	baseline.version,
	'Regenerate demo scenarios after baseline changes.'
);
assert.equal(
	catalog.modelVersion,
	PLANNING_MODEL_VERSION,
	'Regenerate demo scenarios after model changes.'
);
const originId = catalog.cases[0].originId;
const options = catalog.appointmentOptions;
const defaultAssumptions = createDefaultAssumptions(baseline);
const normalWorld = derivePlanningWorld(baseline, [], defaultAssumptions);
const investedWorld = derivePlanningWorld(baseline, inputs.actions, inputs.assumptions);
/** @type {{name:string,milliseconds:number,result:unknown}[]} */
const samples = [];
/** @template T @param {string} name @param {()=>T} compute */
function sample(name, compute) {
	const start = performance.now();
	const result = compute();
	samples.push({ name, milliseconds: +(performance.now() - start).toFixed(2), result });
	return result;
}
const reference = sample('selected baseline appointment cold', () =>
	computeAppointmentJourney(baseline, normalWorld, originId, defaultAssumptions, options)
);
const appointment = sample('selected investment appointment first', () =>
	computeAppointmentJourney(baseline, investedWorld, originId, inputs.assumptions, options)
);
assert.equal(appointment.status, 'feasible');
const scan = sample('investment partial-window departure scan first', () =>
	findAppointmentDepartureWindows(baseline, investedWorld, originId, inputs.assumptions, options)
);
for (let i = 0; i < 5; i++) {
	assert.deepEqual(
		sample(`selected appointment repeat ${i + 1}`, () =>
			computeAppointmentJourney(baseline, investedWorld, originId, inputs.assumptions, options)
		),
		appointment
	);
	assert.deepEqual(
		sample(`partial-window scan repeat ${i + 1}`, () =>
			findAppointmentDepartureWindows(
				baseline,
				investedWorld,
				originId,
				inputs.assumptions,
				options
			)
		),
		scan
	);
}
const report = {
	profiledAt: new Date().toISOString(),
	node: process.version,
	platform: `${process.platform}/${process.arch}`,
	dataset: baseline.version,
	model: PLANNING_MODEL_VERSION,
	date: defaultAssumptions.date,
	departureMinutesMvt: defaultAssumptions.departureMinutes,
	originId,
	counts: {
		origins: baseline.origins.length,
		nodes: baseline.network.nodes.length,
		edges: baseline.network.edges.length,
		patterns: baseline.transit.patterns.length,
		departureSamples: scan.samples.length
	},
	results: {
		baselineAppointment: reference.status,
		investmentAppointment: appointment.status,
		feasibleDepartureSamples: scan.samples.filter((sample) => sample.status === 'feasible').length,
		unknownDepartureSamples: scan.samples.filter((sample) => sample.status === 'unavailable')
			.length,
		scanLabel: scan.label
	},
	interpretation:
		'Node model timings on the real cached bundle. Calculation runs on demand in a browser worker. Worker startup, cloning, browser rendering and device performance are excluded. Partial observed service coverage does not certify all-day departure windows. Repeat results must match exactly.',
	samples: samples.map(({ name, milliseconds }) => ({ name, milliseconds }))
};
if (process.argv.includes('--write'))
	writeFileSync(
		new URL('../docs/return-journey-profile.json', import.meta.url),
		`${JSON.stringify(report, null, '\t')}\n`
	);
console.info(JSON.stringify(report, null, 2));
