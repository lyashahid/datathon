import {
	cellToBoundary,
	cellToLatLng,
	gridDisk,
	gridDistance,
	gridRing,
	latLngToCell
} from 'h3-js';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import {
	buildWaveCells,
	continueWave,
	waveCoverageMs,
	waveFrame,
	WAVE_DEEPEN_MS,
	WAVE_FADE_MS,
	WAVE_SPREAD_MS,
	type RecalculationWave
} from './recalculationWave.ts';

const origin = latLngToCell(4.175, 73.515, 10);
const coordinates = (cell: string): [number, number] => {
	const [lat, lon] = cellToLatLng(cell);
	return [lon, lat];
};
const collection = (
	ids: string[],
	island: string | null = 'test-island'
): FeatureCollection<Polygon | MultiPolygon> => ({
	type: 'FeatureCollection',
	features: ids.map((h3Id, index) => {
		const ring = cellToBoundary(h3Id, true);
		return {
			type: 'Feature',
			id: `${island ?? 'land'}:${index}`,
			properties: { h3Id, ...(island === null ? {} : { islandId: island }), population: 37 },
			geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] }
		};
	})
});

describe('continuing rapid committed edits', () => {
	it('starts a fresh wave without copying its prepared mesh geometry', () => {
		const cells = buildWaveCells(collection([origin]), [coordinates(origin)]);
		const wave = continueWave(null, 2, cells, 100);
		expect(wave).toMatchObject({ id: 2, startedAt: 100, completedAt: null });
		expect(wave.cells).toBe(cells);
	});

	it('preserves lit cells and starts a new seed at the current shared clock', () => {
		const input = collection(gridDisk(origin, 2));
		const previous: RecalculationWave = {
			id: 1,
			startedAt: 100,
			completedAt: 200,
			outcome: 'success',
			cells: buildWaveCells(input, [coordinates(origin)])
		};
		const newSeed = gridRing(origin, 2)[0];
		const nextCells = buildWaveCells(input, [coordinates(newSeed)]);
		const before = structuredClone(previous);
		const nextBefore = structuredClone(nextCells);
		const continued = continueWave(previous, 7, nextCells, 350);
		expect(continued).toMatchObject({ id: 7, startedAt: 100, completedAt: null });
		expect(continued.outcome).toBeUndefined();
		expect(arrivals(continued.cells).get(origin)).toBe(0);
		expect(arrivals(continued.cells).get(newSeed)).toBe(250);
		for (let index = 0; index < continued.cells.features.length; index++) {
			const cell = continued.cells.features[index];
			expect(cell.geometry).toBe(nextCells.features[index].geometry);
			expect(cell.id).toBe(nextCells.features[index].id);
			expect(cell.properties?.arrivalMs).toBeLessThanOrEqual(
				previous.cells.features[index].properties!.arrivalMs
			);
			expect(cell.properties?.population).toBe(37);
		}
		expect(previous).toEqual(before);
		expect(nextCells).toEqual(nextBefore);
		expect(waveFrame(continued, 100_000).finished).toBe(false);
	});

	it('adds newly available cells at the new edit time and matches stable identities after reorder', () => {
		const input = collection(gridDisk(origin, 1));
		const oldCells = buildWaveCells(input, [coordinates(origin)]);
		const old = { id: 1, startedAt: 10, completedAt: null, cells: oldCells };
		const nextCells = {
			...oldCells,
			features: [
				...oldCells.features
					.slice()
					.reverse()
					.map((cell) => ({
						...cell,
						properties: { ...cell.properties, arrivalMs: 0 }
					})),
				{ ...oldCells.features[0], id: 'new-land', properties: { arrivalMs: 200 } }
			]
		};
		const continued = continueWave(old, 3, nextCells, 510);
		expect(continued.cells.features.at(-1)!.properties!.arrivalMs).toBe(700);
		expect(arrivals(continued.cells).get(origin)).toBe(0);
		expect(continued.cells.features[0].id).toBe(nextCells.features[0].id);
	});

	it('clears a superseded island instead of carrying its lit mesh into the next edit', () => {
		const other = latLngToCell(4.22, 73.54, 10);
		const first = buildWaveCells(collection(gridDisk(origin, 1), 'first'), [coordinates(origin)]);
		const second = buildWaveCells(collection(gridDisk(other, 1), 'second'), [coordinates(other)]);
		const continued = continueWave(
			{ id: 1, startedAt: 10, completedAt: null, cells: first },
			2,
			second,
			510
		);
		expect(continued.cells.features).toHaveLength(second.features.length);
		expect(continued.cells.features.every((cell) => cell.properties?.islandId === 'second')).toBe(
			true
		);
		expect(arrivals(continued.cells).get(other)).toBe(500);
		expect(continued.completedAt).toBeNull();
		expect(waveFrame(continued, 100_000).finished).toBe(false);
	});

	it('keeps shared island ages while dropping another island from a multi-island edit', () => {
		const other = latLngToCell(4.22, 73.54, 10);
		const input = {
			type: 'FeatureCollection' as const,
			features: [
				...collection(gridDisk(origin, 1), 'first').features,
				...collection(gridDisk(other, 1), 'second').features
			]
		};
		const prior = buildWaveCells(input, [coordinates(origin), coordinates(other)]);
		const next = buildWaveCells(input, [coordinates(other)]);
		const continued = continueWave(
			{ id: 1, startedAt: 100, completedAt: null, cells: prior },
			2,
			next,
			900
		);
		expect(continued.cells.features).toHaveLength(next.features.length);
		expect(continued.cells.features.every((cell) => cell.properties?.islandId === 'second')).toBe(
			true
		);
		for (const cell of continued.cells.features)
			expect(cell.properties?.arrivalMs).toBe(arrivals(prior).get(cell.properties!.h3Id));
	});
});
const descriptor = (complete: number | null = null): RecalculationWave => ({
	id: 1,
	startedAt: 0,
	completedAt: complete,
	cells: buildWaveCells(collection(gridDisk(origin, 2)), [coordinates(origin)])
});
const arrivals = (features: FeatureCollection<Polygon | MultiPolygon>) =>
	new Map(
		features.features.map((feature) => [feature.properties!.h3Id, feature.properties!.arrivalMs])
	);

