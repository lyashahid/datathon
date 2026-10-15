import { describe, it, expect } from 'vitest';
import { coordinatePair, parseScenario } from './scenarios';

describe('scenario import and map input', () => {
	it('rejects empty or impossible coordinates instead of mapping them to zero', () => {
		expect(() => coordinatePair('', 4)).toThrow();
		expect(() => coordinatePair(181, 4)).toThrow();
		expect(coordinatePair('73.5', '4.2')).toEqual([73.5, 4.2]);
	});
	it('rejects corrupted saved scenarios and missing required IDs', () => {
		expect(() =>
			parseScenario('{"id":"a","name":"A","operations":[{"type":"road_closure"}]}')
		).toThrow('target ID');
		expect(() => parseScenario('null')).toThrow();
		expect(() =>
			parseScenario('{"id":"a","name":"A","operations":[{"type":"invented"}]}')
		).toThrow();
	});
	it('accepts a backend-compatible multi-operation import', () => {
		const value = {
			id: 'a',
			name: 'A',
			operations: [
				{ type: 'add_bus_stop', island_id: 'island:1', coordinates: [73.5, 4.2] },
				{ type: 'weather_disruption', disabled_modes: ['car'] }
			]
		};
		expect(parseScenario(JSON.stringify(value))).toEqual(value);
	});
	it('rejects coerced coordinates before they can corrupt a persisted draft', () => {
		for (const coordinates of [
			['73.5', 4.2],
			[null, 4.2],
			[true, 4.2],
			[73.5, 91]
		]) {
			expect(() =>
				parseScenario(
					JSON.stringify({
						id: 'a',
						name: 'A',
						operations: [{ type: 'add_bus_stop', coordinates }]
					})
				)
			).toThrow('numeric');
		}
		expect(() =>
			parseScenario(
				JSON.stringify({
					id: 'a',
					name: 'A',
					operations: [
						{ type: 'weather_disruption', disabled_modes: ['marine'], coordinates: ['73.5', 4.2] }
					]
				})
			)
		).toThrow('numeric');
	});
	it('round-trips nullable optional fields emitted by backend recommendations', () => {
		const value = {
			id: 'a',
			name: 'A',
			metadata: {},
			operations: [
				{
					type: 'add_bus_stop',
					island_id: 'island:1',
					coordinates: [73.5, 4.2],
					target_id: null,
					from_node_id: null,
					to_node_id: null,
					distance_m: null,
					mode: null,
					passenger_eligible: true,
					bidirectional: true,
					disabled_modes: [],
					metadata: {}
				}
			]
		};
		expect(parseScenario(JSON.stringify(value))).toEqual(value);
	});
	it('rejects malformed fields and unsupported keys with readable errors', () => {
		for (const operation of [
			{ type: ['add_bus_stop'], coordinates: [73.5, 4.2] },
			{ type: 'road_closure', target_id: 3 },
			{ type: 'weather_disruption', disabled_modes: 'marine' },
			{ type: 'weather_disruption', disabled_modes: ['marine'], metadata: null },
			{ type: 'add_bus_stop', coordinates: [73.5, 4.2], unexpected: true }
		]) {
			expect(() =>
				parseScenario(JSON.stringify({ id: 'a', name: 'A', operations: [operation] }))
			).toThrow();
		}
	});
});
