import { describe, expect, it } from 'vitest';
import { activeWeatherAlerts, alertState, eventIsActive } from './lifecycle.ts';
import { extractNoticeRules, publicNoticeUrl } from './notices.ts';
import type { WeatherAlert } from './types.ts';

const alert = (id: string, overrides: Partial<WeatherAlert> = {}): WeatherAlert => ({
	id,
	sourceId: 'mms',
	sourceUrl: 'https://cap.meteorology.gov.mv/rss/alerts/3247',
	sentAt: '2026-10-11T01:00:00+05:00',
	messageType: 'Alert',
	references: [],
	status: 'Actual',
	scope: 'Public',
	headline: 'Heavy rain',
	description: '',
	instruction: '',
	severity: 'Minor',
	urgency: 'Expected',
	certainty: 'Likely',
	event: 'Rain',
	areaLabel: 'Malé',
	validFrom: '2026-10-11T02:00:00+05:00',
	validUntil: '2026-10-11T08:30:00+05:00',
	geometry: null,
	evidenceStatus: 'publisher-issued',
	provenance: 'observed',
	routingEffect: 'advisory-only',
	qualification: 'Advisory',
	...overrides
});

describe('CAP lifecycle and dated replay', () => {
	it('does not display expired, future, test, or non-public alerts as current', () => {
		const alerts = [
			alert('valid'),
			alert('test', { status: 'Test' }),
			alert('private', { scope: 'Restricted' }),
			alert('future', { sentAt: '2026-10-12T01:00:00+05:00' })
		];
		expect(
			activeWeatherAlerts({ weatherAlerts: alerts }, '2026-10-11T06:00:00+05:00').map((a) => a.id)
		).toEqual(['valid']);
		expect(activeWeatherAlerts({ weatherAlerts: alerts }, '2026-10-11T08:30:00+05:00')).toEqual([]);
	});
	it('applies updates and cancels only once they are issued', () => {
		const original = alert('old');
		const replacement = alert('new', {
			messageType: 'Update',
			sentAt: '2026-10-11T05:00:00+05:00',
			references: ['old']
		});
		const cancel = alert('cancel', {
			messageType: 'Cancel',
			sentAt: '2026-10-11T07:00:00+05:00',
			references: ['new'],
			validFrom: null,
			validUntil: null
		});
		const bundle = { weatherAlerts: [cancel, replacement, original] };
		expect(activeWeatherAlerts(bundle, '2026-10-11T04:00:00+05:00').map((a) => a.id)).toEqual([
			'old'
		]);
		expect(activeWeatherAlerts(bundle, '2026-10-11T06:00:00+05:00').map((a) => a.id)).toEqual([
			'new'
		]);
		expect(activeWeatherAlerts(bundle, '2026-10-11T07:00:00+05:00')).toEqual([]);
	});
	it('keeps missing expiry unresolved instead of assuming indefinite disruption', () => {
		expect(alertState(alert('unknown', { validUntil: null }), '2026-10-11T06:00:00+05:00')).toBe(
			'unresolved'
		);
		expect(
			eventIsActive({ validFrom: '2026-10-11T01:00:00Z', validUntil: null }, '2026-10-11T03:00:00Z')
		).toBe(false);
	});
});

describe('public notice extraction', () => {
	it('extracts an English disruption candidate and requires geographic confirmation', () => {
		const result = extractNoticeRules({
			sourceUrl: 'https://malecity.gov.mv/en/notices/example',
			text: 'Majeedhee Magu is closed for construction from 2026-10-11T08:00:00+05:00 until 2026-10-11T12:00:00+05:00.'
		});
		expect(result.mode).toBe('road');
		expect(result.locationLabel).toBe('Majeedhee Magu');
		expect(result.validUntil).toBe('2026-10-11T12:00:00+05:00');
		expect(result.routingEffect).toBe('candidate-only');
		expect(result.geometry).toBeNull();
		expect(result.extractionMethod).toBe('rules');
	});
	it('does not invent timezone, expiry or road geometry', () => {
		const result = extractNoticeRules({
			sourceUrl: 'https://police.gov.mv/news/example',
			text: 'Majeedhee Magu will be closed on 11 October from eight in the morning. Further information will follow.'
		});
		expect(result.validFrom).toBeNull();
		expect(result.validUntil).toBeNull();
		expect(result.missingFields).toContain('Expiry / reopening');
	});
	it('rejects credentials, non-public hosts, redirect ports and lookalike hostnames', () => {
		for (const url of [
			'http://malecity.gov.mv/test',
			'https://malecity.gov.mv.evil.test/test',
			'https://user:pass@police.gov.mv/test',
			'https://127.0.0.1/test',
			'https://malecity.gov.mv:8443/test'
		])
			expect(() => publicNoticeUrl(url)).toThrow();
	});
});
