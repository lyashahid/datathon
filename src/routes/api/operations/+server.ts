import { json } from '@sveltejs/kit';
import { ENABLE_NOTICE_AI, NOTICE_AI_MODEL, OPENAI_API_KEY } from '$app/env/private';
import { loadOperations, operationsEtag } from '#lib/server/data/operationsSource.ts';
import { noticeAiState } from '#lib/server/data/noticeExtraction.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	const loaded = await loadOperations();
	const bundle = {
		...loaded,
		ai: noticeAiState({ enabled: ENABLE_NOTICE_AI, key: OPENAI_API_KEY, model: NOTICE_AI_MODEL })
	};
	const headers = {
		ETag: operationsEtag(bundle),
		'Cache-Control': 'private, max-age=60, must-revalidate'
	};
	if (request.headers.get('if-none-match') === headers.ETag)
		return new Response(null, { status: 304, headers });
	return json(bundle, { headers });
};
