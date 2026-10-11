import { describe, expect, it } from 'vitest';
import type { FeatureCollection, Point } from 'geojson';
import {
	connectionStopMarkers,
	dragTarget,
	reconcileStopEditRevision,
	resolveStopDragIcon,
	stopIds,
	StopDragSession,
	withoutDraggedStop
} from './mapStopEditing.ts';

describe('direct stop editing', () => {
	const markerCollection = (properties: Record<string, unknown>): FeatureCollection<Point> => ({
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				properties: { id: 'stop', mapKind: 'stop', stopIds: ['stop'], ...properties },
				geometry: { type: 'Point', coordinates: [73.51, 4.21] }
			}
		]
	});
	it('numbers directional and repeated connection visits without inventing positions', () => {
		const symbols = markerCollection({ stopIds: ['out', 'opposite'], icon: 'bus' });
		const markers = connectionStopMarkers(symbols, ['out', 'missing', 'opposite', 'out']);
		expect(markers.features).toHaveLength(1);
		expect(markers.features[0].properties).toMatchObject({
			stopIds: ['out', 'opposite'],
			connectionVisits: ['out', 'opposite', 'out'],
			orderLabel: '1/3/4'
		});
		expect(markers.features[0].geometry.coordinates).toEqual([73.51, 4.21]);
		expect(symbols.features[0].properties?.stopIds).toEqual(['out', 'opposite']);
	});
	it('does not turn ferry-only boarding codes or absent stops into bus connection handles', () => {
		const symbols = markerCollection({ icon: 'ferry-moved' });
		expect(connectionStopMarkers(symbols, ['stop', 'missing']).features).toEqual([]);
	});
	it('keeps a held proposed stop unbuilt across repeated drags', () => {
		const symbols = markerCollection({ icon: 'shelter', isBaselineAsset: false });
		const first = resolveStopDragIcon(symbols, 'stop', { icon: 'shelter' });
		const repeated = resolveStopDragIcon(symbols, 'stop', { icon: first });
		expect(first).toBe('shelter-proposed');
		expect(repeated).toBe('shelter-proposed');
	});
	it('keeps a moved existing stop built when a rendered hold has a compound icon', () => {
		const symbols = markerCollection({
			icon: 'shelter',
			isBaselineAsset: true,
			investmentState: 'moved',
			serviceState: 'paused'
		});
		expect(resolveStopDragIcon(symbols, 'stop', { icon: 'shelter-moved' })).toBe('shelter-moved');
		// Model metadata must win over stale rendered status.
		expect(
			resolveStopDragIcon(symbols, 'stop', { icon: 'shelter-proposed', isBaselineAsset: false })
		).toBe('shelter-moved');
	});
	it('looks up authoritative metadata for any serialized co-located boarding identity', () => {
		const symbols = markerCollection({
			stopIds: '["out","opposite"]',
			icon: 'bus',
			isBaselineAsset: true
		});
		expect(
			resolveStopDragIcon(symbols, 'opposite', { icon: 'shelter-proposed', isBaselineAsset: false })
		).toBe('bus-moved');
	});
	it('retains boat and bus categories and built status when only rendered metadata is available', () => {
		const empty: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
		expect(resolveStopDragIcon(empty, 'stop', { icon: 'bus-proposed' })).toBe('bus-proposed');
		expect(resolveStopDragIcon(empty, 'stop', { icon: 'ferry-draft' })).toBe('ferry-proposed');
		expect(
			resolveStopDragIcon(empty, 'stop', { icon: 'ferry-paused', isBaselineAsset: true })
		).toBe('ferry-moved');
		expect(resolveStopDragIcon(empty, 'stop', undefined)).toBe('shelter-moved');
	});
	it('holds the accepted snapped drop until its own analysis catches up', () => {
		const held = { id: 'out', position: [73.51, 4.21] as [number, number], icon: 'bus' };
		const initialized = reconcileStopEditRevision(undefined, 3, held, false);
		expect(initialized).toMatchObject({ heldMove: held, invalidated: false, cancelActive: false });
		// The map's drop transaction leaves the parent's invalidation counter unchanged.
		expect(reconcileStopEditRevision(3, 3, held, false).heldMove).toBe(held);
	});
	it('clears a pending snapped drop when undo supersedes the worker result', () => {
		const held = { id: 'out', position: [73.51, 4.21] as [number, number] };
		expect(reconcileStopEditRevision(3, 4, held, false)).toEqual({
			revision: 4,
			heldMove: null,
			cancelActive: false,
			invalidated: true
		});
		// Redo/import/reset must not revive the abandoned local marker either.
		expect(reconcileStopEditRevision(4, 5, null, false).heldMove).toBeNull();
	});
	it('invalidates an active drag and its cancellation hold on external history changes', () => {
		const held = { id: 'out', position: [73.5, 4.2] as [number, number] };
		const session = new StopDragSession();
		session.begin('out', [73.5, 4.2], [10, 10]);
		session.move([73.51, 4.21], [20, 20]);
		const next = reconcileStopEditRevision(3, 4, held, true);
		if (next.cancelActive) session.cancel();
		expect(next.heldMove).toBeNull();
		expect(next.cancelActive).toBe(true);
		expect(session.finish()).toBeNull();
	});
	it('requires an explicit identity for co-located direction codes', () => {
		expect(stopIds({ mapKind: 'stop', stopIds: '["out","opposite"]', count: 2 })).toEqual([
			'out',
			'opposite'
		]);
		expect(dragTarget(['out', 'opposite'], '')).toBeNull();
		expect(dragTarget(['out', 'opposite'], 'opposite')).toBe('opposite');
		expect(stopIds({ mapKind: 'stop', id: 'out', count: 2 })).toEqual([]);
		expect(stopIds({ mapKind: 'facility', id: 'clinic' })).toEqual([]);
	});
	it('leaves an opposite boarding identity visible while dragging', () => {
		const symbols: FeatureCollection<Point> = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: { id: 'out', mapKind: 'stop', stopIds: ['out', 'opposite'], count: 2 },
					geometry: { type: 'Point', coordinates: [73.5, 4.2] }
				}
			]
		};
		expect(withoutDraggedStop(symbols, 'out').features[0].properties).toMatchObject({
			id: 'opposite',
			stopIds: ['opposite'],
			count: 1
		});
		expect(symbols.features[0].properties?.count).toBe(2);
	});
	it('does not create history entries for clicks or pointer jitter', () => {
		const session = new StopDragSession();
		session.begin('untimed', [73.5, 4.2], [10, 10]);
		expect(session.move([73.51, 4.21], [11, 11])).toBeNull();
		expect(session.finish()).toBeNull();
	});
	it('returns one move on release and none on a second release', () => {
		const session = new StopDragSession();
		session.begin('out', [73.5, 4.2], [10, 10]);
		expect(session.move([73.51, 4.21], [20, 20])).toEqual({ id: 'out', position: [73.51, 4.21] });
		expect(session.finish()).toEqual({ id: 'out', position: [73.51, 4.21] });
		expect(session.finish()).toBeNull();
	});
	it('cancels a drag without committing, including after preview movement', () => {
		const session = new StopDragSession();
		session.begin('out', [73.5, 4.2], [10, 10]);
		session.move([73.51, 4.21], [20, 20]);
		session.cancel();
		expect(session.finish()).toBeNull();
	});
	it('rejects invalid positions and ignores a move returned to its original position', () => {
		const session = new StopDragSession();
		session.begin('out', [73.5, 4.2], [10, 10]);
		expect(session.move([NaN, 4.21], [20, 20])).toBeNull();
		expect(session.move([181, 4.21], [20, 20])).toBeNull();
		session.move([73.51, 4.21], [20, 20]);
		session.move([73.5, 4.2], [10, 10]);
		expect(session.finish()).toBeNull();
	});
});
