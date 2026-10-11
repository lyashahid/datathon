<script lang="ts">
	import type { NationalEvidenceReadiness } from '#lib/operations/types.ts';
	import { number } from './atlasData.ts';
	let { records }: { records: NationalEvidenceReadiness[] } = $props();
	let selectedId = $state('male');
	let search = $state('');
	const located = $derived(
		records
			.filter((record) => record.coordinates !== null)
			.sort((a, b) => b.coordinates![1] - a.coordinates![1])
	);
	const selected = $derived(
		records.find((record) => record.id === selectedId) ??
			records.find((record) => record.accessReadiness === 'flagship') ??
			records[0]
	);
	const matches = $derived(
		records.filter((record) =>
			`${record.name} ${record.atoll}`.toLowerCase().includes(search.toLowerCase())
		)
	);
	const rows = $derived(
		search.trim()
			? matches.slice(0, 8)
			: records.filter((record) => record.accessReadiness === 'flagship').slice(0, 4)
	);
	const y = (latitude: number) => 21 + (7.5 - latitude) * 31;
	const x = (longitude: number) => 110 + (longitude - 73.1) * 31;
	const optionId = (id: string) => `national-coverage-${id}`;
	function navigate(event: KeyboardEvent) {
		if (!located.length) return;
		const position = Math.max(
			0,
			located.findIndex((record) => record.id === selectedId)
		);
		let next: number;
		if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
			next = (position + 1) % located.length;
		else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
			next = (position - 1 + located.length) % located.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = located.length - 1;
		else return;
		event.preventDefault();
		selectedId = located[next].id;
	}
</script>

