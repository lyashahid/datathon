import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './api.js';

const snapshot = (value: unknown, etag = 'W/"source-a"', maxAge = 60) =>
	Response.json(value, {
		headers: { etag, 'cache-control': `private, max-age=${maxAge}, must-revalidate` }
	});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function browserStorage() {
	const entries = new Map<string, Response>();
	const key = (value: RequestInfo | URL) =>
		value instanceof Request ? value.url.replace('http://localhost', '') : String(value);
	const cache = {
		match: async (value: RequestInfo | URL) => entries.get(key(value))?.clone(),
		put: async (value: RequestInfo | URL, response: Response) => {
			entries.set(key(value), response.clone());
		},
		delete: async (value: RequestInfo | URL) => entries.delete(key(value)),
		keys: async () => [...entries.keys()].map((value) => new Request(`http://localhost${value}`))
	};
	return {
		entries,
		open: vi.fn(async () => cache as unknown as Cache),
		delete: vi.fn(async () => {
			entries.clear();
			return true;
		})
	};
}

const settleStorage = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('shared browser API reads', () => {
	it('shares one GET and isolates each subscriber cancellation', async () => {
		const pending = deferred<Response>();
		const fetcher = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
		const client = createApiClient({ fetcher, storage: () => null });
		const first = new AbortController();
		const second = new AbortController();
		const a = client.request('live/snapshot?scope=all', undefined, first.signal);
		const b = client.request('live/snapshot?scope=all', undefined, second.signal);
		first.abort();
		await expect(a).rejects.toMatchObject({ name: 'AbortError' });
		expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
		pending.resolve(Response.json({ vehicles: 4 }));
		await expect(b).resolves.toEqual({ vehicles: 4 });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('cancels the transport when all subscribers leave and permits an immediate replacement', async () => {
		const first = new AbortController();
		const fetcher = vi
			.fn<typeof fetch>()
			.mockImplementationOnce(
				(_url, options) =>
					new Promise((_resolve, reject) =>
						options?.signal?.addEventListener('abort', () => reject(options.signal?.reason))
					)
			)
			.mockResolvedValueOnce(Response.json({ ok: true }));
		const client = createApiClient({ fetcher, storage: () => null });
		const a = client.request('live/status', undefined, first.signal);
		first.abort();
		const b = client.request('live/status');
		await expect(a).rejects.toMatchObject({ name: 'AbortError' });
		await expect(b).resolves.toEqual({ ok: true });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('returns stable source references and canonicalizes independent query key order', async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(snapshot({ features: [] }));
		const client = createApiClient({ fetcher, storage: () => null });
		const value = await client.request('map/features?layer=islands&simplify_m=25');
		expect(await client.request('map/features?simplify_m=25&layer=islands')).toBe(value);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('never retains live feeds or failed responses', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(snapshot({ vehicles: 1 }))
			.mockResolvedValueOnce(snapshot({ vehicles: 2 }))
			.mockResolvedValueOnce(
				Response.json(
					{ error: { message: 'Try again', details: { provider: 'offline' } } },
					{ status: 503 }
				)
			)
			.mockResolvedValueOnce(snapshot({ features: [] }));
		const client = createApiClient({ fetcher, storage: () => null });
		await expect(client.request('live/snapshot')).resolves.toEqual({ vehicles: 1 });
		await expect(client.request('live/snapshot')).resolves.toEqual({ vehicles: 2 });
		await expect(client.request('map/features')).rejects.toMatchObject({
			status: 503,
			message: 'Try again',
			details: { provider: 'offline' }
		});
		await expect(client.request('map/features')).resolves.toEqual({ features: [] });
		expect(fetcher).toHaveBeenCalledTimes(4);
	});

	it('retains only the explicit published-history representation of passenger forecasts', async () => {
		const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => snapshot({ monthly: [] }));
		const storage = browserStorage();
		const client = createApiClient({ fetcher, storage: () => storage });
		const history = await client.request('forecasts?history_only=true');
		expect(await client.request('forecasts?history_only=true')).toBe(history);
		for (const path of [
			'forecasts',
			'forecasts?history_only=false',
			'forecasts?target_month=2026-12'
		]) {
			await client.request(path);
			await client.request(path);
		}
		expect(fetcher).toHaveBeenCalledTimes(7);
		await settleStorage();
		expect([...storage.entries.keys()]).toEqual(['/api/backend/forecasts?history_only=true']);
	});

	it('does not deduplicate or cache exact scenario POSTs', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockImplementation(async () => Response.json({ capital: 50 }));
		const client = createApiClient({ fetcher, storage: () => null });
		const payload = {
			operations: [{ type: 'add_stop', coordinates: [73.5, 4.2] }],
			assumptions: { capital_budget_mvr: 50 }
		};
		await Promise.all([
			client.request('planning/quote', payload),
			client.request('planning/quote', payload)
		]);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(fetcher.mock.calls[0][1]?.body).toBe(JSON.stringify(payload));
	});

	it('refreshes retained views only after a successful source change and supports cleanup', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(snapshot({ score: 20 }))
			.mockResolvedValueOnce(Response.json({ error: { message: 'Rejected' } }, { status: 422 }))
			.mockResolvedValueOnce(Response.json({ accepted: true }))
			.mockResolvedValueOnce(snapshot({ score: 40 }))
			.mockResolvedValueOnce(Response.json({ capital: 50 }));
		const client = createApiClient({ fetcher, storage: () => null });
		const refreshed = vi.fn(() => void client.request('accessibility/summary'));
		const unsubscribe = client.subscribeInvalidation(refreshed);
		await client.request('accessibility/summary');
		const endpoint = `forecasts/sources/${'a'.repeat(32)}/accept`;
		await expect(client.request(endpoint, {})).rejects.toMatchObject({ status: 422 });
		expect(refreshed).not.toHaveBeenCalled();
		await client.request(endpoint, {});
		expect(refreshed).toHaveBeenCalledTimes(1);
		await expect(client.request('accessibility/summary')).resolves.toEqual({ score: 40 });
		await client.request('planning/quote', {});
		expect(refreshed).toHaveBeenCalledTimes(1);
		unsubscribe();
		await client.invalidate();
		expect(refreshed).toHaveBeenCalledTimes(1);
	});

	it('keeps HTTP failures readable when a proxy returns HTML or an empty error body', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response('<html>Unavailable</html>', { status: 502 }))
			.mockResolvedValueOnce(new Response('null', { status: 503 }));
		const client = createApiClient({ fetcher, storage: () => null });
		await expect(client.request('live/status')).rejects.toMatchObject({
			status: 502,
			message: 'Request failed (502). Please retry.'
		});
		await expect(client.request('live/status')).rejects.toMatchObject({
			status: 503,
			message: 'Request failed (503)'
		});
	});

	it('revalidates expired data and reuses the parsed object only for a matching version', async () => {
		let clock = 1_000;
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(snapshot({ score: 30 }, 'W/"a"', 1))
			.mockResolvedValueOnce(
				new Response(null, {
					status: 304,
					headers: { etag: 'W/"a"', 'cache-control': 'private, max-age=1' }
				})
			)
			.mockResolvedValueOnce(snapshot({ score: 31 }, 'W/"b"', 1));
		const client = createApiClient({ fetcher, storage: () => null, now: () => clock });
		const initial = await client.request('accessibility/summary');
		clock += 1_001;
		expect(await client.request('accessibility/summary')).toBe(initial);
		expect(fetcher.mock.calls[1][1]?.headers).toEqual({ 'If-None-Match': 'W/"a"' });
		clock += 1_001;
		const changed = await client.request('accessibility/summary');
		expect(changed).toEqual({ score: 31 });
		expect(changed).not.toBe(initial);
	});

	it('persists only versioned public snapshots and revalidates zero-age data after reload', async () => {
		const storage = browserStorage();
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(snapshot({ country: 28 }, 'W/"a"', 0))
			.mockResolvedValueOnce(
				new Response(null, {
					status: 304,
					headers: { etag: 'W/"a"', 'cache-control': 'private, max-age=0, must-revalidate' }
				})
			);
		const first = createApiClient({ fetcher, storage: () => storage });
		await first.request('national/summary');
		await settleStorage();
		expect(storage.entries.size).toBe(1);
		const reload = createApiClient({ fetcher, storage: () => storage });
		await expect(reload.request('national/summary')).resolves.toEqual({ country: 28 });
		expect(fetcher.mock.calls[1][1]?.headers).toEqual({ 'If-None-Match': 'W/"a"' });
	});

	it('honors no-store, source age, and failures without returning stale data', async () => {
		let clock = 10_000;
		const old = snapshot({ score: 20 }, 'W/"old"', 60);
		old.headers.set('age', '59');
		const privateResponse = snapshot({ score: 30 });
		privateResponse.headers.set('cache-control', 'no-store');
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(old)
			.mockResolvedValueOnce(Response.json({ error: { message: 'offline' } }, { status: 503 }))
			.mockResolvedValueOnce(privateResponse)
			.mockResolvedValueOnce(snapshot({ score: 31 }));
		const client = createApiClient({ fetcher, storage: () => null, now: () => clock });
		await client.request('accessibility/summary');
		clock += 1_001;
		await expect(client.request('accessibility/summary')).rejects.toBeInstanceOf(ApiError);
		await expect(client.request('accessibility/summary')).resolves.toEqual({ score: 30 });
		await expect(client.request('accessibility/summary')).resolves.toEqual({ score: 31 });
		expect(fetcher).toHaveBeenCalledTimes(4);
	});

	it('invalidates public snapshots after an accepted source change and does not join older reads', async () => {
		const pending = deferred<Response>();
		const fetcher = vi
			.fn<typeof fetch>()
			.mockReturnValueOnce(pending.promise)
			.mockResolvedValueOnce(Response.json({ accepted: true }))
			.mockResolvedValueOnce(snapshot({ score: 40 }));
		const client = createApiClient({ fetcher, storage: () => null });
		const old = client.request('accessibility/summary');
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
		await client.request(`forecasts/sources/${'a'.repeat(32)}/accept`, { note: 'Reviewed source' });
		const current = client.request('accessibility/summary');
		pending.resolve(snapshot({ score: 20 }));
		await expect(old).resolves.toEqual({ score: 40 });
		await expect(current).resolves.toEqual({ score: 40 });
		expect(await client.request('accessibility/summary')).toEqual({ score: 40 });
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it('works with blocked browser storage and rejects already cancelled requests before fetching', async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(snapshot({ features: [] }));
		const client = createApiClient({
			fetcher,
			storage: () => {
				throw new Error('Storage disabled');
			}
		});
		const cancelled = AbortSignal.abort();
		await expect(client.request('map/features', undefined, cancelled)).rejects.toMatchObject({
			name: 'AbortError'
		});
		expect(fetcher).not.toHaveBeenCalled();
		await expect(client.request('map/features')).resolves.toEqual({ features: [] });
	});

	it('waits for disk invalidation before a new read can reuse an old persisted snapshot', async () => {
		const storage = browserStorage();
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(snapshot({ score: 20 }))
			.mockResolvedValueOnce(snapshot({ score: 40 }));
		const client = createApiClient({ fetcher, storage: () => storage });
		await client.request('accessibility/summary');
		await settleStorage();
		const deletion = deferred<boolean>();
		storage.delete.mockImplementationOnce(async () => {
			await deletion.promise;
			storage.entries.clear();
			return true;
		});
		const invalidating = client.invalidate();
		const current = client.request('accessibility/summary');
		await vi.waitFor(() => expect(storage.delete).toHaveBeenCalledTimes(1));
		expect(fetcher).toHaveBeenCalledTimes(1);
		deletion.resolve(true);
		await invalidating;
		await expect(current).resolves.toEqual({ score: 40 });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
});
