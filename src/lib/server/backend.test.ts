import { describe, it, expect, vi } from 'vitest';
import { forwardBackend } from './backend';
import { gunzipSync } from 'node:zlib';

describe('backend integration boundary', () => {
	it('keeps embedded API documentation and its schema inside the public app mount', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response('url: "/api/v1/places/openapi.json"'))
			.mockResolvedValueOnce(Response.json({ servers: [{ url: '/api/v1/places' }] }));
		const documentation = await forwardBackend(
			new Request('https://example.com/apps/datathon/api/backend/places/docs'),
			'places/docs',
			'http://backend:8000',
			fetcher,
			'',
			'/apps/datathon'
		);
		expect(await documentation.text()).toContain('/apps/datathon/api/backend/places/openapi.json');
		const schema = await forwardBackend(
			new Request('https://example.com/apps/datathon/api/backend/places/openapi.json'),
			'places/openapi.json',
			'http://backend:8000',
			fetcher,
			'',
			'/apps/datathon'
		);
		expect((await schema.json()).servers).toEqual([{ url: '/apps/datathon/api/backend/places' }]);
		expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
			'http://backend:8000/api/v1/places/docs',
			'http://backend:8000/api/v1/places/openapi.json'
		]);
	});

	it('forwards a scenario body and preserves backend validation responses', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				Response.json({ error: { message: 'Invalid scenario' } }, { status: 422 })
			);
		const request = new Request('http://localhost/api/backend/simulation/run?test=1', {
			method: 'POST',
			body: '{"scenario":{}}'
		});
		const result = await forwardBackend(
			request,
			'simulation/run',
			'http://127.0.0.1:8000',
			fetcher
		);
		expect(result.status).toBe(422);
		expect(fetcher.mock.calls[0][0].toString()).toBe(
			'http://127.0.0.1:8000/api/v1/simulation/run?test=1'
		);
		expect(fetcher.mock.calls[0][1]?.body).toBe('{"scenario":{}}');
		expect(await result.json()).toEqual({ error: { message: 'Invalid scenario' } });
	});
	it('reports a missing backend without inventing data', async () => {
		const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('connection refused'));
		const result = await forwardBackend(
			new Request('http://localhost/api/backend/health'),
			'health',
			'http://127.0.0.1:8000',
			fetcher
		);
		expect(result.status).toBe(503);
		expect((await result.json()).error.message).toContain('backend is unavailable');
	});
	it('forwards a map-placed bus connection package and its authoritative budget quote', async () => {
		const payload = {
			island_id: 'island:1442',
			coordinates: [73.545, 4.22],
			target_stop_id: 'rtl:stop:111',
			headway_minutes: 20,
			operations: []
		};
		const draft = {
			status: 'ready',
			operations: [{ type: 'add_stop' }, { type: 'add_service' }, { type: 'add_service' }],
			quote: { budget: { allowed: false, status: 'over_budget' } }
		};
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(draft));
		const response = await forwardBackend(
			new Request('http://localhost/api/backend/planning/bus-connection', {
				method: 'POST',
				body: JSON.stringify(payload)
			}),
			'planning/bus-connection',
			'http://127.0.0.1:8000',
			fetcher
		);
		expect(response.status).toBe(200);
		expect(fetcher.mock.calls[0][0].toString()).toBe(
			'http://127.0.0.1:8000/api/v1/planning/bus-connection'
		);
		expect(fetcher.mock.calls[0][1]).toMatchObject({
			method: 'POST',
			body: JSON.stringify(payload),
			headers: { 'content-type': 'application/json' }
		});
		expect(await response.json()).toEqual(draft);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
	it.each([
		'map/context',
		'routing/stops',
		'planning/calibration',
		'planning/calibration/validate',
		'planning/calibration/tariff',
		'planning/opportunities',
		'planning/opportunities/island%3A1442',
		'planning/opportunities/suggest',
		'planning/report.pdf',
		'planning/quote',
		'planning/connectivity',
		'planning/ferry-service',
		'planning/bus-connection',
		'forecasts/analysis',
		'forecasts/sources',
		'forecasts/sources/template',
		'forecasts/sources/stage',
		`forecasts/sources/${'a'.repeat(32)}/accept`,
		'data-updates',
		'data-updates/check',
		'data-updates/schedules',
		'data-updates/schedules/stage',
		'data-updates/schedules/journey',
		`data-updates/schedules/${'a'.repeat(64)}/accept`
	])('forwards the reviewed-data and planning endpoint: %s', async (path) => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
		const response = await forwardBackend(
			new Request(`http://localhost/api/backend/${path}`),
			path,
			'http://127.0.0.1:8000',
			fetcher
		);
		expect(response.status).toBe(200);
		expect(fetcher.mock.calls[0][0].toString()).toBe(`http://127.0.0.1:8000/api/v1/${path}`);
	});
	it.each([
		'data-updates/schedules/not-a-hash/accept',
		`data-updates/schedules/${'a'.repeat(63)}/accept`,
		`forecasts/sources/${'g'.repeat(32)}/accept`,
		'planning/calibration/delete',
		'planning/opportunities/island%3A1442/extra',
		'planning/report.pdf/extra',
		'planning/quote/extra',
		'planning/connectivity/extra',
		'planning/ferry-service/extra',
		'planning/bus-connection/extra',
		'forecasts/sources/stage/extra',
		'map/context/extra'
	])('rejects malformed new endpoint paths: %s', async (path) => {
		const fetcher = vi.fn<typeof fetch>();
		const response = await forwardBackend(
			new Request('http://localhost/api/backend/invalid'),
			path,
			'http://127.0.0.1:8000',
			fetcher
		);
		expect(response.status).toBe(404);
		expect(fetcher).not.toHaveBeenCalled();
	});
	it('rejects arbitrary paths before contacting the backend', async () => {
		const fetcher = vi.fn<typeof fetch>();
		const result = await forwardBackend(
			new Request('http://localhost/api/backend/anything'),
			'../admin',
			'http://127.0.0.1:8000',
			fetcher
		);
		expect(result.status).toBe(404);
		expect(fetcher).not.toHaveBeenCalled();
	});
	it.each(['places/..', 'places/%2e%2e', 'places/%2fadmin', 'places/\\admin'])(
		'rejects normalized path escapes: %s',
		async (path) => {
			const fetcher = vi.fn<typeof fetch>();
			const response = await forwardBackend(
				new Request('http://localhost/api/backend/places/test'),
				path,
				'http://127.0.0.1:8000',
				fetcher
			);
			expect(response.status).toBe(404);
			expect(fetcher).not.toHaveBeenCalled();
		}
	);
	it('preserves imagery bytes and provider receipts while keeping keys server side', async () => {
		const bytes = new Uint8Array([255, 216, 255, 217]);
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(bytes, {
				headers: {
					'content-type': 'image/jpeg',
					'cache-control': 'private, max-age=120',
					'x-request-id': 'receipt-1'
				}
			})
		);
		const result = await forwardBackend(
			new Request('http://localhost/api/backend/places/image?url=source'),
			'places/image',
			'http://127.0.0.1:8000',
			fetcher,
			'server-secret'
		);
		expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'x-api-key': 'server-secret' });
		expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
		expect(result.headers.get('content-type')).toBe('image/jpeg');
		expect(result.headers.get('x-request-id')).toBe('receipt-1');
		expect(result.headers.get('cache-control')).toBe('private, max-age=120');
		expect([...result.headers.values()].join()).not.toContain('server-secret');
	});
	it('preserves CSV download and retry metadata from expanded workspaces', async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response('value\n1', {
				status: 429,
				headers: {
					'content-type': 'text/csv',
					'content-disposition': 'attachment; filename=source.csv',
					'retry-after': '30'
				}
			})
		);
		const result = await forwardBackend(
			new Request('http://localhost/api/backend/datasets/population/export.csv'),
			'datasets/population/export.csv',
			'http://127.0.0.1:8000',
			fetcher
		);
		expect(result.status).toBe(429);
		expect(result.headers.get('retry-after')).toBe('30');
		expect(result.headers.get('content-disposition')).toContain('source.csv');
	});
	it('returns public snapshot validators and a body-free conditional response', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockImplementation(async () => Response.json({ features: [1, 2] }));
		const first = await forwardBackend(
			new Request('http://localhost/api/backend/map/features?layer=islands'),
			'map/features',
			'http://127.0.0.1:8000',
			fetcher
		);
		const etag = first.headers.get('etag')!;
		expect(etag).toMatch(/^W\/"[a-f0-9]{64}"$/);
		expect(first.headers.get('cache-control')).toContain('max-age=60');
		const second = await forwardBackend(
			new Request('http://localhost/api/backend/map/features?layer=islands', {
				headers: { 'if-none-match': etag }
			}),
			'map/features',
			'http://127.0.0.1:8000',
			fetcher
		);
		expect(second.status).toBe(304);
		expect(await second.text()).toBe('');
		expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
			'if-none-match': etag,
			'accept-encoding': 'identity'
		});
		expect(second.headers.get('vary')).toContain('Accept-Encoding');
	});

	it('forwards backend 304/source-version metadata without consuming or inventing a body', async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(null, {
				status: 304,
				headers: {
					etag: 'W/"source-a"',
					'x-data-version': 'sources-v2',
					'cache-control': 'private, max-age=0, must-revalidate'
				}
			})
		);
		const result = await forwardBackend(
			new Request('http://localhost/api/backend/accessibility/summary', {
				headers: { 'if-none-match': 'W/"source-a"' }
			}),
			'accessibility/summary',
			'http://127.0.0.1:8000',
			fetcher
		);
		expect(result.status).toBe(304);
		expect(result.headers.get('x-data-version')).toBe('sources-v2');
		expect(result.headers.get('cache-control')).toContain('max-age=0');
		expect(result.body).toBeNull();
	});

	it('adds snapshot validators only for the explicit published-history forecast query', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockImplementation(async () => Response.json({ monthly: [] }));
		for (const query of [
			'',
			'?history_only=false',
			'?target_month=2026-12',
			'?history_only=true'
		]) {
			const result = await forwardBackend(
				new Request(`http://localhost/api/backend/forecasts${query}`),
				'forecasts',
				'http://127.0.0.1:8000',
				fetcher
			);
			if (query === '?history_only=true') {
				expect(result.headers.get('etag')).toMatch(/^W\/"[a-f0-9]{64}"$/);
				expect(result.headers.get('cache-control')).toContain('max-age=60');
			} else {
				expect(result.headers.get('etag')).toBeNull();
				expect(result.headers.get('cache-control')).toBe('no-store');
			}
		}
	});

	it('compresses large JSON for the browser and preserves exact data', async () => {
		const source = {
			features: Array.from({ length: 2_000 }, (_, index) => ({
				id: index,
				name: 'Island source polygon'
			}))
		};
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(source));
		const result = await forwardBackend(
			new Request('http://localhost/api/backend/map/features', {
				headers: { 'accept-encoding': 'gzip, deflate, br' }
			}),
			'map/features',
			'http://127.0.0.1:8000',
			fetcher
		);
		const compressed = new Uint8Array(await result.arrayBuffer());
		expect(result.headers.get('content-encoding')).toBe('gzip');
		expect(JSON.parse(gunzipSync(compressed).toString())).toEqual(source);
		expect(compressed.byteLength).toBeLessThan(JSON.stringify(source).length / 3);
	});

	it.each(['identity', 'gzip;q=0, br'])(
		'does not send gzip to browsers that refuse it: %s',
		async (encoding) => {
			const source = { values: 'a'.repeat(3_000) };
			const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(source));
			const result = await forwardBackend(
				new Request('http://localhost/api/backend/map/features', {
					headers: { 'accept-encoding': encoding }
				}),
				'map/features',
				'http://127.0.0.1:8000',
				fetcher
			);
			expect(result.headers.get('content-encoding')).toBeNull();
			expect(await result.json()).toEqual(source);
		}
	);

	it('does not apply static cache headers to live feeds or proposal responses', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockImplementation(async () => Response.json({ score: 40 }));
		for (const [path, method] of [
			['live/snapshot', 'GET'],
			['planning/evaluate', 'POST']
		]) {
			const result = await forwardBackend(
				new Request(`http://localhost/api/backend/${path}`, { method }),
				path,
				'http://127.0.0.1:8000',
				fetcher
			);
			expect(result.headers.get('etag')).toBeNull();
			expect(result.headers.get('cache-control')).toBe('no-store');
		}
	});
});
