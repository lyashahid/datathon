import { createContext } from 'svelte';
import {
	checkChange,
	deriveEffectiveState,
	type BaselineData
} from '#lib/simulator/scenarioEngine.ts';
import type {
	AssetMetadata,
	AssetRef,
	InfrastructureId,
	InfrastructureType,
	Position
} from '#lib/types/domain.ts';
import type {
	EffectiveState,
	Scenario,
	ScenarioAnalysisSettings,
	ScenarioChange,
	ScenarioId
} from '#lib/types/scenario.ts';
import { deepFreeze } from '#lib/utils/freeze.ts';

/** Side effects the store needs, injectable so tests (and replays) are deterministic. */
export interface ScenarioStoreDeps {
	now(): string;
	createId(prefix: string): string;
}

const defaultDeps: ScenarioStoreDeps = {
	now: () => new Date().toISOString(),
	createId: (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`
};

export type ScenarioResult<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

export interface NewInfrastructure {
	name: string;
	type: InfrastructureType;
	position: Position;
	metadata?: AssetMetadata;
}

type ChangeList = readonly ScenarioChange[];

interface History {
	past: readonly ChangeList[];
	future: readonly ChangeList[];
}

const EMPTY_HISTORY: History = { past: [], future: [] };
const BASELINE_READ_ONLY = 'The baseline is read-only. Create or select a scenario first.';

type ChangeDraft = ScenarioChange extends infer C
	? C extends ScenarioChange
		? Omit<C, 'id' | 'createdAt'>
		: never
	: never;

const NO_CHANGES: ChangeList = [];

/**
 * Owns all scenarios and the active selection. Every edit becomes a ScenarioChange appended to
 * the active scenario; the effective world is always derived, never stored. Undo/redo keep
 * snapshots of the change list per scenario, so resets are undoable too.
 */
export class ScenarioStore {
	// Initialised for the type checker; set in the constructor before any derived value is read.
	readonly #baseline: BaselineData = { infrastructure: [], routes: [] };
	readonly #deps: ScenarioStoreDeps;

	scenarios = $state.raw<readonly Scenario[]>([]);
	/** null means baseline mode. */
	activeId = $state<ScenarioId | null>(null);
	#history = $state.raw<Readonly<Record<ScenarioId, History>>>({});
	/** Analysis settings used in baseline mode, where there is no scenario to store them on. */
	#sessionSettings = $state.raw<ScenarioAnalysisSettings>({});

	readonly active = $derived(this.scenarios.find((s) => s.id === this.activeId) ?? null);
	readonly isBaseline = $derived(this.active === null);
	// Renames and analysis settings replace the scenario object but keep its change list; going
	// through the list's identity stops those from rebuilding the world, grid and map sources.
	readonly #changes = $derived(this.active?.changes ?? NO_CHANGES);
	readonly effective: EffectiveState = $derived(
		deriveEffectiveState(this.#baseline, this.#changes)
	);
	readonly canUndo = $derived(
		this.active !== null && (this.#history[this.active.id]?.past.length ?? 0) > 0
	);
	readonly canRedo = $derived(
		this.active !== null && (this.#history[this.active.id]?.future.length ?? 0) > 0
	);

	/** The immutable baseline, for read-only views such as compare mode. */
	get baseline(): BaselineData {
		return this.#baseline;
	}

	constructor(baseline: BaselineData, deps: ScenarioStoreDeps = defaultDeps) {
		this.#baseline = baseline;
		this.#deps = deps;
	}

	// ── Scenario management ─────────────────────────────────────────────

	selectBaseline(): void {
		this.activeId = null;
	}

	selectScenario(id: ScenarioId): ScenarioResult {
		if (!this.#find(id)) return { ok: false, reason: `Unknown scenario "${id}"` };
		this.activeId = id;
		return { ok: true };
	}

	createScenario(name?: string, description = ''): ScenarioId {
		const now = this.#deps.now();
		const scenario: Scenario = {
			id: this.#deps.createId('scn'),
			name: name?.trim() || this.#nextDefaultName(),
			description,
			changes: [],
			// Priorities tuned in baseline mode carry into the scenario they lead to.
			analysisSettings: { ...this.#sessionSettings },
			createdAt: now,
			updatedAt: now
		};
		this.scenarios = [...this.scenarios, deepFreeze(scenario)];
		this.activeId = scenario.id;
		return scenario.id;
	}

	/**
	 * Returns the active scenario id, creating one first when in baseline mode. Used by direct
	 * map edits so the user never has to stop and create a scenario by hand; the baseline itself
	 * is never edited.
	 */
	ensureScenario(): ScenarioId {
		return this.activeId ?? this.createScenario();
	}

	duplicateScenario(id: ScenarioId | null = this.activeId): ScenarioResult<{ id: ScenarioId }> {
		const source = id ? this.#find(id) : undefined;
		if (!source) return { ok: false, reason: 'Select a scenario to duplicate' };
		const now = this.#deps.now();
		const copy: Scenario = {
			...source,
			id: this.#deps.createId('scn'),
			name: `${source.name} (copy)`,
			createdAt: now,
			updatedAt: now
		};
		this.scenarios = [...this.scenarios, deepFreeze(copy)];
		this.activeId = copy.id;
		return { ok: true, id: copy.id };
	}

	renameScenario(id: ScenarioId, name: string): ScenarioResult {
		const trimmed = name.trim();
		if (!trimmed) return { ok: false, reason: 'Scenario name cannot be empty' };
		if (!this.#find(id)) return { ok: false, reason: `Unknown scenario "${id}"` };
		this.#update(id, (s) => ({ ...s, name: trimmed }));
		return { ok: true };
	}

	/** Clears every change; undoable. */
	resetScenario(id: ScenarioId | null = this.activeId): ScenarioResult {
		const scenario = id ? this.#find(id) : undefined;
		if (!scenario) return { ok: false, reason: BASELINE_READ_ONLY };
		if (scenario.changes.length > 0) this.#setChanges(scenario.id, []);
		return { ok: true };
	}

	// ── Analysis settings (tuning, not infrastructure changes) ──────────

	get analysisSettings(): ScenarioAnalysisSettings {
		return this.active?.analysisSettings ?? this.#sessionSettings;
	}

	/** Stored on the active scenario (or the session in baseline mode); not part of undo history. */
	setAnalysisSettings(patch: ScenarioAnalysisSettings): void {
		const active = this.active;
		if (!active) {
			this.#sessionSettings = { ...this.#sessionSettings, ...patch };
			return;
		}
		this.#update(active.id, (s) => ({
			...s,
			analysisSettings: { ...s.analysisSettings, ...patch }
		}));
	}

	// ── Edits (each appends one ScenarioChange) ─────────────────────────

	addInfrastructure(input: NewInfrastructure): ScenarioResult<{ id: InfrastructureId }> {
		const name = input.name.trim();
		if (!name) return { ok: false, reason: 'Name cannot be empty' };
		const id = this.#deps.createId('proposed');
		const result = this.#commit({
			kind: 'add',
			feature: {
				id,
				name,
				type: input.type,
				status: 'proposed',
				geometry: { type: 'Point', coordinates: [input.position[0], input.position[1]] },
				source: {
					provenance: 'simulated',
					dataset: this.activeId ?? 'baseline',
					syntheticFields: [],
					note: 'Proposed in a scenario; not real infrastructure.'
				},
				metadata: { ...input.metadata }
			}
		});
		return result.ok ? { ok: true, id } : result;
	}

	moveInfrastructure(id: InfrastructureId, to: Position): ScenarioResult {
		const current = this.effective.getInfrastructure(id);
		if (!current) return { ok: false, reason: `infrastructure "${id}" does not exist` };
		return this.#commit({
			kind: 'move',
			target: { kind: 'infrastructure', id },
			from: [...current.geometry.coordinates],
			to: [to[0], to[1]]
		});
	}

	disableAsset(target: AssetRef): ScenarioResult {
		return this.#commit({ kind: 'disable', target });
	}

	/** Withdraws a proposal added in this scenario. Baseline assets must be disabled instead. */
	removeProposed(id: InfrastructureId): ScenarioResult {
		return this.#commit({ kind: 'remove', target: { kind: 'infrastructure', id } });
	}

	restoreAsset(target: AssetRef): ScenarioResult {
		return this.#commit({ kind: 'restore', target });
	}

	// ── History ─────────────────────────────────────────────────────────

	undo(): boolean {
		const scenario = this.active;
		const history = scenario ? this.#history[scenario.id] : undefined;
		if (!scenario || !history || history.past.length === 0) return false;
		const previous = history.past[history.past.length - 1];
		this.#writeHistory(scenario.id, {
			past: history.past.slice(0, -1),
			future: [scenario.changes, ...history.future]
		});
		this.#update(scenario.id, (s) => ({ ...s, changes: previous }));
		return true;
	}

	redo(): boolean {
		const scenario = this.active;
		const history = scenario ? this.#history[scenario.id] : undefined;
		if (!scenario || !history || history.future.length === 0) return false;
		const [next, ...rest] = history.future;
		this.#writeHistory(scenario.id, { past: [...history.past, scenario.changes], future: rest });
		this.#update(scenario.id, (s) => ({ ...s, changes: next }));
		return true;
	}

	// ── Internals ───────────────────────────────────────────────────────

	#commit(draft: ChangeDraft): ScenarioResult {
		const scenario = this.active;
		if (!scenario) return { ok: false, reason: BASELINE_READ_ONLY };
		const change = deepFreeze({
			...draft,
			id: this.#deps.createId('chg'),
			createdAt: this.#deps.now()
		} as ScenarioChange);
		const problem = checkChange(this.#baseline, scenario.changes, change);
		if (problem) return { ok: false, reason: problem };
		this.#setChanges(scenario.id, [...scenario.changes, change]);
		return { ok: true };
	}

	/** Records the current list for undo, clears redo, and stores the new list. */
	#setChanges(id: ScenarioId, next: ChangeList): void {
		const scenario = this.#find(id);
		if (!scenario) return;
		const history = this.#history[id] ?? EMPTY_HISTORY;
		this.#writeHistory(id, { past: [...history.past, scenario.changes], future: [] });
		this.#update(id, (s) => ({ ...s, changes: next }));
	}

	#writeHistory(id: ScenarioId, history: History): void {
		this.#history = { ...this.#history, [id]: history };
	}

	#update(id: ScenarioId, fn: (s: Scenario) => Scenario): void {
		const now = this.#deps.now();
		this.scenarios = this.scenarios.map((s) =>
			s.id === id ? deepFreeze({ ...fn(s), updatedAt: now }) : s
		);
	}

	#find(id: ScenarioId): Scenario | undefined {
		return this.scenarios.find((s) => s.id === id);
	}

	#nextDefaultName(): string {
		const names = this.scenarios.map((s) => s.name);
		let n = this.scenarios.length + 1;
		while (names.includes(`Scenario ${n}`)) n++;
		return `Scenario ${n}`;
	}
}

export const [getScenarioStore, setScenarioStore] = createContext<ScenarioStore>();
