import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PolicyEvidenceBundle } from './policyEvidenceSource.ts';
import { GET } from '../../../routes/api/policy-evidence/+server.ts';

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('#lib/server/data/policyEvidenceSource.ts', () => ({ loadPolicyEvidence: load }));

let bundle: PolicyEvidenceBundle;
beforeAll(async () => {
	bundle = JSON.parse(await readFile('data/public/policy-evidence/bundle.json', 'utf8'));
	load.mockResolvedValue(bundle);
});

const get = (query = '', etag?: string) => {
	const url = new URL(`http://localhost/api/policy-evidence${query}`);
	return GET({
		url,
		request: new Request(url, { headers: etag ? { 'if-none-match': etag } : {} })
	} as Parameters<typeof GET>[0]);
};

describe('policy evidence API representations', () => {
	it('keeps source coverage but omits geometry from the opening summary', async () => {
		const response = await get('?view=summary');
		const summary = await response.json();
		expect(response.status).toBe(200);
		expect(summary.sources).toHaveLength(bundle.sources.length);
		expect(summary.layers[0].recordCount).toBe(310);
		expect(
			summary.layers.every(
				(layer: { featuresLoaded: boolean; features: { features: unknown[] } }) =>
					layer.featuresLoaded === false && layer.features.features.length === 0
			)
		).toBe(true);
	});

	it('returns only a selected validated layer and rejects arbitrary paths', async () => {
		const response = await get('?layer=hdc-trees');
		const result = await response.json();
		expect(result.version).toBe(bundle.version);
		expect(result.layer.id).toBe('hdc-trees');
		expect(result.layer.features.features).toHaveLength(3838);
		expect(result.layers).toBeUndefined();
		expect((await get('?layer=../../archive/private')).status).toBe(404);
		expect((await get('?layer=hdc-trees&view=summary')).status).toBe(400);
	});

	it('uses different cache validators for full, summary and each layer', async () => {
		const full = await get();
		const summary = await get('?view=summary');
		const trees = await get('?layer=hdc-trees');
		const pavements = await get('?layer=hdc-pavements');
		const tags = [full, summary, trees, pavements].map((response) => response.headers.get('etag'));
		expect(new Set(tags).size).toBe(4);
		expect((await get('?view=summary', tags[1]!)).status).toBe(304);
		expect((await get('?layer=hdc-trees', tags[1]!)).status).toBe(200);
		expect((await get('', tags[1]!)).status).toBe(200);
	});
});
