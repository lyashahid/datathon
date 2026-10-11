import type { GraphicKind, GraphicState } from './transportGraphics';

/** Cartographic symbols have their own optical scale, independent of card artwork. */
const symbols: Record<GraphicKind, { ink: string; paths: string }> = {
	bus: {
		ink: '#1c7c86',
		paths:
			'<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 10h14M9 3v7M15 3v7M7 19v2M17 19v2"/><path d="M8 15h.01M16 15h.01" stroke-width="3"/>'
	},
	shelter: {
		ink: '#1c7c86',
		paths:
			'<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 10h14M9 3v7M15 3v7M7 19v2M17 19v2"/><path d="M8 15h.01M16 15h.01" stroke-width="3"/>'
	},
	hospital: {
		ink: '#a45067',
		paths: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor" stroke="none"/>'
	},
	clinic: {
		ink: '#a45067',
		paths:
			'<path d="M6 3v5a4 4 0 0 0 8 0V3M4 3h4M12 3h4M10 12v3a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="10" r="2"/>'
	},
	school: {
		ink: '#7862a0',
		paths: '<path d="m2 9 10-5 10 5-10 5zM6 11v6c3 3 9 3 12 0v-6M22 9v8"/>'
	},
	ferry: {
		ink: '#426f9e',
		paths:
			'<path d="M6 12V5h12v7M9 5V2h6v3M12 10l9 4-4 5H7l-4-5zM12 10v9M3 22l3-1 3 1 3-1 3 1 3-1 3 1"/>'
	},
	terminal: {
		ink: '#426f9e',
		paths:
			'<circle cx="12" cy="4" r="2"/><path d="M12 6v15M8 10h8M4 14v3c0 3 4 4 8 4s8-1 8-4v-3M2 16l2-2 2 2M18 16l2-2 2 2"/>'
	},
	vessel: {
		ink: '#426f9e',
		paths: '<path d="M4 14h17l-4 5H7zM8 14V8h8v6M11 8V4M3 22l3-1 3 1 3-1 3 1 3-1 3 1"/>'
	},
	speedboat: {
		ink: '#426f9e',
		paths: '<path d="M3 14h18l-5 5H7zM8 14V9h5l4 5M3 22l3-1 3 1 3-1 3 1 3-1 3 1"/>'
	},
	'cargo-ship': {
		ink: '#426f9e',
		paths:
			'<path d="M3 14h18l-4 5H7zM5 14V9h5v5M10 14V9h5v5M16 14V5h3v9M3 22l3-1 3 1 3-1 3 1 3-1 3 1"/>'
	},
	airplane: {
		ink: '#596d87',
		paths: '<path d="m12 2 2 8 7 4v3l-7-2v4l3 2v1l-5-1-5 1v-1l3-2v-4l-7 2v-3l7-4z"/>'
	},
	airport: {
		ink: '#596d87',
		paths: '<path d="m12 2 2 8 7 4v3l-7-2v4l3 2v1l-5-1-5 1v-1l3-2v-4l-7 2v-3l7-4z"/>'
	},
	walk: {
		ink: '#1c7c86',
		paths: '<circle cx="13" cy="4" r="2"/><path d="m7 12 4-4 4 2 3 3M11 8l-2 7-4 6M9 15l5 1 2 5"/>'
	},
	wait: {
		ink: '#596d87',
		paths: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
	}
};

export function getMapSymbolSvg(kind: GraphicKind, state: GraphicState = 'existing'): string {
	const proposed = state === 'proposed' || state === 'draft';
	const changed = state !== 'existing';
	const ink = proposed
		? '#a86313'
		: state === 'moved'
			? '#7960ab'
			: state === 'paused'
				? '#7c8d91'
				: symbols[kind].ink;
	const fill = proposed ? '#fff8e9' : state === 'moved' ? '#f7f2ff' : '#fffffc';
	const border = changed ? ink : '#c8d9d9';
	const mark = proposed
		? '<path d="M30 8h6M33 5v6"/>'
		: state === 'moved'
			? '<path d="m30 11 6-6M31 5h5v5"/>'
			: '<path d="M31 5v6M35 5v6"/>';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 40 40">
		<circle cx="20" cy="21.5" r="15" fill="#163f52" opacity=".09"/>
		<circle cx="20" cy="20" r="15" fill="${fill}" stroke="${border}" stroke-width="${changed ? 1.7 : 1.1}" ${proposed ? 'stroke-dasharray="3 2.3"' : ''}/>
		<g transform="translate(10 10) scale(.833333)" color="${ink}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="${state === 'paused' ? '.65' : '1'}">${symbols[kind].paths}</g>
		${changed ? `<circle cx="33" cy="8" r="6" fill="${ink}" stroke="#fff" stroke-width="1.5"/><g fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${mark}</g>` : ''}
	</svg>`;
}

export function getMapSymbolDataUri(kind: GraphicKind, state: GraphicState = 'existing'): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(getMapSymbolSvg(kind, state))}`;
}
