import { json } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { loadPolicyEvidence } from '#lib/server/data/policyEvidenceSource.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url }) => {
	const bundle = await loadPolicyEvidence();
	const layerId = url.searchParams.get('layer');
	const view = url.searchParams.get('view');
	if ((view !== null && view !== 'summary') || (layerId !== null && view !== null))
		return json({ error: 'Use view=summary or one layer ID.' }, { status: 400 });
	const selectedLayer =
		layerId === null ? undefined : bundle.layers.find((layer) => layer.id === layerId);
	if (layerId !== null && !selectedLayer)
		return json({ error: 'Unknown policy evidence layer.' }, { status: 404 });
	const variant = selectedLayer
		? `layer:${selectedLayer.id}`
		: view === 'summary'
			? 'summary'
			: 'full';
	const tag = createHash('sha256')
		.update(`${bundle.version}:${bundle.stale}:${variant}`)
		.digest('hex');
	const headers = {
		ETag: `"${tag}"`,
		'Cache-Control': 'private, max-age=60, must-revalidate'
	};
	if (request.headers.get('if-none-match') === headers.ETag)
		return new Response(null, { status: 304, headers });
	if (selectedLayer) return json({ version: bundle.version, layer: selectedLayer }, { headers });
	if (view === 'summary')
		return json(
			{
				...bundle,
				layers: bundle.layers.map((layer) => ({
					...layer,
					featuresLoaded: false,
					features: { type: 'FeatureCollection', features: [] }
				}))
			},
			{ headers }
		);
	return json(bundle, { headers });
};
