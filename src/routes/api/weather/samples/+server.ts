import { json } from '@sveltejs/kit';
import { buildSamplePoints } from '#lib/config/weather.ts';
import { weatherService } from '#lib/server/weather/service.ts';
import type { RequestHandler } from './$types';

/** Coarse forecast grid for the Rain / Wind / Marine views (?kind=weather|marine). */
export const GET: RequestHandler = async ({ url }) => {
	const kind = url.searchParams.get('kind') ?? 'weather';
	if (kind !== 'weather' && kind !== 'marine')
		return json({ error: 'Unknown kind' }, { status: 400 });
	const points = buildSamplePoints();
	try {
		const grid =
			kind === 'weather'
				? await weatherService.getWeatherSamples(points)
				: await weatherService.getMarineSamples(points);
		return json(grid, { headers: { 'cache-control': 'public, max-age=300' } });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Forecast grid unavailable' },
			{ status: 503 }
		);
	}
};
