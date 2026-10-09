<script lang="ts">
	import { METADATA_LABELS } from '#lib/config/infrastructure.ts';
	import type { AssetMetadata } from '#lib/types/domain.ts';
	import { formatMetadataValue, humanizeKey } from '#lib/utils/format.ts';
	import DemoTag from './DemoTag.svelte';

	let {
		metadata,
		syntheticFields
	}: { metadata: AssetMetadata; syntheticFields: readonly string[] } = $props();

	const rows = $derived(
		Object.entries(metadata).map(([key, value]) => ({
			key,
			label: METADATA_LABELS[key] ?? humanizeKey(key),
			value: formatMetadataValue(value),
			synthetic: syntheticFields.includes(key)
		}))
	);
</script>

{#if rows.length > 0}
	<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
		{#each rows as row (row.key)}
			<dt class="text-hud-muted">{row.label}</dt>
			<dd class="flex min-w-0 items-baseline justify-end gap-1.5 text-right">
				<span class="truncate font-medium tabular-nums">{row.value}</span>
				{#if row.synthetic}
					<DemoTag title="Synthetic demo value" />
				{/if}
			</dd>
		{/each}
	</dl>
{/if}