<section class="national-inset" aria-label="National population and evidence coverage">
	<div class="coverage-layout">
		<div class="map-frame">
			<svg
				viewBox="0 0 225 305"
				role="listbox"
				aria-label="Approximate island display locations. Use arrow keys to select an island."
				tabindex="0"
				aria-activedescendant={selected?.coordinates ? optionId(selected.id) : undefined}
				onkeydown={navigate}
			>
				<rect x="0" y="0" width="225" height="305" rx="13" fill="#edf6f6" />
				{#each [1, 3, 5, 7] as latitude (latitude)}
					<line
						x1="30"
						x2="204"
						y1={y(latitude)}
						y2={y(latitude)}
						stroke="#d5e7e8"
						stroke-dasharray="2 4"
					/>
					<text x="9" y={y(latitude) + 3} class="latitude">{latitude}° N</text>
				{/each}
				<text x="192" y="18" class="north">N ↑</text>
				{#each located as island (island.id)}
					<circle
						id={optionId(island.id)}
						role="option"
						aria-selected={selected?.id === island.id}
						aria-label={`${island.name}, ${island.atoll}, ${island.accessReadiness === 'flagship' ? 'flagship routing coverage' : 'population only'}`}
						tabindex="-1"
						cx={x(island.coordinates![0])}
						cy={y(island.coordinates![1])}
						r={selected?.id === island.id ? 5.2 : island.accessReadiness === 'flagship' ? 3.5 : 2.5}
						fill={island.accessReadiness === 'flagship' ? '#168578' : '#91a8b0'}
						stroke={selected?.id === island.id ? '#123f47' : '#edf6f6'}
						stroke-width={selected?.id === island.id ? 1.7 : 0.7}
						onclick={() => (selectedId = island.id)}
						onkeydown={navigate}
					>
						<title>{island.name} · {island.atoll} · approximate display location</title>
					</circle>
				{/each}
				<text x="143" y={y(4.21) + 2} class="male-label">Greater Malé</text>
			</svg>
			<p class="map-caption">
				{located.length} approximate display locations<br />Latitude / longitude · no island
				boundaries
			</p>
		</div>
		<div class="selected-island" aria-live="polite" aria-atomic="true">
			{#if selected}
				<span class="kicker">{selected.atoll}</span>
				<h4>{selected.name}</h4>
				<span class="coverage-pill" class:flagship={selected.accessReadiness === 'flagship'}
					>{selected.accessReadiness === 'flagship'
						? 'Flagship planning'
						: 'Population evidence only'}</span
				>
				<dl>
					<div>
						<dt>2026 residents</dt>
						<dd>{number(selected.population2026)}</dd>
					</div>
					<div>
						<dt>2030 residents</dt>
						<dd>{number(selected.population2030)}</dd>
					</div>
				</dl>
				<p class="qualification">
					Official projections. {selected.routingAvailable
						? 'Service and destination evidence remains partial.'
						: 'Verified routing has not been prepared for this island.'}
				</p>
				{#if !selected.coordinates}<p class="location-gap">Location unmatched · not plotted</p>{/if}
			{:else}<p class="qualification">National population evidence is unavailable.</p>{/if}
		</div>
	</div>
	<label
		>Find any island or atoll<input
			type="search"
			bind:value={search}
			placeholder="Search official records"
		/></label
	>
	<div class="island-results">
		{#each rows as island (island.id)}
			<button
				type="button"
				class:chosen={selected?.id === island.id}
				aria-pressed={selected?.id === island.id}
				onclick={() => (selectedId = island.id)}
				><span>{island.name}<small>{island.atoll}</small></span><span class="row-status"
					>{island.accessReadiness === 'flagship'
						? 'Flagship'
						: !island.coordinates
							? 'Unlocated'
							: 'Population'}</span
				></button
			>
		{:else}<p class="qualification">No matching official record.</p>{/each}
	</div>
	{#if search.trim()}<p class="map-caption">
			{matches.length} matches{matches.length > rows.length
				? ` · showing ${rows.length}; refine your search`
				: ''}. Unlocated records remain searchable.
		</p>{/if}
	<p class="qualification">
		{records.length} official/local study records. Population coverage does not imply a nationwide transport
		model.
	</p>
</section>

<style>
	.national-inset {
		margin-top: 12px;
		color: #294942;
	}
	.coverage-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 13px;
		align-items: start;
	}
	.map-frame {
		min-width: 0;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
		border-radius: 13px;
	}
	svg:focus-visible {
		outline: 3px solid #72b8ad;
		outline-offset: 3px;
	}
	circle {
		cursor: pointer;
	}
	.latitude,
	.north {
		fill: #819ba2;
		font-size: 8px;
	}
	.male-label {
		fill: #357267;
		font-size: 8px;
		font-weight: 700;
	}
	.map-caption {
		margin: 7px 0 10px;
		color: #7b8f8a;
		font-size: 10px;
		line-height: 1.5;
	}
	.selected-island {
		padding-top: 7px;
		min-width: 0;
	}
	.kicker {
		color: #789288;
		font-size: 10px;
	}
	h4 {
		font-size: 15px;
		line-height: 1.3;
		margin: 5px 0 10px;
		overflow-wrap: anywhere;
	}
	.coverage-pill {
		display: inline-block;
		padding: 5px 6px;
		background: #edf0e8;
		border-radius: 5px;
		font-size: 9px;
		color: #6a7f73;
	}
	.coverage-pill.flagship {
		background: #ddf1e8;
		color: #23725c;
	}
	dl {
		display: grid;
		gap: 11px;
		margin: 17px 0;
	}
	dt {
		color: #7d9187;
		font-size: 10px;
	}
	dd {
		font-variant-numeric: tabular-nums;
		font-size: 20px;
		font-weight: 650;
		margin: 3px 0 0;
	}
	.qualification {
		font-size: 11px;
		line-height: 1.5;
		color: #74877b;
		margin: 10px 0;
	}
	.location-gap {
		color: #a37238;
		font-size: 10px;
	}
	label {
		display: grid;
		gap: 5px;
		color: #5e7b6b;
		font-size: 11px;
		font-weight: 600;
	}
	input {
		font: inherit;
		padding: 9px;
		border: 1px solid #d5e1d8;
		border-radius: 8px;
		min-width: 0;
		color: #294942;
		background: white;
	}
	input:focus-visible,
	button:focus-visible {
		outline: 3px solid #72b8ad;
		outline-offset: 2px;
	}
	.island-results {
		display: grid;
		margin: 6px 0;
	}
	button {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		align-items: center;
		text-align: left;
		padding: 9px 7px;
		border: 0;
		border-bottom: 1px solid #e9eee5;
		background: transparent;
		color: #36594a;
		border-radius: 5px;
		cursor: pointer;
		font-size: 12px;
	}
	button small {
		display: block;
		font-size: 10px;
		color: #8a9b90;
		margin-top: 3px;
	}
	button.chosen {
		background: #edf6ee;
	}
	.row-status {
		font-size: 9px;
		color: #789183;
	}
	@media (hover: hover) {
		button:hover {
			background: #f0f5ed;
		}
	}
	@media (max-width: 380px) {
		.coverage-layout {
			gap: 9px;
		}
		dd {
			font-size: 17px;
		}
		h4 {
			font-size: 14px;
		}
	}
</style>
