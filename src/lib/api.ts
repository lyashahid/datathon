import { apiCachePolicy, canonicalApiPath, changesPublicSources } from './api-cache-policy.js';
import { PUBLIC_BASE_PATH } from '$app/env/public';
import { backendUrl } from './app-paths.js';

export class ApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public details?: unknown
	) {
		super(message);
	}
}

const CACHE_NAME = 'mobility-public-api-v1';
const MAX_MEMORY_BYTES = 48 * 1024 * 1024;
const MAX_MEMORY_ENTRIES = 40;
const MAX_PERSISTENT_ENTRIES = 32;

type CachedValue = { value: unknown; expires: number; bytes: number; etag?: string };
type SavedValue = { response: Response; expires: number; etag: string };
type Flight = { controller: AbortController; promise: Promise<unknown>; subscribers: number };
type Storage = Pick<CacheStorage, 'open' | 'delete'>;

/** Isolated subscribers can cancel a shared request without cancelling another view's data. */
export function createApiClient({
	fetcher = (...args) => fetch(...args),
	now = Date.now,
	storage = () => (typeof window !== 'undefined' && 'caches' in globalThis ? caches : null),
	basePath = PUBLIC_BASE_PATH
}: {
	fetcher?: typeof fetch;
	now?: () => number;
	storage?: () => Storage | null;
	basePath?: string;
} = {}) {
	const cacheName = `${CACHE_NAME}${basePath ? `:${basePath}` : ''}`;
	const memory = new Map<string, CachedValue>();
	const flights = new Map<string, Flight>();
	const invalidationListeners = new Set<() => void>();
	let memoryBytes = 0;
	let generation = 0;
	let clearing = Promise.resolve();

	function remember(path: string, entry: CachedValue) {
		memoryBytes -= memory.get(path)?.bytes ?? 0;
		memory.delete(path);
		if (entry.bytes > MAX_MEMORY_BYTES) return;
		memory.set(path, entry);
		memoryBytes += entry.bytes;
		while (memory.size > MAX_MEMORY_ENTRIES || memoryBytes > MAX_MEMORY_BYTES) {
			const oldest = memory.keys().next().value!;
			memoryBytes -= memory.get(oldest)!.bytes;
			memory.delete(oldest);
		}
	}

	async function invalidate() {
		generation++;
		memory.clear();
		flights.clear();
		memoryBytes = 0;
		clearing = clearing.then(async () => {
			try {
				await storage()?.delete(cacheName);
			} catch {
				// Storage can be disabled or full; correctness never depends on a cache write.
			}
		});
		await clearing;
		for (const listener of invalidationListeners) {
			try {
				listener();
			} catch (cause) {
				// A view refresh must not turn an accepted source update into a failed write.
				console.error('Unable to refresh a view after a source update.', cause);
			}
		}
	}

	function subscribeInvalidation(listener: () => void) {
		invalidationListeners.add(listener);
		return () => {
			invalidationListeners.delete(listener);
		};
	}

	async function persisted(path: string): Promise<SavedValue | null> {
		try {
			const cache = await storage()?.open(cacheName);
			const response = await cache?.match(backendUrl(path, basePath));
			if (!response?.headers.get('etag')) return null;
			const expires = Number(response.headers.get('x-mobility-cache-expires'));
			if (!Number.isFinite(expires) || expires <= 0) return null;
			return {
				response,
				expires,
				etag: response.headers.get('etag')!
			};
		} catch {
			return null;
		}
	}

	async function restore(saved: SavedValue): Promise<CachedValue | null> {
		try {
			const text = await saved.response.text();
			return {
				value: JSON.parse(text),
				expires: saved.expires,
				bytes: text.length * 2,
				etag: saved.etag
			};
		} catch {
			return null;
		}
	}

	function startupSnapshot(request: Request) {
		const url = new URL(request.url);
		const path = url.pathname.slice(backendUrl('', basePath).length);
		return (
			/^(?:national\/summary|accessibility\/summary|planning\/(?:baseline|sea-network|air-network))$/.test(
				path
			) ||
			(path === 'map/features' &&
				url.searchParams.get('layer') === 'islands' &&
				!url.searchParams.has('island_id'))
		);
	}

	async function persist(
		path: string,
		text: string,
		headers: Headers,
		expires: number,
		epoch: number
	) {
		if (epoch !== generation) return;
		try {
			const cache = await storage()?.open(cacheName);
			if (!cache || epoch !== generation) return;
			const savedHeaders = new Headers({
				'content-type': 'application/json',
				etag: headers.get('etag')!,
				'cache-control': headers.get('cache-control') ?? 'private, max-age=60',
				'x-mobility-cache-expires': String(expires)
			});
			await cache.put(backendUrl(path, basePath), new Response(text, { headers: savedHeaders }));
			if (epoch !== generation) {
				await cache.delete(backendUrl(path, basePath));
				return;
			}
			const keys = await cache.keys();
			// Viewport and island browsing should not evict the national snapshots
			// needed on restart. Keep FIFO order within each group and the same cap.
			const eviction = keys
				.map((key, order) => ({ key, order, priority: Number(startupSnapshot(key)) }))
				.sort((a, b) => a.priority - b.priority || a.order - b.order);
			await Promise.all(
				eviction
					.slice(0, Math.max(0, keys.length - MAX_PERSISTENT_ENTRIES))
					.map(({ key }) => cache.delete(key))
			);
		} catch {
			// Cache Storage is an optional acceleration, including in private browsing.
		}
	}

	async function body(response: Response) {
		let value;
		try {
			value = await response.json();
		} catch (cause) {
			if (cause instanceof Error && cause.name === 'AbortError') throw cause;
			throw new ApiError(
				response.ok
					? 'The server returned an unreadable response. Please retry.'
					: `Request failed (${response.status}). Please retry.`,
				response.status
			);
		}
		if (!response.ok)
			throw new ApiError(
				value?.error?.message ?? `Request failed (${response.status})`,
				response.status,
				value?.error?.details
			);
		return value;
	}

	async function read(path: string, controller: AbortController) {
		const policy = apiCachePolicy(path);
		const epoch = generation;
		if (policy?.persistent) {
			await clearing;
			controller.signal.throwIfAborted();
		}
		let previous = memory.get(path);
		let saved: SavedValue | null = null;
		if (policy?.persistent && !previous) {
			saved = await persisted(path);
			controller.signal.throwIfAborted();
			if (epoch === generation && saved && saved.expires > now()) {
				previous = (await restore(saved)) ?? undefined;
				saved = null;
				controller.signal.throwIfAborted();
				if (previous) {
					if (epoch === generation) remember(path, previous);
					return previous.value;
				}
			}
		}
		const validator = previous?.etag ?? saved?.etag;
		let response = await fetcher(backendUrl(path, basePath), {
			signal: controller.signal,
			headers: validator ? { 'If-None-Match': validator } : {}
		});
		controller.signal.throwIfAborted();
		// Revalidate stale disk entries before reading/parsing their potentially large
		// bodies. A changed source needs only its new response, with no obsolete parse.
		if (response.status === 304 && !previous && saved) {
			previous = (await restore(saved)) ?? undefined;
			controller.signal.throwIfAborted();
			if (!previous) {
				// Corrupt or evicted local bytes cannot satisfy a 304; recover from the source.
				response = await fetcher(backendUrl(path, basePath), { signal: controller.signal });
				controller.signal.throwIfAborted();
			}
		}
		const cacheControl = response.headers.get('cache-control') ?? '';
		const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl)?.[1];
		const age = Math.max(0, Number(response.headers.get('age')) || 0) * 1000;
		const ttl = /\bno-cache\b/i.test(cacheControl)
			? 0
			: Math.max(
					0,
					Math.min(
						policy?.maxAge ?? 0,
						maxAge === undefined ? Infinity : Number(maxAge) * 1000 - age
					)
				);
		// max-age=0 retains a validator and body, but always revalidates before returning it.
		const cacheable = !!policy && !/\bno-store\b/i.test(cacheControl);
		if (response.status === 304 && previous) {
			const entry = { ...previous, expires: now() + (cacheable ? ttl : 0) };
			if (epoch === generation && cacheable) {
				remember(path, entry);
				// A zero-age disk copy already requires validation. Rewriting megabytes on
				// every 304 would add serialization and storage work without improving freshness.
				if (ttl > 0) {
					const headers = new Headers(response.headers);
					headers.set('etag', headers.get('etag') ?? previous.etag!);
					void persist(path, JSON.stringify(entry.value), headers, entry.expires, epoch);
				}
			}
			return entry.value;
		}
		if (!response.ok || !cacheable) return body(response);
		const text = await response.text();
		let value: unknown;
		try {
			value = JSON.parse(text);
		} catch {
			throw new ApiError(
				'The server returned an unreadable response. Please retry.',
				response.status
			);
		}
		controller.signal.throwIfAborted();
		if (epoch === generation) {
			const entry = {
				value,
				expires: now() + ttl,
				bytes: text.length * 2,
				etag: response.headers.get('etag') ?? undefined
			};
			remember(path, entry);
			if (policy.persistent && entry.etag)
				void persist(path, text, response.headers, entry.expires, epoch);
		}
		return value;
	}

	function subscribe<T>(flight: Flight, signal?: AbortSignal): Promise<T> {
		flight.subscribers++;
		return new Promise((resolve, reject) => {
			let finished = false;
			const finish = (callback: () => void) => {
				if (finished) return;
				finished = true;
				flight.subscribers--;
				signal?.removeEventListener('abort', abort);
				callback();
			};
			const abort = () => {
				finish(() => reject(signal?.reason ?? new DOMException('Request aborted', 'AbortError')));
				if (!flight.subscribers) flight.controller.abort();
			};
			signal?.addEventListener('abort', abort, { once: true });
			if (signal?.aborted) abort();
			flight.promise.then(
				(value) => finish(() => resolve(value as T)),
				(error: unknown) => finish(() => reject(error))
			);
		});
	}

	async function request<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
		signal?.throwIfAborted();
		if (payload !== undefined) {
			const response = await fetcher(backendUrl(path, basePath), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal
			});
			const value: unknown = await body(response);
			if (changesPublicSources(path)) await invalidate();
			return value as T;
		}
		const key = canonicalApiPath(path);
		const cached = memory.get(key);
		if (cached && cached.expires > now()) {
			memory.delete(key);
			memory.set(key, cached);
			return cached.value as T;
		}
		let flight = flights.get(key);
		if (!flight || flight.controller.signal.aborted) {
			const epoch = generation;
			const current: Flight = {
				controller: new AbortController(),
				promise: Promise.resolve(),
				subscribers: 0
			};
			flights.set(key, current);
			current.promise = read(key, current.controller)
				.then(
					(value) =>
						epoch === generation ? value : request(key, undefined, current.controller.signal),
					(error: unknown) => {
						if (epoch !== generation && !current.controller.signal.aborted)
							return request(key, undefined, current.controller.signal);
						throw error;
					}
				)
				.finally(() => {
					if (flights.get(key) === current) flights.delete(key);
				});
			flight = current;
		}
		return subscribe<T>(flight, signal);
	}

	return { request, invalidate, subscribeInvalidation };
}

const client = createApiClient();
export const api = client.request;
/** Retained views refresh their source data without losing local filters or drafts. */
export const subscribeApiInvalidation = client.subscribeInvalidation;
