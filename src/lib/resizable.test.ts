import { describe, expect, it } from 'vitest';
import {
	PANEL_SIZE_PREFIX,
	clampPanelSize,
	panelResizeBounds,
	readPanelSize,
	resizedPanelSize,
	savePanelSize
} from './resizable.js';

const bounds = { minWidth: 340, minHeight: 360, maxWidth: 680, maxHeight: 800 };

describe('desktop window resizing geometry', () => {
	it('keeps a right-docked panel anchored while dragging its left and bottom corner', () => {
		expect(
			resizedPanelSize(
				{ width: 380, height: 500 },
				{ x: -100, y: 90 },
				'bottom-left',
				'top-right',
				bounds
			)
		).toEqual({ width: 480, height: 590 });
	});

	it('accounts for the opposite moving edge of centered dialogs', () => {
		expect(
			resizedPanelSize(
				{ width: 380, height: 500 },
				{ x: 50, y: 30 },
				'bottom-right',
				'center',
				bounds
			)
		).toEqual({ width: 480, height: 560 });
	});

	it('changes only the selected dimension and enforces both lower and upper limits', () => {
		expect(
			resizedPanelSize(
				{ width: 380, height: 500 },
				{ x: -1000, y: 1000 },
				'left',
				'top-right',
				bounds
			)
		).toEqual({ width: 680, height: 500 });
		expect(clampPanelSize({ width: 100, height: 1500 }, bounds)).toEqual({
			width: 340,
			height: 800
		});
	});

	it('limits a docked panel to the usable space below its real top position', () => {
		expect(
			panelResizeBounds(
				{ key: 'proposal', anchor: 'top-right', minWidth: 360, minHeight: 460, maxWidth: 640 },
				{ width: 1440, height: 1000 },
				{ left: 1056, right: 1422, top: 144, bottom: 980 }
			)
		).toEqual({ minWidth: 360, minHeight: 460, maxWidth: 640, maxHeight: 844 });
	});

	it('honors the map containing block instead of letting a panel escape it', () => {
		expect(
			panelResizeBounds(
				{ key: 'map', anchor: 'top-right' },
				{ width: 1440, height: 1000 },
				{ left: 1056, right: 1422, top: 144, bottom: 880 },
				{ left: 800, right: 1440, top: 100, bottom: 900 }
			)
		).toEqual({ minWidth: 320, minHeight: 300, maxWidth: 610, maxHeight: 744 });
	});

	it('reduces minimums on a short viewport so even a saved large dialog remains usable', () => {
		const limits = panelResizeBounds(
			{ key: 'review', anchor: 'center', minWidth: 720, minHeight: 480 },
			{ width: 800, height: 400 },
			{ left: 100, right: 700, top: 20, bottom: 380 }
		);
		expect(limits).toEqual({ minWidth: 720, minHeight: 376, maxWidth: 776, maxHeight: 376 });
		expect(clampPanelSize({ width: 1400, height: 1200 }, limits)).toEqual({
			width: 776,
			height: 376
		});
	});

	it('uses the correct available space for bottom-left anchored windows', () => {
		expect(
			panelResizeBounds(
				{ key: 'bottom', anchor: 'bottom-left', viewportMargin: 20 },
				{ width: 1200, height: 900 },
				{ left: 100, right: 500, top: 400, bottom: 850 }
			)
		).toEqual({ minWidth: 320, minHeight: 300, maxWidth: 1080, maxHeight: 830 });
	});
});

describe('remembered panel sizes', () => {
	function memoryStorage() {
		const data = new Map<string, string>();
		return {
			data,
			getItem: (key: string) => data.get(key) ?? null,
			setItem: (key: string, value: string) => data.set(key, value),
			removeItem: (key: string) => data.delete(key)
		};
	}

	it('stores only a versioned size under the window family key and restores it', () => {
		const storage = memoryStorage();
		savePanelSize(storage, 'map-proposal', { width: 524, height: 684 });
		expect(storage.data.has(PANEL_SIZE_PREFIX + 'map-proposal')).toBe(true);
		expect(readPanelSize(storage, 'map-proposal')).toEqual({ width: 524, height: 684 });
		expect(readPanelSize(storage, 'map-detail')).toBeNull();
	});

	it('reset removes a preference so the responsive default can return', () => {
		const storage = memoryStorage();
		savePanelSize(storage, 'review', { width: 900, height: 600 });
		savePanelSize(storage, 'review', null);
		expect(readPanelSize(storage, 'review')).toBeNull();
		expect(storage.data.size).toBe(0);
	});

	it('ignores corrupt, outdated, negative and nonnumeric cached dimensions', () => {
		const storage = memoryStorage();
		for (const raw of [
			'broken json',
			'{"version":0,"width":500,"height":500}',
			'{"version":1,"width":-500,"height":500}',
			'{"version":1,"width":"500","height":500}',
			'{"version":1,"width":500,"height":null}'
		]) {
			storage.data.set(PANEL_SIZE_PREFIX + 'review', raw);
			expect(readPanelSize(storage, 'review')).toBeNull();
		}
	});

	it('survives disabled storage, full storage and security errors', () => {
		const unavailable = {
			getItem: () => {
				throw new Error('Blocked');
			},
			setItem: () => {
				throw new Error('Quota exceeded');
			},
			removeItem: () => {
				throw new Error('Blocked');
			}
		};
		expect(readPanelSize(unavailable, 'review')).toBeNull();
		expect(readPanelSize(null, 'review')).toBeNull();
		expect(() => savePanelSize(unavailable, 'review', { width: 500, height: 500 })).not.toThrow();
		expect(() => savePanelSize(unavailable, 'review', null)).not.toThrow();
	});
});
