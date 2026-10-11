import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createOperationsLoader, validateOperationsBundle } from './operationsSource.ts';
import { extractPublicNotice, fetchPublicNotice } from './noticeExtraction.ts';

describe('operational source snapshots', () => {
	it('validates the installed public bundle, including explicitly empty council coverage', async () => {
		const bundle = validateOperationsBundle(
			JSON.parse(await readFile('data/public/operations/bundle.json', 'utf8'))
		);
		expect(bundle.weatherAlerts.length).toBeGreaterThan(0);
		expect(bundle.sources.find((s) => s.id === 'maavehi-road-map')?.status).toBe('empty');
		expect(
			bundle.nationalReadiness
				.filter((i) => i.accessReadiness === 'population-only')
				.every((i) => !i.routingAvailable)
		).toBe(true);
	});
	it('retains a last validated snapshot after corrupt replacements and read failures', async () => {
		let contents = await readFile('data/public/operations/bundle.json', 'utf8');
		const load = createOperationsLoader(async () => contents);
		const initial = await load();
		contents = '{broken';
		const fallback = await load();
		expect(fallback.version).toBe(initial.version);
		expect(fallback.stale).toBe(true);
		const unavailable = await createOperationsLoader(async () => {
			throw new Error('offline');
		})();
		expect(unavailable.status).toBe('unavailable');
		expect(unavailable.roadEvents).toEqual([]);
		expect(unavailable.gaps[0]).toContain('No warning, closure');
	});
	it('rejects an advisory silently converted to a route closure', async () => {
		const bundle = JSON.parse(await readFile('data/public/operations/bundle.json', 'utf8'));
		bundle.weatherAlerts[0].routingEffect = 'closed';
		expect(() => validateOperationsBundle(bundle)).toThrow('automatically block routes');
	});
});

describe('notice reading and optional AI', () => {
	it('uses source-linked rules without an API key and makes no provider request', async () => {
		const result = await extractPublicNotice(
			{
				sourceUrl: 'https://malecity.gov.mv/en/notices/example',
				text: 'Majeedhee Magu is closed for roadworks until further notice.'
			},
			{ enabled: true },
			(() => {
				throw new Error('should not request');
			}) as typeof fetch
		);
		expect(result.candidate.extractionMethod).toBe('rules');
		expect(result.ai.available).toBe(false);
	});
	it('validates every publisher redirect before any next fetch', async () => {
		let requests = 0;
		const fetcher = (async () => {
			requests++;
			return new Response(null, {
				status: 302,
				headers: { location: 'https://127.0.0.1/private' }
			});
		}) as typeof fetch;
		await expect(
			fetchPublicNotice('https://malecity.gov.mv/en/notices/example', fetcher)
		).rejects.toThrow('allowlisted');
		expect(requests).toBe(1);
	});
	it('falls back when the AI invents a supporting quote', async () => {
		const fetcher = (async () =>
			new Response(
				JSON.stringify({
					status: 'completed',
					output: [
						{
							content: [
								{
									type: 'output_text',
									text: JSON.stringify({
										title: 'Closed road',
										description: 'Road closure',
										supportingText: 'Fabricated statement',
										locationLabel: 'Unknown Road',
										mode: 'road',
										validFrom: null,
										validUntil: null
									})
								}
							]
						}
					]
				}),
				{ status: 200 }
			)) as typeof fetch;
		const result = await extractPublicNotice(
			{
				sourceUrl: 'https://malecity.gov.mv/en/notices/example',
				text: 'Majeedhee Magu is closed for maintenance until further notice.'
			},
			{ enabled: true, key: 'test-only', model: 'test-model' },
			fetcher
		);
		expect(result.candidate.extractionMethod).toBe('rules');
		expect(result.warning).toBeTruthy();
	});
	it('accepts supported fields but rejects an invented timestamp even with a real supporting excerpt', async () => {
		const text =
			'Majeedhee Magu is closed for maintenance from 2026-10-11T08:00:00+05:00 until 2026-10-11T12:00:00+05:00.';
		for (const invented of [false, true]) {
			const fetcher = (async (_url, options) => {
				const request = JSON.parse(String(options?.body));
				expect(request.store).toBe(false);
				expect(request.text.format.type).toBe('json_schema');
				return new Response(
					JSON.stringify({
						status: 'completed',
						output: [
							{
								content: [
									{
										type: 'output_text',
										text: JSON.stringify({
											title: 'Maintenance notice',
											description: 'Public maintenance notice',
											supportingText: text,
											locationLabel: 'Majeedhee Magu',
											mode: 'road',
											validFrom: invented
												? '2026-10-12T08:00:00+05:00'
												: '2026-10-11T08:00:00+05:00',
											validUntil: invented
												? '2026-10-12T12:00:00+05:00'
												: '2026-10-11T12:00:00+05:00'
										})
									}
								]
							}
						]
					}),
					{ status: 200 }
				);
			}) as typeof fetch;
			const result = await extractPublicNotice(
				{ sourceUrl: 'https://malecity.gov.mv/en/notices/example', text },
				{ enabled: true, key: 'test-only', model: 'test-model' },
				fetcher
			);
			expect(result.candidate.extractionMethod).toBe(invented ? 'rules' : 'ai-assisted');
			expect(result.candidate.geometry).toBeNull();
			expect(result.candidate.routingEffect).toBe('candidate-only');
		}
	});
});
