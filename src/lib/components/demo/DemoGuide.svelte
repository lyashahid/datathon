<!-- Compact presenter guide for Demo Mode: one step at a time, driving the real simulator. -->
<script lang="ts">
	import { ChevronLeft, ChevronRight, RotateCcw, X } from '@lucide/svelte';
	import { DEMO_CONFIG } from '#lib/config/demo.ts';
	import { getDemoState } from '#lib/stores/demo.svelte.ts';

	const demo = getDemoState();
	const last = $derived(demo.step === demo.steps.length - 1);

	// Highlight the control this step talks about, wherever it is rendered.
	$effect(() => {
		const id = demo.active && !demo.running ? demo.current.highlight : undefined;
		if (!id) return;
		let el: Element | null = null;
		const apply = () => {
			const next = document.querySelector(`[data-demo="${id}"]`);
			if (next === el) return;
			el?.classList.remove('demo-highlight');
			el = next;
			el?.classList.add('demo-highlight');
		};
		apply();
		// The control may render a moment later (panels, menus).
		const observer = new MutationObserver(apply);
		observer.observe(document.body, { childList: true, subtree: true });
		return () => {
			observer.disconnect();
			el?.classList.remove('demo-highlight');
		};
	});
</script>

<section class="pointer-events-auto w-80 hud-panel p-3" aria-label="Demo guide" aria-live="polite">
	<header class="flex items-center gap-2">
		<p class="flex-1 hud-label text-hud-accent">Demo · {DEMO_CONFIG.title}</p>
		<button
			type="button"
			class="grid size-6 place-items-center rounded text-hud-muted hover:bg-hud-hover hover:text-hud-text"
			aria-label="Close demo guide"
			title="Close demo guide (the map stays as it is)"
			onclick={() => demo.stop()}
		>
			<X class="size-3.5" />
		</button>
	</header>

	<div class="mt-1.5 flex items-baseline gap-2">
		<span class="font-mono text-[11px] text-hud-faint tabular-nums">
			{demo.step + 1}/{demo.steps.length}
		</span>
		<h2 class="text-sm font-semibold">{demo.current.title}</h2>
	</div>
	<p class="mt-1 text-[11px] leading-relaxed text-hud-muted">{demo.current.narration}</p>

	<div class="mt-2 flex gap-0.5" aria-hidden="true">
		{#each demo.steps as s, i (s.title)}
			<span
				class="h-1 flex-1 rounded-full {i <= demo.step ? 'bg-hud-accent' : 'bg-hud-line-strong'}"
			></span>
		{/each}
	</div>

	{#if demo.error}
		<p class="mt-2 text-[11px] text-hud-warn" role="alert">{demo.error}</p>
	{/if}

	<div class="mt-2.5 flex items-center gap-1.5">
		<button
			type="button"
			class="flex h-7 items-center gap-1 rounded px-2 text-[11px] text-hud-muted hover:bg-hud-hover hover:text-hud-text disabled:opacity-40"
			disabled={demo.running || demo.step === 0}
			onclick={() => demo.back()}
		>
			<ChevronLeft class="size-3.5" /> Back
		</button>
		<button
			type="button"
			class="flex h-7 items-center gap-1 rounded px-2 text-[11px] text-hud-muted hover:bg-hud-hover hover:text-hud-text disabled:opacity-40"
			disabled={demo.running}
			title="Return to step 1 and empty the demo scenario"
			onclick={() => demo.restart()}
		>
			<RotateCcw class="size-3.5" /> Restart Demo
		</button>
		<span class="flex-1"></span>
		<button
			type="button"
			class="flex h-7 items-center gap-1 rounded bg-hud-accent px-3 text-[11px] font-medium text-hud-void hover:brightness-110 disabled:opacity-40"
			disabled={demo.running || last}
			onclick={() => demo.next()}
		>
			{last ? 'Done' : 'Next'}
			<ChevronRight class="size-3.5" />
		</button>
	</div>
	<p class="mt-2 text-[10px] leading-relaxed text-hud-faint">
		Each step uses the normal controls; every number comes from the live simulator.
	</p>
</section>
