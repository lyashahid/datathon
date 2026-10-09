<script lang="ts">
	import {
		Check,
		ChevronDown,
		Copy,
		GitBranch,
		Pencil,
		Plus,
		Redo2,
		RotateCcw,
		Undo2
	} from '@lucide/svelte';
	import { getScenarioStore } from '#lib/stores/scenario.svelte.ts';
	import { tick } from 'svelte';

	const scenarios = getScenarioStore();

	let open = $state(false);
	let renaming = $state(false);
	let draftName = $state('');
	let root: HTMLDivElement | undefined = $state();
	let renameInput: HTMLInputElement | undefined = $state();

	const active = $derived(scenarios.active);
	const changeCount = $derived(active?.changes.length ?? 0);
	const modKey =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

	function close() {
		open = false;
		renaming = false;
	}

	function choose(id: string | null) {
		if (id === null) scenarios.selectBaseline();
		else scenarios.selectScenario(id);
		close();
	}

	async function startRename() {
		if (!active) return;
		draftName = active.name;
		renaming = true;
		await tick();
		renameInput?.select();
	}

	function commitRename() {
		if (active) scenarios.renameScenario(active.id, draftName);
		renaming = false;
	}

	function onWindowPointerDown(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) close();
	}

	const itemClass =
		'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-hud-hover disabled:cursor-not-allowed disabled:text-hud-faint disabled:hover:bg-transparent';
	const iconButtonClass =
		'grid size-7 place-items-center rounded text-hud-muted hover:bg-hud-hover hover:text-hud-text disabled:text-hud-faint disabled:hover:bg-transparent';
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="flex shrink-0 items-center gap-0.5">
	<div class="relative" bind:this={root}>
		<button
			type="button"
			class="flex h-7 items-center gap-2 rounded border px-2 text-xs transition-colors {active
				? 'border-hud-accent/40 bg-hud-accent-dim'
				: 'border-hud-line bg-hud-raised hover:border-hud-line-strong'}"
			aria-haspopup="menu"
			aria-expanded={open}
			onclick={() => (open ? close() : (open = true))}
		>
			<GitBranch class="size-3.5 {active ? 'text-hud-accent' : 'text-hud-muted'}" />
			<span class="hud-label max-lg:hidden">Scenario</span>
			<span class="max-w-40 truncate font-medium">{active?.name ?? 'Baseline'}</span>
			{#if active}
				<span class="font-mono text-[10px] text-hud-accent tabular-nums" title="Changes">
					{changeCount}
				</span>
			{:else}
				<span class="text-[10px] text-hud-faint">read-only</span>
			{/if}
			<ChevronDown class="size-3.5 text-hud-faint" />
		</button>

		{#if open}
			<div
				class="absolute top-full right-0 z-50 mt-1 w-64 hud-panel p-1 text-hud-text"
				role="menu"
				tabindex="-1"
				onkeydown={(e) => e.key === 'Escape' && close()}
			>
				<button
					type="button"
					role="menuitemradio"
					aria-checked={!active}
					class={itemClass}
					onclick={() => choose(null)}
				>
					<span class="flex-1">
						Baseline
						<span class="block text-[10px] text-hud-faint">Current infrastructure, read-only</span>
					</span>
					{#if !active}<Check class="size-3.5 text-hud-accent" />{/if}
				</button>

				{#if scenarios.scenarios.length > 0}
					<div class="my-1 border-t border-hud-line"></div>
					<p class="px-2 pt-1 pb-0.5 hud-label">Scenarios</p>
					<div class="max-h-56 overflow-y-auto">
						{#each scenarios.scenarios as s (s.id)}
							<button
								type="button"
								role="menuitemradio"
								aria-checked={s.id === active?.id}
								class={itemClass}
								onclick={() => choose(s.id)}
							>
								<span class="min-w-0 flex-1 truncate">{s.name}</span>
								<span class="font-mono text-[10px] text-hud-faint tabular-nums">
									{s.changes.length} change{s.changes.length === 1 ? '' : 's'}
								</span>
								{#if s.id === active?.id}<Check class="size-3.5 text-hud-accent" />{/if}
							</button>
						{/each}
					</div>
				{/if}

				<div class="my-1 border-t border-hud-line"></div>

				{#if renaming && active}
					<form
						class="flex items-center gap-1 px-1 py-1"
						onsubmit={(e) => {
							e.preventDefault();
							commitRename();
						}}
					>
						<input
							bind:this={renameInput}
							bind:value={draftName}
							class="h-7 min-w-0 flex-1 rounded border border-hud-line-strong bg-hud-base px-2 text-xs outline-none focus:border-hud-accent/60"
							aria-label="Scenario name"
							onkeydown={(e) => {
								if (e.key === 'Escape') {
									e.stopPropagation();
									renaming = false;
								}
							}}
						/>
						<button
							type="submit"
							class="h-7 rounded bg-hud-accent-dim px-2 text-xs text-hud-accent"
						>
							Save
						</button>
					</form>
				{/if}

				<button
					type="button"
					role="menuitem"
					class={itemClass}
					onclick={() => {
						scenarios.createScenario();
						close();
					}}
				>
					<Plus class="size-3.5 text-hud-muted" /> New scenario
				</button>
				<button
					type="button"
					role="menuitem"
					class={itemClass}
					disabled={!active}
					onclick={() => {
						scenarios.duplicateScenario();
						close();
					}}
				>
					<Copy class="size-3.5 text-hud-muted" /> Duplicate
				</button>
				<button
					type="button"
					role="menuitem"
					class={itemClass}
					disabled={!active}
					onclick={startRename}
				>
					<Pencil class="size-3.5 text-hud-muted" /> Rename…
				</button>
				<button
					type="button"
					role="menuitem"
					class={itemClass}
					disabled={changeCount === 0}
					onclick={() => {
						scenarios.resetScenario();
						close();
					}}
				>
					<RotateCcw class="size-3.5 text-hud-muted" /> Reset to baseline
					<span class="ml-auto text-[10px] text-hud-faint">undoable</span>
				</button>
			</div>
		{/if}
	</div>

	<button
		type="button"
		class={iconButtonClass}
		disabled={!scenarios.canUndo}
		onclick={() => scenarios.undo()}
		aria-label="Undo"
		title="Undo ({modKey}+Z)"
	>
		<Undo2 class="size-3.5" />
	</button>
	<button
		type="button"
		class={iconButtonClass}
		disabled={!scenarios.canRedo}
		onclick={() => scenarios.redo()}
		aria-label="Redo"
		title="Redo ({modKey}+Shift+Z)"
	>
		<Redo2 class="size-3.5" />
	</button>
</div>
