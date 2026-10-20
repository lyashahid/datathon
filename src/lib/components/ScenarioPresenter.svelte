<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { ArrowLeft, ArrowRight, RotateCcw, X, ChevronRight } from '@lucide/svelte';
	import IslandOverview from './IslandOverview.svelte';
	import { emptyFeatures } from '#lib/map-policy.js';
	import {
		loadPresentationStory,
		retryFailedPresentationStory,
		type PresentationStory
	} from '#lib/presentation-story.js';
	import { seaNetworkMapState } from '#lib/sea-connectivity.js';
	import type { PresentationView } from '#lib/presentation-state.js';
	import type { PresentationMapScene, PresentationProgress } from '#lib/presentation-map.js';
	import {
		formatPresentationElapsed,
		formatPresentationTotal,
		presentationTimeline
	} from '#lib/presentation-timeline.js';
	import type { Coordinates } from '#lib/types.js';
	let {
		onView,
		onClose,
		progress = null
	}: {
		onView: (view: PresentationView) => void;
		onClose: () => void;
		progress?: PresentationProgress | null;
	} = $props();
	const steps = [
		'Hithadhoo, Laamu',
		'The ferry connection',
		'Across Laamu Atoll',
		'Kadhdhoo Airport',
		'The air connection',
		'Landing at Velana',
		'The last few kilometres',
		'People behind the map',
		'The walk to a bus',
		'The bus to the airport',
		'Bring the stop closer'
	];
	let step = $state(0),
		replay = $state(0),
		loading = $state(true),
		failure = $state(''),
		withProposal = $state(false),
		collapsed = $state(false);
	let story = $state.raw<PresentationStory | null>(null);
	let panelBody = $state<HTMLDivElement>();
	let controller: AbortController | undefined;
	const blank = emptyFeatures();
	const islandId = $derived(step <= 2 ? 'island:697' : step <= 5 ? 'island:706' : 'island:1442');
	const islandData = $derived(story?.islandData[islandId]);
	const islandPanel = $derived([0, 3, 6, 7].includes(step));
	const animated = $derived([2, 5, 8, 9].includes(step));
	const itinerary = $derived(
		story?.journey?.segments.flatMap((segment) =>
			segment.status === 'ok' && segment.result?.journey?.status === 'reachable'
				? [segment.result.journey]
				: []
		) ?? []
	);
	const legs = $derived(itinerary.flatMap((journey) => journey.legs));
	const firstWalk = $derived(legs.find((leg) => leg.mode === 'walk'));
	const playbackProgress = $derived(progress?.key === `${step}:${replay}` ? progress.progress : 0);
	const playbackRunning = $derived(
		progress?.key === `${step}:${replay}` && progress.phase === 'playing'
	);
	const cameraEntering = $derived(
		progress?.key !== `${step}:${replay}` || ['idle', 'entering'].includes(progress.phase)
	);
	const arrivalClock = $derived(
		presentationTimeline(step, playbackProgress, [
			{ step: 2, minutes: story?.timing.ferry.minutes },
			{ step: 5, minutes: story?.timing.flight.minutes }
		])
	);
	const pickupClock = $derived(
		presentationTimeline(step, playbackProgress, [
			{ step: 8, minutes: firstWalk?.minutes },
			{
				step: 9,
				minutes: legs.length
					? legs.filter((leg) => leg !== firstWalk).reduce((sum, leg) => sum + leg.minutes, 0)
					: null
			}
		])
	);
	const minutes = (value: number | null | undefined) =>
		value == null ? 'Unavailable' : value > 0 && value < 1 ? '<1 min' : `${Math.round(value)} min`;
	async function load(retryFailed = false) {
		controller?.abort();
		const active = new AbortController();
		controller = active;
		loading = true;
		failure = '';
		try {
			const read = retryFailed ? retryFailedPresentationStory : loadPresentationStory;
			const value = await read(active.signal, (value) => {
				if (!active.signal.aborted) story = value;
			});
			if (!active.signal.aborted) story = value;
		} catch (cause) {
			if (!active.signal.aborted)
				failure = cause instanceof Error ? cause.message : 'Scenario data could not load.';
		} finally {
			if (!active.signal.aborted) loading = false;
		}
	}
	onMount(() => {
		void load();
		window.addEventListener('keydown', keydown, { capture: true });
		return () => {
			controller?.abort();
			window.removeEventListener('keydown', keydown, { capture: true });
		};
	});
	function move(delta: number) {
		step = Math.max(0, Math.min(steps.length - 1, step + delta));
		withProposal = false;
		collapsed = false;
	}
	function keydown(event: KeyboardEvent) {
		const target = event.target;
		if (
			event.defaultPrevented ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			(target instanceof HTMLElement &&
				target.closest('input,textarea,select,[contenteditable="true"]'))
		)
			return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopImmediatePropagation();
			onClose();
		} else if (
			['ArrowRight', 'PageDown', ' '].includes(event.key) &&
			!(event.key === ' ' && target instanceof HTMLElement && target.closest('button,a,summary'))
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
			move(1);
		} else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			move(-1);
		} else if (event.key.toLowerCase() === 'r') {
			event.preventDefault();
			replay += 1;
		}
	}
	function bounds(points: Coordinates[]): [Coordinates, Coordinates] {
		return [
			[Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
			[Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))]
		];
	}
	const view = $derived.by((): PresentationView => {
		const data = story,
			ferry = data?.ferry;
		const kdo = data?.airports.kdo?.coordinates ?? ([73.5219, 1.8591] as Coordinates);
		const mle = data?.airports.mle?.coordinates ?? ([73.529, 4.1918] as Coordinates);
		const hithadhoo =
			data?.islands.hithadhoo.coordinates ?? ([73.3882589, 1.7968289] as Coordinates);
		const proposedStop = data?.proposal?.operations.find(
			(operation) => operation.coordinates?.length === 2
		)?.coordinates as Coordinates | undefined;
		let paths: PresentationMapScene['paths'] = [];
		if ((step === 1 || step === 2) && ferry?.geometry.length)
			paths = [{ mode: 'ferry', coordinates: ferry.geometry }];
		if ((step === 4 || step === 5) && data?.flightGeometry.length)
			paths = [{ mode: 'air', coordinates: data.flightGeometry }];
		if (step === 8 || step === 9)
			paths = legs
				.filter(
					(leg) =>
						leg.geometry?.length > 1 &&
						leg.mode !== 'wait' &&
						(step === 8 ? leg === firstWalk : leg !== firstWalk)
				)
				.map((leg) => ({ mode: leg.mode as 'walk' | 'bus' | 'ferry', coordinates: leg.geometry }));
		if (step === 10 && withProposal)
			paths =
				data?.proposal?.connection.map_features.features.flatMap((feature) =>
					feature.geometry.type === 'LineString'
						? [{ mode: 'bus' as const, coordinates: feature.geometry.coordinates as Coordinates[] }]
						: []
				) ?? [];
		let camera: PresentationMapScene['camera'];
		if (step === 0) camera = { center: hithadhoo, zoom: 14.1, pitch: 20, bearing: -12 };
		else if (step <= 2)
			camera = {
				bounds: ferry?.geometry.length
					? bounds(ferry.geometry)
					: [
							[73.35, 1.77],
							[73.56, 1.94]
						],
				maxZoom: 12,
				pitch: 24,
				bearing: -8
			};
		else if (step === 3) camera = { center: kdo, zoom: 14.2, pitch: 22, bearing: -18 };
		else if (step <= 5) camera = { bounds: bounds([kdo, mle]), maxZoom: 9, pitch: 12, bearing: 0 };
		else if (step === 7)
			camera = {
				bounds: [
					[73.53, 4.194],
					[73.553, 4.252]
				],
				maxZoom: 13.8,
				pitch: 16,
				bearing: -12
			};
		else if (step === 8 && paths.length)
			camera = {
				bounds: bounds(paths.flatMap((path) => path.coordinates)),
				maxZoom: 16,
				pitch: 22,
				bearing: -12
			};
		else if (step === 9)
			camera = {
				bounds: [
					[73.514, 4.186],
					[73.555, 4.247]
				],
				maxZoom: 13.5,
				pitch: 28,
				bearing: -14
			};
		else if (step === 10)
			camera = {
				bounds: [
					[
						(data?.origin?.coordinates[0] ?? 73.5404) - 0.0065,
						(data?.origin?.coordinates[1] ?? 4.2371) - 0.009
					],
					[
						(data?.origin?.coordinates[0] ?? 73.5404) + 0.0085,
						(data?.origin?.coordinates[1] ?? 4.2371) + 0.004
					]
				],
				maxZoom: 15.3,
				pitch: 20,
				bearing: -12
			};
		else
			camera = {
				bounds: [
					[73.533, 4.228],
					[73.553, 4.252]
				],
				maxZoom: 14,
				pitch: 28,
				bearing: -12
			};
		camera.durationMs = step === 5 || step === 6 ? 1500 : 1100;
		const panel =
			islandPanel && !collapsed
				? ('island' as const)
				: step === 1 || step === 4
					? ('route' as const)
					: undefined;
		const duration =
			step === 2
				? ferry?.minutes
				: step === 8
					? firstWalk?.minutes
					: step === 9
						? legs.filter((leg) => leg !== firstWalk).reduce((sum, leg) => sum + leg.minutes, 0)
						: step === 5
							? data?.timing.flight.minutes
							: undefined;
		// Frame the featured flight with its recorded endpoints, keeping its source metadata intact.
		const airNetwork =
			data?.airNetwork && (step === 4 || step === 5)
				? {
						...data.airNetwork,
						map_features: {
							...data.airNetwork.map_features,
							features: data.airNetwork.map_features.features.filter(
								(feature) => feature.properties?.route_id === data.flight?.id
							)
						},
						airports: data.airNetwork.airports.filter((airport) =>
							['KDO', 'MLE'].includes(airport.iata)
						)
					}
				: step === 3
					? (data?.airNetwork ?? null)
					: null;
		return {
			scene: {
				key: `${step}:${replay}`,
				paths,
				camera,
				panel,
				emphasis: {
					quietContext: step > 0,
					...(step === 10 && withProposal && proposedStop ? { proposalPoint: proposedStop } : {})
				},
				...(step === 1 && ferry
					? {
							inspect: {
								mode: 'ferry' as const,
								routeId: ferry.route.id,
								coordinates: ferry.geometry[Math.floor(ferry.geometry.length / 2)],
								...(ferry.schematic
									? {
											summary: {
												title: 'Hithadhoo → Kadhdhoo',
												minutes: ferry.minutes,
												weeklySailings: ferry.sourceWeeklySailings,
												qualification: ferry.qualification,
												timingLabel: 'Estimated crossing',
												frequencyLabel: 'Source corridor sailings'
											}
										}
									: {})
							}
						}
					: {}),
				...(step === 4 && data?.flight
					? {
							inspect: {
								mode: 'air' as const,
								routeId: data.flight.id,
								coordinates: kdo,
								summary: {
									title: 'Kadhdhoo → Velana',
									minutes: data.timing.flight.minutes,
									weeklySailings: null,
									qualification: data.timing.flight.qualification,
									timingLabel: 'Estimated flight'
								}
							}
						}
					: {}),
				...(animated && paths.length
					? {
							playback: {
								durationMs: step === 5 ? 4750 : step === 2 ? 4500 : 8000,
								establishMs: step === 5 ? 850 : 700,
								follow: true,
								label: steps[step],
								...(duration ? { clockMinutes: duration } : {})
							}
						}
					: {}),
				...(step === 7 ? { population: data?.populationFeatures ?? blank } : {})
			},
			islandId,
			gaps: step !== 7 ? (islandData?.gaps ?? blank) : blank,
			coverage: step !== 7 ? (islandData?.coverage ?? blank) : blank,
			comparison: step === 10 ? (data?.proposal?.comparisonFeatures ?? blank) : blank,
			comparisonView: withProposal ? 'proposal' : 'current',
			operations: step === 10 && withProposal ? (data?.proposal?.operations ?? []) : [],
			lens: step < 6 ? 'overall' : 'transport',
			seaState:
				data?.seaNetwork && step <= 3 ? seaNetworkMapState(data.seaNetwork, null, islandId) : null,
			airNetwork,
			showSea: step <= 3,
			showAir: step >= 3 && step <= 5
		};
	});
	$effect(() => {
		const value = view;
		untrack(() => onView(value));
	});
	$effect(() => {
		const currentStep = step,
			profile = islandData?.profile;
		if (!panelBody || !profile) return;
		void tick().then(() => {
			if (step === currentStep) panelBody?.scrollTo({ top: 0, behavior: 'auto' });
		});
	});
	const context = $derived(
		step === 1
			? `Hithadhoo → Kadhdhoo · ${minutes(story?.ferry?.minutes)} estimated crossing`
			: step === 2
				? 'Hithadhoo → Kadhdhoo · Illustrative airport connection'
				: step === 3
					? 'Kadhdhoo Airport · KDO'
					: step === 4
						? 'KDO → MLE · Published air corridor'
						: step === 6
							? `Northern Hulhumalé → Airport · ${minutes(itinerary[0]?.minutes)}`
							: step === 7
								? 'Modeled residents · Census allocation'
								: step === 9
									? `Direct airport bus · ${story?.journeyGeometrySchematic ? 'Schematic airport approach' : 'R9 service'}`
									: step === 10
										? `Walk to a stop · ${minutes(story?.proposal?.originBeforeMinutes)} → ${minutes(story?.proposal?.originAfterMinutes)}`
										: ''
	);
	const routeUnavailable = $derived(
		!loading && story
			? (step === 1 || step === 2) && !story.ferry
				? (story.errors.ferry ?? 'Ferry connection unavailable.')
				: (step === 4 || step === 5) && !story.flightGeometry.length
					? (story.errors.flight ?? 'Air connection unavailable.')
					: (step === 8 || step === 9) && !legs.length
						? (story.errors.journey ?? 'Airport itinerary unavailable.')
						: step === 10 && !story.proposal?.evaluation
							? (story.errors.proposal ?? story.errors.evaluation ?? 'Stop comparison unavailable.')
							: ''
			: ''
	);
