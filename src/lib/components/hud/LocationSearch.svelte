<script lang="ts">
	import { Search } from '@lucide/svelte';
</script>

<!-- Placeholder: geocoding over islands/atolls/facilities arrives with the data layer. -->
<label
	class="flex h-7 w-64 items-center gap-2 rounded border border-hud-line bg-hud-base/60 px-2 text-hud-muted focus-within:border-hud-accent/50 max-md:hidden lg:w-80"
>
	<Search class="size-3.5 shrink-0" />
	<input
		type="search"
		placeholder="Search island, atoll or facility"
		class="w-full bg-transparent text-xs text-hud-text outline-none placeholder:text-hud-faint"
		aria-label="Search location"
	/>
</label>
