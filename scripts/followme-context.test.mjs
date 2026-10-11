import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
	attachObservation,
	createKeyedPublicApiClient,
	parseDirectory
} from './followme-context.mjs';

function card(type = 'Speed Boat', suffix = '1') {
	return `<article class="boat-card" data-boat-id="${suffix}">
	<a class="boat-main-link" href="/public/?id=${suffix}"><h2>Test &amp; Boat 7777777</h2><time>2 mins ago</time>
	<p class="operator-name">Test Operator 9999999</p><div class="boat-status"><strong>Hulhumale</strong></div></a>
	<a class="boat-meta-link" href="/public/?id=${suffix}"><span>${type}</span></a></article>`;
}

test('allowlists vessels, removes contact strings and preserves missing positions', () => {
	const parsed = parseDirectory(card() + card('Car', '2') + card('Unknown', '3'), {
		retrievedAt: '2026-10-10T10:00:00Z'
	});
	assert.equal(parsed.vessels.length, 1);
	assert.equal(parsed.directoryCardCount, 3);
	assert.deepEqual(parsed.excludedTypeCounts, { Car: 1, Unknown: 1 });
	assert.equal(parsed.vessels[0].name, 'Test & Boat');
	assert.equal(parsed.vessels[0].operator, 'Test Operator');
	assert.equal(parsed.vessels[0].coordinates, null);
	assert.equal(parsed.vessels[0].speedKnots, null);
	assert.match(parsed.vessels[0].id, /^followme-[a-f0-9]{16}$/);
	assert.ok(!JSON.stringify(parsed).includes('7777777'));
});

test('fails closed on source drift or duplicated public cards', () => {
	assert.throws(() => parseDirectory('<main>New format</main>'), /No public vessel cards/);
	assert.throws(() => parseDirectory(card() + card()), /Duplicate/);
});

test('preserves genuine zero speed and raw date while removing device identifiers', () => {
	const vessel = parseDirectory(card()).vessels[0];
	const result = attachObservation(
		vessel,
		{
			status: 'ok',
			device: {
				id: 1,
				imei: 'PRIVATE-DEVICE',
				latitude: '4.21',
				longitude: '73.54',
				speed: 0,
				heading: null,
				updated_at: '2026-10-10 15:01:02',
				fence: { name: 'Hulhumale', status: 'ARRIVED', datetime: '2026-10-10 14:00:00' }
			}
		},
		'2026-10-10T10:03:00Z'
	);
	assert.deepEqual(result.coordinates, [73.54, 4.21]);
	assert.equal(result.speedKnots, 0);
	assert.equal(result.headingDeg, null);
	assert.equal(result.observedAt, null);
	assert.equal(result.observedAtRaw, '2026-10-10 15:01:02');
	assert.equal(result.observedTimezone, null);
	assert.ok(!JSON.stringify(result).includes('PRIVATE-DEVICE'));
	assert.ok(!Object.hasOwn(result, 'imei'));
});

test('rejects missing coordinates and mismatched observation/card identities', () => {
	const vessel = parseDirectory(card()).vessels[0];
	assert.throws(
		() =>
			attachObservation(vessel, { status: 'ok', device: { id: 1, latitude: null, longitude: 73 } }),
		/invalid coordinates/
	);
	assert.throws(
		() =>
			attachObservation(vessel, { status: 'ok', device: { id: 2, latitude: 4, longitude: 73 } }),
		/does not match/
	);
});

test('requires an issued key and caches or merges requests for one minute', async () => {
	let calls = 0;
	const fetchFn = async () => {
		calls++;
		return Response.json({ result: 'schema not verified' });
	};
	await assert.rejects(createKeyedPublicApiClient({ fetchFn })(), /issued/);
	let time = 100_000;
	const client = createKeyedPublicApiClient({ apiKey: 'test-only', fetchFn, now: () => time });
	const [first, second] = await Promise.all([client(), client()]);
	assert.equal(first, second);
	assert.equal(calls, 1);
	assert.equal(await client(), first);
	time += 60_000;
	await client();
	assert.equal(calls, 2);
});

test('hides keys in failures and refuses immediate retries', async () => {
	let calls = 0;
	const fetchFn = async () => {
		calls++;
		throw new Error('url contains private-key');
	};
	const client = createKeyedPublicApiClient({ apiKey: 'private-key', fetchFn });
	await assert.rejects(client(), /could not be loaded/);
	await assert.rejects(client(), /at most one/);
	assert.equal(calls, 1);
});
