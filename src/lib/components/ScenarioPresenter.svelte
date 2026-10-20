<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { ArrowLeft, ArrowRight, RotateCcw, X, ChevronRight } from '@lucide/svelte';
	import IslandOverview from './IslandOverview.svelte';
	import { emptyFeatures } from '#lib/map-policy.js';
	import {
		loadPresentationStory,
		retryFailedPresentationStory,
		PRESENTATION_LOCATIONS,
		type PresentationStory
	} from '#lib/presentation-story.js';
	import { seaNetworkMapState } from '#lib/sea-connectivity.js';
	import type { PresentationView } from '#lib/presentation-state.js';
	import type { PresentationMapScene, PresentationProgress } from '#lib/presentation-map.js';
	import {
		formatPresentationElapsedMinutes,
		formatPresentationTotal,
		presentationJourneySummary,
		presentationPlaybackLegs,
		presentationPlaybackState,
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
	type SceneKind =
		| 'island'
		| 'ferry-inspect'
		| 'ferry-travel'
		| 'airport'
		| 'flight-inspect'
		| 'flight-travel'
		| 'access'
		| 'population'
		| 'walk'
		| 'bus';
	type Scene = {
		title: string;
		kind: SceneKind;
		location: 'baarah' | 'vashafaru' | 'dhidhdhoo' | 'hanimaadhoo' | 'hulhumale';
		chapter: number;
		ferryIndex?: number;
	};
	const scenes: Scene[] = [
		{ title: 'Baarah, Haa Alifu', kind: 'island', location: 'baarah', chapter: 0 },
		{
			title: 'Baarah → Vashafaru',
			kind: 'ferry-inspect',
			location: 'baarah',
			chapter: 1,
			ferryIndex: 0
		},
		{
			title: 'Ferry to Vashafaru',
			kind: 'ferry-travel',
			location: 'baarah',
			chapter: 1,
			ferryIndex: 0
		},
		{ title: 'Vashafaru, Haa Alifu', kind: 'island', location: 'vashafaru', chapter: 1 },
		{
			title: 'Vashafaru → Dhidhdhoo',
			kind: 'ferry-inspect',
			location: 'vashafaru',
			chapter: 1,
			ferryIndex: 1
		},
		{
			title: 'Ferry to Dhidhdhoo',
			kind: 'ferry-travel',
			location: 'vashafaru',
			chapter: 1,
			ferryIndex: 1
		},
		{ title: 'Dhidhdhoo, Haa Alifu', kind: 'island', location: 'dhidhdhoo', chapter: 1 },
		{
			title: 'Dhidhdhoo → Hanimaadhoo',
			kind: 'ferry-inspect',
			location: 'dhidhdhoo',
			chapter: 1,
			ferryIndex: 2
		},
		{
			title: 'Ferry to Hanimaadhoo',
			kind: 'ferry-travel',
			location: 'dhidhdhoo',
			chapter: 1,
			ferryIndex: 2
		},
		{ title: 'Hanimaadhoo Airport', kind: 'airport', location: 'hanimaadhoo', chapter: 2 },
		{ title: 'Hanimaadhoo → Velana', kind: 'flight-inspect', location: 'hanimaadhoo', chapter: 2 },
		{ title: 'Landing at Velana', kind: 'flight-travel', location: 'hanimaadhoo', chapter: 2 },
		{ title: 'The last few kilometres', kind: 'access', location: 'hulhumale', chapter: 3 },
		{ title: 'People behind the map', kind: 'population', location: 'hulhumale', chapter: 3 },
		{ title: 'The walk to a bus', kind: 'walk', location: 'hulhumale', chapter: 4 },
		{ title: 'The bus to the airport', kind: 'bus', location: 'hulhumale', chapter: 4 }
	];
	const steps = scenes.map((scene) => scene.title);
	const chapters = [
		'Baarah',
		'Ferry through the north',
		'Hanimaadhoo to Velana',
		'The Phase 3 access gap',
		'Journey to the airport'
	];
	let step = $state(0),
		replay = $state(0),
		loading = $state(true),
		failure = $state(''),
		collapsed = $state(false);
	let story = $state.raw<PresentationStory | null>(null);
	let panelBody = $state<HTMLDivElement>();
	let controller: AbortController | undefined;
	const blank = emptyFeatures();
	const scene = $derived(scenes[step]);
	const islandId = $derived(PRESENTATION_LOCATIONS[scene.location].id);
	const ferry = $derived(story?.ferryLegs[scene.ferryIndex ?? 0]);
	const islandData = $derived(story?.islandData[islandId]);
	const islandTravel = $derived(scene.kind === 'ferry-travel' || scene.kind === 'flight-travel');
	const islandPanel = $derived(
		islandTravel || ['island', 'airport', 'access', 'population'].includes(scene.kind)
	);
	const ferryScene = $derived(scene.kind.startsWith('ferry-'));
	const flightScene = $derived(scene.kind.startsWith('flight-'));
	const pickupScene = $derived(scene.kind === 'walk' || scene.kind === 'bus');
	const pickupCurrent = $derived(scene.chapter >= 3);
	const animated = $derived(['ferry-travel', 'flight-travel', 'walk', 'bus'].includes(scene.kind));
	const itinerary = $derived(
		story?.journey?.segments.flatMap((segment) =>
			segment.status === 'ok' && segment.result?.journey?.status === 'reachable'
				? [segment.result.journey]
				: []
		) ?? []
	);
	const legs = $derived(itinerary.flatMap((journey) => journey.legs));
	const firstWalk = $derived(legs.find((leg) => leg.mode === 'walk'));
	const chapter = $derived(scene.chapter);
	const pickupLegs = $derived(legs.filter((leg) => leg !== firstWalk));
	const pickupPlayback = $derived(
		presentationPlaybackLegs(pickupLegs, { weights: { wait: 3, bus: 6, walk: 1 } })
	);
	const connectionWaitWeight = $derived(
		scene.ferryIndex === 0 ? 2.5 : scene.ferryIndex === 1 ? 0.8 : 1.8
	);
	const arrivalPlayback = $derived(
		islandTravel
			? presentationPlaybackLegs(
					[
						{
							mode: 'wait',
							minutes: ferryScene ? ferry?.waitMinutes : story?.timing.connection.minutes
						},
						{
							mode: ferryScene ? 'ferry' : 'air',
							minutes: ferryScene ? ferry?.minutes : story?.timing.flight.minutes,
							geometry: ferryScene ? ferry?.geometry : story?.flightGeometry
						}
					],
					{ weights: { wait: ferryScene ? connectionWaitWeight : 2.5, ferry: 4.5, air: 4.75 } }
				)
			: []
	);
	const journeySummary = $derived(presentationJourneySummary(legs));
	const playbackReady = $derived(
		islandTravel
			? arrivalPlayback.length > 0
			: scene.kind === 'bus'
				? pickupPlayback.length > 0
				: scene.kind === 'walk' && firstWalk?.minutes != null
	);
	// Keep panel updates independent of the map scene so arrival cannot restart playback.
	const statsIslandId = $derived(
		islandTravel &&
			playbackReady &&
			progress?.key === `${step}:${replay}` &&
			progress.phase === 'complete'
			? PRESENTATION_LOCATIONS[scenes[step + 1].location].id
			: islandId
	);
	const statsData = $derived(story?.islandData[statsIslandId]);
	const airportStats = $derived(statsIslandId === PRESENTATION_LOCATIONS.hanimaadhoo.id);
	const playbackProgress = $derived(progress?.key === `${step}:${replay}` ? progress.progress : 0);
	const arrivalState = $derived(presentationPlaybackState(playbackProgress, arrivalPlayback));
	const pickupState = $derived(
		scene.kind === 'bus' ? presentationPlaybackState(playbackProgress, pickupPlayback) : null
	);
	const playbackRunning = $derived(
		progress?.key === `${step}:${replay}` && progress.phase === 'playing'
	);
	const arrivalRunning = $derived(
		playbackRunning && (scene.kind === 'ferry-travel' || scene.kind === 'flight-travel')
	);
	const cameraEntering = $derived(
		progress?.key !== `${step}:${replay}` || ['idle', 'entering'].includes(progress.phase)
	);
	const arrivalClock = $derived(
		presentationTimeline(
			step,
			arrivalState?.clockProgress ?? playbackProgress,
			scenes.flatMap((item, index) =>
				item.kind === 'ferry-travel'
					? [{ step: index, minutes: story?.ferryLegs[item.ferryIndex!]?.elapsedMinutes }]
					: item.kind === 'flight-travel'
						? [
								{
									step: index,
									minutes:
										story?.timing.connection.minutes != null && story?.timing.flight.minutes != null
											? story.timing.connection.minutes + story.timing.flight.minutes
											: null
								}
							]
						: []
			)
		)
	);
	const pickupClock = $derived(
		presentationTimeline(
			step,
			scene.kind === 'bus' ? (pickupState?.clockProgress ?? playbackProgress) : playbackProgress,
			[
				{ step: 14, minutes: firstWalk?.minutes },
				{
					step: 15,
					minutes: legs.length
						? legs.filter((leg) => leg !== firstWalk).reduce((sum, leg) => sum + leg.minutes, 0)
						: null
				}
			]
		)
	);
	const minutes = (value: number | null | undefined) =>
		value == null ? 'Unavailable' : value > 0 && value < 1 ? '<1 min' : `${Math.round(value)} min`;
	const sailingTime = (value: number | null | undefined) =>
		value == null
			? ''
			: `${String(Math.floor(value / 60) % 24).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
	const duration = (value: number | null | undefined) =>
		value == null ? 'Unconfirmed' : formatPresentationTotal(value * 60);
	const shortIslandName = (name: string, islandId?: string) =>
		Object.values(PRESENTATION_LOCATIONS)
			.find((location) => location.id === islandId)
			?.name.split(' · ')[0] ?? name.replace(/^(?:Ha|Hdh)\.\s*/i, '');
	const ferrySources = $derived(
		story?.seaNetwork?.sources.filter((source) => ferry?.route.source_ids.includes(source.id)) ?? []
	);
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
		collapsed = false;
	}
	function advance() {
		if (step === steps.length - 1) onClose();
		else move(1);
	}
	function keydown(event: KeyboardEvent) {
		const target = event.target;
		if (
			event.defaultPrevented ||
			event.repeat ||
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
			advance();
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
		const data = story;
		const crossing = ferry;
		const haq = data?.airports.haq?.coordinates ?? ([73.1705, 6.7442] as Coordinates);
		const mle = data?.airports.mle?.coordinates ?? ([73.529, 4.1918] as Coordinates);
		const location = PRESENTATION_LOCATIONS[scene.location];
		let paths: PresentationMapScene['paths'] = [];
		if (ferryScene && crossing?.geometry.length)
			paths = [{ mode: 'ferry', coordinates: crossing.geometry }];
		if (flightScene && data?.flightGeometry.length)
			paths = [{ mode: 'air', coordinates: data.flightGeometry }];
		if (pickupScene)
			paths = legs
				.filter(
					(leg) =>
						leg.geometry?.length > 1 &&
						leg.mode !== 'wait' &&
						(scene.kind === 'walk' ? leg === firstWalk : leg !== firstWalk)
				)
				.map((leg) => ({ mode: leg.mode as 'walk' | 'bus' | 'ferry', coordinates: leg.geometry }));
		let camera: PresentationMapScene['camera'];
		if (scene.kind === 'island') camera = { center: location.coordinates, zoom: 14.1 };
		else if (ferryScene)
			camera = {
				bounds: crossing?.geometry.length
					? bounds(crossing.geometry)
					: bounds([
							PRESENTATION_LOCATIONS.baarah.coordinates,
							PRESENTATION_LOCATIONS.hanimaadhoo.coordinates
						]),
				maxZoom: 12.8
			};
		else if (scene.kind === 'airport') camera = { center: haq, zoom: 13.6 };
		else if (flightScene) camera = { bounds: bounds([haq, mle]), maxZoom: 9 };
		else if (scene.kind === 'walk' && paths.length)
			camera = { bounds: bounds(paths.flatMap((path) => path.coordinates)), maxZoom: 16 };
		else if (scene.kind === 'bus')
			camera = {
				bounds: [
					[73.514, 4.186],
					[73.555, 4.247]
				],
				maxZoom: 13.5
			};
		else {
			const origin = data?.origin?.coordinates ?? ([73.5404, 4.2371] as Coordinates);
			camera = {
				bounds: [
					[origin[0] - 0.0075, origin[1] - 0.014],
					[origin[0] + 0.0125, origin[1] + 0.006]
				],
				maxZoom: 14.7
			};
		}
		camera.durationMs = scene.kind === 'flight-travel' || scene.kind === 'access' ? 1500 : 1100;
		camera.bearing = flightScene ? 0 : -8;
		camera.pitch = flightScene ? 12 : 20;
		const panel =
			islandPanel && !collapsed
				? ('island' as const)
				: scene.kind === 'flight-inspect' || scene.kind === 'ferry-inspect'
					? ('route' as const)
					: undefined;
		const duration =
			scene.kind === 'ferry-travel'
				? crossing?.elapsedMinutes
				: scene.kind === 'flight-travel'
					? data?.timing.connection.minutes != null && data?.timing.flight.minutes != null
						? data.timing.connection.minutes + data.timing.flight.minutes
						: undefined
					: scene.kind === 'walk'
						? firstWalk?.minutes
						: scene.kind === 'bus'
							? pickupLegs.reduce((sum, leg) => sum + leg.minutes, 0)
							: undefined;
		const airNetwork =
			data?.airNetwork && (flightScene || scene.kind === 'airport')
				? {
						...data.airNetwork,
						map_features: {
							...data.airNetwork.map_features,
							features: data.airNetwork.map_features.features.filter(
								(feature) => feature.properties?.route_id === data.flight?.id
							)
						},
						airports: data.airNetwork.airports.filter((airport) =>
							['HAQ', 'MLE'].includes(airport.iata)
						)
					}
				: null;
		const showSea = scene.chapter <= 1 || scene.kind === 'airport';
		return {
			scene: {
				key: `${step}:${replay}`,
				...(ferryScene
					? { continuityKey: `ferry-${scene.ferryIndex}` }
					: flightScene
						? { continuityKey: 'flight' }
						: scene.kind === 'access' || scene.kind === 'population'
							? { continuityKey: 'hulhumale' }
							: pickupScene
								? { continuityKey: 'pickup' }
								: {}),
				...(scene.kind === 'access'
					? {
							handoff: {
								from: mle,
								to: data?.origin?.coordinates ?? ([73.5404, 4.2371] as Coordinates),
								fromLabel: 'Velana Airport',
								toLabel: 'Phase 3',
								holdMs: 900
							}
						}
					: {}),
				paths,
				...(ferryScene && crossing?.geometry.length
					? {
							stops: [
								{
									coordinates: crossing.geometry[0],
									label: shortIslandName(crossing.from, crossing.fromIslandId),
									detail: sailingTime(crossing.departure)
								},
								{
									coordinates: crossing.geometry.at(-1)!,
									label: shortIslandName(crossing.to, crossing.toIslandId),
									detail: sailingTime(crossing.arrival)
								}
							]
						}
					: flightScene
						? {
								stops: [
									{ coordinates: haq, label: 'Hanimaadhoo', detail: 'HAQ' },
									{ coordinates: mle, label: 'Velana Airport', detail: 'MLE · Hulhumalé' }
								]
							}
						: {}),
				camera,
				panel,
				emphasis: { quietContext: step > 0 },
				...(scene.kind === 'ferry-inspect' && crossing
					? {
							inspect: {
								mode: 'ferry' as const,
								routeId: crossing.route.id,
								coordinates: crossing.geometry[0],
								summary: {
									title: `${shortIslandName(crossing.from, crossing.fromIslandId)} → ${shortIslandName(crossing.to, crossing.toIslandId)}`,
									minutes: crossing.minutes,
									weeklySailings: crossing.sourceWeeklySailings,
									qualification: crossing.qualification,
									timingLabel: 'Route crossing',
									frequencyLabel: 'Source weekly sailings'
								}
							}
						}
					: {}),
				...(scene.kind === 'flight-inspect' && data?.flight
					? {
							inspect: {
								mode: 'air' as const,
								routeId: data.flight.id,
								coordinates: haq,
								summary: {
									title: 'Hanimaadhoo → Velana',
									minutes: data.timing.flight.minutes,
									weeklySailings: null,
									qualification: `${data.timing.flight.qualification} ${data.timing.connection.qualification}`,
									timingLabel: 'Estimated flight'
								}
							}
						}
					: {}),
				...(animated && paths.length && playbackReady
					? {
							playback: {
								durationMs:
									scene.kind === 'flight-travel'
										? 7250
										: scene.kind === 'ferry-travel'
											? 4500 + connectionWaitWeight * 1000
											: scene.kind === 'bus'
												? 10000
												: 8000,
								establishMs: scene.kind === 'flight-travel' ? 850 : 700,
								...(islandTravel || scene.kind === 'bus' ? { continueFrom: `${step - 1}:` } : {}),
								...(scene.kind === 'bus' ? { timeline: pickupPlayback } : {}),
								...(islandTravel && arrivalPlayback.length ? { timeline: arrivalPlayback } : {}),
								follow: true,
								label: steps[step],
								...(duration ? { clockMinutes: duration } : {})
							}
						}
					: {}),
				...(scene.kind === 'population' ? { population: data?.populationFeatures ?? blank } : {})
			},
			islandId: statsIslandId,
			gaps: scene.kind !== 'population' ? (statsData?.gaps ?? blank) : blank,
			coverage: scene.kind !== 'population' ? (statsData?.coverage ?? blank) : blank,
			comparison: blank,
			comparisonView: 'current',
			operations: [],
			lens: pickupCurrent ? 'transport' : 'overall',
			seaState:
				data?.seaNetwork && showSea
					? seaNetworkMapState(data.seaNetwork, null, statsIslandId)
					: null,
			airNetwork,
			showSea,
			showAir: scene.kind === 'airport' || flightScene
		};
	});
	$effect(() => {
		const value = view;
		untrack(() => onView(value));
	});
	$effect(() => {
		const currentIsland = statsIslandId,
			profile = statsData?.profile;
		if (!panelBody || !profile) return;
		void tick().then(() => {
			if (statsIslandId === currentIsland) panelBody?.scrollTo({ top: 0, behavior: 'auto' });
		});
	});

	const context = $derived(
		step === 0 && story
			? `Journey starts ${story.travelStart.date} at ${sailingTime(story.travelStart.minutes)}`
			: scene.kind === 'ferry-travel' && ferry
				? `${shortIslandName(ferry.from, ferry.fromIslandId)} → ${shortIslandName(ferry.to, ferry.toIslandId)} · ${minutes(ferry.minutes)}`
				: scene.kind === 'flight-travel'
					? `HAQ → MLE · ${minutes(story?.timing.flight.minutes)} estimated flight`
					: ''
	);
	const routeUnavailable = $derived(
		!loading && story
			? ferryScene && !ferry
				? (story.errors.ferry ?? 'Ferry connection unavailable.')
				: ferryScene && ferry?.elapsedMinutes == null
					? (story.errors[`ferryTiming:${scene.ferryIndex}`] ?? 'Ferry timetable unavailable.')
					: flightScene && !story.flightGeometry.length
						? (story.errors.flight ?? 'Air connection unavailable.')
						: pickupScene && !legs.length
							? (story.errors.journey ?? 'Airport itinerary unavailable.')
							: ''
			: ''
	);
</script>

<section
	class="scenario-presenter"
	aria-label="Scenario presentation"
	data-step={step}
	data-scene={scene.kind}
	data-chapter={chapter + 1}
	aria-busy={loading}
>
	<div class="journey-overlay">
		<div class="journey-clocks" class:pickup-current={pickupCurrent} aria-label="Journey timers">
			<div
				class="journey-clock"
				class:current={!pickupCurrent}
				class:running={arrivalRunning}
				data-testid="presentation-arrival-clock"
				data-active={!pickupCurrent}
				data-elapsed-seconds={arrivalClock.elapsedSeconds}
				data-total-seconds={arrivalClock.totalSeconds ?? ''}
				data-running={arrivalRunning}
				title={story?.timing.arrival.qualification ?? 'Ferry and flight travel time'}
			>
				<span class="clock-label">To Hulhumalé</span>
				<div class="clock-value">
					<strong
						>{formatPresentationElapsedMinutes(arrivalClock.elapsedSeconds)}{arrivalClock.incomplete
							? '+'
							: ''}</strong
					>
					<span>/ {formatPresentationTotal(arrivalClock.totalSeconds)}</span>
				</div>
				<span class="clock-status"
					><i aria-hidden="true"></i>{playbackRunning && arrivalState?.stationary
						? ferryScene
							? 'Waiting for ferry · Accelerated'
							: 'Airport connection · Accelerated'
						: playbackRunning && scene.kind === 'ferry-travel'
							? 'Ferry · Accelerated'
							: playbackRunning && scene.kind === 'flight-travel'
								? 'Flight · Accelerated'
								: 'Paused'}<span class="clock-basis">Travel estimate</span></span
				>
				<span class="clock-note">Includes waits · air connection assumed</span>
				<span class="clock-track" aria-hidden="true"
					><span
						style:transform={`scaleX(${arrivalClock.totalSeconds ? arrivalClock.elapsedSeconds / arrivalClock.totalSeconds : 0})`}
					></span></span
				>
			</div>
			<div
				class="journey-clock"
				class:current={pickupCurrent}
				class:running={playbackRunning && pickupScene}
				data-testid="presentation-pickup-clock"
				data-active={pickupCurrent}
				data-elapsed-seconds={pickupClock.elapsedSeconds}
				data-total-seconds={pickupClock.totalSeconds ?? ''}
				data-running={playbackRunning && pickupScene}
				title={story?.timing.pickup.qualification ?? 'Walk, wait and direct airport bus'}
			>
				<span class="clock-label">To the airport</span>
				<div class="clock-value">
					<strong
						>{formatPresentationElapsedMinutes(pickupClock.elapsedSeconds)}{pickupClock.incomplete
							? '+'
							: ''}</strong
					>
					<span>/ {formatPresentationTotal(pickupClock.totalSeconds)}</span>
				</div>
				<span class="clock-status"
					><i aria-hidden="true"></i>{playbackRunning && scene.kind === 'walk'
						? 'Walking · Accelerated'
						: playbackRunning && scene.kind === 'bus'
							? pickupState?.mode === 'wait'
								? 'Waiting · Accelerated'
								: pickupState?.mode === 'walk'
									? 'Terminal walk · Accelerated'
									: 'Bus · Accelerated'
							: 'Paused'}<span class="clock-basis">Walk + wait + ride</span></span
				>
				<span class="clock-note">Includes bus wait + terminal walk</span>
				<span class="clock-track" aria-hidden="true"
					><span
						style:transform={`scaleX(${pickupClock.totalSeconds ? pickupClock.elapsedSeconds / pickupClock.totalSeconds : 0})`}
					></span></span
				>
			</div>
		</div>
		{#if context}{#key step}<div class="scenario-context" aria-live="polite">
					{context}
				</div>{/key}{/if}
		{#if pickupScene}
			<div
				class="journey-stages"
				aria-label="Airport journey breakdown"
				data-stage={scene.kind === 'walk' ? 'walk' : (pickupState?.mode ?? 'wait')}
			>
				{#each [{ mode: 'walk', label: 'Walk', value: journeySummary.walkMinutes }, { mode: 'wait', label: 'Wait', value: journeySummary.waitMinutes }, { mode: 'bus', label: 'Ride', value: journeySummary.rideMinutes }] as segment (segment.mode)}
					<div
						class:active={scene.kind === 'walk'
							? segment.mode === 'walk'
							: segment.mode === pickupState?.mode}
					>
						<span>{segment.label}</span><strong>{minutes(segment.value)}</strong>
					</div>
				{/each}
			</div>
		{/if}
		{#if scene.kind === 'access'}
			<div class="access-legend" aria-label="Transport heatmap legend">
				<span class="legend-ramp" aria-hidden="true"></span>
				<div>
					<strong>Walk to public transport</strong><span
						>Shorter walk <span aria-hidden="true">→</span> Longer walk</span
					>
				</div>
			</div>
		{/if}
	</div>
	{#if islandPanel && !collapsed}
		<aside
			class="scenario-island-panel"
			class:awaiting-camera={cameraEntering && !islandTravel}
			inert={cameraEntering && !islandTravel}
			aria-label="Scenario island details"
		>
			<header>
				<div>
					<span class="panel-eyebrow">{airportStats ? 'AIRPORT ISLAND' : 'ISLAND ACCESS'}</span>
					<h2>{statsData?.profile?.island.name ?? steps[step]}</h2>
				</div>
				<button
					aria-label="Collapse island details"
					title="Collapse island details"
					onclick={() => (collapsed = true)}><ChevronRight size={19} /></button
				>
			</header>
			<div class="island-panel-body" bind:this={panelBody}>
				{#if ferryScene && ferry}
					<section
						class="scenario-ferry-summary"
						aria-label="Ferry connection"
						data-stage={progress?.key === `${step}:${replay}` && progress.phase === 'complete'
							? 'complete'
							: (arrivalState?.mode ?? 'wait')}
					>
						<div class="connection-heading">
							<span>FERRY · {ferry.route.route_code ?? ferry.route.name}</span>
							<span
								>{progress?.key === `${step}:${replay}` && progress.phase === 'complete'
									? 'Arrived'
									: arrivalState?.stationary
										? 'Waiting at the jetty'
										: 'Crossing'}</span
							>
						</div>
						<h3>
							{shortIslandName(ferry.from, ferry.fromIslandId)} → {shortIslandName(
								ferry.to,
								ferry.toIslandId
							)}
						</h3>
						<dl class="connection-metrics">
							<div>
								<dt>Crossing</dt>
								<dd>{minutes(ferry.minutes)}</dd>
							</div>
							<div>
								<dt>Weekly sailings</dt>
								<dd>{ferry.sourceWeeklySailings ?? '—'}</dd>
							</div>
							<div>
								<dt>Wait</dt>
								<dd>{duration(ferry.waitMinutes)}</dd>
							</div>
						</dl>
						<p class="connection-departure">
							Departs {ferry.serviceDate ?? 'date unconfirmed'} · {sailingTime(ferry.departure) ||
								'time unconfirmed'}
						</p>
						<details class="connection-source">
							<summary>Source corridor details</summary>
							<p>{ferry.qualification}</p>
							{#each ferrySources as source (source.id)}
								{#if source.url?.startsWith('https://')}<a
										href={source.url}
										target="_blank"
										rel="noreferrer">{source.title}</a
									>{/if}
							{/each}
						</details>
					</section>
				{:else if scene.kind === 'flight-travel'}
					<section class="scenario-ferry-summary" aria-label="Airport connection allowance">
						<div class="connection-heading">
							<span>AIRPORT CONNECTION</span><span>Demo assumption</span>
						</div>
						<dl class="connection-metrics flight-metrics">
							<div>
								<dt>Transfer + check-in</dt>
								<dd>{duration(story?.timing.connection.minutes)}</dd>
							</div>
							<div>
								<dt>Flight</dt>
								<dd>{minutes(story?.timing.flight.minutes)}</dd>
							</div>
						</dl>
						<details class="connection-source">
							<summary>Connection assumptions</summary>
							<p>{story?.timing.connection.qualification}</p>
							{#if story?.timing.connection.sourceUrl}<a
									href={story.timing.connection.sourceUrl}
									target="_blank"
									rel="noreferrer">Maldivian check-in guidance</a
								>{/if}
						</details>
					</section>
				{/if}
				<IslandOverview
					presentation={scene.kind === 'population' ? 'population' : 'access'}
					presentationFact={scene.kind === 'access'
						? {
								label: 'Walk to the nearest bus stop',
								value: minutes(firstWalk?.minutes),
								detail: 'From Phase 3 · Modeled walking route'
							}
						: airportStats
							? {
									label: 'Airport connection',
									value: 'HAQ',
									detail: 'Hanimaadhoo Airport · Air connection to Velana'
								}
							: undefined}
					presentationAirport={story?.airNetwork?.airports.find(
						(airport) => airport.island_id === statsIslandId
					) ?? null}
					profile={statsData?.profile ?? null}
					loading={statsData?.loading ?? true}
					error={statsData?.error ?? ''}
					connectivity={statsData?.connectivity ?? null}
					connectivityLoading={statsData?.loading ?? true}
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
	{:else if islandTravel && !playbackReady && loading}<div class="scenario-status" role="status">
			<span class="loading-dot"></span>Preparing connection times…
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
	<nav class="scenario-navigation" aria-label="Scenario controls">
		<button
			class="step-arrow"
			aria-label="Previous scenario step"
			title="Previous (←)"
			disabled={step === 0}
			onclick={() => move(-1)}><ArrowLeft size={19} /></button
		>
		<div class="step-caption" aria-live="polite">
			<div class="chapter-caption">
				<span class="step-number"
					>{String(chapter + 1).padStart(2, '0')} / {String(chapters.length).padStart(2, '0')}</span
				><span>{chapters[chapter]}</span><span class="chapter-progress" aria-hidden="true"
					>{#each chapters as chapterName, index (chapterName)}<i
							class:passed={index < chapter}
							class:current={index === chapter}
						></i>{/each}</span
				>
			</div>
			<span class="scene-caption">{steps[step]}</span>
		</div>
		<button
			class="step-arrow"
			aria-label={step === steps.length - 1 ? 'Finish scenario' : 'Next scenario step'}
			title={step === steps.length - 1 ? 'Finish' : 'Next (→)'}
			onclick={advance}><ArrowRight size={19} /></button
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
	.journey-overlay {
		position: absolute;
		top: 24px;
		left: 24px;
		width: 440px;
		max-width: calc(100% - 48px);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
	}
	.journey-clocks {
		display: grid;
		grid-template-columns: 1fr 1fr;
		width: 100%;
		border: 1px solid #d6e1dbb3;
		border-radius: 18px;
		background: #f0f5f2f5;
		box-shadow: 0 8px 32px #173c2610;
		overflow: hidden;
	}
	.journey-clock {
		position: relative;
		min-width: 0;
		padding: 11px 16px 13px;
		color: #61756d;
		display: flex;
		flex-direction: column;
		justify-content: center;
		transition:
			background-color 260ms ease,
			color 260ms ease;
	}
	.journey-clock.current {
		/* Retain alpha so the browser does not occlude the WebGL canvas behind this pane. */
		background: #fffffffa;
		color: var(--theme-color-273732);
	}
	.clock-track {
		position: absolute;
		inset: auto 16px 0;
		height: 2px;
		background: #dce5df;
		overflow: hidden;
	}
	.clock-track > span {
		display: block;
		height: 100%;
		background: #9cada3;
		transform-origin: left;
		transition: transform 100ms linear;
	}
	.current .clock-track > span {
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
		flex-wrap: wrap;
		align-items: baseline;
		gap: 7px;
		margin: 3px 0 5px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.clock-value strong {
		font-size: 23px;
		line-height: 1.15;
		font-weight: 600;
		letter-spacing: -0.04em;
	}
	.current .clock-value strong {
		font-size: 32px;
	}
	.clock-value > span {
		font-size: 11px;
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
	.clock-note {
		margin-top: 4px;
		font-size: 9px;
		line-height: 1.3;
		color: var(--theme-color-6f8177);
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
		transition:
			opacity 260ms cubic-bezier(0.23, 1, 0.32, 1),
			transform 260ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.scenario-island-panel.awaiting-camera {
		opacity: 0;
		transform: translateY(8px);
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
	.scenario-ferry-summary {
		margin-bottom: 16px;
		padding: 16px;
		border: 1px solid #dce7e1;
		border-radius: 15px;
		background: #f4f8f5;
	}
	.connection-heading {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: #61756d;
	}
	.connection-heading span:last-child {
		color: #16866e;
		letter-spacing: 0;
	}
	.scenario-ferry-summary h3 {
		margin: 10px 0 16px;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.035em;
	}
	.connection-metrics {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
		margin: 14px 0;
	}
	.connection-metrics.flight-metrics {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.connection-metrics dt {
		font-size: 11px;
		color: #61756d;
		margin-bottom: 5px;
	}
	.connection-metrics dd {
		margin: 0;
		font-size: 23px;
		line-height: 1.15;
		font-weight: 600;
		letter-spacing: -0.04em;
		font-variant-numeric: tabular-nums;
	}
	.connection-departure {
		font-size: 11px;
		margin: 0 0 10px;
		color: #50635b;
	}
	.connection-source {
		font-size: 11px;
		line-height: 1.6;
		color: #61756d;
	}
	.connection-source summary {
		cursor: pointer;
		width: fit-content;
	}
	.connection-source p {
		margin: 8px 0;
	}
	.connection-source a {
		display: block;
		color: #16866e;
		text-decoration: underline;
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
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		font-size: 13px;
		white-space: nowrap;
	}
	.chapter-caption {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.scene-caption {
		font-size: 11px;
		color: var(--theme-color-6f8177);
	}
	.chapter-progress {
		display: flex;
		gap: 3px;
		margin-left: 3px;
	}
	.chapter-progress i {
		width: 5px;
		height: 5px;
		border-radius: 5px;
		background: #d4dfd8;
		transition:
			background-color 220ms ease,
			width 220ms ease;
	}
	.chapter-progress i.passed {
		background: #8bbcaf;
	}
	.chapter-progress i.current {
		width: 15px;
		background: var(--theme-color-16866e);
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
		padding: 10px 15px;
		border-radius: 14px;
		background: #fffffff2;
		font-size: 14px;
		line-height: 1.45;
		box-shadow: 0 3px 20px #173c2608;
		animation: scene-enter 300ms cubic-bezier(0.23, 1, 0.32, 1) both;
	}
	.journey-stages {
		width: 100%;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 4px;
		padding: 5px;
		background: #fffffff2;
		border: 1px solid #d6e1dbb3;
		border-radius: 14px;
		animation: scene-enter 300ms cubic-bezier(0.23, 1, 0.32, 1) both;
	}
	.journey-stages > div {
		display: flex;
		align-items: baseline;
		justify-content: center;
		flex-wrap: wrap;
		gap: 6px;
		padding: 10px 7px;
		border-radius: 10px;
		color: #718179;
		transition:
			background-color 280ms ease,
			color 280ms ease;
	}
	.journey-stages > div.active {
		color: #146d5d;
		background: #e8f3ef;
	}
	.journey-stages span {
		font-size: 12px;
	}
	.journey-stages strong {
		font-size: 16px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.access-legend {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 13px;
		border: 1px solid #d6e1db70;
		border-radius: 12px;
		background: #fffffff0;
	}
	.legend-ramp {
		width: 55px;
		height: 8px;
		border-radius: 6px;
		background: linear-gradient(90deg, #81a994, #e6d78c, #d77e68);
	}
	.access-legend > div {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.access-legend strong {
		font-size: 11px;
		font-weight: 600;
	}
	.access-legend div > span {
		font-size: 10px;
		color: #6f8177;
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
	}
	@keyframes breathe {
		50% {
			opacity: 0.35;
		}
	}
	@keyframes scene-enter {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (min-width: 701px) and (max-width: 1307px) {
		.journey-overlay {
			width: min(440px, calc(100% - 480px));
		}
		.journey-clock {
			padding: 12px 10px;
		}
		.clock-value {
			gap: 4px;
			flex-wrap: wrap;
		}
		.current .clock-value strong {
			font-size: clamp(22px, 3vw, 32px);
		}
		.clock-value > span {
			font-size: 9px;
		}
	}
	@media (max-width: 700px) {
		.journey-overlay {
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
		.current .clock-value strong {
			font-size: 26px;
		}
		.clock-value strong {
			font-size: 21px;
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
			display: flex;
			flex-direction: column;
		}
		.island-panel-body > :global(.island-overview) {
			order: -1;
			flex-shrink: 0;
		}
		.scenario-ferry-summary {
			padding: 12px;
			margin: 12px 0 0;
			flex-shrink: 0;
		}
		.scenario-ferry-summary h3 {
			font-size: 20px;
			margin: 8px 0 12px;
		}
		.connection-metrics {
			margin: 10px 0;
		}
		.connection-metrics dd {
			font-size: 21px;
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
			align-items: center;
			gap: 2px;
			font-size: 10px;
		}
		.chapter-caption {
			gap: 5px;
		}
		.chapter-progress {
			display: none;
		}
		.scene-caption {
			font-size: 9px;
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
			font-size: 12px;
		}
		.journey-stages > div {
			gap: 5px;
			padding: 8px 4px;
		}
		.journey-stages strong {
			font-size: 14px;
		}
		.access-legend {
			padding: 8px 11px;
		}
		.scenario-status {
			bottom: 74px;
			left: 12px;
			max-width: calc(100% - 24px);
		}
		.reopen-island {
			right: 12px;
			top: 132px;
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
