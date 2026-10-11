import { json } from '@sveltejs/kit';
import { loadPredictionSource } from '#lib/server/data/predictionSource.ts';
import { getPredictionBundle } from '#lib/prediction/index.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const targetMonth = event.url?.searchParams.get('targetMonth') ?? undefined;
	if (targetMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth))
		return json({ error: 'Invalid target month; use YYYY-MM' }, { status: 400 });
	const bundle = getPredictionBundle(await loadPredictionSource(), new Date(), targetMonth);
	return json(bundle, { headers: { 'Cache-Control': 'private, max-age=60, must-revalidate' } });
};
