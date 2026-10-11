import { json } from '@sveltejs/kit';
import { loadPlanningBaseline } from '#lib/server/data/planningSource.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const { bundle, etag, stale } = await loadPlanningBaseline();
		const requestedVersion = url.searchParams.get('version');
		if (requestedVersion && requestedVersion !== bundle.version) {
			return json(
				{ error: 'This data version is not installed.', installedVersion: bundle.version },
				{ status: 409 }
			);
		}
		const headers = {
			ETag: etag,
			'Cache-Control': 'private, max-age=0, must-revalidate',
			'X-Planning-Snapshot': stale ? 'last-validated' : 'validated'
		};
		if (request.headers.get('if-none-match') === etag)
			return new Response(null, { status: 304, headers });
		return json(bundle, { headers });
	} catch {
		return json(
			{
				error:
					'No validated public planning snapshot is installed. Run npm run data:fetch and npm run data:prepare. No demonstration data has been substituted.'
			},
			{ status: 503 }
		);
	}
};