describe('land-cell recalculation propagation', () => {
	it('starts at the edited cell and progresses through equal neighbour rings', () => {
		const cells = buildWaveCells(collection(gridDisk(origin, 2)), [coordinates(origin)]);
		const times = arrivals(cells);
		expect(times.get(origin)).toBe(0);
		for (const [id, arrival] of times) {
			expect(arrival).toBe((gridDistance(origin, id) / 2) * WAVE_SPREAD_MS);
		}
	});

	it('follows a connected land-cell detour instead of jumping a missing central cell', () => {
		const ring = gridRing(origin, 1);
		const cells = buildWaveCells(collection(ring), [coordinates(ring[0])]);
		const times = arrivals(cells);
		expect(gridDistance(ring[0], ring[3])).toBe(2);
		expect(times.get(ring[1])).toBeCloseTo(WAVE_SPREAD_MS / 3);
		expect(times.get(ring[2])).toBeCloseTo((WAVE_SPREAD_MS * 2) / 3);
		expect(times.get(ring[3])).toBe(WAVE_SPREAD_MS);
		expect(cells.features).toHaveLength(6);
	});

	it('starts a single outward wave from all edited route or move coordinates', () => {
		const ring = gridRing(origin, 1);
		const cells = buildWaveCells(collection(ring), [coordinates(ring[0]), coordinates(ring[3])]);
		const times = arrivals(cells);
		expect(times.get(ring[0])).toBe(0);
		expect(times.get(ring[3])).toBe(0);
		expect(times.get(ring[1])).toBe(WAVE_SPREAD_MS);
		expect(times.get(ring[4])).toBe(WAVE_SPREAD_MS);
	});

	it('covers disconnected land pieces belonging to the selected island without changing geometry or population', () => {
		const otherIsland = latLngToCell(4.22, 73.54, 10);
		const input = collection([...gridDisk(origin, 1), ...gridDisk(otherIsland, 1)]);
		const original = structuredClone(input);
		const cells = buildWaveCells(input, [coordinates(origin)]);
		expect(cells.features).toHaveLength(input.features.length);
		expect(input).toEqual(original);
		for (let index = 0; index < cells.features.length; index++) {
			expect(cells.features[index].geometry).toEqual(original.features[index].geometry);
			expect(cells.features[index].id).toBe(original.features[index].id);
			expect(cells.features[index].properties!.population).toBe(37);
			expect(cells.features[index].properties!.arrivalMs).toBeGreaterThanOrEqual(0);
			expect(cells.features[index].properties!.arrivalMs).toBeLessThanOrEqual(WAVE_SPREAD_MS);
		}
		expect(arrivals(cells).get(otherIsland)).toBeGreaterThan(
			arrivals(cells).get(gridRing(origin, 1)[0])
		);
	});

	it('limits a single edit to its nearest island and leaves other island geometry out', () => {
		const other = latLngToCell(4.22, 73.54, 10);
		const first = collection(gridDisk(origin, 1), 'first');
		const input = {
			type: 'FeatureCollection' as const,
			features: [...first.features, ...collection(gridDisk(other, 2), 'other').features]
		};
		const before = structuredClone(input);
		const result = buildWaveCells(input, [coordinates(origin)]);
		expect(result.features).toHaveLength(first.features.length);
		expect(result.features.every((cell) => cell.properties?.islandId === 'first')).toBe(true);
		expect(arrivals(result).get(origin)).toBe(0);
		expect(input).toEqual(before);
	});

	it('does not leak across island metadata even when separate islands occupy neighbouring hexes', () => {
		const adjacent = gridRing(origin, 1)[0];
		const input = {
			type: 'FeatureCollection' as const,
			features: [
				...collection([origin], 'first').features,
				...collection([adjacent], 'other').features
			]
		};
		expect(
			buildWaveCells(input, [coordinates(origin)]).features.map((cell) => cell.properties?.islandId)
		).toEqual(['first']);
	});

	it('selects both islands touched by a route edit while leaving a third island quiet', () => {
		const other = latLngToCell(4.22, 73.54, 10);
		const third = latLngToCell(4.17, 73.485, 10);
		const input = {
			type: 'FeatureCollection' as const,
			features: [
				...collection(gridDisk(origin, 1), 'first').features,
				...collection(gridDisk(other, 1), 'second').features,
				...collection(gridDisk(third, 1), 'third').features
			]
		};
		const result = buildWaveCells(input, [coordinates(origin), coordinates(other)]);
		expect(new Set(result.features.map((cell) => cell.properties?.islandId))).toEqual(
			new Set(['first', 'second'])
		);
		expect(arrivals(result).get(origin)).toBe(0);
		expect(arrivals(result).get(other)).toBe(0);
	});

	it('uses seeded connected components when island metadata is unavailable', () => {
		const other = latLngToCell(4.22, 73.54, 10);
		const input = collection([...gridDisk(origin, 1), ...gridDisk(other, 1)], null);
		const result = buildWaveCells(input, [coordinates(origin)]);
		expect(result.features).toHaveLength(7);
		expect([...arrivals(result).keys()].sort()).toEqual(gridDisk(origin, 1).sort());
		expect(buildWaveCells(input, [coordinates(origin), coordinates(other)]).features).toHaveLength(
			14
		);
	});

	it('preserves split coastal geometry and gives duplicate H3 identities the same arrival', () => {
		const input = collection([origin, origin]);
		const polygon = input.features[1].geometry as Polygon;
		input.features[1].geometry = { type: 'MultiPolygon', coordinates: [polygon.coordinates] };
		const cells = buildWaveCells(input, []);
		expect(cells.features[1].geometry.type).toBe('MultiPolygon');
		expect(cells.features.map((feature) => feature.properties!.arrivalMs)).toEqual([0, 0]);
	});

	it('uses a stable fallback seed and handles an empty display grid', () => {
		const input = collection(gridDisk(origin, 1));
		expect(buildWaveCells(input, [[NaN, Infinity]])).toEqual(buildWaveCells(input, []));
		expect(buildWaveCells({ type: 'FeatureCollection', features: [] }, [])).toEqual({
			type: 'FeatureCollection',
			features: []
		});
	});
});

