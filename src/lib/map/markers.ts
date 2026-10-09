import type { Map as MaplibreMap } from 'maplibre-gl';
import { INFRASTRUCTURE_TYPE_STYLES } from '#lib/config/infrastructure.ts';
import { MAP_COLORS } from '#lib/config/map.ts';
import { INFRASTRUCTURE_TYPES, type InfrastructureType } from '#lib/types/domain.ts';
import { markerPath, type MarkerShape } from '#lib/utils/markerShapes.ts';

const OUTLINE_PX = 1.5;

export const MARKER_IMAGE_PREFIX = 'mv-marker-';

/** Suffix of the out-of-service variant of each marker image. */
export const DISABLED_MARKER_SUFFIX = '-disabled';

export function markerImageId(type: InfrastructureType, disabled = false): string {
	return `${MARKER_IMAGE_PREFIX}${type}${disabled ? DISABLED_MARKER_SUFFIX : ''}`;
}

/**
 * Rasterises a marker shape on a canvas. Drawing locally avoids depending on a sprite sheet
 * or glyph server, so markers render even on the offline fallback basemap.
 */
function renderMarker(
	shape: MarkerShape,
	color: string,
	sizePx: number,
	pixelRatio: number,
	disabled: boolean
) {
	const radius = sizePx / 2;
	const side = Math.ceil((sizePx + OUTLINE_PX * 2) * pixelRatio);
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = side;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D context unavailable');

	ctx.translate(side / 2, side / 2);
	ctx.scale(radius * pixelRatio, radius * pixelRatio);
	const path = new Path2D(markerPath(shape));
	ctx.fillStyle = disabled ? MAP_COLORS.disabledFill : color;
	ctx.fill(path);
	ctx.lineJoin = 'round';
	ctx.lineWidth = OUTLINE_PX / radius;
	ctx.strokeStyle = MAP_COLORS.markerOutline;
	ctx.stroke(path);
	if (disabled) {
		// A diagonal slash reads as "out of service" independently of colour.
		ctx.beginPath();
		ctx.moveTo(-0.9, 0.9);
		ctx.lineTo(0.9, -0.9);
		ctx.lineCap = 'round';
		ctx.lineWidth = 2.2 / radius;
		ctx.strokeStyle = MAP_COLORS.scenarioDisabled;
		ctx.stroke();
	}
	return ctx.getImageData(0, 0, side, side);
}

export function registerMarkerImages(map: MaplibreMap): void {
	const pixelRatio = Math.max(1, Math.ceil(window.devicePixelRatio));
	for (const type of INFRASTRUCTURE_TYPES) {
		const { shape, color, sizePx } = INFRASTRUCTURE_TYPE_STYLES[type];
		for (const disabled of [false, true]) {
			const id = markerImageId(type, disabled);
			if (map.hasImage(id)) continue;
			map.addImage(id, renderMarker(shape, color, sizePx, pixelRatio, disabled), { pixelRatio });
		}
	}
}
