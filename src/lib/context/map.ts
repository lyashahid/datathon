import type { FeatureCollection, Point } from 'geojson';
import type { TransportContext } from './types.ts';
import type { GraphicKind } from '#lib/components/planning/graphics/transportGraphics.ts';

export function vesselGraphic(type: string): GraphicKind {
	if (/cargo|supply|landing|oil|tanker/i.test(type)) return 'cargo-ship';
	if (/speed|yacht/i.test(type)) return 'speedboat';
	if (/passenger|ferry/i.test(type)) return 'ferry';
	return 'vessel';
}

export const VIA_COORDINATES: [number, number] = [73.529, 4.1918];

/** No port-call rows are turned into vessel positions. Only source-provided coordinates qualify. */
export function transportContextSymbols(
	bundle: TransportContext | null,
	showVessels: boolean,
	showAirport: boolean
): FeatureCollection<Point> {
	const features: FeatureCollection<Point>['features'] = [];
	if (bundle?.followme.enabled && showVessels) {
		for (const vessel of bundle.followme.records) {
			if (!vessel.coordinates) continue;
			features.push({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: vessel.coordinates },
				properties: {
					id: vessel.id,
					name: vessel.name,
					icon: vesselGraphic(vessel.type),
					heading: vessel.headingDeg ?? 0,
					contextKind: 'vessel',
					description: `${vessel.type} · ${vessel.speedKnots == null ? 'Speed unavailable' : `${vessel.speedKnots} kn`} · Last reported ${vessel.observedAtRaw ?? vessel.lastSeenLabel ?? 'time unavailable'}${vessel.observedTimezone ? ` ${vessel.observedTimezone}` : ' (timezone unconfirmed)'}. Cached observation, not live tracking.`,
					sourceUrl: vessel.sourceUrl
				}
			});
		}
	}
	if (bundle?.aviation.enabled && showAirport) {
		features.push({
			type: 'Feature',
			geometry: { type: 'Point', coordinates: VIA_COORDINATES },
			properties: {
				id: 'airport-via',
				name: 'Velana International Airport',
				icon: 'airport',
				heading: 0,
				contextKind: 'airport',
				description:
					'Airport passenger totals · Open Sea & air for dated official MBS/CAA observations.',
				sourceUrl: 'https://statisticsmaldives.gov.mv/yearbook/2026/'
			}
		});
	}
	return { type: 'FeatureCollection', features };
}
