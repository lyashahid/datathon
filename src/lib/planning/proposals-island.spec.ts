import { describe, expect, it } from 'vitest';
import { createBusProposal } from './proposals.ts';
import type { PlanningBaseline } from './types.ts';

function twoIslands(): PlanningBaseline {
	const nodes = [
		{ id: 'a0', lon: 73.5, lat: 4.17, islandId: 'a' },
		{ id: 'a1', lon: 73.501, lat: 4.17, islandId: 'a' },
		{ id: 'b0', lon: 73.53, lat: 4.2, islandId: 'b' },
		{ id: 'b1', lon: 73.531, lat: 4.2, islandId: 'b' }
	];
	return {
		schemaVersion: 1,
		version: 'two-islands',
		generatedAt: '2026-10-10T00:00:00Z',
		referenceDate: '2026-10-10',
		sources: [],
		islands: [
			{ id: 'a', name: 'A' },
			{ id: 'b', name: 'B' }
		],
		origins: [
			{ ...nodes[0], id: 'area-a', population2026: 100 },
			{ ...nodes[2], id: 'area-b', population2026: 200 }
		],
		network: {
			nodes,
			edges: [
				{
					id: 'road-a',
					from: 'a0',
					to: 'a1',
					distanceM: 100,
					walkAllowed: true,
					driveAllowed: true
				},
				{
					id: 'road-b',
					from: 'b0',
					to: 'b1',
					distanceM: 100,
					walkAllowed: true,
					driveAllowed: true
				}
			]
		},
		facilities: [
			{ ...nodes[1], id: 'care-a', name: 'Care A', kind: 'hospital', verification: 'official' },
			{ ...nodes[3], id: 'care-b', name: 'Care B', kind: 'hospital', verification: 'official' }
		],
		transit: { stops: [], patterns: [], gaps: [] }
	};
}

describe('manual bus placement island assignment', () => {
	it('uses the snapped road island instead of an area selected on another island', () => {
		const b = twoIslands();
		const proposal = createBusProposal(b, { originId: 'area-a', coordinate: [73.53, 4.2] });
		expect(proposal.ok).toBe(true);
		if (!proposal.ok || proposal.action.kind !== 'add-route') throw new Error('Expected a service');
		expect(proposal.action.stops?.map((stop) => stop.islandId)).toEqual(['b', 'b']);
		expect(proposal.action.pattern.geometry).toEqual([
			[73.53, 4.2],
			[73.531, 4.2]
		]);
		expect(proposal.action.returnPattern?.geometry).toEqual([
			[73.531, 4.2],
			[73.53, 4.2]
		]);
	});

	it('uses the closest known origin for a legacy graph without island metadata', () => {
		const b = twoIslands();
		b.network.nodes = b.network.nodes.map(({ id, lon, lat }) => ({ id, lon, lat }));
		const proposal = createBusProposal(b, { originId: 'area-a', coordinate: [73.53, 4.2] });
		expect(proposal.ok).toBe(true);
		if (!proposal.ok || proposal.action.kind !== 'add-route') throw new Error('Expected a service');
		expect(proposal.action.stops?.[0].islandId).toBe('b');
	});

	it.each([null, 'unknown-island'])(
		'does not replace explicit %s road classification with a selected origin',
		(islandId) => {
			const b = twoIslands();
			b.network.nodes[2] = { ...b.network.nodes[2], ...{ islandId } };
			expect(createBusProposal(b, { originId: 'area-a', coordinate: [73.53, 4.2] })).toMatchObject({
				ok: false,
				reason: expect.stringContaining('supported land island')
			});
		}
	);
});
