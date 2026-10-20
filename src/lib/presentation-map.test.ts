import { describe, expect, it } from 'vitest';
import {
	preparePresentationPaths,
	presentationCameraPadding,
	presentationPathBounds,
	presentationClock,
	presentationPosition,
	presentationRouteFeatures,
	presentationVehicleFeatures
} from './presentation-map.js';

describe('presentation camera composition', () => {
	it('reserves the desktop inspector while leaving an active map canvas', () => {
		const padding = presentationCameraPadding(1440, 1000, 'route');
		expect(padding.right).toBe(458);
		expect(padding.left).toBe(64);
		expect(padding.top + padding.bottom).toBeLessThan(1000 - 400);
		expect(presentationCameraPadding(1440, 1000).right).toBe(padding.left);
	});

	it('reserves the mobile bottom sheet without consuming the entire map', () => {
		for (const [width, height] of [
			[390, 844],
			[700, 500]
		]) {
			const padding = presentationCameraPadding(width, height, 'island');
			expect(padding.left).toBe(padding.right);
			expect(height - padding.top - padding.bottom).toBeGreaterThanOrEqual(140);
			expect(padding.bottom).toBeGreaterThan(presentationCameraPadding(width, height).bottom);
		}
	});

	it('establishes all complete legs including interior bends and separated endpoints', () => {
		const paths = preparePresentationPaths([
			{
				mode: 'ferry',
				coordinates: [
					[73.4, 1.8],
					[73.3, 1.9],
					[73.5, 1.85]
				]
			},
			{
				mode: 'air',
				coordinates: [
					[73.51, 1.86],
					[73.55, 4.19]
				]
			}
		]);
		expect(presentationPathBounds(paths)).toEqual([
			[73.3, 1.8],
			[73.55, 4.19]
		]);
		expect(presentationPathBounds([])).toBeNull();
	});
});

describe('presentation clock', () => {
	it('uses supplied source journey minutes for an accelerated crossing', () => {
		const playback = { durationMs: 16000, clockMinutes: 35 };
		expect(presentationClock(0.5, playback)).toEqual({
			elapsed: '17:30',
			total: '35:00',
			qualification: 'Accelerated journey'
		});
		expect(presentationClock(1.5, playback).elapsed).toBe('35:00');
		expect(presentationClock(-1, playback).elapsed).toBe('00:00');
	});

	it('identifies simulation seconds when a travel duration has not been supplied', () => {
		const playback = { durationMs: 7500 };
		expect(presentationClock(0.5, playback)).toEqual({
			elapsed: '00:04',
			total: '00:08',
			qualification: 'Playback time'
		});
		expect(presentationClock(1, playback).elapsed).toBe('00:08');
	});

	it('falls back to playback time for missing or invalid source durations', () => {
		for (const clockMinutes of [0, -4, NaN, Infinity]) {
			expect(presentationClock(1, { durationMs: 12000, clockMinutes })).toEqual({
				elapsed: '00:12',
				total: '00:12',
				qualification: 'Playback time'
			});
		}
	});

	it('handles invalid progress and playback durations without displaying NaN', () => {
		expect(presentationClock(NaN, { durationMs: 12000 }).elapsed).toBe('00:00');
		for (const durationMs of [0, -5, NaN, Infinity]) {
			expect(presentationClock(0.5, { durationMs })).toEqual({
				elapsed: '00:00',
				total: '00:00',
				qualification: 'Playback time'
			});
		}
	});
});

describe('presenter map geometry', () => {
	it('follows a bent source path and clamps progress at its endpoints', () => {
		const paths = preparePresentationPaths([
			{
				mode: 'bus',
				coordinates: [
					[0, 0],
					[1, 0],
					[1, 1]
				]
			}
		]);
		expect(presentationPosition(paths, 0.25)?.point).toEqual([0.5, 0]);
		expect(presentationPosition(paths, 0.75)?.point).toEqual([1, 0.5]);
		expect(presentationPosition(paths, -2)?.point).toEqual([0, 0]);
		expect(presentationPosition(paths, 2)?.point).toEqual([1, 1]);
	});

	it('retains gaps between separate legs and changes the vehicle mode at a transfer', () => {
		const paths = preparePresentationPaths([
			{
				mode: 'walk',
				coordinates: [
					[0, 0],
					[1, 0]
				]
			},
			{
				mode: 'bus',
				coordinates: [
					[3, 0],
					[4, 0]
				]
			}
		]);
		expect(
			presentationRouteFeatures(paths).features.map((feature) => feature.geometry.coordinates)
		).toEqual([
			[
				[0, 0],
				[1, 0]
			],
			[
				[3, 0],
				[4, 0]
			]
		]);
		const boarded = presentationPosition(paths, 0.75);
		expect(boarded?.point).toEqual([3.5, 0]);
		expect(presentationVehicleFeatures(boarded).features[0].properties?.mode).toBe('bus');
	});

	it('omits incomplete geometry instead of bridging an invalid vertex', () => {
		const paths = preparePresentationPaths([
			{
				mode: 'ferry',
				coordinates: [
					[0, 0],
					[NaN, 0],
					[2, 0]
				]
			},
			{
				mode: 'air',
				coordinates: [
					[1, 1],
					[1, 1]
				]
			},
			{ mode: 'walk', coordinates: [[1, 1]] }
		]);
		expect(paths).toEqual([]);
		expect(presentationPosition(paths, 0.5)).toBeNull();
		expect(presentationVehicleFeatures(null).features).toEqual([]);
	});
});
