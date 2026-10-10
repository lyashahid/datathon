<!-- HUD switch for the presentation Demo Mode. -->
<script lang="ts">
	import { Presentation } from '@lucide/svelte';
	import { getDemoState } from '#lib/stores/demo.svelte.ts';

	const demo = getDemoState();
</script>

<button
	type="button"
	class="flex h-7 shrink-0 items-center gap-1.5 rounded border px-2 text-xs transition-colors {demo.active
		? 'border-hud-accent/50 bg-hud-accent-dim text-hud-accent'
		: 'border-hud-line bg-hud-raised hover:border-hud-line-strong'}"
	aria-pressed={demo.active}
	title={demo.active ? 'Hide the demo guide' : 'Start the guided presentation demo'}
	onclick={() => (demo.active ? demo.stop() : demo.start())}
>
	<Presentation class="size-3.5" />
	<span class="max-xl:hidden">Demo</span>
</button>
