import type { FeatureCollection, Point } from 'geojson';
import type { GeoJSONSource, Map as MaplibreMap, PointLike } from 'maplibre-gl';
import { MAP_COLORS } from '#lib/config/map.ts';
import type { BusStopCandidate } from '#lib/types/candidates.ts';

const SOURCE_ID = 'mv-candidates';
const LAYER_IDS = { halo: 'mv-candidates-halo', markers: 'mv-candidates-markers' } as const;
const IMAGE_PREFIX = 'mv-candidate-';
const MAX_RANK = 10;
const SIZE_PX = 24;

/** Numbered badges drawn on canvas, so ranks render without a glyph server. */
function renderBadge(rank: number, pixelRatio: number): ImageData {
	const side = Math.ceil(SIZE_PX * pixelRatio);
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = side;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D context unavailable');
	const r = side / 2;
	ctx.beginPath();
	ctx.arc(r, r, r - pixelRatio, 0, Math.PI * 2);
	ctx.fillStyle = rank === 1 ? MAP_COLORS.candidateTop : MAP_COLORS.candidate;
	ctx.fill();
	ctx.lineWidth = 2 * pixelRatio;
	ctx.strokeStyle = MAP_COLORS.markerOutline;
	ctx.stroke();
	ctx.fillStyle = MAP_COLORS.markerOutline;
	ctx.font = `700 ${Math.round(12 * pixelRatio)}px system-ui, sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(String(rank), r, r + pixelRatio * 0.5);
	return ctx.getImageData(0, 0, side, side);
}

export function addCandidateLayers(map: MaplibreMap): void {
	const pixelRatio = Math.max(1, Math.ceil(window.devicePixelRatio));
	for (let rank = 1; rank <= MAX_RANK; rank++) {
		const id = `${IMAGE_PREFIX}${rank}`;
		if (!map.hasImage(id)) map.addImage(id, renderBadge(rank, pixelRatio), { pixelRatio });
	}
	map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
	map.addLayer({
		id: LAYER_IDS.halo,
		type: 'circle',
		source: SOURCE_ID,
		filter: ['==', ['get', 'selected'], true],
		paint: {
			'circle-radius': 17,
			'circle-color': 'transparent',
			'circle-stroke-color': MAP_COLORS.selection,
			'circle-stroke-width': 2.5
		}
	});
	map.addLayer({
		id: LAYER_IDS.markers,
		type: 'symbol',
		source: SOURCE_ID,
		layout: {
			'icon-image': ['concat', IMAGE_PREFIX, ['to-string', ['get', 'rank']]],
			'icon-allow-overlap': true,
			'icon-ignore-placement': true,
			// Rank 1 draws on top.
			'symbol-sort-key': ['-', 0, ['get', 'rank']]
		}
	});
}

export function removeCandidateLayers(map: MaplibreMap): void {
	for (const id of [LAYER_IDS.markers, LAYER_IDS.halo]) if (map.getLayer(id)) map.removeLayer(id);
	if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

export function setCandidates(
	map: MaplibreMap,
	candidates: readonly BusStopCandidate[],
	selectedId: string | null
): void {
	const data: FeatureCollection<Point> = {
		type: 'FeatureCollection',
		features: candidates.slice(0, MAX_RANK).map((c) => ({
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [...c.position] },
			properties: { id: c.id, rank: c.rank, selected: c.id === selectedId }
		}))
	};
	map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(data);
}

/** Candidate id under a screen point. Other click handlers defer to this layer. */
export function pickCandidate(map: MaplibreMap, point: PointLike): string | null {
	if (!map.getLayer(LAYER_IDS.markers)) return null;
	const [hit] = map.queryRenderedFeatures(point, { layers: [LAYER_IDS.markers] });
	const id = hit?.properties.id;
	return typeof id === 'string' ? id : null;
}
