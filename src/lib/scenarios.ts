import type { Coordinates, OperationType, Scenario, ScenarioOperation } from './types';

export const operationLabels: Record<OperationType, string> = {
	add_bus_stop: 'Add a bus stop',
	move_bus_stop: 'Move a bus stop',
	remove_bus_stop: 'Remove a bus stop',
	add_ferry_terminal: 'Add a ferry terminal',
	move_ferry_terminal: 'Move a ferry terminal',
	disable_ferry_terminal: 'Disable a ferry terminal',
	add_ferry_route: 'Add a ferry connection',
	remove_ferry_route: 'Remove a ferry connection',
	change_ferry_route: 'Change a ferry connection',
	add_parking: 'Add parking',
	add_park_and_ride: 'Add park and ride',
	add_mobility_hub: 'Add a mobility hub',
	road_closure: 'Close a road',
	pedestrian_connection: 'Add a pedestrian connection',
	airport_access_improvement: 'Improve airport access',
	weather_disruption: 'Restrict modes for disruption'
};
export const needsCoordinates = (type: OperationType) =>
	[
		'add_bus_stop',
		'move_bus_stop',
		'add_ferry_terminal',
		'move_ferry_terminal',
		'add_parking',
		'add_park_and_ride',
		'add_mobility_hub'
	].includes(type);
export const needsTarget = (type: OperationType) =>
	[
		'move_bus_stop',
		'remove_bus_stop',
		'move_ferry_terminal',
		'disable_ferry_terminal',
		'remove_ferry_route',
		'change_ferry_route',
		'road_closure'
	].includes(type);
export const needsNodes = (type: OperationType) =>
	[
		'add_ferry_route',
		'change_ferry_route',
		'pedestrian_connection',
		'airport_access_improvement'
	].includes(type);
export function coordinatePair(longitude: string | number, latitude: string | number): Coordinates {
	if (String(longitude).trim() === '' || String(latitude).trim() === '')
		throw new Error('Choose a location on the map or enter both coordinates.');
	const lon = Number(longitude),
		lat = Number(latitude);
	if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90)
		throw new Error('Enter valid longitude and latitude values.');
	return [lon, lat];
}
export function validateOperation(value: unknown): asserts value is ScenarioOperation {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('An operation must be an object.');
	const operation = value as ScenarioOperation;
	const allowedFields = new Set([
		'type',
		'island_id',
		'coordinates',
		'target_id',
		'from_node_id',
		'to_node_id',
		'distance_m',
		'mode',
		'passenger_eligible',
		'bidirectional',
		'disabled_modes',
		'metadata'
	]);
	if (Object.keys(operation).some((key) => !allowedFields.has(key)))
		throw new Error('An operation contains unsupported fields.');
	if (typeof operation.type !== 'string' || !Object.hasOwn(operationLabels, operation.type))
		throw new Error('Unknown scenario operation.');
	for (const field of ['island_id', 'target_id', 'from_node_id', 'to_node_id', 'mode'] as const) {
		if (operation[field] != null && typeof operation[field] !== 'string')
			throw new Error(`${field} must be a string.`);
	}
	if (
		operation.coordinates != null &&
		(!Array.isArray(operation.coordinates) ||
			operation.coordinates.length !== 2 ||
			operation.coordinates.some(
				(coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate)
			) ||
			Math.abs(operation.coordinates[0]) > 180 ||
			Math.abs(operation.coordinates[1]) > 90)
	)
		throw new Error('Coordinates must contain valid numeric longitude and latitude values.');
	if (needsCoordinates(operation.type) && operation.coordinates == null)
		throw new Error('This operation needs a coordinate pair.');
	if (needsTarget(operation.type) && !operation.target_id?.trim())
		throw new Error('This operation needs a target ID.');
	if (
		needsNodes(operation.type) &&
		(!operation.from_node_id?.trim() || !operation.to_node_id?.trim())
	)
		throw new Error('This connection needs two graph node IDs.');
	if (
		operation.disabled_modes !== undefined &&
		(!Array.isArray(operation.disabled_modes) ||
			operation.disabled_modes.some((mode) => typeof mode !== 'string'))
	)
		throw new Error('Restricted modes must be an array of strings.');
	if (operation.type === 'weather_disruption' && !operation.disabled_modes?.length)
		throw new Error('Choose at least one mode to restrict.');
	if (
		operation.distance_m != null &&
		(typeof operation.distance_m !== 'number' ||
			!Number.isFinite(operation.distance_m) ||
			operation.distance_m <= 0)
	)
		throw new Error('Connection distance must be positive.');
	for (const field of ['passenger_eligible', 'bidirectional'] as const) {
		if (operation[field] !== undefined && typeof operation[field] !== 'boolean')
			throw new Error(`${field} must be a boolean.`);
	}
	if (
		operation.metadata !== undefined &&
		(!operation.metadata ||
			typeof operation.metadata !== 'object' ||
			Array.isArray(operation.metadata))
	)
		throw new Error('Operation metadata must be an object.');
}
export function parseScenario(text: string): Scenario {
	const value = JSON.parse(text) as Scenario;
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		typeof value.id !== 'string' ||
		!value.id.trim() ||
		value.id.length > 120 ||
		typeof value.name !== 'string' ||
		!value.name.trim() ||
		value.name.length > 200 ||
		!Array.isArray(value.operations) ||
		value.operations.length > 100
	)
		throw new Error('Choose a scenario JSON with an ID, name, and at most 100 operations.');
	if (Object.keys(value).some((key) => !['id', 'name', 'operations', 'metadata'].includes(key)))
		throw new Error('The scenario contains unsupported fields.');
	if (
		value.metadata !== undefined &&
		(!value.metadata || typeof value.metadata !== 'object' || Array.isArray(value.metadata))
	)
		throw new Error('Scenario metadata must be an object.');
	value.operations.forEach(validateOperation);
	return value;
}
export const newScenario = (): Scenario => ({
	id: `option-${Date.now()}`,
	name: 'My mobility option',
	operations: []
});
