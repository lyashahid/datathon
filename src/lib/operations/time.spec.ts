import { describe, expect, it } from 'vitest';
import { maldivesDateTime } from './time.ts';

describe('source instants in Maldives time', () => {
	it('moves the date across midnight when UTC and MVT differ', () => {
		expect(maldivesDateTime('2026-10-11T21:30:00Z')).toEqual({ date: '2026-10-12', time: '02:30' });
		expect(maldivesDateTime('2026-10-12T02:30:00+05:00')).toEqual({
			date: '2026-10-12',
			time: '02:30'
		});
	});
	it('preserves the distinct local dates of a notice crossing midnight', () => {
		const start = maldivesDateTime('2026-10-11T18:30:00Z');
		const end = maldivesDateTime('2026-10-11T20:00:00Z');
		expect(start).toEqual({ date: '2026-10-11', time: '23:30' });
		expect(end).toEqual({ date: '2026-10-12', time: '01:00' });
	});
	it('does not interpret timestamps with unresolved timezone', () => {
		expect(maldivesDateTime('2026-10-11T08:00:00')).toBeNull();
		expect(maldivesDateTime('invalid')).toBeNull();
	});
});
