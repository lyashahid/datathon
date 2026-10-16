import { createHash } from 'node:crypto';
import { Duplex } from 'node:stream';
import { createGzip } from 'node:zlib';
import { apiCachePolicy } from '../api-cache-policy.js';

const allowed =
	/^(health|national\/summary|islands(?:\/[^/]+(?:\/profile)?)?|map\/(?:features|context)|accessibility\/(score|summary)|routing\/(land|marine|stops)|simulation\/(run|compare)|recommendations|live\/(status|snapshot|stream)|forecasts(?:\/(?:analysis|sources(?:\/(?:template|stage|[a-f0-9]{32}\/accept))?|series(?:\/[^/]+)?|backtests\/[^/]+|issues(?:\/[^/]+)?))?|datasets(?:\/compare|\/[^/]+\/(?:schema|rows|query|chart|export\.csv))?|planning\/(?:baseline|connectivity|ferry-service|bus-connection|evaluate|quote|journey|timetable|fleet|report\.pdf|opportunities(?:\/[^/]+)?|calibration(?:\/(?:validate|tariff))?)|data-updates(?:\/check|\/schedules(?:\/(?:stage|journey|[a-f0-9]{64}\/accept))?)?|conditions\/(?:status|weather|marine|traffic)|operations\/(?:snapshot|notices(?:\/ingest|\/[^/]+\/review)?)|places(?:\/(?:status|search|suggest|details|photos|reviews|directions|streetview(?:\/panorama|\/tile)?|image|docs|openapi\.json|[^/]+))?)$/;

export async function forwardBackend(
	request: Request,
	path: string,
	origin: string,
	fetcher: typeof fetch = fetch,
	placesApiKey = '',
	basePath = ''
): Promise<Response> {
	if (
		!allowed.test(path) ||
		path.includes('\\') ||
		path
			.split('/')
			.some((segment) => segment === '.' || segment === '..' || /%(?:2e|2f|5c)/i.test(segment))
	)
		return Response.json({ error: { message: 'Unknown backend endpoint.' } }, { status: 404 });
	if (!['GET', 'POST'].includes(request.method))
		return Response.json({ error: { message: 'Method not allowed.' } }, { status: 405 });
	const url = new URL(path === 'health' ? '/health' : `/api/v1/${path}`, origin);
	url.search = new URL(request.url).search;
	try {
		const response = await fetcher(url, {
			method: request.method,
			headers: {
				accept: request.headers.get('accept') ?? 'application/json',
				// Fetch decodes upstream encodings. Compress once at this browser-facing boundary.
				'accept-encoding': 'identity',
				...(request.headers.get('if-none-match')
					? { 'if-none-match': request.headers.get('if-none-match')! }
					: {}),
				...(request.headers.get('if-modified-since')
					? { 'if-modified-since': request.headers.get('if-modified-since')! }
					: {}),
				...(placesApiKey && (path.startsWith('places/') || path === 'conditions/traffic')
					? { 'x-api-key': placesApiKey }
					: {}),
				...(request.method === 'POST' ? { 'content-type': 'application/json' } : {})
			},
			body: request.method === 'POST' ? await request.text() : undefined,
			signal: AbortSignal.any([request.signal, AbortSignal.timeout(90000)])
		});
		if (path === 'places/docs' && response.ok) {
			const html = (await response.text()).replaceAll(
				'/api/v1/places',
				`${basePath}/api/backend/places`
			);
			return new Response(html, {
				status: response.status,
				headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
			});
		}
		if (path === 'places/openapi.json' && response.ok) {
			const schema = await response.json();
			schema.servers = [{ url: `${basePath}/api/backend/places` }];
			return Response.json(schema, { headers: { 'cache-control': 'no-store' } });
		}
		const headers = new Headers({
			'content-type': response.headers.get('content-type') ?? 'application/json',
			'cache-control': response.headers.get('cache-control') ?? 'no-store'
		});
		for (const name of [
			'etag',
			'last-modified',
			'age',
			'vary',
			'x-data-version',
			'x-source-version',
			'x-request-id',
			'retry-after',
			'content-disposition'
		]) {
			const value = response.headers.get(name);
			if (value) headers.set(name, value);
		}
		const policy = request.method === 'GET' ? apiCachePolicy(`${path}${url.search}`) : null;
		const json = headers.get('content-type')!.includes('application/json');
		if (json) {
			const vary = new Set(
				(headers.get('vary') ?? '')
					.split(',')
					.map((value) => value.trim())
					.filter(Boolean)
			);
			vary.add('Accept-Encoding');
			headers.set('vary', [...vary].join(', '));
		}
		let body = response.body;
		let length = Number(response.headers.get('content-length')) || undefined;
		if (policy && response.ok && json) {
			if (!response.headers.has('cache-control'))
				headers.set('cache-control', `private, max-age=${policy.maxAge / 1000}, must-revalidate`);
			let etag = headers.get('etag');
			if (!etag) {
				const bytes = new Uint8Array(await response.arrayBuffer());
				length = bytes.byteLength;
				etag = `W/"${createHash('sha256').update(bytes).digest('hex')}"`;
				headers.set('etag', etag);
				body = new Response(bytes).body;
			}
			if (matchesValidator(request.headers.get('if-none-match'), etag)) {
				void body?.cancel().catch(() => {});
				return new Response(null, { status: 304, headers });
			}
		}
		if (response.status === 304 || response.status === 204)
			return new Response(null, { status: response.status, headers });
		if (
			response.ok &&
			body &&
			json &&
			(length === undefined || length >= 2048) &&
			acceptsGzip(request)
		) {
			// Fast streaming compression avoids blocking map delivery to optimize the last few bytes.
			// Node and DOM declarations differ on BYOB readers; both use native Web Streams here.
			const gzip = Duplex.toWeb(createGzip({ level: 1 })) as unknown as ReadableWritablePair<
				Uint8Array<ArrayBuffer>,
				Uint8Array<ArrayBuffer>
			>;
			body = body.pipeThrough(gzip);
			headers.set('content-encoding', 'gzip');
			const etag = headers.get('etag');
			if (etag && !etag.startsWith('W/')) headers.set('etag', `W/${etag}`);
		}
		return new Response(body, { status: response.status, headers });
	} catch {
		return Response.json(
			{
				error: {
					message:
						'The mobility backend is unavailable. Start both services with npm start, then retry.'
				}
			},
			{ status: 503 }
		);
	}
}

function matchesValidator(value: string | null, etag: string) {
	return value?.split(',').some((candidate) => {
		const tag = candidate.trim();
		return tag === '*' || tag.replace(/^W\//, '') === etag.replace(/^W\//, '');
	});
}

function acceptsGzip(request: Request) {
	return request.headers
		.get('accept-encoding')
		?.split(',')
		.some((part) => {
			const [name, ...options] = part.trim().split(';');
			if (name !== 'gzip') return false;
			const quality = options.find((option) => option.trim().startsWith('q='));
			return !quality || Number(quality.trim().slice(2)) > 0;
		});
}
