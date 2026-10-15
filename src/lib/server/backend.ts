const allowed =
	/^(health|national\/summary|islands(?:\/[^/]+(?:\/profile)?)?|map\/(?:features|context)|accessibility\/(score|summary)|routing\/(land|marine|stops)|simulation\/(run|compare)|recommendations|live\/(status|snapshot|stream)|forecasts(?:\/(?:analysis|sources(?:\/(?:template|stage|[a-f0-9]{32}\/accept))?|series(?:\/[^/]+)?|backtests\/[^/]+|issues(?:\/[^/]+)?))?|datasets(?:\/compare|\/[^/]+\/(?:schema|rows|query|chart|export\.csv))?|planning\/(?:baseline|evaluate|journey|timetable|fleet|report\.pdf|opportunities(?:\/[^/]+)?|calibration(?:\/(?:validate|tariff))?)|data-updates(?:\/check|\/schedules(?:\/(?:stage|journey|[a-f0-9]{64}\/accept))?)?|conditions\/(?:status|weather|marine|traffic)|operations\/(?:snapshot|notices(?:\/ingest|\/[^/]+\/review)?)|places(?:\/(?:status|search|suggest|details|photos|reviews|directions|streetview(?:\/panorama|\/tile)?|image|docs|openapi\.json|[^/]+))?)$/;

export async function forwardBackend(
	request: Request,
	path: string,
	origin: string,
	fetcher: typeof fetch = fetch,
	placesApiKey = ''
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
				...(placesApiKey && (path.startsWith('places/') || path === 'conditions/traffic')
					? { 'x-api-key': placesApiKey }
					: {}),
				...(request.method === 'POST' ? { 'content-type': 'application/json' } : {})
			},
			body: request.method === 'POST' ? await request.text() : undefined,
			signal: AbortSignal.any([request.signal, AbortSignal.timeout(90000)])
		});
		if (path === 'places/docs' && response.ok) {
			const html = (await response.text()).replaceAll('/api/v1/places', '/api/backend/places');
			return new Response(html, {
				status: response.status,
				headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
			});
		}
		if (path === 'places/openapi.json' && response.ok) {
			const schema = await response.json();
			schema.servers = [{ url: '/api/backend/places' }];
			return Response.json(schema, { headers: { 'cache-control': 'no-store' } });
		}
		return new Response(response.body, {
			status: response.status,
			headers: {
				'content-type': response.headers.get('content-type') ?? 'application/json',
				'cache-control': response.headers.get('cache-control') ?? 'no-store',
				...(response.headers.get('x-request-id')
					? { 'x-request-id': response.headers.get('x-request-id')! }
					: {}),
				...(response.headers.get('retry-after')
					? { 'retry-after': response.headers.get('retry-after')! }
					: {}),
				...(response.headers.get('content-disposition')
					? { 'content-disposition': response.headers.get('content-disposition')! }
					: {})
			}
		});
	} catch {
		return Response.json(
			{
				error: {
					message:
						'The mobility backend is unavailable. Start both services with npm run dev, then retry.'
				}
			},
			{ status: 503 }
		);
	}
}
