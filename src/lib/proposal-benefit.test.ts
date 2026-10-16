import { describe, expect, it } from 'vitest';
import { proposalBenefit } from './proposal-benefit.js';
import type { TransportImpactData } from './transport-impact.js';

const fasterBus: TransportImpactData = {
	lines: [
		{
			id: 'bus',
			name: 'R1',
			mode: 'bus',
			change: 'improved',
			expected_wait_comparable: true,
			before: { expected_wait_minutes: 15 },
			after: { expected_wait_minutes: 7.5 }
		}
	]
};

describe('proposalBenefit', () => {
	it('leads with resident access when it increases, keeping service benefit separate', () => {
		expect(proposalBenefit(120, fasterBus)).toMatchObject({
			label: 'Gaining access',
			value: 120,
			detail: '7.5 min shorter expected wait · R1'
		});
	});
	it('shows a comparable route wait saving even when walking coverage is unchanged', () => {
		expect(proposalBenefit(0, fasterBus)).toMatchObject({
			label: 'Wait saved',
			value: 7.5,
			unit: 'min',
			reduced: false
		});
	});
	it('does not call a longer wait a benefit', () => {
		const slower = structuredClone(fasterBus);
		slower.lines![0].after = { expected_wait_minutes: 20 };
		expect(proposalBenefit(0, slower)).toMatchObject({
			label: 'Wait increase',
			value: 5,
			reduced: true
		});
	});
	it('counts actual new directed connections without claiming residents served', () => {
		expect(
			proposalBenefit(0, {
				connections: [
					{
						id: 'a-b',
						mode: 'ferry',
						from_island_id: 'a',
						to_island_id: 'b',
						from_island_name: 'A',
						to_island_name: 'B',
						change: 'added'
					}
				]
			})
		).toMatchObject({ label: 'New directions', value: 1, unit: '' });
	});
	it('does not infer a saving from an incomparable service window', () => {
		const incomparable = structuredClone(fasterBus);
		incomparable.lines![0].expected_wait_comparable = false;
		expect(proposalBenefit(0, incomparable)).toMatchObject({ label: 'Gaining access', value: 0 });
	});
	it('keeps unknown access unknown and distinguishes it from zero', () => {
		expect(proposalBenefit(null).value).toBeNull();
		expect(proposalBenefit(0).value).toBe(0);
	});
	it('qualifies a real saving when another dated service is removed without double-counting it', () => {
		const mixed = structuredClone(fasterBus);
		mixed.lines!.push({
			id: 'ferry',
			name: 'Island ferry',
			mode: 'ferry',
			change: 'removed',
			before: { departure_count: 2 },
			after: null
		});
		mixed.connections = [
			{
				id: 'a-b',
				mode: 'ferry',
				from_island_id: 'a',
				to_island_id: 'b',
				from_island_name: 'A',
				to_island_name: 'B',
				change: 'removed',
				before: { departure_count: 2, service_ids: ['ferry'] },
				after: null
			}
		];
		expect(proposalBenefit(0, mixed)).toMatchObject({
			label: 'Wait saved',
			value: 7.5,
			reduced: false,
			guardrail: 'Also includes reduced or removed service. Review timetables.'
		});
		expect(proposalBenefit(0, fasterBus).guardrail).toBeNull();
	});
});
