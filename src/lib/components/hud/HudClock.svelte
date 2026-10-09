<script lang="ts">
	import { APP_CONFIG } from '#lib/config/app.ts';

	const formatter = new Intl.DateTimeFormat('en-GB', {
		timeZone: APP_CONFIG.timeZone,
		hour: '2-digit',
		minute: '2-digit'
	});

	// Rendered client-side only so server and client markup never disagree.
	let now = $state<Date | null>(null);

	$effect(() => {
		now = new Date();
		const id = setInterval(() => (now = new Date()), 15_000);
		return () => clearInterval(id);
	});
</script>

<div
	class="flex h-7 shrink-0 items-center gap-1.5 px-1 text-xs max-sm:hidden"
	title="Maldives Time"
>
	<span class="font-mono font-medium tabular-nums">{now ? formatter.format(now) : '--:--'}</span>
	<span class="text-[10px] text-hud-faint">{APP_CONFIG.timeZoneLabel}</span>
</div>
