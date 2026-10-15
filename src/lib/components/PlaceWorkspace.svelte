<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import {
		ArrowRight,
		ArrowUpRight,
		Camera,
		ChevronLeft,
		ChevronRight,
		Download,
		ExternalLink,
		Globe2,
		MapPin,
		Maximize2,
		MessageSquare,
		Minimize2,
		Navigation,
		PanelBottomClose,
		PanelBottomOpen,
		Plus,
		Search,
		Sparkles,
		Star,
		Trash2,
		X
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import LocationMap from '#lib/components/LocationMap.svelte';
	import { providerRouteCoordinates } from '#lib/map-location.js';
	import {
		placesQuery,
		type ConsumerCoordinates,
		type ConsumerDirections,
		type ConsumerEnvelope,
		type ConsumerMeta,
		type ConsumerPanorama,
		type ConsumerPhotos,
		type ConsumerPlace,
		type ConsumerReviews,
		type ConsumerSearch,
		type ConsumerSuggestions
	} from '#lib/places.js';

	let {
		selectedIsland,
		initialLatitude = 4.1755,
		initialLongitude = 73.5093,
		active = true,
		onFocusPlace,
		onJourneyPoint
	}: {
		selectedIsland?: { id: string; name: string; coordinates?: [number, number] };
		initialLatitude?: number;
		initialLongitude?: number;
		active?: boolean;
		onFocusPlace?: (place: { name: string; latitude: number; longitude: number }) => void;
		onJourneyPoint?: (
			place: { name: string; latitude: number; longitude: number },
			endpoint: 'start' | 'end'
		) => void;
	} = $props();
	let section = $state('discover');
	let workspaceElement: HTMLDivElement;
	let workspaceTop = $state(218);
	let inspectorOpen = $state(false);
	let inspectorExpanded = $state(false);
	let inspectorTrigger = $state.raw<HTMLButtonElement | null>(null);
	function closeInspector() {
		inspectorOpen = false;
		inspectorExpanded = false;
		void tick().then(() => inspectorTrigger?.focus());
	}
	let mapSelection = $state<'origin' | 'destination' | null>(null);
	let waypointSelection = $state<number | null>(null);
	let originName = $state('Island center');
	let destinationName = $state('Choose a destination');
	let destinationChosen = $state(false);
	let waypointNames = $state<string[]>([]);
	let selectedRoute = $state(0);
	let query = $state('hospital');
	let latitude = $state(4.1755);
	let longitude = $state(73.5093);
	let span = $state(25000);
	let language = $state('en');
	let region = $state('MV');
	let searchResult = $state<ConsumerEnvelope<ConsumerSearch> | null>(null);
	let suggestions = $state<ConsumerSuggestions | null>(null);
	let chosen = $state<ConsumerPlace | null>(null);
	let detail = $state<ConsumerEnvelope<ConsumerPlace> | null>(null);
	let photos = $state<ConsumerEnvelope<ConsumerPhotos> | null>(null);
	let reviews = $state<ConsumerEnvelope<ConsumerReviews> | null>(null);
	let reviewBackend = $state<'native' | 'browser'>('native');
	let reviewLimit = $state(10);
	let errors = $state<Record<string, string>>({});
	let busy = $state<Record<string, boolean>>({});
	let browserEnabled = $state(false);
	let providerReady = $state(false);
	let originLatitude = $state(4.1755);
	let originLongitude = $state(73.5093);
	let destinationLatitude = $state(4.1785);
	let destinationLongitude = $state(73.513);
	let routeMode = $state<'driving' | 'walking' | 'bicycling'>('walking');
	let avoidTolls = $state(false);
	let avoidHighways = $state(false);
	let avoidFerries = $state(false);
	let waypoints = $state<ConsumerCoordinates[]>([]);
	let directions = $state<ConsumerEnvelope<ConsumerDirections> | null>(null);
	let panoLatitude = $state(4.1755);
	let panoLongitude = $state(73.5093);
	let panoRadius = $state(200);
	let panoId = $state('');
	let panorama = $state<ConsumerEnvelope<ConsumerPanorama> | null>(null);
	let tileZoom = $state(0);
	let tileX = $state(0);
	let tileY = $state(0);
	let tileSrc = $state('');
	let loadedTile = $state<{ zoom: number; x: number; y: number } | null>(null);
	let scopeKey = '';
	let searchOffset = $state(0);
	let photoFailures = $state<Record<string, boolean>>({});
	const controllers = new SvelteMap<string, AbortController>();
	const selectedPlace = $derived(detail?.data ?? chosen);
	const providerIdentity = $derived(selectedPlace?.feature_id ?? selectedPlace?.place_id ?? null);
	const selectedName = $derived(selectedIsland?.name?.trim() || 'Malé');
	const mapCenter = $derived({
		latitude: selectedIsland?.coordinates?.[1] ?? initialLatitude,
		longitude: selectedIsland?.coordinates?.[0] ?? initialLongitude
	});
	const mapOrigin = $derived(
		section === 'directions'
			? { latitude: Number(originLatitude), longitude: Number(originLongitude) }
			: section === 'imagery'
				? { latitude: Number(panoLatitude), longitude: Number(panoLongitude) }
				: { latitude: Number(latitude), longitude: Number(longitude) }
	);
	const mapDestination = $derived(
		section === 'directions'
			? waypointSelection !== null
				? (waypoints[waypointSelection] ?? null)
				: destinationChosen
					? { latitude: Number(destinationLatitude), longitude: Number(destinationLongitude) }
					: null
			: section === 'imagery'
				? panorama?.data
					? { latitude: panorama.data.latitude, longitude: panorama.data.longitude }
					: null
				: (selectedPlace?.location ?? null)
	);
	const mapOriginLabel = $derived(
		section === 'directions'
			? originName
			: section === 'imagery'
				? 'Imagery search point'
				: `Search area · ${selectedName}`
	);
	const mapDestinationLabel = $derived(
		section === 'directions'
			? waypointSelection !== null
				? `Stop ${waypointSelection + 1}`
				: destinationName
			: section === 'imagery'
				? (panorama?.data.address_label ?? 'Available panorama')
				: (selectedPlace?.name ?? 'Selected place')
	);
	const displayedRoute = $derived(directions?.data.routes[selectedRoute]);
	const routeCoordinates = $derived(
		section === 'directions' ? providerRouteCoordinates(displayedRoute?.geometry?.coordinates) : []
	);
	const extraPoints = $derived.by(() => {
		if (section === 'discover') {
			const places = [...(searchResult?.data.places ?? [])];
			if (selectedPlace && !places.some((place) => place.id === selectedPlace.id))
				places.push(selectedPlace);
			return places.map((place) => ({ id: place.id, label: place.name, ...place.location }));
		}
		if (section === 'directions') {
			const points = waypoints.map((point, index) => ({
				id: `waypoint:${index}`,
				label: waypointNames[index] ?? `Stop ${index + 1}`,
				...point
			}));
			if (waypointSelection !== null && destinationChosen)
				points.push({
					id: 'final-destination',
					label: `Final destination · ${destinationName}`,
					latitude: Number(destinationLatitude),
					longitude: Number(destinationLongitude)
				});
			return points;
		}
		return panorama
			? [
					{
						id: `panorama:${panorama.data.pano_id}`,
						label: panorama.data.address_label ?? 'Available panorama',
						latitude: panorama.data.latitude,
						longitude: panorama.data.longitude
					}
				]
			: [];
	});
	let routeSignature = '';
	let mapSection = '';
	$effect(() => {
		const next = JSON.stringify([
			originLatitude,
			originLongitude,
			destinationLatitude,
			destinationLongitude,
			destinationChosen,
			routeMode,
			avoidTolls,
			avoidHighways,
			avoidFerries,
			waypoints,
			language,
			region
		]);
		untrack(() => {
			if (next === routeSignature) return;
			routeSignature = next;
			controllers.get('directions')?.abort();
			directions = null;
			selectedRoute = 0;
		});
	});
	$effect(() => {
		const nextSection = section;
		untrack(() => {
			if (nextSection === mapSection) return;
			mapSection = nextSection;
			mapSelection = null;
			waypointSelection = null;
		});
	});
	$effect(() => {
		if (mapSelection !== null) {
			untrack(() => {
				inspectorOpen = false;
				inspectorExpanded = false;
			});
		}
	});
	const tileLevel = $derived(panorama?.data.level_dimensions[tileZoom]);
	const tileColumns = $derived(
		tileLevel ? Math.ceil(tileLevel.width / panorama!.data.tile_size) : 1
	);
	const tileRows = $derived(tileLevel ? Math.ceil(tileLevel.height / panorama!.data.tile_size) : 1);
	const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
	const number = (value: number) => numberFormatter.format(value);
	const minutes = (seconds: number | null | undefined) =>
		seconds === null || seconds === undefined ? 'Unavailable' : `${number(seconds / 60)} min`;
	const imageUrl = (url: string) => `/api/backend/places/image?${placesQuery({ url })}`;
	const safeWebsite = (url: string | null | undefined) => {
		if (!url) return null;
		try {
			const value = new URL(url);
			return ['http:', 'https:'].includes(value.protocol) ? value.href : null;
		} catch {
			return null;
		}
	};

	function cancelRequests() {
		for (const controller of controllers.values()) controller.abort();
		controllers.clear();
		busy = {};
	}
	$effect(() => {
		const coordinates = selectedIsland?.coordinates;
		const nextLatitude = coordinates?.[1] ?? initialLatitude;
		const nextLongitude = coordinates?.[0] ?? initialLongitude;
		const nextScope = `${selectedIsland?.id ?? 'male'}:${nextLatitude}:${nextLongitude}`;
		untrack(() => {
			if (nextScope === scopeKey) return;
			scopeKey = nextScope;
			cancelRequests();
			latitude = originLatitude = panoLatitude = nextLatitude;
			longitude = originLongitude = panoLongitude = nextLongitude;
			destinationLatitude = nextLatitude + 0.003;
			destinationLongitude = nextLongitude + 0.0037;
			originName = `${selectedName} · island center`;
			destinationName = 'Choose a destination';
			destinationChosen = false;
			inspectorOpen = false;
			inspectorExpanded = false;
			mapSelection = null;
			waypointSelection = null;
			waypointNames = [];
			searchResult = detail = photos = reviews = null;
			suggestions = chosen = null;
			directions = panorama = null;
			errors = {};
			waypoints = [];
			if (tileSrc) URL.revokeObjectURL(tileSrc);
			tileSrc = '';
			loadedTile = null;
		});
	});

	async function request<T>(key: string, path: string, payload?: unknown): Promise<T | null> {
		controllers.get(key)?.abort();
		const controller = new AbortController();
		controllers.set(key, controller);
		busy[key] = true;
		errors[key] = '';
		try {
			const response = await fetch(`/api/backend/places/${path}`, {
				method: payload === undefined ? 'GET' : 'POST',
				headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
				body: payload === undefined ? undefined : JSON.stringify(payload),
				signal: controller.signal
			});
			const body = await response.json();
			if (controller.signal.aborted) return null;
			if (!response.ok)
				throw new Error(
					`${body.error?.message ?? `Request failed (${response.status})`}${body.error?.code ? ` (${body.error.code})` : ''}`
				);
			return body as T;
		} catch (error) {
			if (!controller.signal.aborted)
				errors[key] = error instanceof Error ? error.message : 'The provider could not be reached.';
			return null;
		} finally {
			if (controllers.get(key) === controller) {
				controllers.delete(key);
				busy[key] = false;
			}
		}
	}
	function searchParameters(offset = 0) {
		return placesQuery({ query, latitude, longitude, span_meters: span, offset, language, region });
	}
	async function searchPlaces(offset = 0, quickQuery?: string) {
		inspectorOpen = true;
		if (quickQuery) query = quickQuery;
		const result = await request<ConsumerEnvelope<ConsumerSearch>>(
			'search',
			`search?${searchParameters(offset)}`
		);
		if (!result) return;
		searchResult = result;
		searchOffset = offset;
		suggestions = null;
	}
	async function suggestPlaces() {
		inspectorOpen = true;
		const result = await request<ConsumerEnvelope<ConsumerSuggestions>>(
			'suggest',
			`suggest?${placesQuery({ query, latitude, longitude, span_meters: span, language, region })}`
		);
		if (result) suggestions = result.data;
	}
	async function choosePlace(place: ConsumerPlace) {
		inspectorOpen = true;
		for (const key of ['detail', 'photos', 'reviews']) controllers.get(key)?.abort();
		chosen = place;
		detail = photos = reviews = null;
		photoFailures = {};
		errors.detail = errors.photos = errors.reviews = '';
		await tick();
		document.querySelector('.places-workspace .detail-card')?.scrollIntoView({
			block: 'nearest',
			behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
		});
		const identifier = place.feature_id ?? place.place_id;
		if (!identifier) {
			errors.detail =
				'This provider result has no lookup identity. Its search fields are shown below.';
			return;
		}
		const result = await request<ConsumerEnvelope<ConsumerPlace>>('detail', 'details', {
			place_id: identifier,
			name: place.name,
			...place.location,
			address: place.address,
			language,
			region
		});
		if (result) detail = result;
	}
	async function loadPhotos(token?: string | null) {
		const featureId = selectedPlace?.feature_id;
		if (!featureId) return;
		const result = await request<ConsumerEnvelope<ConsumerPhotos>>(
			'photos',
			`photos?${placesQuery({ feature_id: featureId, token, language, region })}`
		);
		if (result) {
			if (token && photos)
				result.data.photos = [...photos.data.photos, ...result.data.photos].filter(
					(photo, index, all) => all.findIndex((other) => other.url === photo.url) === index
				);
			photos = result;
		}
	}
	async function loadReviews(token?: string | null) {
		const featureId = selectedPlace?.feature_id;
		if (!featureId) return;
		const result = await request<ConsumerEnvelope<ConsumerReviews>>(
			'reviews',
			`reviews?${placesQuery({ feature_id: featureId, token, backend: reviewBackend, limit: reviewLimit, language, region })}`
		);
		if (result) {
			if (token && reviews) result.data.reviews = [...reviews.data.reviews, ...result.data.reviews];
			reviews = result;
		}
	}
	function usePlaceDestination() {
		if (!selectedPlace) return;
		destinationLatitude = selectedPlace.location.latitude;
		destinationLongitude = selectedPlace.location.longitude;
		destinationName = selectedPlace.name;
		destinationChosen = true;
		section = 'directions';
		inspectorOpen = false;
		directions = null;
	}
	function usePlaceOrigin() {
		if (!selectedPlace) return;
		originLatitude = selectedPlace.location.latitude;
		originLongitude = selectedPlace.location.longitude;
		originName = selectedPlace.name;
		section = 'directions';
		inspectorOpen = false;
	}
	function pickMapOrigin(point: ConsumerCoordinates) {
		if (section === 'directions') {
			originLatitude = point.latitude;
			originLongitude = point.longitude;
			originName = `Map pin · ${selectedName}`;
		} else if (section === 'imagery') {
			panoLatitude = point.latitude;
			panoLongitude = point.longitude;
			clearImagery();
		} else {
			latitude = point.latitude;
			longitude = point.longitude;
			controllers.get('search')?.abort();
			controllers.get('suggest')?.abort();
			for (const key of ['detail', 'photos', 'reviews']) controllers.get(key)?.abort();
			searchResult = suggestions = null;
			chosen = detail = photos = reviews = null;
			searchOffset = 0;
		}
		mapSelection = null;
	}
	function pickMapDestination(point: ConsumerCoordinates) {
		if (section !== 'directions') return;
		if (waypointSelection !== null) {
			const index = waypointSelection;
			waypoints = [...waypoints.slice(0, index), point, ...waypoints.slice(index + 1)];
			waypointNames = [
				...waypointNames.slice(0, index),
				`Stop ${index + 1} · map pin`,
				...waypointNames.slice(index + 1)
			];
			waypointSelection = null;
		} else {
			destinationLatitude = point.latitude;
			destinationLongitude = point.longitude;
			destinationName = `Map pin · ${selectedName}`;
			destinationChosen = true;
		}
		mapSelection = null;
	}
	function chooseWaypoint(index: number) {
		waypointSelection = index;
		mapSelection = 'destination';
	}
	function chooseExtraPoint(id: string) {
		if (section === 'discover') {
			const place = searchResult?.data.places.find((candidate) => candidate.id === id);
			if (place) void choosePlace(place);
		} else if (section === 'directions' && id.startsWith('waypoint:')) {
			chooseWaypoint(Number(id.split(':')[1]));
		}
	}
	function clearImagery() {
		controllers.get('panorama')?.abort();
		controllers.get('tile')?.abort();
		panorama = null;
		if (tileSrc) URL.revokeObjectURL(tileSrc);
		tileSrc = '';
		loadedTile = null;
	}
	function inspectPlaceImagery() {
		if (!selectedPlace) return;
		panoLatitude = selectedPlace.location.latitude;
		panoLongitude = selectedPlace.location.longitude;
		section = 'imagery';
		inspectorOpen = false;
		panorama = null;
		if (tileSrc) URL.revokeObjectURL(tileSrc);
		tileSrc = '';
		loadedTile = null;
	}
	async function findDirections() {
		if (!destinationChosen) {
			mapSelection = 'destination';
			return;
		}
		inspectorOpen = true;
		directions = null;
		const avoid = [
			avoidTolls ? 'tolls' : null,
			avoidHighways ? 'highways' : null,
			avoidFerries ? 'ferries' : null
		].filter(Boolean);
		const result = await request<ConsumerEnvelope<ConsumerDirections>>('directions', 'directions', {
			origin: { latitude: originLatitude, longitude: originLongitude },
			destination: { latitude: destinationLatitude, longitude: destinationLongitude },
			mode: routeMode,
			waypoints,
			avoid,
			language,
			region
		});
		if (result) directions = result;
	}
	async function findPanorama(identifier?: string) {
		inspectorOpen = true;
		controllers.get('tile')?.abort();
		panorama = null;
		if (tileSrc) URL.revokeObjectURL(tileSrc);
		tileSrc = '';
		loadedTile = null;
		const result = await request<ConsumerEnvelope<ConsumerPanorama>>(
			'panorama',
			identifier
				? `streetview/panorama?${placesQuery({ pano_id: identifier })}`
				: `streetview?${placesQuery({ latitude: panoLatitude, longitude: panoLongitude, radius: panoRadius })}`
		);
		if (!result) return;
		panorama = result;
		panoId = result.data.pano_id;
		tileZoom = tileX = tileY = 0;
		await loadTile();
	}
	async function loadTile() {
		if (!panorama) return;
		controllers.get('tile')?.abort();
		const controller = new AbortController();
		controllers.set('tile', controller);
		busy.tile = true;
		errors.tile = '';
		const requestedTile = { zoom: tileZoom, x: tileX, y: tileY };
		try {
			const response = await fetch(
				`/api/backend/places/streetview/tile?${placesQuery({ pano_id: panorama.data.pano_id, ...requestedTile })}`,
				{ signal: controller.signal }
			);
			if (!response.ok) {
				const body = await response.json();
				throw new Error(body.error?.message ?? 'This imagery tile is unavailable.');
			}
			const blob = await response.blob();
			if (controller.signal.aborted) return;
			if (tileSrc) URL.revokeObjectURL(tileSrc);
			tileSrc = URL.createObjectURL(blob);
			loadedTile = requestedTile;
		} catch (error) {
			if (!controller.signal.aborted)
				errors.tile = error instanceof Error ? error.message : 'The image could not be loaded.';
		} finally {
			if (controllers.get('tile') === controller) {
				controllers.delete('tile');
				busy.tile = false;
			}
		}
	}
	function exportJson(value: unknown, filename: string) {
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(url);
	}
	onMount(() => {
		const measureWorkspace = () => {
			if (!workspaceElement.offsetParent) return;
			workspaceTop = Math.max(0, workspaceElement.getBoundingClientRect().top + window.scrollY);
		};
		measureWorkspace();
		const resizeObserver = new ResizeObserver(measureWorkspace);
		resizeObserver.observe(workspaceElement);
		window.addEventListener('resize', measureWorkspace);
		void request<{ browser_enabled: boolean }>('status', 'status').then((status) => {
			if (status) {
				browserEnabled = status.browser_enabled;
				providerReady = true;
			}
		});
		return () => {
			resizeObserver.disconnect();
			window.removeEventListener('resize', measureWorkspace);
			cancelRequests();
			if (tileSrc) URL.revokeObjectURL(tileSrc);
		};
	});
</script>

{#snippet sourceNote(meta: ConsumerMeta | undefined)}
	<div class="source-note">
		<Globe2 size={13} />
		<span
			>Google consumer source · {meta?.cached ? 'cached response' : 'anonymous live lookup'} · completeness
			unconfirmed</span
		>
	</div>
	{#if meta?.warnings.length}
		<p class="coverage-note">{meta.warnings.join(' ')}</p>
	{/if}
{/snippet}

<svelte:window
	onkeydown={(event) => {
		if (active && event.key === 'Escape' && inspectorOpen) {
			event.preventDefault();
			closeInspector();
		}
	}}
/>
<div
	class="places-workspace"
	bind:this={workspaceElement}
	style={`--places-top: ${workspaceTop}px`}
>
	<header class="places-heading">
		<div>
			<h1>Places & journeys</h1>
			<p>Explore {selectedName}, choose a place on the map, and see how to reach it.</p>
		</div>
		<div class="heading-actions">
			<Badge variant="outline"
				>{errors.status
					? 'Provider unavailable'
					: providerReady
						? 'Vela connected'
						: 'Checking provider'}</Badge
			>
		</div>
	</header>
	{#if errors.status}<div class="provider-error" role="status">{errors.status}</div>{/if}
	<Tabs.Root bind:value={section} class={`places-tabs ${inspectorOpen ? 'has-inspector' : ''}`}>
		<Tabs.List aria-label="Place research tools"
			><Tabs.Trigger value="discover"><Search size={15} /> Discover places</Tabs.Trigger
			><Tabs.Trigger value="directions"><Navigation size={15} /> Directions</Tabs.Trigger
			><Tabs.Trigger value="imagery"><Camera size={15} /> Street View</Tabs.Trigger></Tabs.List
		>
		<div class="places-map-stage">
			<div class="map-action-strip">
				{#if section === 'discover'}
					<form
						class="map-search-form"
						onsubmit={(event) => {
							event.preventDefault();
							void searchPlaces();
						}}
					>
						<Search size={18} />
						<Input
							aria-label="Place, service or category"
							bind:value={query}
							placeholder="Find a hospital, school or ferry terminal…"
							required
							maxlength={300}
						/>
						<Button type="submit" disabled={busy.search || !query.trim()}
							>{busy.search ? 'Searching…' : 'Search places'}</Button
						>
					</form>
					<Button variant="outline" onclick={() => (mapSelection = 'origin')}
						><MapPin /> Choose search area</Button
					>
				{:else if section === 'directions'}
					<div class="imagery-point-copy">
						<Navigation size={18} /><span>Choose your starting point and destination below.</span>
					</div>
					<NativeSelect.Root aria-label="Journey mode" bind:value={routeMode}>
						<NativeSelect.Option value="walking">Walking</NativeSelect.Option>
						<NativeSelect.Option value="driving">Driving</NativeSelect.Option>
						<NativeSelect.Option value="bicycling">Bicycling</NativeSelect.Option>
					</NativeSelect.Root>
					<Button disabled={busy.directions} onclick={findDirections}
						><Navigation />{busy.directions ? 'Finding route…' : 'Find directions'}</Button
					>
				{:else}
					<div class="imagery-point-copy">
						<Camera size={18} /><span>Choose the site you want to inspect.</span>
					</div>
					<Button variant="outline" onclick={() => (mapSelection = 'origin')}
						><MapPin /> Choose imagery point</Button
					>
					<Button disabled={busy.panorama} onclick={() => findPanorama()}
						><Camera />{busy.panorama ? 'Searching…' : 'Find imagery'}</Button
					>
				{/if}
			</div>
			<LocationMap
				center={mapCenter}
				{active}
				origin={mapOrigin}
				destination={section === 'directions' ? mapDestination : null}
				originLabel={mapOriginLabel}
				destinationLabel={mapDestinationLabel}
				selection={mapSelection}
				showDestination={section === 'directions'}
				label={section === 'directions'
					? 'Place directions map'
					: section === 'imagery'
						? 'Street View location map'
						: 'Place discovery map'}
				{routeCoordinates}
				routeLabel={displayedRoute?.summary ?? 'Provider route'}
				{extraPoints}
				selectedPointId={section === 'discover'
					? (selectedPlace?.id ?? null)
					: section === 'directions' && waypointSelection !== null
						? `waypoint:${waypointSelection}`
						: null}
				onorigin={pickMapOrigin}
				ondestination={pickMapDestination}
				onselection={(value) => {
					mapSelection = value;
					if (value !== 'destination') waypointSelection = null;
				}}
				onpoint={chooseExtraPoint}
			/>
			<div class="map-context-bar" aria-live="polite">
				<span
					>{section === 'directions'
						? waypointSelection !== null
							? `Choose stop ${waypointSelection + 1} on the map.`
							: directions
								? `${directions.data.routes.length} route options · ${displayedRoute?.geometry ? 'provider geometry shown' : 'geometry unavailable'}`
								: 'Choose A and B on the map. Drag either pin to adjust your journey.'
						: section === 'imagery'
							? 'The search point and any returned panorama are shown on the map.'
							: searchResult
								? `${searchResult.data.places.length} places · select a numbered pin to inspect it`
								: 'Search nearby services. Choose a result to open its evidence.'}</span
				>
				<Button
					bind:ref={inspectorTrigger}
					variant="ghost"
					size="sm"
					aria-expanded={inspectorOpen}
					aria-controls="places-research-inspector"
					onclick={() => (inspectorOpen ? closeInspector() : (inspectorOpen = true))}
				>
					{#if inspectorOpen}<PanelBottomClose /> Hide details{:else}<PanelBottomOpen />
						{section === 'directions'
							? 'Journey details'
							: section === 'imagery'
								? 'Imagery viewer'
								: 'Search results & details'}{/if}
				</Button>
			</div>
		</div>
		<div
			id="places-research-inspector"
			class="research-inspector"
			class:expanded={inspectorExpanded}
			hidden={!inspectorOpen}
			role="region"
			aria-label="Place research inspector"
		>
			<header class="inspector-heading">
				<div>
					<span class="drawer-handle"></span><strong
						>{section === 'directions'
							? 'Journey details'
							: section === 'imagery'
								? 'Imagery viewer'
								: 'Place research'}</strong
					>
				</div>
				<div class="inspector-controls">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={inspectorExpanded ? 'Restore place inspector' : 'Expand place inspector'}
						aria-expanded={inspectorExpanded}
						onclick={() => (inspectorExpanded = !inspectorExpanded)}
						>{#if inspectorExpanded}<Minimize2 size={15} />{:else}<Maximize2
								size={15}
							/>{/if}</Button
					>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Close place inspector"
						onclick={closeInspector}><X size={17} /></Button
					>
				</div>
			</header>
			<div class="inspector-body">
				<Tabs.Content value="discover">
					<div class={`discover-grid ${selectedPlace ? 'has-selected' : ''}`}>
						<div class="discovery-column">
							<Card.Root class="research-card search-card">
								<div class="card-title">
									<div>
										<span class="eyebrow">01 · FIND A SERVICE</span>
										<h2>Search near the island.</h2>
									</div>
									<Search size={21} />
								</div>
								<p class="coverage-note">
									Search results are marked on the map. Choose a pin or a listing to inspect its
									evidence.
								</p>
								<div class="quick-searches">
									<Button variant="secondary" size="sm" onclick={() => searchPlaces(0, 'hospital')}
										>Health facilities</Button
									><Button variant="secondary" size="sm" onclick={() => searchPlaces(0, 'school')}
										>Schools</Button
									><Button
										variant="secondary"
										size="sm"
										onclick={() => searchPlaces(0, 'ferry terminal')}>Ferry terminals</Button
									><Button
										variant="ghost"
										size="sm"
										disabled={busy.suggest || !query.trim()}
										onclick={suggestPlaces}
										><Sparkles />{busy.suggest ? 'Loading…' : 'Suggestions'}</Button
									>
								</div>
								<details class="advanced-details">
									<summary>Search location & radius</summary>
									<div class="field-grid three">
										<div>
											<Label for="places-latitude">Latitude</Label><Input
												id="places-latitude"
												type="number"
												bind:value={latitude}
												min={-90}
												max={90}
												step="any"
											/>
										</div>
										<div>
											<Label for="places-longitude">Longitude</Label><Input
												id="places-longitude"
												type="number"
												bind:value={longitude}
												min={-180}
												max={180}
												step="any"
											/>
										</div>
										<div>
											<Label for="places-span">Search span (m)</Label><Input
												id="places-span"
												type="number"
												bind:value={span}
												min={2000}
												max={500000}
												step={1000}
											/>
										</div>
									</div>
								</details>
								{#if errors.search || errors.suggest}<p class="provider-error" role="alert">
										{errors.search || errors.suggest}
									</p>{/if}
								{#if suggestions}<div class="suggestion-list">
										<h3>Suggested searches</h3>
										{#each suggestions.places as place (place.id)}<Button
												variant="ghost"
												class="suggestion"
												onclick={() => choosePlace(place)}
												><MapPin />{place.name}<ArrowRight /></Button
											>{/each}{#each suggestions.queries as suggested (suggested)}<Button
												variant="ghost"
												class="suggestion"
												onclick={() => searchPlaces(0, suggested)}
												><Search />{suggested}<ArrowRight /></Button
											>{/each}{#if !suggestions.places.length && !suggestions.queries.length}<p>
												No suggestions were returned for this query.
											</p>{/if}
									</div>{/if}
							</Card.Root>
							{#if searchResult}
								<div class="results-heading">
									<h2>{searchResult.data.places.length} places returned</h2>
									<span>Page {searchOffset / 20 + 1}</span>
								</div>
								{#if !searchResult.data.places.length}<Card.Root class="research-card empty-state"
										><MapPin size={28} />
										<h3>No readable places returned.</h3>
										<p>
											Try a broader category or adjust the location. An empty consumer response does
											not establish that services are absent.
										</p></Card.Root
									>{/if}
								<div class="place-results" aria-label="Search results">
									{#each searchResult.data.places as place (place.id)}
										<Button
											variant="outline"
											class={`place-result ${chosen?.id === place.id ? 'selected' : ''}`}
											aria-pressed={chosen?.id === place.id}
											onclick={() => choosePlace(place)}
											><div class="place-symbol"><MapPin size={18} /></div>
											<div class="place-copy">
												<strong>{place.name}</strong><span
													>{place.category ?? 'Category unavailable'}</span
												>
												<p>{place.address ?? 'Address not supplied'}</p>
												<span class="rating-line"
													>{#if place.rating !== null && place.rating !== undefined}<Star
															size={12}
														/>
														{number(
															place.rating
														)}{#if place.review_count !== null && place.review_count !== undefined}
															· {number(place.review_count)} reviews{/if}{:else}Rating unavailable{/if}</span
												>
											</div>
											<ArrowUpRight size={15} /></Button
										>
									{/each}
								</div>
								<div class="result-pagination">
									<Button
										variant="outline"
										disabled={busy.search || searchOffset === 0}
										onclick={() => searchPlaces(Math.max(0, searchOffset - 20))}
										><ChevronLeft /> Previous page</Button
									><Button
										variant="outline"
										disabled={busy.search ||
											searchResult.data.next_offset === null ||
											searchResult.data.next_offset === undefined}
										onclick={() => searchPlaces(searchResult?.data.next_offset ?? 0)}
										>Next page <ChevronRight /></Button
									>
								</div>
								{@render sourceNote(searchResult.meta)}
							{:else}<div class="discovery-empty">
									<div class="empty-icon"><MapPin size={29} /></div>
									<h2>Start with a place that matters.</h2>
									<p>
										Search for a service, choose the exact listing, and inspect its location and
										evidence. Search does not alter the official facility inventory.
									</p>
								</div>{/if}
						</div>
						<Card.Root class="research-card detail-card">
							{#if selectedPlace}
								<div class="card-title">
									<div>
										<span class="eyebrow">02 · INSPECT THE EVIDENCE</span>
										<h2>{selectedPlace.name}</h2>
										<p>{selectedPlace.category ?? 'Place listing'}</p>
									</div>
									<Badge variant="secondary"
										>{busy.detail
											? 'Loading details'
											: detail
												? 'Identity matched'
												: 'Search record'}</Badge
									>
								</div>
								{#if errors.detail}<p class="provider-error" role="alert">{errors.detail}</p>{/if}
								<p class="place-address">{selectedPlace.address ?? 'Address unavailable'}</p>
								<div class="place-metrics">
									<div>
										<span>Rating</span><strong
											>{selectedPlace.rating !== null && selectedPlace.rating !== undefined
												? `${number(selectedPlace.rating)} / 5`
												: 'Unavailable'}</strong
										>
									</div>
									<div>
										<span>Reported reviews</span><strong
											>{selectedPlace.review_count !== null &&
											selectedPlace.review_count !== undefined
												? number(selectedPlace.review_count)
												: 'Unavailable'}</strong
										>
									</div>
									<div>
										<span>Opening status</span><strong
											>{selectedPlace.permanently_closed
												? 'Permanently closed'
												: selectedPlace.temporarily_closed
													? 'Temporarily closed'
													: selectedPlace.open_now === true
														? 'Open now'
														: selectedPlace.open_now === false
															? 'Closed now'
															: 'Unavailable'}</strong
										>
									</div>
								</div>
								{#if selectedPlace.phone}<p class="contact-line">
										Phone <strong>{selectedPlace.phone}</strong>
									</p>{/if}
								{#if safeWebsite(selectedPlace.website)}<Button
										variant="link"
										href={safeWebsite(selectedPlace.website)!}
										target="_blank"
										rel="noreferrer">Visit provider website <ExternalLink /></Button
									>{/if}
								{#if selectedPlace.hours?.length}<details class="advanced-details">
										<summary>Reported opening hours</summary>
										<ul>
											{#each selectedPlace.hours as hour, index (index)}<li>{hour}</li>{/each}
										</ul>
									</details>{/if}
								<div class="detail-actions">
									<Button
										onclick={() =>
											onJourneyPoint
												? onJourneyPoint(
														{ name: selectedPlace!.name, ...selectedPlace!.location },
														'end'
													)
												: usePlaceDestination()}><Navigation /> Directions to this place</Button
									><Button
										variant="outline"
										onclick={() =>
											onJourneyPoint
												? onJourneyPoint(
														{ name: selectedPlace!.name, ...selectedPlace!.location },
														'start'
													)
												: usePlaceOrigin()}><MapPin /> Start here</Button
									><Button variant="outline" onclick={inspectPlaceImagery}
										><Camera /> Inspect imagery</Button
									>{#if onFocusPlace}<Button
											variant="outline"
											onclick={() =>
												onFocusPlace?.({ name: selectedPlace!.name, ...selectedPlace!.location })}
											><MapPin /> Show on planning map</Button
										>{/if}
								</div>
								<div class="coordinate-line">
									<MapPin size={13} />{selectedPlace.location.latitude.toFixed(6)}, {selectedPlace.location.longitude.toFixed(
										6
									)}
								</div>
								<Tabs.Root value="photos" class="detail-tabs"
									><Tabs.List aria-label="Place evidence"
										><Tabs.Trigger value="photos"><Camera size={14} /> Photos</Tabs.Trigger
										><Tabs.Trigger value="reviews"><MessageSquare size={14} /> Reviews</Tabs.Trigger
										><Tabs.Trigger value="record">Full record</Tabs.Trigger></Tabs.List
									>
									<Tabs.Content value="photos"
										><div class="section-heading">
											<h3>Site photographs</h3>
											<Button
												variant="outline"
												size="sm"
												disabled={busy.photos || !selectedPlace.feature_id}
												onclick={() => loadPhotos()}
												>{busy.photos
													? 'Loading…'
													: photos
														? 'Refresh photos'
														: 'Load photos'}</Button
											>
										</div>
										{#if !selectedPlace.feature_id}<p class="coverage-note">
												Photos require a provider feature identity, which this listing does not
												include.
											</p>{/if}{#if errors.photos}<p class="provider-error" role="alert">
												{errors.photos}
											</p>{/if}{#if photos}<div class="photo-grid">
												{#each photos.data.photos as photo (photo.url)}<figure>
														{#if photoFailures[photo.url]}<div class="photo-unavailable">
																Image unavailable
															</div>{:else}<img
																src={imageUrl(photo.url)}
																alt={`${selectedPlace.name} — provider photograph`}
																loading="lazy"
																onerror={() => {
																	photoFailures[photo.url] = true;
																}}
															/>{/if}
														<figcaption>
															{photo.posted_text ?? 'Date unavailable'}{photo.category
																? ` · ${photo.category}`
																: ''}
														</figcaption>
													</figure>{/each}
											</div>
											{#if !photos.data.photos.length}<p class="coverage-note">
													No readable photo records were returned.
												</p>{/if}{#if photos.data.next_token}<Button
													variant="outline"
													size="sm"
													disabled={busy.photos}
													onclick={() => loadPhotos(photos?.data.next_token)}
													>Load another photo page <ChevronRight /></Button
												>{/if}
											<p class="coverage-note">
												Provider imagery can be outdated. Photo timestamps and categories are
												reported only when supplied.
											</p>
											{@render sourceNote(photos.meta)}{:else}<p class="section-empty">
												Look at the site context before assuming capacity, an entrance or service
												quality.
											</p>{/if}</Tabs.Content
									>
									<Tabs.Content value="reviews"
										><div class="section-heading"><h3>Reported experiences</h3></div>
										<div class="review-controls">
											<div>
												<Label for="place-review-backend">Review source</Label><NativeSelect.Root
													id="place-review-backend"
													bind:value={reviewBackend}
													><NativeSelect.Option value="native">Native feed</NativeSelect.Option
													><NativeSelect.Option value="browser" disabled={!browserEnabled}
														>Browser cards{browserEnabled ? '' : ' · disabled'}</NativeSelect.Option
													></NativeSelect.Root
												>
											</div>
											<div>
												<Label for="place-review-limit">Maximum rows</Label><Input
													id="place-review-limit"
													type="number"
													bind:value={reviewLimit}
													min={1}
													max={50}
												/>
											</div>
											<Button
												variant="outline"
												disabled={busy.reviews || !selectedPlace.feature_id}
												onclick={() => loadReviews()}
												>{busy.reviews ? 'Reading…' : 'Load reviews'}</Button
											>
										</div>
										{#if !browserEnabled}<p class="coverage-note">
												The native feed is available. Browser cards require the server's optional
												Chromium backend to be enabled.
											</p>{/if}{#if errors.reviews}<p class="provider-error" role="alert">
												{errors.reviews}
											</p>{/if}{#if reviews}<p class="coverage-note">
												{reviews.data.reviews.length} rows shown · {reviews.data.backend} feed · limited
												coverage. Reported total reviews and readable rows can differ.
											</p>
											<div class="review-list">
												{#each reviews.data.reviews as review, index (`${review.id ?? review.author}:${index}`)}<article
													>
														<div class="review-heading">
															<strong>{review.author}</strong><span
																>{review.rating !== null && review.rating !== undefined
																	? `${review.rating} / 5`
																	: 'Rating unavailable'}</span
															>
														</div>
														<span class="review-date"
															>{review.relative_time ?? 'Date unavailable'}</span
														>
														<p>{review.text ?? 'No readable review text supplied.'}</p>
														{#if review.photos?.length}<details class="advanced-details">
																<summary>{review.photos.length} review photographs</summary>
																<div class="photo-grid">
																	{#each review.photos as photo, photoIndex (photoIndex)}<img
																			src={imageUrl(photo)}
																			alt={`Photograph reported by ${review.author}`}
																			loading="lazy"
																		/>{/each}
																</div>
															</details>{/if}
													</article>{/each}
											</div>
											{#if reviewBackend === 'native' && reviews.data.next_token}<Button
													variant="outline"
													size="sm"
													disabled={busy.reviews}
													onclick={() => loadReviews(reviews?.data.next_token)}
													>Try continuation <ChevronRight /></Button
												>{/if}{@render sourceNote(reviews.meta)}
											<details class="advanced-details">
												<summary>Review source metadata</summary>
												<pre>{JSON.stringify(
														{ ...reviews.data, reviews: undefined },
														null,
														2
													)}</pre>
											</details>{:else}<p class="section-empty">
												Review content is anecdotal. Limited feeds do not establish representative
												resident experience.
											</p>{/if}</Tabs.Content
									>
									<Tabs.Content value="record"
										><div class="section-heading">
											<h3>Provider record</h3>
											<Button
												variant="outline"
												size="sm"
												onclick={() =>
													exportJson(detail ?? { data: chosen }, 'place-evidence.json')}
												><Download /> Export JSON</Button
											>
										</div>
										<p class="coverage-note">
											Identity: {providerIdentity ?? 'Unavailable'}. Missing fields stay empty. This
											preserves all returned fields, including departments, accessibility attributes
											and popular times when supplied.
										</p>
										<pre class="full-record">{JSON.stringify(
												selectedPlace,
												null,
												2
											)}</pre></Tabs.Content
									>
								</Tabs.Root>
								{@render sourceNote(detail?.meta ?? searchResult?.meta)}
							{:else}<div class="detail-empty">
									<div class="empty-icon"><Search size={26} /></div>
									<span class="eyebrow">02 · INSPECT THE EVIDENCE</span>
									<h2>Choose an exact listing.</h2>
									<p>
										Its identity, reported hours, photographs and review coverage appear here. You
										can then check directions to that location.
									</p>
								</div>{/if}
						</Card.Root>
					</div>
				</Tabs.Content>
				<Tabs.Content value="directions">
					<div class="tool-grid">
						<Card.Root class="research-card route-form"
							><div class="card-title">
								<div>
									<span class="eyebrow">CHECK THE REAL-WORLD JOURNEY</span>
									<h2>Directions & traffic context.</h2>
								</div>
								<Navigation size={22} />
							</div>
							<p class="card-intro">
								Consumer route geometry and timing complement the planning graph. Traffic duration
								appears when the provider supplies it.
							</p>
							<form
								onsubmit={(event) => {
									event.preventDefault();
									void findDirections();
								}}
							>
								<div class="field-grid">
									<div>
										<Label for="place-route-mode">Mode</Label><NativeSelect.Root
											id="place-route-mode"
											bind:value={routeMode}
											><NativeSelect.Option value="walking">Walking</NativeSelect.Option
											><NativeSelect.Option value="driving">Driving</NativeSelect.Option
											><NativeSelect.Option value="bicycling">Bicycling</NativeSelect.Option
											></NativeSelect.Root
										>
									</div>
									<Button variant="outline" disabled={!selectedPlace} onclick={usePlaceDestination}
										><MapPin /> Use selected place</Button
									>
								</div>
								<div class="journey-point">
									<span class="point-label">A</span>
									<div>
										<h3>{originName}</h3>
										<Button
											variant="outline"
											size="sm"
											onclick={() => {
												waypointSelection = null;
												mapSelection = 'origin';
											}}><MapPin /> Change start on map</Button
										>
									</div>
								</div>
								<div class="journey-point">
									<span class="point-label destination">B</span>
									<div>
										<h3>{destinationName}</h3>
										<Button
											variant="outline"
											size="sm"
											onclick={() => {
												waypointSelection = null;
												mapSelection = 'destination';
											}}
											><MapPin />
											{destinationChosen
												? 'Change destination on map'
												: 'Choose destination on map'}</Button
										>
									</div>
								</div>
								<div class="waypoints">
									{#each waypoints as waypoint, index (`${index}:${waypoint.latitude}:${waypoint.longitude}`)}
										<div class="visual-waypoint">
											<span class="point-label">{index + 1}</span>
											<span>{waypointNames[index] ?? `Stop ${index + 1}`}</span>
											<Button variant="outline" size="sm" onclick={() => chooseWaypoint(index)}
												>Move on map</Button
											>
											<Button
												size="icon"
												variant="ghost"
												aria-label={`Remove waypoint ${index + 1}`}
												onclick={() => {
													waypoints = waypoints.filter((_, row) => row !== index);
													waypointNames = waypointNames.filter((_, row) => row !== index);
													waypointSelection = null;
													mapSelection = null;
												}}><Trash2 /></Button
											>
										</div>
									{/each}
									<Button
										variant="outline"
										size="sm"
										disabled={waypoints.length >= 8}
										onclick={() => chooseWaypoint(waypoints.length)}
										><Plus /> Add a stop on map</Button
									>
									{#if waypointSelection !== null}<p class="coverage-note">
											Choose stop {waypointSelection + 1} on the map above. It will appear as a numbered
											pin.
										</p>{/if}
								</div>
								<details class="advanced-details">
									<summary>Route preferences</summary>
									<div class="avoid-controls">
										<label><input type="checkbox" bind:checked={avoidTolls} /> Avoid tolls</label>
										<label
											><input type="checkbox" bind:checked={avoidHighways} /> Avoid highways</label
										>
										<label
											><input type="checkbox" bind:checked={avoidFerries} /> Avoid ferries</label
										>
									</div>
								</details>
								<details class="advanced-details">
									<summary>Advanced coordinates</summary>
									<p class="coverage-note">
										Use the map for ordinary planning. Precise coordinates are available for
										importing a known location.
									</p>
									<div class="field-grid">
										<div>
											<Label for="place-origin-lat">Origin latitude</Label><Input
												id="place-origin-lat"
												type="number"
												bind:value={originLatitude}
												step="any"
												min={-90}
												max={90}
												required
												oninput={() => (originName = 'Imported coordinates')}
											/>
										</div>
										<div>
											<Label for="place-origin-lng">Origin longitude</Label><Input
												id="place-origin-lng"
												type="number"
												bind:value={originLongitude}
												step="any"
												min={-180}
												max={180}
												required
												oninput={() => (originName = 'Imported coordinates')}
											/>
										</div>
										<div>
											<Label for="place-destination-lat">Destination latitude</Label><Input
												id="place-destination-lat"
												type="number"
												bind:value={destinationLatitude}
												step="any"
												min={-90}
												max={90}
												required
												oninput={() => {
													destinationChosen = true;
													destinationName = 'Imported coordinates';
												}}
											/>
										</div>
										<div>
											<Label for="place-destination-lng">Destination longitude</Label><Input
												id="place-destination-lng"
												type="number"
												bind:value={destinationLongitude}
												step="any"
												min={-180}
												max={180}
												required
												oninput={() => {
													destinationChosen = true;
													destinationName = 'Imported coordinates';
												}}
											/>
										</div>
									</div>
									{#each waypoints as waypoint, index (index)}
										<div class="field-grid waypoint-row">
											<div>
												<Label for={`waypoint-lat-${index}`}>Stop {index + 1} latitude</Label><Input
													id={`waypoint-lat-${index}`}
													type="number"
													bind:value={waypoint.latitude}
													min={-90}
													max={90}
													step="any"
													required
												/>
											</div>
											<div>
												<Label for={`waypoint-lng-${index}`}>Longitude</Label><Input
													id={`waypoint-lng-${index}`}
													type="number"
													bind:value={waypoint.longitude}
													min={-180}
													max={180}
													step="any"
													required
												/>
											</div>
										</div>
									{/each}
								</details>
								<Button type="submit" class="primary-action" disabled={busy.directions}
									><Navigation />{busy.directions ? 'Finding routes…' : 'Find directions'}</Button
								>
							</form>
							{#if errors.directions}<p class="provider-error" role="alert">
									{errors.directions}
								</p>{/if}
							<p class="coverage-note">
								Availability varies by location and mode. Scheduled transit is handled by the
								journey planner. This source supplies route context and does not provide an offline
								navigation engine.
							</p></Card.Root
						>
						<div class="route-results">
							{#if directions}<div class="results-heading">
									<h2>{directions.data.routes.length} route options</h2>
									<Badge variant="secondary">{directions.data.mode}</Badge>
								</div>
								{#each directions.data.routes as route, index (index)}<Card.Root
										class="research-card route-card"
										><div class="card-title">
											<h3>{route.summary || `Option ${index + 1}`}</h3>
											<Badge variant="outline">Google consumer</Badge>
										</div>
										<div class="route-metrics">
											<div>
												<span>Distance</span><strong
													>{route.distance_meters !== null && route.distance_meters !== undefined
														? `${number(route.distance_meters / 1000)} km`
														: 'Unavailable'}</strong
												>
											</div>
											<div>
												<span>Typical duration</span><strong
													>{minutes(route.typical_seconds)}</strong
												>
											</div>
											<div class="traffic-metric">
												<span>Traffic-aware duration</span><strong
													>{minutes(route.traffic_seconds)}</strong
												>
											</div>
										</div>
										<Button
											variant={selectedRoute === index ? 'secondary' : 'outline'}
											size="sm"
											aria-pressed={selectedRoute === index}
											onclick={() => (selectedRoute = index)}
											><MapPin />
											{selectedRoute === index
												? 'Selected on map'
												: 'Show this route on map'}</Button
										>
										<p class="coverage-note">
											{route.geometry
												? `${route.geometry.coordinates.length} actual geometry points returned.`
												: 'Geometry unavailable; no straight-line substitute is drawn.'}{route.guidance_available
												? ' Instruction text is supplied; turn positions remain unverified.'
												: 'Readable turn instructions unavailable.'}
										</p>
										{#if route.steps.length}<details class="advanced-details">
												<summary>{route.steps.length} reported instructions</summary>
												<ol>
													{#each route.steps as step, stepIndex (stepIndex)}<li>
															{step.instruction}{step.distance_meters !== null &&
															step.distance_meters !== undefined
																? ` · ${number(step.distance_meters)} m`
																: ''}
														</li>{/each}
												</ol>
											</details>{/if}
										<div class="detail-actions">
											{#if route.geometry}<Button
													variant="outline"
													size="sm"
													onclick={() =>
														exportJson(
															{
																type: 'Feature',
																properties: {
																	...route,
																	geometry: undefined,
																	retrieved_source: directions?.meta
																},
																geometry: route.geometry
															},
															`route-option-${index + 1}.geojson`
														)}><Download /> Export GeoJSON</Button
												>{/if}<Button
												variant="ghost"
												size="sm"
												onclick={() =>
													exportJson(
														{ data: route, meta: directions?.meta },
														`route-option-${index + 1}.json`
													)}><Download /> Full route record</Button
											>
										</div>
										<details class="advanced-details">
											<summary>Full route evidence</summary>
											<pre>{JSON.stringify(route, null, 2)}</pre>
										</details></Card.Root
									>{/each}
								{#if !directions.data.routes.length}<p class="provider-error" role="status">
										No readable route was returned for these points and this mode. Try a closer
										destination or a different mode. Your chosen points remain on the map.
									</p>{/if}
								{@render sourceNote(directions.meta)}{:else}<Card.Root
									class="research-card directions-empty"
									><div class="empty-icon"><Navigation size={29} /></div>
									<h2>Compare a real route.</h2>
									<p>
										Choose your start and destination on the map, or use a named place from
										discovery. The result separates typical duration from the provider's
										traffic-aware estimate.
									</p>
									<div class="empty-metrics">
										<span>Actual geometry</span><span>Traffic when supplied</span><span
											>Source instructions</span
										>
									</div></Card.Root
								>{/if}
						</div>
					</div>
				</Tabs.Content>
				<Tabs.Content value="imagery">
					<div class="tool-grid">
						<Card.Root class="research-card"
							><div class="card-title">
								<div>
									<span class="eyebrow">INSPECT THE PHYSICAL CONTEXT</span>
									<h2>Street View evidence.</h2>
								</div>
								<Camera size={22} />
							</div>
							<p class="card-intro">
								Inspect capture dates, neighboring panoramas and actual raster tiles where imagery
								is available.
							</p>
							<form
								onsubmit={(event) => {
									event.preventDefault();
									void findPanorama();
								}}
							>
								<Button variant="outline" onclick={() => (mapSelection = 'origin')}
									><MapPin /> Change imagery point on map</Button
								>
								<details class="advanced-details">
									<summary>Advanced imagery coordinates</summary>
									<div class="field-grid">
										<div>
											<Label for="pano-latitude">Latitude</Label><Input
												id="pano-latitude"
												type="number"
												bind:value={panoLatitude}
												min={-90}
												max={90}
												step="any"
												required
											/>
										</div>
										<div>
											<Label for="pano-longitude">Longitude</Label><Input
												id="pano-longitude"
												type="number"
												bind:value={panoLongitude}
												min={-180}
												max={180}
												step="any"
												required
											/>
										</div>
									</div>
								</details>
								<div class="field-grid">
									<div>
										<Label for="pano-radius">Search radius</Label><NativeSelect.Root
											id="pano-radius"
											value={String(panoRadius)}
											onchange={(event) => {
												panoRadius = Number(event.currentTarget.value);
											}}
											><NativeSelect.Option value="50">50 meters</NativeSelect.Option
											><NativeSelect.Option value="200">200 meters</NativeSelect.Option
											></NativeSelect.Root
										>
									</div>
									<Button type="submit" disabled={busy.panorama}
										><Camera />{busy.panorama ? 'Searching…' : 'Find imagery'}</Button
									>
								</div>
							</form>
							<details class="advanced-details">
								<summary>Look up a panorama identity</summary>
								<form
									class="search-row"
									onsubmit={(event) => {
										event.preventDefault();
										void findPanorama(panoId);
									}}
								>
									<Input
										aria-label="Panorama identity"
										bind:value={panoId}
										placeholder="Provider panorama ID"
										maxlength={256}
										required
									/><Button
										variant="outline"
										type="submit"
										disabled={busy.panorama || !panoId.trim()}>Look up</Button
									>
								</form>
							</details>
							{#if errors.panorama}<p class="provider-error" role="alert">{errors.panorama}</p>{/if}
							<p class="coverage-note">
								A location may have no public imagery. Capture date describes the source photograph,
								which can differ from today's conditions.
							</p>
							{#if panorama}<div class="pano-facts">
									<div>
										<span>Capture date</span><strong
											>{panorama.data.capture_year
												? `${panorama.data.capture_year}${panorama.data.capture_month ? `-${String(panorama.data.capture_month).padStart(2, '0')}` : ''}`
												: 'Unavailable'}</strong
										>
									</div>
									<div>
										<span>Available image levels</span><strong
											>{panorama.data.level_dimensions.length}</strong
										>
									</div>
									<div>
										<span>Reported heading</span><strong
											>{number(panorama.data.heading_degrees)}°</strong
										>
									</div>
								</div>
								{#if panorama.data.neighbors.length}<details class="advanced-details">
										<summary>{panorama.data.neighbors.length} neighboring viewpoints</summary>
										<div class="neighbor-list">
											{#each panorama.data.neighbors as neighbor, neighborIndex (neighborIndex)}<Button
													variant="outline"
													size="sm"
													disabled={busy.panorama}
													onclick={() => findPanorama(neighbor.pano_id)}
													><Navigation />{number(neighbor.distance_meters)} m · {number(
														neighbor.bearing_degrees
													)}°</Button
												>{/each}
										</div>
									</details>{/if}{#if panorama.data.history.length}<details
										class="advanced-details"
									>
										<summary>Historical image captures</summary>
										<div class="neighbor-list">
											{#each panorama.data.history as capture, captureIndex (captureIndex)}<Button
													variant="outline"
													size="sm"
													disabled={busy.panorama}
													onclick={() => findPanorama(capture.pano_id)}
													><Camera />{capture.year}-{String(capture.month).padStart(2, '0')}</Button
												>{/each}
										</div>
									</details>{/if}<Button
									variant="outline"
									size="sm"
									onclick={() => exportJson(panorama, 'streetview-evidence.json')}
									><Download /> Export imagery metadata</Button
								>{/if}</Card.Root
						>
						<Card.Root class="research-card imagery-card"
							>{#if panorama}<div class="card-title">
									<div>
										<h3>{panorama.data.address_label ?? 'Provider imagery'}</h3>
										<p>
											Actual tile · {panorama.data.latitude.toFixed(5)}, {panorama.data.longitude.toFixed(
												5
											)}
										</p>
									</div>
									<Badge variant="secondary">Raster evidence</Badge>
								</div>
								<form
									class="tile-controls"
									onsubmit={(event) => {
										event.preventDefault();
										void loadTile();
									}}
								>
									<div>
										<Label for="pano-level">Image level</Label><NativeSelect.Root
											id="pano-level"
											value={String(tileZoom)}
											onchange={(event) => {
												tileZoom = Number(event.currentTarget.value);
												tileX = tileY = 0;
											}}
											>{#each panorama.data.level_dimensions as dimensions, index (index)}<NativeSelect.Option
													value={String(index)}
													>Level {index} · {dimensions.width}×{dimensions.height}</NativeSelect.Option
												>{/each}</NativeSelect.Root
										>
									</div>
									<div>
										<Label for="pano-tile-x">Column</Label><Input
											id="pano-tile-x"
											type="number"
											bind:value={tileX}
											min={0}
											max={tileColumns - 1}
											required
										/>
									</div>
									<div>
										<Label for="pano-tile-y">Row</Label><Input
											id="pano-tile-y"
											type="number"
											bind:value={tileY}
											min={0}
											max={tileRows - 1}
											required
										/>
									</div>
									<Button variant="outline" type="submit" disabled={busy.tile}
										>{busy.tile ? 'Loading…' : 'Load tile'}</Button
									>
								</form>
								<div class="tile-viewer" aria-busy={busy.tile}>
									{#if tileSrc}<img
											src={tileSrc}
											alt={`Street View raster tile, level ${loadedTile?.zoom}, column ${loadedTile?.x}, row ${loadedTile?.y}`}
										/>{:else}<Camera size={32} /><span>No image tile loaded.</span>{/if}
								</div>
								{#if errors.tile}<p class="provider-error" role="alert">{errors.tile}</p>{/if}
								<div class="tile-navigation">
									<Button
										variant="outline"
										size="sm"
										disabled={busy.tile || tileX === 0}
										onclick={() => {
											tileX -= 1;
											void loadTile();
										}}><ChevronLeft /> Previous tile</Button
									><span>{tileColumns} columns × {tileRows} rows</span><Button
										variant="outline"
										size="sm"
										disabled={busy.tile || tileX >= tileColumns - 1}
										onclick={() => {
											tileX += 1;
											void loadTile();
										}}>Next tile <ChevronRight /></Button
									>
								</div>
								<p class="imagery-attribution">
									{panorama.data.copyright ?? 'Provider copyright unavailable'} · Source imagery remains
									subject to its provider attribution.
								</p>
								{@render sourceNote(panorama.meta)}
								<details class="advanced-details">
									<summary>Full panorama record</summary>
									<pre>{JSON.stringify(panorama.data, null, 2)}</pre>
								</details>{:else}<div class="detail-empty">
									<div class="empty-icon"><Camera size={29} /></div>
									<h2>Look at the site context.</h2>
									<p>
										Search a location to inspect available imagery. Where no panorama exists, the
										coverage message stays visible.
									</p>
								</div>{/if}</Card.Root
						>
					</div>
				</Tabs.Content>
				<details class="advanced-details provider-settings">
					<summary>Source context & advanced settings</summary>
					<p class="coverage-note">
						Consumer listings complement official records. Confirm identities, dates and coverage
						before using them in a policy decision.
					</p>
					<div class="locale-controls">
						<span class="context-island"><MapPin size={14} /> Around {selectedName}</span>
						<div class="locale-field">
							<Label for="places-language">Language</Label><Input
								id="places-language"
								bind:value={language}
								maxlength={12}
							/>
						</div>
						<div class="locale-field">
							<Label for="places-region">Country code</Label><Input
								id="places-region"
								bind:value={region}
								maxlength={2}
							/>
						</div>
					</div>
					<Button
						variant="outline"
						size="sm"
						href="/api/backend/places/docs"
						target="_blank"
						rel="noreferrer"><ExternalLink /> Full API</Button
					>
				</details>
				<footer class="places-footer">
					<span
						>Vela-derived consumer adapters · calibration 26 · source records remain distinct from
						verified public facility data.</span
					><a href="/api/backend/places/openapi.json" target="_blank" rel="noreferrer"
						>Endpoint schema <ArrowUpRight size={12} /></a
					>
				</footer>
			</div>
		</div>
	</Tabs.Root>
</div>

<style>
	.places-workspace {
		width: 100%;
		margin: 0 auto;
		padding: 18px 22px 24px;
		color: var(--foreground);
	}
	.places-map-stage {
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 18px;
		overflow: hidden;
		background: var(--card);
	}
	.map-action-strip {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		padding: 12px;
		background: var(--card);
	}
	.map-search-form {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: min(360px, 100%);
	}
	.map-search-form > :global(svg) {
		color: var(--muted-foreground);
		flex-shrink: 0;
	}
	.map-search-form :global(input) {
		flex: 1;
		min-width: 0;
	}
	.map-action-strip :global(button) {
		font-size: 12px;
	}
	.map-action-strip :global(select) {
		width: 116px;
	}
	.map-context-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 9px 12px;
		border-top: 1px solid var(--border);
		font-size: 11px;
		color: var(--muted-foreground);
	}
	.imagery-point-copy {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.research-inspector {
		min-width: 0;
		max-height: calc(100dvh - 205px);
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
		border: 1px solid var(--border);
		border-radius: 18px;
		background: var(--card);
	}
	.research-inspector[hidden] {
		display: none;
	}
	.inspector-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		position: sticky;
		top: 0;
		z-index: 3;
		padding: 10px 14px;
		background: var(--card);
		border-bottom: 1px solid var(--border);
		font-size: 12px;
	}
	.inspector-controls {
		display: flex;
		gap: 4px;
	}
	.inspector-controls :global(button:first-child),
	.drawer-handle {
		display: none;
	}
	.provider-settings,
	.places-footer {
		margin-inline: 18px;
	}
	.places-footer {
		padding-bottom: 18px;
	}
	.research-inspector .discover-grid,
	.research-inspector .tool-grid {
		grid-template-columns: minmax(0, 1fr);
		gap: 12px;
	}
	.discover-grid.has-selected {
		display: flex;
		flex-direction: column;
	}
	.discover-grid.has-selected .discovery-column {
		order: 1;
		width: 100%;
	}
	.discover-grid.has-selected :global(.detail-card) {
		order: 0;
		width: 100%;
	}
	.discover-grid:not(.has-selected) :global(.detail-card) {
		display: none;
	}
	.places-workspace .research-inspector :global(.research-card) {
		border: 0;
		box-shadow: none;
		padding: 18px;
	}
	.visual-waypoint {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
	}
	.visual-waypoint > span:nth-child(2) {
		flex: 1;
		min-width: 0;
	}
	.provider-settings {
		margin-top: 14px;
	}
	:global(.places-tabs) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 14px;
	}
	:global(.places-tabs.has-inspector) {
		grid-template-columns: minmax(0, 1fr) minmax(320px, 410px);
	}
	:global(.places-tabs > [data-slot='tabs-list']) {
		grid-column: 1 / -1;
	}
	.places-heading,
	.heading-actions,
	.card-title,
	.section-heading,
	.results-heading,
	.result-pagination,
	.tile-navigation,
	.places-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
	}
	.places-heading {
		margin-bottom: 16px;
	}
	.eyebrow {
		display: block;
		color: #756b8c;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.11em;
		margin-bottom: 9px;
	}
	h1 {
		font-size: clamp(22px, 2vw, 27px);
		font-weight: 700;
		letter-spacing: -0.045em;
		line-height: 1.12;
		margin: 0;
	}
	h2 {
		font-size: 21px;
		font-weight: 650;
		letter-spacing: -0.035em;
		line-height: 1.25;
		margin: 0;
	}
	h3 {
		font-size: 15px;
		font-weight: 650;
		letter-spacing: -0.015em;
		margin: 0;
	}
	p {
		line-height: 1.65;
	}
	.places-heading p {
		color: var(--muted-foreground);
		font-size: 13px;
		margin: 6px 0 0;
		max-width: 590px;
	}
	.locale-controls {
		display: flex;
		gap: 20px;
		align-items: center;
		justify-content: flex-end;
		margin-bottom: 18px;
	}
	.context-island {
		display: flex;
		gap: 7px;
		align-items: center;
		font-size: 12px;
		font-weight: 650;
		margin-right: auto;
	}
	.locale-field {
		display: flex;
		gap: 9px;
		align-items: center;
	}
	.locale-field :global(input) {
		width: 70px;
	}
	.locale-field :global(label) {
		color: var(--muted-foreground);
		font-size: 11px;
		white-space: nowrap;
	}
	:global(.places-tabs > [data-slot='tabs-list']) {
		margin-bottom: 0;
		height: 44px;
		background: #e6e1ee;
		padding: 5px;
		gap: 4px;
		border-radius: 14px;
		align-self: flex-start;
	}
	:global(.places-tabs > [data-slot='tabs-list'] [data-slot='tabs-trigger']) {
		padding: 9px 17px;
		gap: 7px;
		font-size: 12px;
	}
	.discover-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
		gap: 22px;
		align-items: start;
	}
	.discovery-column,
	.route-results {
		min-width: 0;
	}
	:global(.places-workspace .research-card) {
		padding: 25px;
		gap: 18px;
		min-width: 0;
	}
	.card-title {
		align-items: flex-start;
	}
	.card-title > div {
		min-width: 0;
	}
	.card-title h2 {
		overflow-wrap: anywhere;
	}
	.card-title > :global(svg) {
		color: #81749c;
		flex-shrink: 0;
	}
	.card-title p {
		font-size: 12px;
		color: var(--muted-foreground);
		margin: 7px 0 0;
	}
	.search-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
	}
	.search-row :global(input) {
		height: 42px;
	}
	.search-row :global(button) {
		height: 42px;
		padding: 0 15px;
	}
	.quick-searches,
	.detail-actions,
	.neighbor-list {
		display: flex;
		align-items: center;
		gap: 7px;
		flex-wrap: wrap;
	}
	.quick-searches :global(button) {
		font-size: 11px;
	}
	.advanced-details {
		border-top: 1px solid var(--border);
		padding-top: 13px;
		color: var(--muted-foreground);
		font-size: 12px;
		min-width: 0;
	}
	.advanced-details summary {
		cursor: pointer;
		color: #625c73;
		font-weight: 600;
		line-height: 1.5;
	}
	.advanced-details summary:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
		border-radius: 4px;
	}
	.advanced-details[open] summary {
		margin-bottom: 15px;
	}
	.field-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 12px;
		align-items: end;
	}
	.field-grid.three {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.field-grid > div,
	.review-controls > div,
	.tile-controls > div {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	:global(.places-workspace label) {
		font-size: 11px;
		color: #66616f;
	}
	.provider-error {
		background: #fff1ed;
		color: #994731;
		border: 1px solid #edd6cc;
		border-radius: 11px;
		padding: 12px 14px;
		font-size: 12px;
		line-height: 1.6;
		overflow-wrap: anywhere;
		margin: 0;
	}
	.suggestion-list {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.suggestion-list h3 {
		margin-bottom: 6px;
	}
	:global(.places-workspace .suggestion) {
		justify-content: flex-start;
		white-space: normal;
		text-align: left;
		height: auto;
		min-height: 35px;
	}
	:global(.places-workspace .suggestion svg:last-child) {
		margin-left: auto;
	}
	.results-heading {
		margin: 22px 1px 13px;
	}
	.results-heading h2 {
		font-size: 16px;
	}
	.results-heading span {
		font-size: 11px;
		color: var(--muted-foreground);
	}
	.place-results {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	:global(.places-workspace .place-result) {
		display: flex;
		width: 100%;
		height: auto;
		min-height: 100px;
		padding: 16px 18px;
		border: 1px solid #e4e0e8;
		background: white;
		border-radius: 17px;
		align-items: flex-start;
		justify-content: flex-start;
		gap: 13px;
		white-space: normal;
		text-align: left;
	}
	:global(.places-workspace .place-result.selected) {
		border-color: #8d79b0;
		background: #f3eff9;
		box-shadow: 0 0 0 1px #8d79b0;
	}
	.place-symbol {
		display: grid;
		place-items: center;
		background: #f0ecf5;
		color: #8b76ad;
		width: 37px;
		height: 37px;
		border-radius: 12px;
		flex-shrink: 0;
	}
	.place-copy {
		min-width: 0;
		flex: 1;
	}
	.place-copy strong {
		display: block;
		font-size: 13px;
		line-height: 1.45;
	}
	.place-copy > span {
		display: block;
		font-size: 10px;
		color: var(--muted-foreground);
		margin-top: 3px;
	}
	.place-copy p {
		color: #6c6676;
		font-size: 11px;
		line-height: 1.5;
		margin: 6px 0;
	}
	.place-copy .rating-line {
		display: flex;
		align-items: center;
		gap: 3px;
		color: #74603c;
	}
	.result-pagination {
		margin: 15px 0;
	}
	.result-pagination :global(button) {
		font-size: 11px;
	}
	.source-note {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		color: #747080;
		font-size: 10px;
		line-height: 1.5;
		margin-top: 6px;
	}
	.source-note :global(svg) {
		flex-shrink: 0;
		margin-top: 1px;
	}
	.coverage-note {
		color: #71697d;
		font-size: 11px;
		line-height: 1.7;
		margin: 0;
	}
	.discovery-empty {
		padding: 48px 32px;
		text-align: center;
		max-width: 420px;
		margin: 0 auto;
	}
	.discovery-empty h2,
	.detail-empty h2,
	:global(.places-workspace .directions-empty h2) {
		font-size: 21px;
	}
	.discovery-empty p,
	.detail-empty p,
	:global(.places-workspace .directions-empty p) {
		font-size: 12px;
		color: var(--muted-foreground);
		max-width: 380px;
	}
	.empty-icon {
		display: grid;
		place-items: center;
		color: #8e78ab;
		background: #ece6f3;
		border-radius: 19px;
		width: 63px;
		height: 63px;
		margin: 0 auto 19px;
	}
	:global(.places-workspace .detail-card) {
		min-height: 452px;
		scroll-margin-top: 96px;
	}
	.detail-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		flex: 1;
		padding: 37px 15px;
	}
	.place-address {
		color: var(--muted-foreground);
		font-size: 12px;
		margin: -3px 0 0;
	}
	.place-metrics {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		border: 1px solid #e7e2ec;
		background: #faf8fc;
		border-radius: 14px;
		padding: 14px 12px;
		gap: 9px;
	}
	.place-metrics span,
	.route-metrics span,
	.pano-facts span {
		display: block;
		color: var(--muted-foreground);
		font-size: 10px;
		margin-bottom: 6px;
	}
	.place-metrics strong {
		display: block;
		font-size: 13px;
		font-weight: 650;
		line-height: 1.4;
	}
	.contact-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 0;
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.contact-line strong {
		color: var(--foreground);
	}
	.detail-actions :global(button) {
		font-size: 11px;
	}
	.coordinate-line {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 10px;
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	:global(.places-workspace .detail-tabs) {
		margin-top: 4px;
		gap: 17px;
	}
	:global(.places-workspace .detail-tabs [data-slot='tabs-list']) {
		width: 100%;
	}
	:global(.places-workspace .detail-tabs [data-slot='tabs-trigger']) {
		gap: 5px;
		font-size: 11px;
	}
	.section-heading {
		margin: 0 0 14px;
	}
	.section-heading h3 {
		font-size: 14px;
	}
	.section-empty {
		padding: 24px 15px;
		text-align: center;
		color: var(--muted-foreground);
		font-size: 12px;
		background: #f9f7fc;
		border-radius: 12px;
		margin: 0;
	}
	.photo-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		margin: 12px 0 15px;
	}
	.photo-grid figure {
		margin: 0;
		min-width: 0;
	}
	.photo-grid img,
	.photo-unavailable {
		width: 100%;
		height: 135px;
		border-radius: 12px;
		object-fit: cover;
		background: #efebf4;
	}
	.photo-grid figcaption {
		font-size: 9px;
		color: var(--muted-foreground);
		margin-top: 6px;
		line-height: 1.5;
	}
	.photo-unavailable {
		display: grid;
		place-items: center;
		color: var(--muted-foreground);
		font-size: 11px;
	}
	.review-controls {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 80px auto;
		gap: 10px;
		align-items: end;
		margin-bottom: 13px;
	}
	.review-controls :global(button) {
		font-size: 11px;
	}
	.review-list {
		display: flex;
		flex-direction: column;
		gap: 13px;
		margin: 17px 0;
		max-height: 550px;
		overflow-y: auto;
		padding-right: 4px;
	}
	.review-list article {
		border-bottom: 1px solid var(--border);
		padding-bottom: 13px;
	}
	.review-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		font-size: 12px;
	}
	.review-heading span {
		color: #7b6340;
		font-size: 11px;
	}
	.review-date {
		color: var(--muted-foreground);
		font-size: 10px;
		display: block;
		margin-top: 5px;
	}
	.review-list p {
		font-size: 12px;
		margin: 9px 0 0;
		white-space: pre-wrap;
	}
	pre {
		font-family: ui-monospace, monospace;
		background: #f5f2f9;
		color: #655c76;
		font-size: 10px;
		line-height: 1.65;
		border-radius: 11px;
		padding: 13px;
		max-height: 450px;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		margin: 13px 0 0;
	}
	.tool-grid {
		display: grid;
		grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
		gap: 23px;
		align-items: start;
	}
	.card-intro {
		font-size: 12px;
		color: var(--muted-foreground);
		margin: -4px 0 0;
	}
	:global(.places-workspace .route-form form) {
		display: flex;
		flex-direction: column;
		gap: 23px;
	}
	.journey-point {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.journey-point > div {
		flex: 1;
		min-width: 0;
	}
	.journey-point h3 {
		margin: 3px 0 13px;
	}
	.point-label {
		display: grid;
		place-items: center;
		background: #ece6f4;
		color: #796199;
		width: 26px;
		height: 26px;
		border-radius: 9px;
		font-size: 12px;
		font-weight: 700;
		flex-shrink: 0;
	}
	.point-label.destination {
		background: #e2ede7;
		color: #527b62;
	}
	.waypoints {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.waypoint-row {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 36px;
		gap: 8px;
	}
	.avoid-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 11px;
		margin-top: 18px;
	}
	.avoid-controls label {
		display: flex;
		gap: 5px;
		align-items: center;
	}
	.avoid-controls input {
		accent-color: #8870a9;
		width: 15px;
		height: 15px;
	}
	:global(.places-workspace .primary-action) {
		width: 100%;
		height: 41px;
	}
	.route-results > .results-heading {
		margin-top: 0;
		margin-bottom: 15px;
	}
	:global(.places-workspace .route-card) {
		margin-bottom: 13px;
	}
	.route-metrics {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 11px;
	}
	.route-metrics strong {
		font-size: 21px;
		font-weight: 650;
		letter-spacing: -0.04em;
	}
	.traffic-metric strong {
		color: #52765d;
	}
	ol,
	ul {
		padding-left: 18px;
		font-size: 12px;
		line-height: 1.65;
	}
	li + li {
		margin-top: 7px;
	}
	:global(.places-workspace .directions-empty) {
		align-items: center;
		text-align: center;
		min-height: 440px;
		justify-content: center;
	}
	.empty-metrics {
		display: flex;
		gap: 7px;
		flex-wrap: wrap;
		justify-content: center;
	}
	.empty-metrics span {
		background: #f0ebf5;
		color: #7d6d93;
		padding: 7px 10px;
		border-radius: 9px;
		font-size: 10px;
	}
	.tool-grid :global(.research-card > form) {
		display: flex;
		flex-direction: column;
		gap: 17px;
	}
	.pano-facts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		border-top: 1px solid var(--border);
		padding-top: 18px;
	}
	.pano-facts strong {
		font-size: 17px;
		letter-spacing: -0.03em;
	}
	.tile-controls {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 55px 55px auto;
		gap: 9px;
		align-items: end;
	}
	.tile-controls :global(button) {
		font-size: 11px;
	}
	.tile-viewer {
		min-height: 220px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		background: #e9e4f0;
		border-radius: 13px;
		overflow: hidden;
		gap: 12px;
		color: #8c7b9f;
	}
	.tile-viewer img {
		display: block;
		width: 100%;
		max-height: 430px;
		object-fit: contain;
	}
	.tile-navigation {
		gap: 7px;
	}
	.tile-navigation span {
		font-size: 9px;
		color: var(--muted-foreground);
	}
	.tile-navigation :global(button) {
		font-size: 10px;
	}
	.imagery-attribution {
		font-size: 10px;
		color: var(--muted-foreground);
		margin: 0;
	}
	.places-footer {
		color: var(--muted-foreground);
		font-size: 10px;
		line-height: 1.6;
		padding: 25px 0 0;
	}
	.places-footer a {
		display: flex;
		align-items: center;
		gap: 4px;
		color: #78648e;
		white-space: nowrap;
	}
	@media (max-width: 1050px) {
		:global(.places-tabs.has-inspector) {
			grid-template-columns: minmax(0, 1fr);
		}
		.research-inspector {
			max-height: 65dvh;
		}
		.discover-grid,
		.tool-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.places-workspace {
			padding: 16px 18px;
		}
		.places-heading {
			align-items: flex-start;
		}
		.heading-actions {
			flex-direction: column;
			align-items: flex-end;
			gap: 8px;
		}
		.place-results {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		:global(.places-workspace .detail-card) {
			min-height: 340px;
		}
		.route-results {
			min-width: 0;
		}
	}
	@media (max-width: 600px) {
		.places-workspace {
			padding: 8px 10px;
			height: calc(100dvh - var(--places-top, 218px));
			min-height: 0;
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}
		:global(.places-tabs),
		:global(.places-tabs.has-inspector) {
			position: relative;
			display: flex;
			flex-direction: column;
			flex: 1;
			min-height: 0;
			gap: 6px;
		}
		.places-map-stage {
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
			border-radius: 14px;
		}
		.map-action-strip {
			padding: 7px 8px;
			gap: 6px;
			flex-wrap: nowrap;
		}
		.map-search-form {
			width: 100%;
			min-width: 0;
			gap: 6px;
		}
		.map-search-form > :global(svg),
		.map-action-strip:has(.map-search-form) > :global(button),
		.imagery-point-copy {
			display: none;
		}
		.map-search-form :global(input) {
			height: 35px;
			font-size: 12px;
		}
		.map-action-strip :global(button),
		.map-action-strip :global(select) {
			height: 35px;
			font-size: 11px;
		}
		.map-action-strip > :global(button),
		.map-action-strip > :global([data-slot='native-select-wrapper']) {
			flex: 1;
			width: auto;
			min-width: 0;
		}
		.map-action-strip :global(select) {
			width: 100%;
		}
		.map-search-form :global(button) {
			padding-inline: 10px;
			flex-shrink: 0;
		}
		.map-context-bar {
			padding: 4px 8px;
			justify-content: flex-end;
		}
		.map-context-bar > span {
			display: none;
		}
		:global(.places-workspace .location-map) {
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
			border-inline: 0;
			border-radius: 0;
		}
		:global(.places-workspace .location-map-stage) {
			flex: 1;
			height: auto;
			min-height: 0;
		}
		:global(.places-workspace .point-toolbar) {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 34px;
			gap: 5px;
			padding: 6px 8px;
		}
		:global(.places-workspace .point-toolbar:not(:has(.point-badge.b)) > button:first-child) {
			grid-column: 1 / span 2;
		}
		:global(.places-workspace .point-toolbar > button) {
			width: 100%;
			min-width: 0;
			height: 34px;
			padding-inline: 6px;
			gap: 5px;
		}
		:global(.places-workspace .point-toolbar > button:last-child) {
			font-size: 0;
			gap: 0;
		}
		:global(.places-workspace .point-toolbar > button > svg:last-child:not(:first-child)) {
			display: none;
		}
		:global(.places-workspace .map-source) {
			padding: 5px 8px;
			font-size: 8px;
			gap: 3px;
		}
		.research-inspector {
			position: absolute;
			inset: auto 5px 5px;
			z-index: 5;
			height: 50%;
			max-height: 50%;
			display: flex;
			flex-direction: column;
			overflow: hidden;
			border-radius: 18px;
			box-shadow: 0 6px 28px #263d3330;
		}
		.research-inspector.expanded {
			height: 84%;
			max-height: 84%;
		}
		.inspector-heading {
			flex-shrink: 0;
			padding: 10px 12px;
		}
		.inspector-heading > div:first-child {
			display: grid;
			gap: 5px;
		}
		.inspector-controls :global(button:first-child) {
			display: inline-flex;
		}
		.drawer-handle {
			display: block;
			width: 28px;
			height: 3px;
			border-radius: 3px;
			background: #d1d8d0;
		}
		.inspector-body {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			overscroll-behavior: contain;
		}
		.visual-waypoint {
			flex-wrap: wrap;
		}
		.places-heading {
			flex-direction: row;
			align-items: center;
			gap: 8px;
			margin-bottom: 7px;
			flex-shrink: 0;
		}
		h1 {
			font-size: 17px;
		}
		.heading-actions {
			flex-direction: row;
			align-items: center;
			width: auto;
			flex-shrink: 0;
		}
		.heading-actions :global([data-slot='badge']) {
			font-size: 9px;
			padding-inline: 6px;
		}
		.places-heading p {
			display: none;
		}
		.locale-controls {
			gap: 12px;
			flex-wrap: wrap;
			justify-content: flex-start;
		}
		.context-island {
			width: 100%;
		}
		.locale-field :global(input) {
			width: 59px;
		}
		:global(.places-tabs > [data-slot='tabs-list']) {
			width: 100%;
			gap: 2px;
			height: 35px;
			flex-shrink: 0;
			padding: 3px;
		}
		:global(.places-tabs > [data-slot='tabs-list'] [data-slot='tabs-trigger']) {
			padding: 8px;
			font-size: 10px;
			gap: 4px;
		}
		:global(.places-tabs > [data-slot='tabs-list'] svg) {
			display: none;
		}
		:global(.places-workspace .research-card) {
			padding: 20px 17px;
			gap: 16px;
		}
		.place-results {
			grid-template-columns: minmax(0, 1fr);
		}
		.field-grid.three {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
		.field-grid.three > div:last-child {
			grid-column: 1 / -1;
		}
		.search-row :global(button) {
			padding: 0 10px;
			font-size: 11px;
		}
		h2 {
			font-size: 19px;
		}
		.card-title {
			flex-wrap: wrap;
			gap: 8px;
		}
		.place-metrics {
			padding: 12px 10px;
			gap: 7px;
		}
		.place-metrics strong {
			font-size: 12px;
		}
		.place-metrics span {
			font-size: 9px;
		}
		.review-controls {
			grid-template-columns: minmax(0, 1fr) 75px;
		}
		.review-controls :global(button) {
			grid-column: 1 / -1;
		}
		.route-metrics {
			gap: 10px;
		}
		.route-metrics strong {
			font-size: 18px;
		}
		.route-metrics span {
			font-size: 9px;
		}
		.tile-controls {
			grid-template-columns: minmax(0, 1fr) 50px 50px;
			gap: 8px;
		}
		.tile-controls :global(button) {
			grid-column: 1 / -1;
		}
		.tile-navigation {
			flex-wrap: wrap;
		}
		.tile-navigation span {
			width: 100%;
			order: 3;
			text-align: center;
		}
		.pano-facts span {
			font-size: 9px;
		}
		.pano-facts strong {
			font-size: 15px;
		}
		.places-footer {
			align-items: flex-start;
			flex-direction: column;
			gap: 10px;
		}
		.discovery-empty {
			padding: 37px 15px;
		}
	}
</style>