</script>

<section
	class="scenario-presenter"
	aria-label="Scenario presentation"
	data-step={step}
	aria-busy={loading}
>
	<div class="journey-clocks" aria-label="Journey timers">
		<div
			class="journey-clock"
			class:current={step < 6}
			class:running={playbackRunning && (step === 2 || step === 5)}
			data-testid="presentation-arrival-clock"
			data-active={step < 6}
			data-elapsed-seconds={arrivalClock.elapsedSeconds}
			data-total-seconds={arrivalClock.totalSeconds ?? ''}
			data-running={playbackRunning && (step === 2 || step === 5)}
			title={story?.timing.arrival.qualification ?? 'Ferry and flight travel time'}
		>
			<span class="clock-label">To Hulhumalé</span>
			<div class="clock-value">
				<strong
					>{formatPresentationElapsed(arrivalClock.elapsedSeconds)}{arrivalClock.incomplete
						? '+'
						: ''}</strong
				>
				<span>/ {formatPresentationTotal(arrivalClock.totalSeconds)}</span>
			</div>
			<span class="clock-status"
				><i aria-hidden="true"></i>{playbackRunning && step === 2
					? 'Ferry · Accelerated'
					: playbackRunning && step === 5
						? 'Flight · Accelerated'
						: 'Paused'}<span class="clock-basis">Travel estimate</span></span
			>
		</div>
		<div
			class="journey-clock"
			class:current={step >= 6}
			class:running={playbackRunning && (step === 8 || step === 9)}
			data-testid="presentation-pickup-clock"
			data-active={step >= 6}
			data-elapsed-seconds={pickupClock.elapsedSeconds}
			data-total-seconds={pickupClock.totalSeconds ?? ''}
			data-running={playbackRunning && (step === 8 || step === 9)}
			title={story?.timing.pickup.qualification ?? 'Walk, wait and direct airport bus'}
		>
			<span class="clock-label">To the airport</span>
			<div class="clock-value">
				<strong
					>{formatPresentationElapsed(pickupClock.elapsedSeconds)}{pickupClock.incomplete
						? '+'
						: ''}</strong
				>
				<span>/ {formatPresentationTotal(pickupClock.totalSeconds)}</span>
			</div>
			<span class="clock-status"
				><i aria-hidden="true"></i>{playbackRunning && step === 8
					? 'Walking · Accelerated'
					: playbackRunning && step === 9
						? 'Bus · Accelerated'
						: 'Paused'}<span class="clock-basis">Walk + wait + ride</span></span
			>
		</div>
	</div>
	{#if context && ![1, 4, 10].includes(step)}<div class="scenario-context" aria-live="polite">
			{context}
		</div>{/if}
	{#if islandPanel && !collapsed}
		<aside
			class="scenario-island-panel"
			class:awaiting-camera={cameraEntering}
			inert={cameraEntering}
			aria-label="Scenario island details"
		>
			<header>
				<div>
					<span class="panel-eyebrow">{step === 3 ? 'AIRPORT ISLAND' : 'ISLAND ACCESS'}</span>
					<h2>{islandData?.profile?.island.name ?? steps[step]}</h2>
				</div>
				<button
					aria-label="Collapse island details"
					title="Collapse island details"
					onclick={() => (collapsed = true)}><ChevronRight size={19} /></button
				>
			</header>
			<div class="island-panel-body" bind:this={panelBody}>
				<IslandOverview
					presentation={step === 7 ? 'population' : 'access'}
					presentationAirport={story?.airNetwork?.airports.find(
						(airport) => airport.island_id === islandId
					) ?? null}
					profile={islandData?.profile ?? null}
					loading={islandData?.loading ?? true}
					error={islandData?.error ?? ''}
					connectivity={islandData?.connectivity ?? null}
					connectivityLoading={islandData?.loading ?? true}
					connectivityDate={story?.serviceDate ?? ''}
					onRetry={() => load(true)}
				/>
			</div>
		</aside>
	{:else if islandPanel}<button class="reopen-island" onclick={() => (collapsed = false)}
			>Island access index<ChevronRight size={15} /></button
		>{/if}
	{#if failure}<div class="scenario-status" role="alert">
			{failure}<button onclick={() => load(true)}>Retry</button>
		</div>
	{:else if !story || (islandData?.loading && !islandData.gaps.features.length && !islandData.coverage.features.length)}<div
			class="scenario-status"
			role="status"
		>
			<span class="loading-dot"></span>Preparing island access…
		</div>
	{:else if routeUnavailable || (!loading && islandData?.error)}<div
			class="scenario-status"
			role="status"
		>
			{routeUnavailable || islandData?.error}<button onclick={() => load(true)}>Retry</button>
		</div>{/if}
	{#if step === 10}
		<div class="comparison-outcome" aria-label="Walking time to a stop">
			<span class="outcome-label">Walk to a stop</span>
			<div class="outcome-values">
				<div class:emphasized={!withProposal}>
					<strong
						>{story?.proposal?.originBeforeMinutes == null
							? '—'
							: minutes(story.proposal.originBeforeMinutes)}</strong
					><span>Before</span>
				</div>
				<ArrowRight size={22} aria-hidden="true" />
				<div class:emphasized={withProposal}>
					<strong
						>{story?.proposal?.originAfterMinutes == null
							? '—'
							: minutes(story.proposal.originAfterMinutes)}</strong
					><span>Closer stop</span>
				</div>
			</div>
		</div>
		<div class="scenario-comparison" aria-label="Compare stop access">
			<button
				class:chosen={!withProposal}
				aria-pressed={!withProposal}
				onclick={() => (withProposal = false)}>Before</button
			><button
				class:chosen={withProposal}
				aria-pressed={withProposal}
				onclick={() => (withProposal = true)}>Closer stop</button
			>{#if !story?.proposal?.evaluation}<span
					>{loading ? 'Calculating…' : 'Comparison unavailable'}</span
				>{/if}
		</div>{/if}
	<nav class="scenario-navigation" aria-label="Scenario controls">
		<button
			class="step-arrow"
			aria-label="Previous scenario step"
			title="Previous (←)"
			disabled={step === 0}
			onclick={() => move(-1)}><ArrowLeft size={19} /></button
		>
		<div class="step-caption" aria-live="polite">
			<span class="step-number">{String(step + 1).padStart(2, '0')} / {steps.length}</span><span
				>{steps[step]}</span
			>
		</div>
		<button
			class="step-arrow"
			aria-label={step === steps.length - 1 ? 'Finish scenario' : 'Next scenario step'}
			title={step === steps.length - 1 ? 'Finish' : 'Next (→)'}
			onclick={() => (step === steps.length - 1 ? onClose() : move(1))}
			><ArrowRight size={19} /></button
		>
	</nav>
	<div class="scenario-utilities">
		<button aria-label="Replay scenario step" title="Replay (R)" onclick={() => (replay += 1)}
			><RotateCcw size={15} /></button
		><button aria-label="Exit scenario" title="Exit (Esc)" onclick={onClose}><X size={17} /></button
		>
	</div>
</section>

<style>
	.scenario-presenter {
		position: absolute;
		inset: 0;
		z-index: 15;
		pointer-events: none;
		color: var(--theme-color-273732);
	}
	button {
		cursor: pointer;
		pointer-events: auto;
		border: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: inherit;
	}
	button:focus-visible {
		outline: 2px solid var(--theme-color-16866e);
		outline-offset: 3px;
	}
	button:disabled {
		opacity: 0.22;
		cursor: default;
	}
	button:active:not(:disabled) {
		transform: scale(0.96);
	}
	.journey-clocks {
		position: absolute;
		top: 24px;
		left: 24px;
		display: grid;
		grid-template-columns: 1fr 1fr;
		width: 500px;
		max-width: calc(100% - 48px);
		border: 1px solid #d6e1dbb3;
		border-radius: 18px;
		background: #f0f5f2f5;
		box-shadow: 0 8px 32px #173c2610;
		overflow: hidden;
	}
	.journey-clock {
		position: relative;
		min-width: 0;
		padding: 14px 18px;
		color: #61756d;
	}
	.journey-clock.current {
		background: #ffffff;
		color: var(--theme-color-273732);
	}
	.journey-clock.current::after {
		content: '';
		position: absolute;
		inset: auto 18px 0;
		height: 2px;
		background: var(--theme-color-16866e);
	}
	.journey-clock + .journey-clock {
		border-left: 1px solid #dce5df;
	}
	.clock-label {
		font-size: 13px;
		font-weight: 600;
	}
	.current .clock-label {
		color: var(--theme-color-16866e);
	}
	.clock-value {
		display: flex;
		align-items: baseline;
		gap: 7px;
		margin: 3px 0 5px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.clock-value strong {
		font-size: 32px;
		line-height: 1.15;
		font-weight: 600;
		letter-spacing: -0.04em;
	}
	.clock-value > span {
		font-size: 12px;
		color: var(--theme-color-6f8177);
	}
	.clock-status {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
		font-size: 11px;
		color: var(--theme-color-6f8177);
	}
	.clock-status i {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: #a5b4aa;
	}
	.running .clock-status i {
		background: var(--theme-color-16866e);
	}
	.clock-basis {
		display: none;
	}
	.scenario-island-panel {
		position: absolute;
		right: 24px;
		top: 24px;
		max-height: calc(100% - 128px);
		width: 410px;
		max-width: calc(100% - 32px);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		pointer-events: auto;
		border: 1px solid #d6e1dbb3;
		border-radius: 22px;
		background: var(--theme-color-ffffff);
		box-shadow: 0 12px 40px #173c2614;
		transition: opacity 180ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.scenario-island-panel.awaiting-camera {
		opacity: 0;
		pointer-events: none;
	}
	.scenario-island-panel header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-shrink: 0;
		padding: 22px 24px 18px;
		border-bottom: 1px solid var(--theme-color-e1e7e0);
	}
	.panel-eyebrow {
		display: block;
		margin-bottom: 5px;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.12em;
		color: var(--theme-color-6f8177);
	}
	h2 {
		margin: 0;
		font-size: 28px;
		font-weight: 600;
		letter-spacing: -0.04em;
	}
	.scenario-island-panel header button {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: transparent;
		color: var(--theme-color-6f8177);
	}
	.island-panel-body {
		overflow: auto;
		overscroll-behavior: contain;
		padding: 16px;
		scrollbar-width: thin;
	}
	.scenario-navigation {
		position: absolute;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 5px;
		border: 1px solid #d6e1db70;
		border-radius: 40px;
		background: #fffffff0;
		box-shadow: 0 4px 20px #173c2608;
		pointer-events: auto;
	}
	.step-arrow {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: transparent;
		color: var(--theme-color-50635b);
		transition:
			background-color 150ms ease,
			transform 150ms ease;
	}
	.step-caption {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 13px;
		white-space: nowrap;
	}
	.step-number {
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		color: var(--theme-color-6f8177);
	}
	.scenario-utilities {
		position: absolute;
		bottom: 29px;
		right: 24px;
		display: flex;
		gap: 5px;
		pointer-events: auto;
	}
	.scenario-utilities button {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: #ffffffd9;
		color: var(--theme-color-6f8177);
	}
	.scenario-context {
		position: absolute;
		top: 148px;
		left: 24px;
		max-width: 500px;
		padding: 10px 15px;
		border-radius: 14px;
		background: #fffffff2;
		font-size: 14px;
		line-height: 1.45;
		box-shadow: 0 3px 20px #173c2608;
	}
	.scenario-status {
		position: absolute;
		bottom: 90px;
		left: 24px;
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 10px 14px;
		max-width: 350px;
		border-radius: 16px;
		background: #fffffff0;
		font-size: 11px;
		pointer-events: auto;
	}
	.scenario-status button {
		background: transparent;
		color: var(--theme-color-16866e);
		text-decoration: underline;
	}
	.loading-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--theme-color-16866e);
		animation: breathe 1.4s ease-in-out infinite;
	}
	.scenario-comparison {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		bottom: 88px;
		display: flex;
		gap: 3px;
		align-items: center;
		padding: 4px;
		border-radius: 30px;
		background: #fffffff0;
		pointer-events: auto;
		font-size: 13px;
	}
	.scenario-comparison button {
		padding: 9px 16px;
		border-radius: 24px;
		background: transparent;
		font-size: 13px;
	}
	.scenario-comparison button.chosen {
		background: var(--theme-color-16866e);
		color: white;
	}
	.scenario-comparison span {
		padding: 0 12px;
	}
	.comparison-outcome {
		position: absolute;
		top: 24px;
		right: 24px;
		padding: 18px 24px;
		border: 1px solid #d6e1dbb3;
		border-radius: 18px;
		background: #fffffff5;
		box-shadow: 0 8px 32px #173c2610;
	}
	.outcome-label {
		font-size: 14px;
		font-weight: 600;
	}
	.outcome-values {
		display: flex;
		align-items: center;
		gap: 22px;
		margin-top: 8px;
	}
	.outcome-values > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: #718179;
	}
	.outcome-values strong {
		font-size: 34px;
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: -0.05em;
		font-variant-numeric: tabular-nums;
	}
	.outcome-values span {
		font-size: 12px;
	}
	.outcome-values .emphasized {
		color: var(--theme-color-16866e);
	}
	.outcome-values > div:first-child.emphasized {
		color: #b25d43;
	}
	.reopen-island {
		position: absolute;
		top: 24px;
		right: 24px;
		gap: 8px;
		padding: 12px 16px;
		border-radius: 24px;
		background: white;
		font-size: 12px;
	}
	@media (hover: hover) {
		button:hover:not(:disabled) {
			background: var(--theme-color-e1e7e0);
		}
		.scenario-comparison button.chosen:hover {
			background: var(--theme-color-16866e);
		}
	}
	@keyframes breathe {
		50% {
			opacity: 0.35;
		}
	}
	@media (min-width: 701px) and (max-width: 1307px) {
		.journey-clocks {
			width: min(500px, calc(100% - 480px));
		}
		.journey-clock {
			padding: 12px 10px;
		}
		.clock-value {
			gap: 4px;
			flex-wrap: wrap;
		}
		.clock-value strong {
			font-size: clamp(22px, 3vw, 32px);
		}
		.clock-value > span {
			font-size: 9px;
		}
		.scenario-context {
			top: 160px;
			max-width: calc(100% - 480px);
		}
	}
	@media (max-width: 700px) {
		.journey-clocks {
			top: 14px;
			left: 12px;
			width: calc(100% - 24px);
			max-width: none;
		}
		.journey-clock {
			padding: 10px 11px;
		}
		.clock-value {
			gap: 5px;
			flex-wrap: wrap;
		}
		.clock-value strong {
			font-size: 26px;
		}
		.clock-value > span {
			font-size: 10px;
		}
		.clock-status {
			font-size: 9px;
		}
		.scenario-island-panel {
			top: auto;
			bottom: 82px;
			right: 12px;
			left: 12px;
			width: auto;
			max-width: none;
			max-height: 43dvh;
			border-radius: 18px;
		}
		.scenario-island-panel header {
			padding: 12px 16px;
		}
		h2 {
			font-size: 18px;
		}
		.island-panel-body {
			padding: 12px;
		}
		.scenario-navigation {
			left: 12px;
			right: 78px;
			transform: none;
			bottom: 16px;
			justify-content: space-between;
			gap: 2px;
		}
		.step-caption {
			flex-direction: column;
			gap: 2px;
			font-size: 10px;
		}
		.step-arrow {
			width: 36px;
			height: 36px;
		}
		.scenario-utilities {
			bottom: 19px;
			right: 9px;
			gap: 0;
		}
		.scenario-utilities button {
			width: 30px;
			height: 36px;
		}
		.scenario-context {
			top: 132px;
			left: 12px;
			max-width: calc(100% - 24px);
			font-size: 12px;
		}
		.scenario-status {
			bottom: 74px;
			left: 12px;
			max-width: calc(100% - 24px);
		}
		.scenario-comparison {
			bottom: 76px;
		}
		.reopen-island {
			right: 12px;
			top: 132px;
		}
		.comparison-outcome {
			top: auto;
			bottom: 132px;
			left: 50%;
			right: auto;
			transform: translateX(-50%);
			width: max-content;
			max-width: calc(100% - 24px);
			padding: 12px 18px;
		}
		.outcome-values {
			gap: 18px;
			margin-top: 4px;
		}
		.outcome-values strong {
			font-size: 28px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		*,
		*::before,
		*::after {
			animation: none !important;
			transition: none !important;
		}
	}
</style>
