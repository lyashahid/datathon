import { json } from '@sveltejs/kit';
import { ENABLE_NOTICE_AI, NOTICE_AI_MODEL, OPENAI_API_KEY } from '$app/env/private';
import { extractPublicNotice, fetchPublicNotice } from '#lib/server/data/noticeExtraction.ts';
import { publicNoticeUrl } from '#lib/operations/notices.ts';
import type { RequestHandler } from './$types';

let active = 0;
export const POST: RequestHandler = async ({ request }) => {
	if (active >= 2)
		return json(
			{ error: 'Two public notice reads are already running. Try again shortly.' },
			{ status: 429 }
		);
	if (Number(request.headers.get('content-length') ?? 0) > 40000)
		return json({ error: 'Notice request is too large.' }, { status: 413 });
	active++;
	try {
		const body = await request.text();
		if (body.length > 40000)
			return json({ error: 'Notice request is too large.' }, { status: 413 });
		const input = JSON.parse(body);
		const sourceUrl = publicNoticeUrl(input.sourceUrl);
		if (input.text !== undefined && typeof input.text !== 'string')
			throw new Error('Public notice text must be a string.');
		const evidence = input.text?.trim()
			? {
					sourceUrl,
					text: input.text,
					title: typeof input.title === 'string' ? input.title : '',
					retrievedAt: null,
					checksum: null
				}
			: await fetchPublicNotice(sourceUrl);
		const result = await extractPublicNotice(evidence, {
			enabled: ENABLE_NOTICE_AI,
			key: OPENAI_API_KEY,
			model: NOTICE_AI_MODEL
		});
		return json(
			{
				...result,
				evidence: {
					sourceUrl: evidence.sourceUrl,
					retrievedAt: evidence.retrievedAt,
					checksum: evidence.checksum,
					acquisition: input.text?.trim() ? 'user-supplied-public-excerpt' : 'publisher-fetch'
				}
			},
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Public notice could not be read.' },
			{ status: 400 }
		);
	} finally {
		active--;
	}
};
