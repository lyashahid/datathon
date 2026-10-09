import { json } from '@sveltejs/kit';
import { coordinatesFrom, weatherService } from '#lib/server/weather/service.ts';
import type { RequestHandler } from './$types';

/** Current sea state. Upstream failures return 503 with a message; the simulator keeps working. */
export const GET: RequestHandler = async ({ url }) => {
	const at = coordinatesFrom(url);
	if (!at) return json({ error: 'Invalid lat/lon' }, { status: 400 });
	try {
		return json(await weatherService.getMarine(at), {
			headers: { 'cache-control': 'public, max-age=300' }
		});
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Marine data unavailable' },
			{ status: 503 }
		);
	}
};
