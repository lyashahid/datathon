import type { PlanningBaseline, PlanningPosition } from './types.ts';

export interface GraphArc {
	to: number;
	distanceM: number;
	geometry?: [number, number][];
}
export interface NetworkGraph {
	nodes: PlanningBaseline['network']['nodes'];
	walk: GraphArc[][];
	drive: GraphArc[][];
	byId: Map<string, number>;
	walkConnected: boolean[];
	driveConnected: boolean[];
}
export interface PathTree {
	distances: Float64Array;
	previous: Int32Array;
	previousArc: Int32Array;
	mode: 'walk' | 'drive';
	start: number;
}

/** Stable binary min-heap shared by walking, driving and service routing. */
export class MinHeap<T> {
	#items: { value: T; priority: number; order: number }[] = [];
	#order = 0;
	get size() {
		return this.#items.length;
	}
	push(value: T, priority: number) {
		const item = { value, priority, order: this.#order++ };
		this.#items.push(item);
		let i = this.#items.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (!this.#less(item, this.#items[p])) break;
			this.#items[i] = this.#items[p];
			i = p;
		}
		this.#items[i] = item;
	}
	pop(): { value: T; priority: number } | undefined {
		const first = this.#items[0];
		const last = this.#items.pop();
		if (!first || !last) return first;
		if (this.#items.length) {
			let i = 0;
			while (i * 2 + 1 < this.#items.length) {
				let child = i * 2 + 1;
				if (
					child + 1 < this.#items.length &&
					this.#less(this.#items[child + 1], this.#items[child])
				)
					child++;
				if (!this.#less(this.#items[child], last)) break;
				this.#items[i] = this.#items[child];
				i = child;
			}
			this.#items[i] = last;
		}
		return first;
	}
	#less(a: { priority: number; order: number }, b: { priority: number; order: number }) {
		return a.priority < b.priority || (a.priority === b.priority && a.order < b.order);
	}
}

export function distanceM(a: PlanningPosition, b: PlanningPosition): number {
	const rad = Math.PI / 180;
	const lat = (b.lat - a.lat) * rad;
	const lon = (b.lon - a.lon) * rad;
	const h =
		Math.sin(lat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(lon / 2) ** 2;
	return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

const graphCache = new WeakMap<PlanningBaseline['network'], NetworkGraph>();
export function buildNetworkGraph(network: PlanningBaseline['network']): NetworkGraph {
	const cached = graphCache.get(network);
	if (cached) return cached;
	const nodes = network.nodes;
	const byId = new Map(nodes.map((n, i) => [n.id, i]));
	const walk: GraphArc[][] = nodes.map(() => []);
	const drive: GraphArc[][] = nodes.map(() => []);
	const walkConnected = nodes.map(() => false);
	const driveConnected = nodes.map(() => false);
	for (const edge of network.edges) {
		const from = byId.get(edge.from);
		const to = byId.get(edge.to);
		if (
			from === undefined ||
			to === undefined ||
			!Number.isFinite(edge.distanceM) ||
			edge.distanceM <= 0
		)
			continue;
		if (edge.walkAllowed) {
			walk[from].push({ to, distanceM: edge.distanceM, geometry: edge.geometry });
			walk[to].push({
				to: from,
				distanceM: edge.distanceM,
				geometry: edge.geometry ? [...edge.geometry].reverse() : undefined
			});
			walkConnected[from] = walkConnected[to] = true;
		}
		if (edge.driveAllowed) {
			drive[from].push({ to, distanceM: edge.distanceM, geometry: edge.geometry });
			if (!edge.oneway)
				drive[to].push({
					to: from,
					distanceM: edge.distanceM,
					geometry: edge.geometry ? [...edge.geometry].reverse() : undefined
				});
			driveConnected[from] = driveConnected[to] = true;
		}
	}
	for (const list of [...walk, ...drive])
		list.sort((a, b) => a.to - b.to || a.distanceM - b.distanceM);
	const graph = { nodes, byId, walk, drive, walkConnected, driveConnected };
	graphCache.set(network, graph);
	return graph;
}

export function nearestGraphNode(
	graph: NetworkGraph,
	position: PlanningPosition,
	mode: 'walk' | 'drive',
	maxM: number
) {
	let best: { index: number; distanceM: number } | null = null;
	const connected = mode === 'walk' ? graph.walkConnected : graph.driveConnected;
	for (let i = 0; i < graph.nodes.length; i++) {
		if (!connected[i]) continue;
		const d = distanceM(position, graph.nodes[i]);
		if (
			d <= maxM &&
			(!best ||
				d < best.distanceM ||
				(d === best.distanceM && graph.nodes[i].id < graph.nodes[best.index].id))
		)
			best = { index: i, distanceM: d };
	}
	return best;
}

export function shortestPaths(
	graph: NetworkGraph,
	start: number,
	mode: 'walk' | 'drive',
	maxDistanceM = Infinity
): PathTree {
	const distances = new Float64Array(graph.nodes.length).fill(Infinity);
	const previous = new Int32Array(graph.nodes.length).fill(-1);
	const previousArc = new Int32Array(graph.nodes.length).fill(-1);
	const queue = new MinHeap<number>();
	distances[start] = 0;
	queue.push(start, 0);
	while (queue.size) {
		const next = queue.pop()!;
		if (next.priority !== distances[next.value]) continue;
		for (const [arcIndex, arc] of graph[mode][next.value].entries()) {
			const d = next.priority + arc.distanceM;
			if (d <= maxDistanceM && d < distances[arc.to]) {
				distances[arc.to] = d;
				previous[arc.to] = next.value;
				previousArc[arc.to] = arcIndex;
				queue.push(arc.to, d);
			}
		}
	}
	return { distances, previous, previousArc, mode, start };
}

export function pathCoordinates(
	graph: NetworkGraph,
	tree: PathTree,
	to: number
): [number, number][] {
	if (!Number.isFinite(tree.distances[to])) return [];
	const indexes: number[] = [];
	let next = to;
	while (next !== -1) {
		indexes.push(next);
		if (next === tree.start) break;
		next = tree.previous[next];
	}
	indexes.reverse();
	const coordinates: [number, number][] = [
		[graph.nodes[indexes[0]].lon, graph.nodes[indexes[0]].lat]
	];
	for (const index of indexes.slice(1)) {
		const arc = graph[tree.mode][tree.previous[index]][tree.previousArc[index]];
		const segment = arc.geometry ?? [
			[graph.nodes[tree.previous[index]].lon, graph.nodes[tree.previous[index]].lat],
			[graph.nodes[index].lon, graph.nodes[index].lat]
		];
		coordinates.push(...segment.slice(1));
	}
	return coordinates;
}
