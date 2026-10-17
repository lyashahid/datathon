import { describe, expect, it } from 'vitest';
import { createTheme, themeColors, themeCss, themePalette } from './theme';

describe('application theme', () => {
	it('preserves the current UI, map and chart palette by default', () => {
		expect(themeColors.brand).toBe('#087f78');
		expect(themeColors.color087f78).toBe(themeColors.brand);
		expect(themeColors.colorffffff).toBe('#ffffff');
		expect(themeColors.colordceef0).toBe(themePalette.mapWater);
		expect(themeColors.color9072dd).toBe(themePalette.health);
		expect(themeColors.color286d638c).toBe('#286d638c');
		expect(themeCss).toContain('--primary:var(--theme-color-273732)');
		expect(themeCss).toContain('--chart-1:var(--theme-color-83a96c)');
	});

	it('updates related shades and preserves their transparency from one palette edit', () => {
		const { colors, css } = createTheme({ ...themePalette, brand: '#0066cc' });
		expect(colors.color087f78).toBe('#0066cc');
		expect(colors.color087e77).not.toBe(themeColors.color087e77);
		expect(colors.color286d638c).not.toBe(themeColors.color286d638c);
		expect(colors.color286d638c).toMatch(/^#[0-9a-f]{6}8c$/);
		expect(css).toContain(`--theme-color-286d638c:${colors.color286d638c}`);
		expect(colors.colordceef0).toBe(themeColors.colordceef0);
		expect(colors.color9072dd).toBe(themeColors.color9072dd);
	});

	it('changes map and chart roles independently while sharing their CSS values', () => {
		const { colors, css } = createTheme({
			...themePalette,
			mapWater: '#d0e4ff',
			health: '#7346ca'
		});
		expect(colors.colordceef0).toBe('#d0e4ff');
		expect(colors.colorcce5e6).not.toBe(themeColors.colorcce5e6);
		expect(colors.color9072dd).toBe('#7346ca');
		expect(colors.coloraf98e7).not.toBe(themeColors.coloraf98e7);
		expect(colors.colorcfc0ee).not.toBe(themeColors.colorcfc0ee);
		expect(css).toContain('--theme-color-dceef0:#d0e4ff');
		expect(css).toContain('--theme-health:#7346ca');
	});

	it('returns browser-independent CSS and literal colors accepted by maps and canvas', () => {
		const { colors, css } = createTheme({ ...themePalette, accent: '#f64' });
		expect(Object.keys(colors).length).toBeGreaterThan(1200);
		for (const color of Object.values(colors)) {
			expect(color).toMatch(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
		}
		for (const [key, color] of Object.entries(colors)) {
			if (key.startsWith('color')) expect(css).toContain(`--theme-color-${key.slice(5)}:${color}`);
		}
		expect(css).toMatch(/^:root\{.*\}$/);
		expect(css).not.toMatch(/undefined|NaN|window|document|<\/style>/);
	});

	it('rejects invalid palette values before generating styles', () => {
		expect(() => createTheme({ ...themePalette, brand: 'url(external)' })).toThrow(
			'Theme palette colours must be opaque hex values'
		);
	});
});
