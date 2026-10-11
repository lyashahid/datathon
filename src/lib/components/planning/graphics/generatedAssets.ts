import type { GraphicKind, GraphicState } from './transportGraphics';

/**
 * Project-owned, generated architectural miniatures. Their kind is intentional:
 * a waiting shelter is not a bus vehicle, and a hospital is not a general clinic.
 * Other asset categories keep their original vector illustrations.
 */
export const GENERATED_TRANSPORT_ASSETS: Partial<Record<GraphicKind, string>> = {
	shelter: 'graphics/generated/bus-stop.webp',
	hospital: 'graphics/generated/hospital.webp',
	school: 'graphics/generated/school.webp',
	clinic: 'graphics/generated/clinic.webp',
	bus: 'graphics/generated/bus.webp',
	ferry: 'graphics/generated/ferry.webp'
};

export const PROPOSED_TRANSPORT_ASSETS: Partial<Record<GraphicKind, string>> = {
	shelter: 'graphics/generated/bus-stop-proposed.webp',
	hospital: 'graphics/generated/hospital-proposed.webp'
};

export function getGeneratedTransportAsset(
	kind: GraphicKind,
	state: GraphicState = 'existing'
): string | null {
	if (state === 'proposed' || state === 'draft') {
		return PROPOSED_TRANSPORT_ASSETS[kind] ?? GENERATED_TRANSPORT_ASSETS[kind] ?? null;
	}
	return GENERATED_TRANSPORT_ASSETS[kind] ?? null;
}
