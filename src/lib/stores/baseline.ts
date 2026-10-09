import type {
	DatasetInfo,
	InfrastructureCollection,
	InfrastructureFeature,
	InfrastructureId,
	RouteCollection,
	RouteId,
	TransportRoute
} from '#lib/types/domain.ts';
import { deepFreeze } from '#lib/utils/freeze.ts';

/**
 * The immutable baseline world. Frozen on construction so nothing (scenario code included)
 * can mutate it; scenarios derive new views instead.
 */
export class Baseline {
	readonly infrastructure: readonly InfrastructureFeature[];
	readonly routes: readonly TransportRoute[];
	readonly datasets: readonly DatasetInfo[];
	readonly #infrastructureById: ReadonlyMap<InfrastructureId, InfrastructureFeature>;
	readonly #routesById: ReadonlyMap<RouteId, TransportRoute>;
	readonly #routesByStop: ReadonlyMap<InfrastructureId, readonly TransportRoute[]>;

	constructor(infrastructure: InfrastructureCollection, routes: RouteCollection) {
		this.infrastructure = deepFreeze([...infrastructure.features]);
		this.routes = deepFreeze([...routes.routes]);
		this.datasets = deepFreeze(
			infrastructure.dataset.id === routes.dataset.id
				? [infrastructure.dataset]
				: [infrastructure.dataset, routes.dataset]
		);
		this.#infrastructureById = new Map(this.infrastructure.map((f) => [f.id, f]));
		this.#routesById = new Map(this.routes.map((r) => [r.id, r]));
		const byStop = new Map<InfrastructureId, TransportRoute[]>();
		for (const route of this.routes) {
			for (const stopId of new Set(route.stopIds)) {
				byStop.set(stopId, [...(byStop.get(stopId) ?? []), route]);
			}
		}
		this.#routesByStop = byStop;
	}

	getInfrastructure(id: InfrastructureId): InfrastructureFeature | undefined {
		return this.#infrastructureById.get(id);
	}

	getRoute(id: RouteId): TransportRoute | undefined {
		return this.#routesById.get(id);
	}

	/** Routes that list this facility as a stop. */
	routesServing(id: InfrastructureId): readonly TransportRoute[] {
		return this.#routesByStop.get(id) ?? [];
	}
}
