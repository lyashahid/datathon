import { createDefaultAssumptions, PLANNING_MODEL_VERSION } from './defaults.ts';
import { analyzePlanning } from './engine.ts';
import type { PlanningAction, PlanningAssumptions, PlanningBaseline } from './types.ts';
import { validSavedActions, validPlanningAssumptions } from './validation.ts';

export const PLANNING_STORAGE_KEY = 'mobility-planning-scenario-v1';
export const PLANNING_ARCHIVE_PREFIX = `${PLANNING_STORAGE_KEY}:archive:`;
export const PLANNING_LAST_ARCHIVE_KEY = `${PLANNING_STORAGE_KEY}:last-archive`;
export interface SavedPlanningScenario {
	schemaVersion: 1;
	datasetVersion: string;
	modelVersion: string;
	actions: readonly PlanningAction[];
	assumptions: PlanningAssumptions;
}
type StateResult = { ok: true } | { ok: false; reason: string };

/** Reactive planning history is independent of the legacy proximity simulator. */
export class PlanningScenarioState {
	readonly baseline: PlanningBaseline;
	actions = $state.raw<readonly PlanningAction[]>([]);
	assumptions = $state.raw<PlanningAssumptions>(null!);
	#past = $state.raw<{ actions: readonly PlanningAction[]; assumptions: PlanningAssumptions }[]>(
		[]
	);
	#future = $state.raw<{ actions: readonly PlanningAction[]; assumptions: PlanningAssumptions }[]>(
		[]
	);
	#archivedProposalJson = $state.raw<string | null>(null);
	constructor(baseline: PlanningBaseline) {
		this.baseline = baseline;
		this.assumptions = createDefaultAssumptions(baseline);
	}
	get canUndo() {
		return this.#past.length > 0;
	}
	get canRedo() {
		return this.#future.length > 0;
	}
	/** Exact rejected bytes are recoverable for download after safe browser archival. */
	get archivedProposalJson(): string | null {
		return this.#archivedProposalJson;
	}
	/** Start the visible session at its initialized/restored state, without undoing setup. */
	clearHistory() {
		this.#past = [];
		this.#future = [];
	}
	/** Prefer the worker in the UI. This getter also supports deterministic tests/exports. */
	get analysis() {
		return analyzePlanning(this.baseline, this.actions, this.assumptions!);
	}
	addAction(action: PlanningAction) {
		this.#remember();
		this.actions = [...this.actions, structuredClone(action)];
	}
	replaceActions(actions: readonly PlanningAction[]) {
		this.#remember();
		this.actions = structuredClone(actions);
	}
	setAssumptions(patch: Partial<PlanningAssumptions>) {
		this.#remember();
		this.assumptions = { ...this.assumptions!, ...structuredClone(patch) };
	}
	reset() {
		this.#remember();
		this.actions = [];
	}
	/** Restore a fresh planning session, with the whole previous proposal recoverable in one Undo. */
	resetToDefaults(assumptions: PlanningAssumptions = createDefaultAssumptions(this.baseline)) {
		this.#remember();
		this.actions = [];
		this.assumptions = structuredClone(assumptions);
	}
	undo() {
		const previous = this.#past.at(-1);
		if (!previous) return false;
		this.#future = [{ actions: this.actions, assumptions: this.assumptions! }, ...this.#future];
		this.#past = this.#past.slice(0, -1);
		this.actions = previous.actions;
		this.assumptions = previous.assumptions;
		return true;
	}
	redo() {
		const next = this.#future[0];
		if (!next) return false;
		this.#past = [...this.#past, { actions: this.actions, assumptions: this.assumptions! }];
		this.#future = this.#future.slice(1);
		this.actions = next.actions;
		this.assumptions = next.assumptions;
		return true;
	}
	exportJson(): string {
		return JSON.stringify(
			{
				schemaVersion: 1,
				datasetVersion: this.baseline.version,
				modelVersion: PLANNING_MODEL_VERSION,
				actions: this.actions,
				assumptions: this.assumptions
			} satisfies SavedPlanningScenario,
			null,
			2
		);
	}
	importJson(json: string): StateResult {
		try {
			const saved = JSON.parse(json) as SavedPlanningScenario;
			if (
				saved.schemaVersion !== 1 ||
				saved.datasetVersion !== this.baseline.version ||
				saved.modelVersion !== PLANNING_MODEL_VERSION
			)
				return {
					ok: false,
					reason:
						'Saved scenario uses a different data or model version. Recreate it against this baseline.'
				};
			if (!validSavedActions(saved.actions) || !validPlanningAssumptions(saved.assumptions))
				return { ok: false, reason: 'Invalid saved scenario actions or assumptions.' };
			this.#remember();
			this.actions = structuredClone(saved.actions);
			this.assumptions = { ...createDefaultAssumptions(this.baseline), ...saved.assumptions };
			return { ok: true };
		} catch {
			return { ok: false, reason: 'The scenario file is not valid JSON.' };
		}
	}
	save(storage?: Storage): StateResult {
		try {
			const target = storage ?? localStorage;
			// Preserve a previous data/model version before autosave starts the new session.
			this.#archiveIncompatible(target);
			target.setItem(PLANNING_STORAGE_KEY, this.exportJson());
			return { ok: true };
		} catch {
			return {
				ok: false,
				reason: 'Browser storage is unavailable. Export the scenario JSON instead.'
			};
		}
	}
	load(storage?: Storage): StateResult {
		try {
			const target = storage ?? localStorage;
			this.#restoreArchivedProposal(target);
			const json = target.getItem(PLANNING_STORAGE_KEY);
			if (!json) return { ok: false, reason: 'No saved scenario exists.' };
			const result = this.importJson(json);
			if (!result.ok) {
				const archived = this.#archiveIncompatible(target);
				if (archived) {
					this.#archivedProposalJson = json;
					return {
						ok: false,
						reason: `${result.reason} The previous proposal is preserved in this browser's version archive.`
					};
				}
			}
			return result;
		} catch {
			return { ok: false, reason: 'Browser storage is unavailable.' };
		}
	}
	#restoreArchivedProposal(storage: Storage) {
		try {
			const key = storage.getItem(PLANNING_LAST_ARCHIVE_KEY);
			if (!key?.startsWith(PLANNING_ARCHIVE_PREFIX)) return;
			const json = storage.getItem(key);
			if (json !== null) this.#archivedProposalJson = json;
		} catch {
			// A missing/unreadable recovery pointer must not prevent loading the current proposal.
		}
	}
	#archiveIncompatible(storage: Storage): string | undefined {
		const json = storage.getItem(PLANNING_STORAGE_KEY);
		if (!json) return;
		let dataset = 'unreadable';
		let model = 'unreadable';
		let schema = 'unreadable';
		try {
			const saved = JSON.parse(json) as Partial<SavedPlanningScenario>;
			if (
				saved.schemaVersion === 1 &&
				saved.datasetVersion === this.baseline.version &&
				saved.modelVersion === PLANNING_MODEL_VERSION
			)
				return;
			dataset = String(saved.datasetVersion ?? 'unknown');
			model = String(saved.modelVersion ?? 'unknown');
			schema = String(saved.schemaVersion ?? 'unknown');
		} catch {
			// Even an unreadable old value must not be silently destroyed by autosave.
		}
		const base = `${PLANNING_ARCHIVE_PREFIX}${encodeURIComponent(dataset)}:${encodeURIComponent(model)}:${encodeURIComponent(schema)}`;
		let key = base;
		let suffix = 0;
		while (storage.getItem(key) !== null && storage.getItem(key) !== json)
			key = `${base}:${++suffix}`;
		if (storage.getItem(key) !== json) storage.setItem(key, json);
		storage.setItem(PLANNING_LAST_ARCHIVE_KEY, key);
		return key;
	}
	#remember() {
		this.#past = [
			...this.#past.slice(-49),
			{ actions: this.actions, assumptions: this.assumptions! }
		];
		this.#future = [];
	}
}
