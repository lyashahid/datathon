import { describe, expect, it } from 'vitest';
import { mobileServiceRoutePadding, serviceCardMaxHeight } from './map-service-layout.js';

describe('service editor map viewport', () => {
	it('keeps a useful route viewport above a tall phone editor', () => {
		const cardHeight = serviceCardMaxHeight(390, 178, 764);
		const padding = mobileServiceRoutePadding(844, 178, 764, cardHeight);
		expect(cardHeight).toBe(320);
		expect(844 - padding.top - padding.bottom).toBeGreaterThan(200);
		expect(844 - padding.bottom).toBeLessThan(764 - cardHeight);
	});
	it('keeps terminals clear when compact timetable details expand without refitting', () => {
		const maxCardHeight = serviceCardMaxHeight(390, 178, 764);
		const padding = mobileServiceRoutePadding(844, 178, 764, maxCardHeight);
		const lowestTerminalY = 844 - padding.bottom;
		for (const actualCardHeight of [240, maxCardHeight]) {
			const cardTop = 764 - actualCardHeight;
			expect(cardTop - lowestTerminalY).toBeGreaterThanOrEqual(24);
		}
		expect(844 - padding.top - padding.bottom).toBe(218);
		expect(padding).toMatchObject({ left: 40, right: 40 });
	});
	it('shares scarce height on shorter phones and retains desktop editor space', () => {
		const cardHeight = serviceCardMaxHeight(390, 136, 488);
		const padding = mobileServiceRoutePadding(568, 136, 488, cardHeight);
		expect(568 - padding.top - padding.bottom).toBeGreaterThan(100);
		expect(cardHeight).toBeLessThan(200);
		expect(serviceCardMaxHeight(1440, 108, 920)).toBe(812);
		expect(serviceCardMaxHeight(390, 178, 178)).toBe(0);
	});
});
