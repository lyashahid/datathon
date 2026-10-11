import type { FeatureCollection, Point } from 'geojson';

export type MapCoordinate = [number, number];
export type StopMove = { id: string; position: MapCoordinate };

/** A parent's invalidation counter excludes this map's accepted drop transaction. */
export function reconcileStopEditRevision<T>(
	previousRevision: number | undefined,
	nextRevision: number,
	heldMove: T | null,
	activeDrag: boolean
): { revision: number; heldMove: T | null; cancelActive: boolean; invalidated: boolean } {
	const invalidated = previousRevision !== undefined && previousRevision !== nextRevision;
	return {
		revision: nextRevision,
		heldMove: invalidated ? null : heldMove,
		cancelActive: invalidated && activeDrag,
		invalidated
	};
}

/** MapLibre serializes array properties when returning rendered features. */
export function stopIds(properties: Record<string, unknown> | null | undefined): string[] {
	if (properties?.mapKind !== 'stop') return [];
	let ids: unknown = properties.stopIds;
	if (typeof ids === 'string') {
		try {
			ids = JSON.parse(ids);
		} catch {
			ids = [];
		}
	}
	if (Array.isArray(ids)) {
		const strings = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
		if (strings.length) return strings;
	}
	return typeof properties.id === 'string' && Number(properties.count ?? 1) <= 1
		? [properties.id]
		: [];
}

export function dragTarget(ids: string[], selectedId: string): string | null {
	return ids.length === 1 ? ids[0] : ids.includes(selectedId) ? selectedId : null;
}

/** Ordered connection handles retain boarding identities, including co-located directions. */
export function connectionStopMarkers(
	symbols: FeatureCollection<Point>,
	orderedIds: readonly string[]
): FeatureCollection<Point> {
	const points = new Map<string, FeatureCollection<Point>['features'][number]>();
	for (const [index, id] of orderedIds.entries()) {
		const marker = symbols.features.find(
			(feature) =>
				stopIds(feature.properties).includes(id) &&
				!String(feature.properties?.icon ?? '').startsWith('ferry')
		);
		if (!marker) continue;
		const key = marker.geometry.coordinates.slice(0, 2).join(',');
		const samePoint = points.get(key);
		if (samePoint) {
			const boardingIds = [
				...new Set([...stopIds(samePoint.properties), ...stopIds(marker.properties)])
			];
			samePoint.properties = {
				...samePoint.properties,
				stopIds: boardingIds,
				count: boardingIds.length,
				connectionVisits: [...(samePoint.properties?.connectionVisits as string[]), id],
				orderLabel: `${samePoint.properties?.orderLabel}/${index + 1}`
			};
		} else {
			points.set(key, {
				...marker,
				properties: {
					...marker.properties,
					id,
					stopIds: stopIds(marker.properties),
					count: stopIds(marker.properties).length,
					connectionVisits: [id],
					orderLabel: String(index + 1)
				}
			});
		}
	}
	return { type: 'FeatureCollection', features: [...points.values()] };
}

/** Resolve from model metadata: rendered drag holds already contain a state sprite. */
export function resolveStopDragIcon(
	symbols: FeatureCollection<Point>,
	id: string,
	fallbackProperties: Record<string, unknown> | null | undefined
): string {
	const marker =
		symbols.features.find((feature) => stopIds(feature.properties).includes(id))?.properties ??
		fallbackProperties ??
		{};
	const icon = typeof marker.icon === 'string' && marker.icon.trim() ? marker.icon : 'shelter';
	const baseIcon = icon.replace(/(?:-(?:proposed|draft|moved|paused))+$/, '');
	// Explicit built status takes precedence. Older rendered holds may carry only
	// a sprite or investment state; retain their unbuilt status when model data is absent.
	const proposed =
		marker.isBaselineAsset === false ||
		(marker.isBaselineAsset !== true &&
			(marker.investmentState === 'proposed' ||
				marker.investmentState === 'draft' ||
				/-(proposed|draft)$/.test(icon)));
	return `${baseIcon}-${proposed ? 'proposed' : 'moved'}`;
}

/** Hide only the identity being dragged; preserve other co-located boarding codes. */
export function withoutDraggedStop(
	symbols: FeatureCollection<Point>,
	id: string
): FeatureCollection<Point> {
	return {
		type: 'FeatureCollection',
		features: symbols.features.flatMap((feature) => {
			const ids = stopIds(feature.properties);
			if (!ids.includes(id)) return [feature];
			const remaining = ids.filter((other) => other !== id);
			return remaining.length
				? [
						{
							...feature,
							properties: {
								...feature.properties,
								id: remaining[0],
								stopIds: remaining,
								count: remaining.length
							}
						}
					]
				: [];
		})
	};
}

/** Pointer movement is local UI state. Only finish() can produce one committed edit. */
export class StopDragSession {
	private active: {
		id: string;
		original: MapCoordinate;
		position: MapCoordinate;
		pixel: MapCoordinate;
		moved: boolean;
	} | null = null;
	begin(id: string, position: MapCoordinate, pixel: MapCoordinate): void {
		this.active = {
			id,
			original: [...position],
			position: [...position],
			pixel: [...pixel],
			moved: false
		};
	}
	move(position: MapCoordinate, pixel: MapCoordinate): StopMove | null {
		const active = this.active;
		if (
			!active ||
			!Number.isFinite(position[0]) ||
			!Number.isFinite(position[1]) ||
			Math.abs(position[0]) > 180 ||
			Math.abs(position[1]) > 90
		)
			return null;
		if (!active.moved && Math.hypot(pixel[0] - active.pixel[0], pixel[1] - active.pixel[1]) < 3)
			return null;
		active.moved = true;
		active.position = [...position];
		return { id: active.id, position: [...active.position] };
	}
	finish(): StopMove | null {
		const active = this.active;
		this.active = null;
		return active?.moved &&
			(active.position[0] !== active.original[0] || active.position[1] !== active.original[1])
			? { id: active.id, position: [...active.position] }
			: null;
	}
	cancel(): void {
		this.active = null;
	}
}
