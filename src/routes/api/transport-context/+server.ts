import { json } from '@sveltejs/kit';
import {
	ENABLE_VESSEL_DATA,
	ENABLE_FLIGHT_PASSENGER_DATA,
	PUBLIC_DATA_ONLY
} from '$app/env/private';
import { loadTransportContext } from '#lib/server/data/transportContextSource.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	const bundle = await loadTransportContext({
		publicOnly: PUBLIC_DATA_ONLY,
		vessels: ENABLE_VESSEL_DATA,
		flights: ENABLE_FLIGHT_PASSENGER_DATA
	});
	const headers = {
		ETag: `"${bundle.version}"`,
		'Cache-Control': 'private, max-age=60, must-revalidate'
	};
	if (request.headers.get('if-none-match') === headers.ETag)
		return new Response(null, { status: 304, headers });
	return json(bundle, { headers });
};