describe('analysis-gated wave timing', () => {
	it('holds a deep highlight indefinitely while the actual worker is still pending', () => {
		const wave = descriptor();
		expect(waveFrame(wave, 100_000)).toMatchObject({
			opacity: 1,
			finished: false,
			animating: false,
			finishAt: null
		});
	});

	it('never fades or declares completion before every cell has been covered', () => {
		const wave = descriptor(5);
		const covered = WAVE_SPREAD_MS + WAVE_DEEPEN_MS;
		expect(waveCoverageMs(wave)).toBe(covered);
		expect(waveFrame(wave, 6)).toMatchObject({ opacity: 1, finished: false });
		expect(waveFrame(wave, covered - 1)).toMatchObject({ opacity: 1, finished: false });
		expect(waveFrame(wave, covered + WAVE_FADE_MS / 2).opacity).toBeCloseTo(0.5);
		expect(waveFrame(wave, covered + WAVE_FADE_MS)).toMatchObject({ opacity: 0, finished: true });
	});

	it('waits for a slow calculation, then fades smoothly from the actual completion time', () => {
		const wave = descriptor(5_000);
		expect(waveFrame(wave, 4_999)).toMatchObject({ opacity: 1, finished: false });
		expect(waveFrame(wave, 5_000)).toMatchObject({ opacity: 1, finished: false });
		expect(waveFrame(wave, 5_000 + WAVE_FADE_MS / 2).opacity).toBeCloseTo(0.5);
		expect(waveFrame(wave, 5_000 + WAVE_FADE_MS)).toMatchObject({ opacity: 0, finished: true });
	});

	it('uses a static reduced-motion highlight while preserving the real completion gate', () => {
		expect(waveFrame(descriptor(), 0, true)).toMatchObject({
			opacity: 1,
			finished: false,
			animating: false
		});
		expect(waveFrame(descriptor(), 10_000, true)).toMatchObject({
			opacity: 1,
			finished: false,
			animating: false
		});
		expect(waveFrame(descriptor(10), 299, true).finished).toBe(false);
		expect(waveFrame(descriptor(10), 300, true)).toMatchObject({ opacity: 0, finished: true });
	});

	it('fades failed calculations without pretending the whole flood succeeded', () => {
		const wave = { ...descriptor(20), outcome: 'error' as const };
		expect(waveFrame(wave, 120)).toMatchObject({ opacity: 1, finished: false });
		expect(waveFrame(wave, 120 + WAVE_FADE_MS)).toMatchObject({ opacity: 0, finished: true });
	});

	it('can settle without geometry while an empty pending grid never signals completion', () => {
		const wave = { ...descriptor(), cells: { type: 'FeatureCollection' as const, features: [] } };
		expect(waveFrame(wave, 100)).toMatchObject({ finished: false, animating: false });
		expect(waveFrame({ ...wave, completedAt: 100 }, 100)).toMatchObject({ finished: true });
	});
});
