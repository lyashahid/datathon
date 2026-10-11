<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { PlanningBaseline } from '#lib/planning/types.ts';
	import type { AppointmentOptions } from '#lib/planning/returnJourney.ts';
	import { PLANNING_MODEL_VERSION } from '#lib/planning/defaults.ts';
	export interface DemoCase {
		id: string;
		file: string;
		title: string;
		originId: string;
		mapCenter: [number, number];
		selectedPatternId?: string;
		appointmentOptions?: AppointmentOptions;
	}
	let {
		baseline,
		onselect
	}: { baseline: PlanningBaseline; onselect: (demo: DemoCase, json: string) => void } = $props();
	let cases = $state<DemoCase[]>([]);
	let available = $state(false);
	let loading = $state('');
	let error = $state('');
	let destroyed = false;
	let selectionRequest = 0;
	let selectionAbort: AbortController | null = null;
	onDestroy(() => {
		destroyed = true;
		selectionRequest++;
		selectionAbort?.abort();
	});
	onMount(() => {
		let active = true;
		void fetch('/demo/catalog.json')
			.then((r) => {
				if (!r.ok) throw new Error('Demo catalogue unavailable.');
				return r.json();
			})
			.then((catalog) => {
				if (!active) return;
				available =
					catalog.datasetVersion === baseline.version &&
					catalog.modelVersion === PLANNING_MODEL_VERSION;
				cases = catalog.cases.map((demo: DemoCase) => ({
					...demo,
					appointmentOptions: demo.appointmentOptions ?? catalog.appointmentOptions
				}));
			})
			.catch(() => {
				if (active) error = 'Prepared examples are unavailable; your scenario can still be edited.';
			});
		return () => {
			active = false;
		};
	});
	async function select(demo: DemoCase) {
		if (destroyed) return;
		const request = ++selectionRequest;
		selectionAbort?.abort();
		const controller = new AbortController();
		selectionAbort = controller;
		loading = demo.id;
		error = '';
		try {
			const response = await fetch(demo.file, { signal: controller.signal });
			if (!response.ok) throw new Error('Example could not load.');
			const json = await response.text();
			if (destroyed || request !== selectionRequest) return;
			// Parent handlers may clone this pinned metadata; deep $state values are proxies.
			onselect($state.snapshot(demo), json);
		} catch (e) {
			if (destroyed || request !== selectionRequest || controller.signal.aborted) return;
			error = String(e instanceof Error ? e.message : e);
		} finally {
			if (!destroyed && request === selectionRequest) {
				loading = '';
				selectionAbort = null;
			}
		}
	}
</script>

<details class="demo-presets">
	<summary>Try a prepared policy example</summary>
	<p>Editable scenarios using the cached public baseline. Undo restores your previous proposal.</p>
	<div>
		{#each cases as demo (demo.id)}<button
				disabled={!available || !!loading}
				onclick={() => select(demo)}
				><strong>{demo.title}</strong><span
					>{loading === demo.id ? 'Loading…' : 'Open example →'}</span
				></button
			>{/each}
	</div>
	{#if !available && cases.length}<p>These examples use another dataset or model version.</p>{/if}
	{#if error}<p role="alert">{error}</p>{/if}
</details>

<style>
	.demo-presets {
		padding: 16px 0;
		border-top: 1px solid #dfe7df;
		margin-top: 16px;
	}
	summary {
		font-size: 14px;
		font-weight: 650;
		cursor: pointer;
	}
	p {
		font-size: 12px;
		color: #65776b;
		line-height: 1.5;
	}
	div {
		display: grid;
		gap: 8px;
	}
	button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		text-align: left;
		font: inherit;
		border: 1px solid #d7e4de;
		background: #f5faf6;
		border-radius: 10px;
		padding: 12px;
		color: #34594a;
		cursor: pointer;
	}
	strong {
		font-size: 13px;
		font-weight: 600;
	}
	span {
		font-size: 11px;
		white-space: nowrap;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button:focus-visible {
		outline: 2px solid #168b76;
		outline-offset: 3px;
	}
	@media (hover: hover) {
		button:hover:not(:disabled) {
			background: #eaf4ec;
		}
	}
</style>
