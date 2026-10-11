<script lang="ts">
	import type { FeatureCollection, Point } from 'geojson';
	import AtlasMap from '../planning/AtlasMap.svelte';
	import { streetData, routeData, symbolData, journeyData } from '../planning/atlasData.ts';
	import { honeycombAreas } from '../planning/honeycombAreas.ts';
	import { TRAVEL_TIME_BANDS } from '../planning/travelTimeBands.ts';
	import { planningRoadFeatures } from '#lib/planning/disruptions.ts';
	import type {
		PlanningAnalysis,
		PlanningAssumptions,
		PlanningBaseline
	} from '#lib/planning/types.ts';

	let {
		baseline,
		analysis,
		assumptions,
		selectedOriginId = '',
		onselect,
		playbackSymbols = { type: 'FeatureCollection', features: [] },
		showAreas = true,
		onready
	}: {
		baseline: PlanningBaseline;
		analysis: PlanningAnalysis | null;
		assumptions: PlanningAssumptions;
		selectedOriginId?: string;
		onselect?: (originId: string) => void;
		playbackSymbols?: FeatureCollection<Point>;
		showAreas?: boolean;
		onready?: (capture: () => Promise<string>) => void;
	} = $props();
	const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
	let ready = $state(false);
	const land = $derived(
		(baseline.landBoundaries ?? baseline.islandBoundaries ?? empty) as FeatureCollection
	);
	const streets = $derived(streetData(baseline));
	const areas = $derived(
		honeycombAreas(baseline, analysis, assumptions.populationYear, assumptions.targetMinutes)
	);
	const selection = $derived(
		areas.features.find((f) => f.properties.originIds.includes(selectedOriginId))?.properties.id ??
			''
	);
	const origin = $derived(baseline.origins.find((o) => o.id === selectedOriginId));
	const result = $derived(analysis?.origins.find((o) => o.originId === selectedOriginId));
	const journey = $derived(journeyData(baseline, analysis, origin, result?.after));
	const routes = $derived(routeData(analysis));
	const symbols = $derived(
		symbolData(baseline, analysis, assumptions.goal, false, { assumptions })
	);
	const roads = $derived(
		showAreas
			? planningRoadFeatures(baseline, assumptions)
			: { type: 'FeatureCollection' as const, features: [] }
	);
</script>

<div
	class="policy-map"
	data-testid="policy-map"
	data-map-ready={ready}
	data-vehicle-count={playbackSymbols.features.length}
>
	<AtlasMap
		{land}
		{streets}
		{areas}
		{routes}
		{symbols}
		{journey}
		{playbackSymbols}
		roadConditions={roads}
		selectedId={selection}
		view="access"
		overlayOpacity={showAreas ? 0.35 : 0}
		controlsHeight={0}
		mobileBottomInset={0}
		onselect={(id) => onselect?.(id)}
		onplace={() => {}}
		onready={(capture) => {
			ready = true;
			onready?.(capture);
		}}
	/>
	{#if showAreas}
		<div class="map-legend" aria-label="Journey-time map legend">
			<strong>Time to {assumptions.goal === 'education' ? 'school' : 'healthcare'} · one way</strong
			>
			<div>
				{#each TRAVEL_TIME_BANDS as band (band.id)}
					<span><i style:background={band.color}></i>{band.label}</span>
				{/each}
			</div>
			<small>Shading shows journey time, not road traffic.</small>
		</div>
	{/if}
</div>

<style>
	.policy-map {
		position: relative;
		height: 100%;
		min-height: 0;
		overflow: hidden;
		border-radius: var(--surface-radius, 28px);
		background: #dceef0;
	}
	.map-legend {
		position: absolute;
		left: 16px;
		top: 16px;
		max-width: 240px;
		padding: 12px 14px;
		border: 1px solid #dde6e8;
		border-radius: var(--surface-radius-inner, 16px);
		background: #fff;
		color: #254f4b;
		font-size: 11px;
		box-shadow: var(--surface-shadow, 0 4px 16px #102e3412, 0 1px 3px #102e340a);
		pointer-events: none;
	}
	.map-legend strong {
		display: block;
		font-size: 11px;
		margin-bottom: 7px;
	}
	.map-legend > div {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 5px 10px;
	}
	.map-legend span {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.map-legend i {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		flex-shrink: 0;
	}
	.map-legend small {
		display: block;
		margin-top: 7px;
		font-size: 10px;
	}
	@media (max-width: 680px) {
		.policy-map :global(.atlas-map .maplibregl-ctrl-bottom-left) {
			top: auto;
			bottom: 0;
			max-width: calc(100% - 56px);
		}
	}
	@media (max-width: 720px) {
		.policy-map {
			border-radius: var(--surface-radius-mobile, 24px);
		}
		.map-legend {
			max-width: 195px;
			font-size: 9px;
			padding: 8px;
		}
		.map-legend strong {
			font-size: 10px;
		}
		.map-legend small {
			font-size: 9px;
		}
	}
</style>
