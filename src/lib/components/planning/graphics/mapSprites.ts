import type { GraphicKind, GraphicState } from './transportGraphics';
import { getMapSymbolDataUri } from './mapSymbols';

export const MAP_GRAPHIC_STATES: GraphicState[] = [
	'existing',
	'proposed',
	'draft',
	'moved',
	'paused'
];

/** Two device pixels per map pixel keeps small vector badges crisp on export. */
export async function createMapSprite(kind: GraphicKind, state: GraphicState = 'existing') {
	const picture = new Image();
	picture.src = getMapSymbolDataUri(kind, state);
	await picture.decode();
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 80;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Map symbol canvas unavailable');
	context.drawImage(picture, 0, 0, 80, 80);
	return context.getImageData(0, 0, 80, 80);
}
