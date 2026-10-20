import type { PlanningIslandImpact } from './proposal-review.js';
import {
	changedIslandConnections,
	changedTransportLines,
	type TransportServiceMetrics
} from './transport-impact.js';

export type IslandServiceChange = {
	id: string;
	name: string;
	mode: string;
	detail: string;
	before?: TransportServiceMetrics | null;
	after?: TransportServiceMetrics | null;
};

/** Show departures from this island; the return direction belongs to the other island's result. */
export function islandServiceChanges(island: PlanningIslandImpact): IslandServiceChange[] {
	const impact = island.transport_connectivity?.impact;
	const connections = changedIslandConnections(impact)
		.filter((connection) => connection.from_island_id === island.island_id)
		.map((connection) => ({
			id: `connection:${connection.id}`,
			name: `To ${connection.to_island_name}`,
			mode: connection.mode,
			detail: 'Departing this island',
			before: connection.before,
			after: connection.after
		}));
	// Inter-island services are represented by directed connections above. Only local bus
	// lines belong here, preventing the same ferry or bridge journey being counted twice.
	const local = changedTransportLines(impact)
		.filter(
			(line) =>
				line.mode === 'bus' &&
				line.island_ids?.includes(island.island_id) &&
				line.island_ids.every((identity) => identity === island.island_id)
		)
		.map((line) => ({
			id: `line:${line.id}`,
			name: line.name,
			mode: line.mode,
			detail:
				line.from_stop_name && line.to_stop_name
					? `${line.from_stop_name} → ${line.to_stop_name}`
					: 'Local bus timetable',
			before: line.before,
			after: line.after
		}));
	return [...connections, ...local];
}
