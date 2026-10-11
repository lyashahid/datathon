import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoordinates, assessSequence, captureOptions } from './collect-bus-positions.mjs';

const receivedAt = '2026-10-11T11:48:56Z';
function payload(extra = {}) {
	return {
		busList: [
			{
				busCode: 'PRIVATE-BUS-CODE',
				plateNumber: 'PRIVATE-PLATE',
				latitude: 4.2,
				longitude: 73.5,
				...extra
			}
		]
	};
}

test('allowlist removes plates and raw identifiers and pseudonyms are session-stable', () => {
	const first = parseCoordinates(payload(), receivedAt, 'private-salt');
	assert.match(first.vehicles[0].id, /^vehicle-[a-f0-9]{16}$/);
	assert.equal(
		first.vehicles[0].id,
		parseCoordinates(payload(), receivedAt, 'private-salt').vehicles[0].id
	);
	assert.notEqual(
		first.vehicles[0].id,
		parseCoordinates(payload(), receivedAt, 'another-salt').vehicles[0].id
	);
	assert.equal(JSON.stringify(first).includes('PRIVATE'), false);
	assert.equal(JSON.stringify(first).includes('plate'), false);
	assert.equal(first.measurementTimestampAvailable, false);
});
test('invalid coordinates and route mismatches are excluded rather than invented', () => {
	assert.equal(parseCoordinates(payload({ latitude: '4.2' }), receivedAt, 'salt').excluded, 1);
	assert.equal(parseCoordinates(payload({ latitude: 90 }), receivedAt, 'salt').vehicles.length, 0);
	assert.equal(
		parseCoordinates(payload({ routeCode: '999' }), receivedAt, 'salt').vehicles.length,
		0
	);
	assert.throws(
		() => parseCoordinates({ ...payload(), routeCode: '999' }, receivedAt, 'salt'),
		/route association/
	);
	assert.throws(() => parseCoordinates({}, receivedAt, 'salt'), /schema/);
});
test('repeated positions retain unresolved freshness; movement is separately counted', () => {
	const first = parseCoordinates(payload(), receivedAt, 'salt');
	const same = assessSequence(first, parseCoordinates(payload(), '2026-10-11T11:49:56Z', 'salt'));
	assert.equal(same.positionsRepeated, true);
	assert.equal(same.freshness, 'measurement-time-unverified');
	const changed = assessSequence(
		first,
		parseCoordinates(payload({ latitude: 4.201 }), '2026-10-11T11:49:56Z', 'salt')
	);
	assert.equal(changed.changedPositions, 1);
});
test('collector cannot be unbounded or sample more frequently than once a minute', () => {
	assert.deepEqual(captureOptions([]), { minutes: 10, intervalSeconds: 60 });
	assert.throws(() => captureOptions(['--minutes', 'Infinity']));
	assert.throws(() => captureOptions(['--interval-seconds', '5']));
	assert.throws(() => captureOptions(['--minutes', '0']));
});
