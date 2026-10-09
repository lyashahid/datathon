import { createContext } from 'svelte';
import { getDisruption, NORMAL_CONDITIONS } from '#lib/config/disruptionScenarios.ts';
import { assessCriticality } from '#lib/analysis/criticality.ts';
import { buildAccessibilityGrid } from '#lib/analysis/h3Grid.ts';
import { compareGrids } from '#lib/analysis/impact.ts';
import type { CriticalityResult } from '#lib/types/criticality.ts';
import type { DisruptionId } from '#lib/types/disruption.ts';
import type { InfrastructureFeature } from '#lib/types/domain.ts';
import type { H3BaseCell, H3Grid } from '#lib/types/h3.ts';
import type { GridImpact } from '#lib/types/impact.ts';

/**
 * The analytical grid for the active view, plus the grids it is compared against.
 * Demographics never change; accessibility re-derives whenever the effective infrastructure
 * or the planning disruption changes.
 *
 * - `grid`: effective infrastructure under the selected disruption (what every view shows).
 * - `impact`: scenario edits versus baseline, both under the same disruption.
 * - `disruptionImpact`: the disruption versus normal operations, same infrastructure.
 * - `criticality`: single-closure test of every scored facility; derived lazily, so the sweep
 *   only runs while something (inspector, exposure view) reads it.
 */
export class AnalysisGridState {
	// Initialised for the type checker; set in the constructor before any derived value is read.
	readonly #base: readonly H3BaseCell[] = [];
	readonly #baselineInfrastructure: readonly InfrastructureFeature[] = [];
	readonly #infrastructure: () => readonly InfrastructureFeature[] = () => [];
	readonly #disruptionId: () => DisruptionId = () => 'normal';
	/** Baseline under normal operations never changes, so it is computed once. */
	readonly #normalBaseline: H3Grid = buildAccessibilityGrid([], []);

	readonly disruption = $derived(getDisruption(this.#disruptionId()));
	readonly #disrupted = $derived(this.disruption.id !== 'normal');

	readonly normalGrid: H3Grid = $derived(
		buildAccessibilityGrid(this.#base, this.#infrastructure(), NORMAL_CONDITIONS)
	);
	readonly grid: H3Grid = $derived(
		this.#disrupted
			? buildAccessibilityGrid(this.#base, this.#infrastructure(), this.disruption.conditions)
			: this.normalGrid
	);
	readonly baselineGrid: H3Grid = $derived(
		this.#disrupted
			? buildAccessibilityGrid(this.#base, this.#baselineInfrastructure, this.disruption.conditions)
			: this.#normalBaseline
	);
	readonly impact: GridImpact = $derived(compareGrids(this.baselineGrid, this.grid));
	readonly disruptionImpact: GridImpact | null = $derived(
		this.#disrupted ? compareGrids(this.normalGrid, this.grid) : null
	);
	readonly criticality: CriticalityResult = $derived(
		assessCriticality(this.#base, this.#infrastructure(), this.grid, this.disruption.conditions)
	);

	constructor(
		base: readonly H3BaseCell[],
		baselineInfrastructure: readonly InfrastructureFeature[],
		infrastructure: () => readonly InfrastructureFeature[],
		disruption: () => DisruptionId = () => 'normal'
	) {
		this.#base = base;
		this.#baselineInfrastructure = baselineInfrastructure;
		this.#infrastructure = infrastructure;
		this.#disruptionId = disruption;
		this.#normalBaseline = buildAccessibilityGrid(base, baselineInfrastructure);
	}
}

export const [getAnalysisGrid, setAnalysisGrid] = createContext<AnalysisGridState>();
