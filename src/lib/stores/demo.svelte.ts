import { createContext, tick } from 'svelte';
import { DEMO_CONFIG } from '#lib/config/demo.ts';
import { DEMO_STEPS, DemoStepError, type DemoContext } from '#lib/demo/script.ts';

type Deps = Omit<DemoContext, 'click'>;

/**
 * Demo Mode: walks the real simulator through a fixed narrative. It only calls the stores and
 * clicks the controls a presenter would; it never sets a score or injects data.
 */
export class DemoState {
	readonly #deps: Deps;
	active = $state(false);
	/** Index into DEMO_STEPS of the step currently shown. */
	step = $state(0);
	running = $state(false);
	error = $state<string | null>(null);

	readonly steps = DEMO_STEPS;
	readonly current = $derived(DEMO_STEPS[this.step]);

	constructor(deps: Deps) {
		this.#deps = deps;
	}

	#context(): DemoContext {
		return { ...this.#deps, click: (id) => clickControl(id) };
	}

	async #run(indexes: readonly number[]): Promise<void> {
		this.running = true;
		this.error = null;
		try {
			for (const i of indexes) {
				this.step = i;
				// Several steps use inspector controls; make sure the presenter can see them.
				this.#deps.ui.setPanelOpen('right', true);
				await DEMO_STEPS[i].run(this.#context());
				await tick();
			}
		} catch (e) {
			this.error =
				e instanceof DemoStepError || e instanceof Error ? e.message : 'This step could not run.';
		} finally {
			this.running = false;
		}
	}

	/** Replays steps 0..target so every step always starts from the same state. */
	goTo(target: number): Promise<void> {
		const end = Math.max(0, Math.min(DEMO_STEPS.length - 1, target));
		return this.#run(Array.from({ length: end + 1 }, (_, i) => i));
	}

	next(): Promise<void> {
		if (this.step >= DEMO_STEPS.length - 1) return Promise.resolve();
		return this.#run([this.step + 1]);
	}

	back(): Promise<void> {
		return this.goTo(this.step - 1);
	}

	restart(): Promise<void> {
		return this.goTo(0);
	}

	start(): Promise<void> {
		this.active = true;
		return this.restart();
	}

	stop(): void {
		this.active = false;
		this.error = null;
	}
}

async function clickControl(id: string): Promise<void> {
	const deadline = Date.now() + DEMO_CONFIG.controlTimeoutMs;
	for (;;) {
		await tick();
		const el = document.querySelector<HTMLElement>(`[data-demo="${id}"]`);
		if (el && !(el as HTMLButtonElement).disabled) {
			el.click();
			await tick();
			return;
		}
		if (Date.now() > deadline) {
			throw new DemoStepError(`Could not find the "${id}" control. Restart the demo to recover.`);
		}
		await new Promise((r) => setTimeout(r, 50));
	}
}

export const [getDemoState, setDemoState] = createContext<DemoState>();
