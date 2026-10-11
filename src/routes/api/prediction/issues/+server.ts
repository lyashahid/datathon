import { json } from '@sveltejs/kit';
import { loadPredictionSource } from '#lib/server/data/predictionSource.ts';
import {
	issueForecast,
	listForecastIssues,
	recordForecastScores
} from '#lib/server/data/predictionSourceLedger.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () =>
	json(
		{ issues: await listForecastIssues(await loadPredictionSource()) },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Expected a JSON request' }, { status: 400 });
	}
	if (!body || typeof body !== 'object')
		return json({ error: 'Expected targetMonth or score action' }, { status: 400 });
	const input = body as Record<string, unknown>;
	try {
		const source = await loadPredictionSource();
		if (input.action === 'record-scores' && typeof input.issueId === 'string')
			return json(await recordForecastScores(source, input.issueId));
		if (typeof input.targetMonth !== 'string')
			return json({ error: 'Expected targetMonth in YYYY-MM form' }, { status: 400 });
		const result = await issueForecast(source, input.targetMonth);
		return json(result, {
			status: result.created ? 201 : 200,
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Forecast issuance failed' },
			{ status: 400 }
		);
	}
};
