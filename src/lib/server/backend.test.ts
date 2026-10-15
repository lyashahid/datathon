import { describe, it, expect, vi } from 'vitest';
import { forwardBackend } from './backend';

describe('backend integration boundary', () => {
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
});
