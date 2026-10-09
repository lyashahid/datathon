import { createContext } from 'svelte';
import { recommendBusStops } from '#lib/analysis/candidates.ts';
import { DEFAULT_BUS_STOP_WEIGHTS, type BusStopWeights } from '#lib/config/busStopScoring.ts';
import type { CandidateSearchResult } from '#lib/types/candidates.ts';
import type { InfrastructureFeature, Position, TransportRoute } from '#lib/types/domain.ts';
import type { H3Grid, H3Index } from '#lib/types/h3.ts';

export interface CandidateSearchDeps {
	grid(): H3Grid;
	infrastructure(): readonly InfrastructureFeature[];
	routes(): readonly TransportRoute[];
	weights(): BusStopWeights;
	islandAt(position: Position): string | null;
}

/**
 * The active bus-stop candidate search. Only the origin cell is state; results are derived, so
 * they re-rank immediately when the scenario or the planning priorities change.
 */
export class CandidateSearchState {
	readonly #deps: CandidateSearchDeps = {
		grid: () => ({
			resolution: 0,
			cells: [],
			get: () => undefined,
			totals: { population: 0, underservedPopulation: 0 }
		}),
		infrastructure: () => [],
		routes: () => [],
		weights: () => DEFAULT_BUS_STOP_WEIGHTS,
		islandAt: () => null
	};

	origin = $state<H3Index | null>(null);

	readonly result: CandidateSearchResult | null = $derived.by(() => {
		if (!this.origin) return null;
		const cell = this.#deps.grid().get(this.origin);
		if (!cell) return null;
		return recommendBusStops({
			origin: cell,
			grid: this.#deps.grid(),
			infrastructure: this.#deps.infrastructure(),
			routes: this.#deps.routes(),
			weights: this.#deps.weights(),
			islandAt: (p) => this.#deps.islandAt(p)
		});
	});

	constructor(deps: CandidateSearchDeps) {
		this.#deps = deps;
	}

	start(origin: H3Index): void {
		this.origin = origin;
	}

	close(): void {
		this.origin = null;
	}

	get(id: string) {
		return this.result?.candidates.find((c) => c.id === id);
	}
}

export const [getCandidateSearch, setCandidateSearch] = createContext<CandidateSearchState>();
