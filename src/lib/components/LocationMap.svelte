<script lang="ts">
	import { themeColors } from '#lib/theme.js';
	import { backendUrl } from '#lib/app-paths.js';
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import type { FeatureCollection, Feature, Geometry } from 'geojson';
	import type { Map as LibreMap, Marker, GeoJSONSource } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import { Crosshair, MousePointer2, Scan, X } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { api } from '#lib/api.js';
	import type { MapFeatures } from '#lib/types.js';
	import { validLocation, providerRouteCoordinates, type MapLocation } from '#lib/map-location.js';

	type Selection = 'origin' | 'destination' | null;
	type ExtraPoint = MapLocation & { id: string; label: string };
	let {
		center,
		origin = null,
		destination = null,
		originLabel = 'Starting point',
		destinationLabel = 'Destination',
		selection = null,
		routeCoordinates = [],
		routeLabel = 'Provider route geometry',
		active = true,
		label = 'Choose locations on the map',
		showDestination = true,
		mapFeatures = null,
		extraPoints = [],
		selectedPointId = null,
		onorigin,
		ondestination,
		onselection,
		onpoint
	}: {
		center: MapLocation;
		origin?: MapLocation | null;
		destination?: MapLocation | null;
		originLabel?: string;
		destinationLabel?: string;
		selection?: Selection;
		routeCoordinates?: [number, number][];
		routeLabel?: string;
		active?: boolean;
		label?: string;
		showDestination?: boolean;
		mapFeatures?: MapFeatures | null;
		extraPoints?: ExtraPoint[];
		selectedPointId?: string | null;
		onorigin?: (point: MapLocation) => void;
		ondestination?: (point: MapLocation) => void;
		onselection?: (selection: Selection) => void;
		onpoint?: (id: string) => void;
	} = $props();
	let container: HTMLDivElement;
	let map = $state.raw<LibreMap | null>(null);
	let ready = $state(false),
		error = $state(''),
		contextStatus = $state('Loading streets…');
	let contextReceipt = $state('');
	let centerKey = '';
	let lastSelectedPoint: string | null = null;
	let disposed = false;
	let contextGeneration = 0;
	let contextController: AbortController | null = null;
	let featureController: AbortController | null = null;
	let contextTimer: ReturnType<typeof setTimeout> | undefined;
	let lastContext = '';
	let contextData: FeatureCollection = { type: 'FeatureCollection', features: [] };
	let markerConstructor: typeof import('maplibre-gl').Marker | undefined;
	let originMarker: Marker | null = null,
		destinationMarker: Marker | null = null;
	let nearbyChoices = $state<ExtraPoint[]>([]);
	const pointMarkers = new SvelteMap<string, Marker>();
	const pointGroups = new SvelteMap<string, ExtraPoint[]>();
	const streetMarkers = new SvelteMap<string, Marker>();
	const instanceId = $props.id();
	const safeRoute = $derived(providerRouteCoordinates(routeCoordinates));
	const endpointGuide = $derived(
		showDestination && validLocation(origin) && validLocation(destination) && safeRoute.length < 2
	);
	const selectionMessage = $derived(
		selection
			? `Click the map to choose ${selection === 'origin' ? 'the starting point' : 'the destination'}, or drag its pin.`
			: 'Choose a point above, then click the map. You can also drag a pin.'
	);
	const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });
	function setData(id: string, data: FeatureCollection) {
		(map?.getSource(id) as GeoJSONSource | undefined)?.setData(data);
	}
	function setIslands(features: MapFeatures) {
		setData('location-islands', {
			type: 'FeatureCollection',
			features: features.features.filter(
				(feature): feature is Feature<Geometry> =>
					!!feature.geometry &&
					['Polygon', 'MultiPolygon'].includes(feature.geometry.type) &&
					!!feature.properties?.id &&
					!feature.properties?.island_id
			)
		});
	}
	function choose(point: MapLocation, endpoint = selection) {
		if (!validLocation(point) || !endpoint) return;
		if (endpoint === 'origin') onorigin?.(point);
		else ondestination?.(point);
		onselection?.(
			showDestination && endpoint === 'origin' && !validLocation(destination) ? 'destination' : null
		);
	}
	function useMapCenter() {
		const point = map?.getCenter();
		if (point) choose({ latitude: point.lat, longitude: point.lng });
	}
	function chooseEndpoint(endpoint: Exclude<Selection, null>) {
		onselection?.(selection === endpoint ? null : endpoint);
	}
	function fitPoints() {
		if (!map || !ready) return;
		const selected = [origin, showDestination ? destination : null, ...extraPoints].filter(
			validLocation
		);
		const points =
			safeRoute.length > 1 ? safeRoute : selected.map((point) => [point.longitude, point.latitude]);
		if (points.length > 1) {
			map.fitBounds(
				[
					[
						Math.min(...points.map((point) => point[0])),
						Math.min(...points.map((point) => point[1]))
					],
					[
						Math.max(...points.map((point) => point[0])),
						Math.max(...points.map((point) => point[1]))
					]
				],
				{
					padding: { top: 75, bottom: 45, left: 65, right: 65 },
					maxZoom: 15,
					duration: reducedMotion() ? 0 : 240
				}
			);
		} else {
			const point = selected[0] ?? center;
			if (validLocation(point))
				map.easeTo({
					center: [point.longitude, point.latitude],
					zoom: 14.5,
					duration: reducedMotion() ? 0 : 240
				});
		}
	}
	function makeEndpoint(
		endpoint: 'origin' | 'destination',
		point: MapLocation,
		name: string
	): Marker | null {
		if (!map || !markerConstructor) return null;
		const button = document.createElement('button');
		button.type = 'button';
		button.className = `location-endpoint ${endpoint}`;
		button.textContent = endpoint === 'origin' ? 'A' : 'B';
		button.title = `${name} · drag to move`;
		button.setAttribute(
			'aria-label',
			`${endpoint === 'origin' ? 'Starting point' : 'Destination'}: ${name}. Drag to move, or press Enter to choose on map.`
		);
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			onselection?.(endpoint);
		});
		const marker = new markerConstructor({ element: button, draggable: true, anchor: 'bottom' })
			.setLngLat([point.longitude, point.latitude])
			.addTo(map);
		marker.on('dragend', () => {
			const position = marker.getLngLat();
			choose({ latitude: position.lat, longitude: position.lng }, endpoint);
		});
		return marker;
	}
	function updateEndpoints() {
		if (!map || !ready) return;
		for (const endpoint of ['origin', 'destination'] as const) {
			const point = endpoint === 'origin' ? origin : showDestination ? destination : null;
			let marker = endpoint === 'origin' ? originMarker : destinationMarker;
			const name = endpoint === 'origin' ? originLabel : destinationLabel;
			if (!validLocation(point)) {
				marker?.remove();
				marker = null;
			} else if (!marker) marker = makeEndpoint(endpoint, point, name);
			else marker.setLngLat([point.longitude, point.latitude]);
			if (marker) {
				marker.getElement().title = `${name} · drag to move`;
				marker.getElement().setAttribute('aria-pressed', String(selection === endpoint));
				marker
					.getElement()
					.setAttribute(
						'aria-label',
						`${endpoint === 'origin' ? 'Starting point' : 'Destination'}: ${name}. Drag to move, or press Enter to choose on map.`
					);
			}
			if (endpoint === 'origin') originMarker = marker;
			else destinationMarker = marker;
		}
	}
	function updateRoute() {
		if (!map || !ready) return;
		const coordinates =
			safeRoute.length > 1
				? safeRoute
				: endpointGuide
					? [
							[origin!.longitude, origin!.latitude],
							[destination!.longitude, destination!.latitude]
						]
					: [];
		setData(
			'location-route',
			coordinates.length > 1
				? {
						type: 'FeatureCollection',
						features: [
							{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }
						]
					}
				: empty()
		);
		map.setPaintProperty(
			'location-route-line',
			'line-dasharray',
			safeRoute.length > 1 ? [1, 0] : [2, 2]
		);
		map.setPaintProperty('location-route-line', 'line-opacity', safeRoute.length > 1 ? 1 : 0.55);
	}
	function updateExtraPoints() {
		if (!map || !markerConstructor || !ready) return;
		const groups: ExtraPoint[][] = [];
		for (const point of extraPoints.filter(validLocation)) {
			const pixel = map.project([point.longitude, point.latitude]);
			const group = groups.find((items) => {
				const first = map!.project([items[0].longitude, items[0].latitude]);
				return Math.hypot(pixel.x - first.x, pixel.y - first.y) < 34;
			});
			if (group) group.push(point);
			else groups.push([point]);
		}
		const retained = new SvelteSet<string>();
		groups.forEach((group) => {
			const point = group[0];
			retained.add(point.id);
			pointGroups.set(point.id, group);
			const index = extraPoints.findIndex((item) => item.id === point.id);
			const existing = pointMarkers.get(point.id);
			const button = existing?.getElement() ?? document.createElement('button');
			button.setAttribute('type', 'button');
			button.className = `location-extra-point${group.length > 1 ? ' grouped' : ''}`;
			button.textContent = group.length > 1 ? String(group.length) : String(index + 1);
			button.title = group.length > 1 ? group.map((item) => item.label).join(', ') : point.label;
			button.setAttribute(
				'aria-label',
				group.length > 1 ? `${group.length} nearby places. Choose a place.` : point.label
			);
			if (existing) existing.setLngLat([point.longitude, point.latitude]);
			else {
				button.addEventListener('click', (event) => {
					event.stopPropagation();
					const currentGroup = pointGroups.get(point.id) ?? [];
					if (currentGroup.length > 1) nearbyChoices = currentGroup;
					else {
						nearbyChoices = [];
						if (currentGroup[0]) onpoint?.(currentGroup[0].id);
					}
				});
				pointMarkers.set(
					point.id,
					new markerConstructor!({ element: button })
						.setLngLat([point.longitude, point.latitude])
						.addTo(map!)
				);
			}
		});
		for (const [id, marker] of pointMarkers) {
			if (retained.has(id)) continue;
			marker.remove();
			pointMarkers.delete(id);
			pointGroups.delete(id);
		}
		updateSelectedPoint();
	}
	function updateSelectedPoint() {
		for (const [id, marker] of pointMarkers) {
			const selected = (pointGroups.get(id) ?? []).some((point) => point.id === selectedPointId);
			marker.getElement().classList.toggle('selected', selected);
			marker.getElement().setAttribute('aria-pressed', String(selected));
		}
	}
	function updateStreetLabels() {
		if (!map || !markerConstructor) return;
		for (const marker of streetMarkers.values()) marker.remove();
		streetMarkers.clear();
		if (map.getZoom() < 13) return;
		const names = new SvelteSet<string>();
		const occupied: { x: number; y: number; halfWidth: number }[] = [];
		const endpointPixels = [origin, showDestination ? destination : null]
			.filter(validLocation)
			.map((point) => map!.project([point.longitude, point.latitude]));
		for (const feature of contextData.features) {
			const name = feature.properties?.name;
			if (
				!name ||
				feature.properties?.kind !== 'road' ||
				feature.geometry?.type !== 'LineString' ||
				names.has(String(name))
			)
				continue;
			const point =
				feature.geometry.coordinates[Math.floor(feature.geometry.coordinates.length / 2)];
			if (!point || !map.getBounds().contains([point[0], point[1]])) continue;
			const pixel = map.project([point[0], point[1]]);
			const halfWidth = Math.min(95, String(name).length * 2.65);
			if (
				pixel.x < halfWidth + 8 ||
				pixel.x > container.clientWidth - halfWidth - 8 ||
				pixel.y < 70 ||
				pixel.y > container.clientHeight - 38 ||
				occupied.some(
					(other) =>
						Math.abs(other.x - pixel.x) < other.halfWidth + halfWidth + 8 &&
						Math.abs(other.y - pixel.y) < 19
				) ||
				endpointPixels.some(
					(other) =>
						Math.abs(other.x - pixel.x) < halfWidth + 26 && Math.abs(other.y - pixel.y) < 40
				)
			)
				continue;
			occupied.push({ x: pixel.x, y: pixel.y, halfWidth });
			names.add(String(name));
			const element = document.createElement('span');
			element.className = 'location-street-label';
			element.textContent = String(name);
			streetMarkers.set(
				String(name),
				new markerConstructor({ element, anchor: 'center' })
					.setLngLat([point[0], point[1]])
					.addTo(map)
			);
			if (names.size >= (container.clientWidth < 550 ? 12 : 24)) break;
		}
	}
	async function loadContext() {
		if (!map || !ready || !active) return;
		const bounds = map.getBounds();
		const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
		if (bbox[2] - bbox[0] > 1 || bbox[3] - bbox[1] > 1) {
			contextStatus = 'Zoom in to see streets';
			return;
		}
		const key = bbox.map((coordinate) => coordinate.toFixed(5)).join(',');
		if (lastContext === key) return;
		lastContext = key;
		const generation = ++contextGeneration;
		contextController?.abort();
		contextController = new AbortController();
		try {
			const response = await fetch(backendUrl(`map/context?bbox=${bbox.join(',')}`), {
				signal: contextController.signal
			});
			if (!response.ok) throw new Error('Streets unavailable');
			const data = await response.json();
			if (disposed || generation !== contextGeneration) return;
			contextData = data;
			setData('location-context', data);
			updateStreetLabels();
			contextReceipt = String(data.metadata?.retrieved_at ?? '').slice(0, 10);
			contextStatus =
				data.summary?.status === 'unavailable'
					? 'Streets unavailable'
					: 'OpenStreetMap streets & buildings';
		} catch (cause) {
			if (
				generation === contextGeneration &&
				!(cause instanceof DOMException && cause.name === 'AbortError')
			) {
				lastContext = '';
				contextStatus = 'Streets unavailable · move the map to retry';
			}
		}
	}
	function scheduleContext() {
		clearTimeout(contextTimer);
		if (!active || disposed) return;
		contextTimer = setTimeout(() => void loadContext(), 140);
	}
	$effect(() => {
		if (ready) {
			void [origin, destination, originLabel, destinationLabel, selection, showDestination];
			untrack(updateEndpoints);
		}
	});
	$effect(() => {
		if (ready) {
			void extraPoints;
			untrack(updateExtraPoints);
		}
	});
	$effect(() => {
		if (!ready) return;
		void [origin, destination, safeRoute, endpointGuide];
		untrack(updateRoute);
	});
	$effect(() => {
		if (!ready) return;
		void selectedPointId;
		untrack(updateSelectedPoint);
	});
	$effect(() => {
		if (!active) {
			clearTimeout(contextTimer);
			contextController?.abort();
			contextGeneration++;
			lastContext = '';
		}
	});
	$effect(() => {
		if (!selectedPointId) {
			lastSelectedPoint = null;
			return;
		}
		if (!ready || !active) return;
		const point = extraPoints.find((item) => item.id === selectedPointId);
		if (!validLocation(point) || selectedPointId === lastSelectedPoint) return;
		lastSelectedPoint = selectedPointId;
		untrack(() =>
			map?.easeTo({
				center: [point.longitude, point.latitude],
				zoom: Math.max(map.getZoom(), 15.5),
				duration: reducedMotion() ? 0 : 240
			})
		);
	});
	$effect(() => {
		if (ready && mapFeatures) untrack(() => setIslands(mapFeatures!));
	});
	$effect(() => {
		if (!ready || !active) return;
		const key = `${center.latitude}:${center.longitude}`;
		const focus = key !== centerKey;
		centerKey = key;
		void tick().then(() => {
			map?.resize();
			if (focus) untrack(fitPoints);
			scheduleContext();
		});
	});
	onMount(() => {
		const resize = new ResizeObserver(() => {
			map?.resize();
			if (active) {
				untrack(fitPoints);
				scheduleContext();
			}
		});
		resize.observe(container);
		void (async () => {
			try {
				const library = await import('maplibre-gl');
				if (disposed) return;
				library.setWorkerUrl(workerUrl);
				markerConstructor = library.Marker;
				const instance = new library.Map({
					container,
					style: {
						version: 8,
						sources: {},
						layers: [
							{
								id: 'water',
								type: 'background',
								paint: { 'background-color': themeColors.colorcce5e6 }
							}
						]
					},
					center: validLocation(center) ? [center.longitude, center.latitude] : [73.51, 4.18],
					zoom: 14,
					attributionControl: false
				});
				map = instance;
				instance.on('load', () => {
					for (const id of ['location-islands', 'location-context', 'location-route'])
						instance.addSource(id, { type: 'geojson', data: empty() });
					instance.addLayer({
						id: 'location-land',
						type: 'fill',
						source: 'location-islands',
						paint: { 'fill-color': themeColors.colorf5f2e8 }
					});
					instance.addLayer({
						id: 'location-shore',
						type: 'line',
						source: 'location-islands',
						paint: { 'line-color': themeColors.colora5c2b6, 'line-width': 1.5 }
					});
					instance.addLayer({
						id: 'location-green',
						type: 'fill',
						source: 'location-context',
						filter: ['==', ['get', 'kind'], 'green'],
						paint: { 'fill-color': themeColors.colorbcd4b5, 'fill-opacity': 0.6 }
					});
					instance.addLayer({
						id: 'location-buildings',
						type: 'fill',
						source: 'location-context',
						filter: ['==', ['get', 'kind'], 'building'],
						paint: { 'fill-color': themeColors.colorc9cec7, 'fill-opacity': 0.85 }
					});
					instance.addLayer({
						id: 'location-street-casing',
						type: 'line',
						source: 'location-context',
						filter: ['==', ['get', 'kind'], 'road'],
						paint: {
							'line-color': themeColors.colorc2c7bc,
							'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 6]
						}
					});
					instance.addLayer({
						id: 'location-streets',
						type: 'line',
						source: 'location-context',
						filter: ['==', ['get', 'kind'], 'road'],
						paint: {
							'line-color': themeColors.colorfffdf7,
							'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 16, 4.3]
						}
					});
					instance.addLayer({
						id: 'location-route-casing',
						type: 'line',
						source: 'location-route',
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: { 'line-color': themeColors.colorffffff, 'line-width': 8, 'line-opacity': 0.7 }
					});
					instance.addLayer({
						id: 'location-route-line',
						type: 'line',
						source: 'location-route',
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: { 'line-color': themeColors.color326c75, 'line-width': 4 }
					});
					ready = true;
					if (mapFeatures) setIslands(mapFeatures);
					else {
						featureController = new AbortController();
						void api<MapFeatures>('map/features?layer=islands', undefined, featureController.signal)
							.then((features) => {
								if (!disposed) setIslands(features);
							})
							.catch(() => {
								if (!disposed) error = 'Island outlines unavailable';
							});
					}
				});
				instance.on('moveend', () => {
					updateStreetLabels();
					updateExtraPoints();
					scheduleContext();
				});
				instance.on('click', (event) =>
					choose({ latitude: event.lngLat.lat, longitude: event.lngLat.lng })
				);
				instance
					.getCanvas()
					.setAttribute(
						'aria-label',
						'Location map. Use arrow keys to pan, plus or minus to zoom. Press Enter to choose the map center.'
					);
				instance.getCanvas().addEventListener('keydown', (event) => {
					if (event.key === 'Enter' && selection) {
						event.preventDefault();
						useMapCenter();
					}
				});
			} catch (cause) {
				if (!disposed) error = cause instanceof Error ? cause.message : 'Map unavailable';
			}
		})();
		return () => {
			disposed = true;
			resize.disconnect();
			clearTimeout(contextTimer);
			contextGeneration++;
			contextController?.abort();
			featureController?.abort();
			originMarker?.remove();
			destinationMarker?.remove();
			for (const marker of [...pointMarkers.values(), ...streetMarkers.values()]) marker.remove();
			pointMarkers.clear();
			pointGroups.clear();
			streetMarkers.clear();
			map?.remove();
			map = null;
		};
	});
</script>

<section
	class="location-map"
	aria-label={label}
	data-origin={origin ? `${origin.longitude},${origin.latitude}` : ''}
	data-destination={destination ? `${destination.longitude},${destination.latitude}` : ''}
>
	<div class="point-toolbar" aria-label="Map location controls">
		<Button
			variant={selection === 'origin' ? 'default' : 'outline'}
			aria-pressed={selection === 'origin'}
			onclick={() => chooseEndpoint('origin')}
			><span class="point-badge a">A</span><span>{originLabel}</span><MousePointer2
				size={14}
			/></Button
		>
		{#if showDestination}<Button
				variant={selection === 'destination' ? 'default' : 'outline'}
				aria-pressed={selection === 'destination'}
				onclick={() => chooseEndpoint('destination')}
				><span class="point-badge b">B</span><span>{destinationLabel}</span><MousePointer2
					size={14}
				/></Button
			>{/if}
		<Button variant="ghost" size="sm" onclick={fitPoints} aria-label="Show selected locations"
			><Scan size={16} />Show points</Button
		>
	</div>
	<div class="location-map-stage" class:picking={!!selection}>
		<div
			bind:this={container}
			class="location-map-canvas"
			aria-describedby={`${instanceId}-hint`}
		></div>
		<div class="map-picking-hint" id={`${instanceId}-hint`} role="status">
			<MousePointer2 size={15} /><span>{selectionMessage}</span>{#if selection}<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => onselection?.(null)}
					aria-label="Cancel choosing a location"><X size={15} /></Button
				>{/if}
		</div>
		{#if selection}<Button class="use-center" variant="secondary" size="sm" onclick={useMapCenter}
				><Crosshair size={15} />Use map center</Button
			>{/if}
		{#if error}<p class="map-error" role="alert">{error}</p>{/if}
		{#if nearbyChoices.length}
			<div class="nearby-place-choices" aria-label="Choose a nearby place">
				<div>
					<b>{nearbyChoices.length} nearby places</b><Button
						variant="ghost"
						size="icon-sm"
						onclick={() => (nearbyChoices = [])}
						aria-label="Close nearby place choices"><X size={15} /></Button
					>
				</div>
				<p>These source locations overlap at this zoom. Choose a place below.</p>
				{#each nearbyChoices as point (point.id)}<Button
						variant="outline"
						onclick={() => {
							nearbyChoices = [];
							onpoint?.(point.id);
						}}>{point.label}</Button
					>{/each}
			</div>
		{/if}
		{#if safeRoute.length > 1 || endpointGuide}<span class="route-caption"
				>{safeRoute.length > 1 ? routeLabel : 'Endpoint guide · route not calculated'}</span
			>{/if}
	</div>
	<div class="map-source">
		<span>{contextStatus}{contextReceipt ? ` · ${contextReceipt}` : ''}</span><span
			>© OpenStreetMap contributors</span
		>
	</div>
</section>

<style>
	.location-map {
		min-width: 0;
		border: 1px solid var(--theme-color-d9e2db);
		border-radius: 16px;
		overflow: hidden;
		background: var(--theme-color-fbfcf8);
	}
	.point-toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 12px;
		align-items: center;
	}
	.point-toolbar :global(button) {
		max-width: 100%;
	}
	.point-toolbar :global(button > span:not(.point-badge)) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.point-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		color: var(--theme-color-ffffff);
		font-size: 11px;
		font-weight: 700;
		flex-shrink: 0;
	}
	.a {
		background: var(--theme-color-2d626a);
	}
	.b {
		background: var(--theme-color-8761a7);
	}
	.location-map-stage {
		position: relative;
		height: clamp(340px, 51vh, 530px);
		min-height: 340px;
	}
	.location-map-canvas {
		width: 100%;
		height: 100%;
	}
	.picking :global(.maplibregl-canvas) {
		cursor: crosshair;
	}
	.location-map-canvas:focus-visible {
		outline: 3px solid var(--theme-color-4b7a6f);
		outline-offset: -3px;
	}
	.map-picking-hint {
		position: absolute;
		top: 12px;
		left: 12px;
		right: 52px;
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--theme-color-fffdf5ee);
		border: 1px solid var(--theme-color-d4ded7);
		border-radius: 10px;
		padding: 8px 11px;
		font-size: 12px;
		color: var(--theme-color-38514d);
		max-width: 510px;
		box-shadow: 0 2px 10px var(--theme-color-263d3310);
		pointer-events: none;
	}
	.map-picking-hint :global(button) {
		pointer-events: auto;
		margin-left: auto;
		flex-shrink: 0;
	}
	.map-picking-hint :global(svg) {
		flex-shrink: 0;
	}
	.location-map :global(.use-center) {
		position: absolute;
		bottom: 18px;
		left: 12px;
	}
	.route-caption {
		position: absolute;
		bottom: 18px;
		left: 12px;
		font-size: 11px;
		border-radius: 7px;
		background: var(--theme-color-fffdf5ee);
		padding: 7px 10px;
		color: var(--theme-color-38514d);
		pointer-events: none;
	}
	.picking .route-caption {
		bottom: 58px;
	}
	.map-error {
		position: absolute;
		top: 65px;
		left: 12px;
		background: var(--theme-color-fff0e8);
		padding: 8px 12px;
		border-radius: 8px;
		font-size: 12px;
	}
	.map-source {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 5px 12px;
		padding: 9px 12px;
		font-size: 10px;
		color: var(--theme-color-6c7871);
	}
	.location-map :global(.location-endpoint) {
		width: 38px;
		height: 42px;
		border-radius: 18px 18px 18px 3px;
		border: 3px solid var(--theme-color-ffffff);
		color: var(--theme-color-ffffff);
		background: var(--theme-color-2d626a);
		box-shadow: 0 2px 8px var(--theme-color-133b4259);
		font-family: inherit;
		font-size: 16px;
		font-weight: 700;
		cursor: grab;
	}
	.location-map :global(.location-endpoint.destination) {
		background: var(--theme-color-8761a7);
	}
	.location-map :global(.location-endpoint[aria-pressed='true']) {
		box-shadow:
			0 0 0 5px var(--theme-color-ffffff88),
			0 2px 8px var(--theme-color-133b4259);
	}
	.location-map :global(.location-endpoint:active) {
		cursor: grabbing;
	}
	.location-map :global(.location-endpoint:focus-visible),
	.location-map :global(.location-extra-point:focus-visible) {
		outline: 3px solid var(--theme-color-1d414b);
		outline-offset: 3px;
	}
	.location-map :global(.location-extra-point) {
		width: 27px;
		height: 27px;
		border: 2px solid var(--theme-color-ffffff);
		color: var(--theme-color-345953);
		background: var(--theme-color-e8f2df);
		border-radius: 50%;
		box-shadow: 0 1px 5px var(--theme-color-133b4233);
		font-family: inherit;
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
	}
	.location-map :global(.location-extra-point.grouped) {
		width: 33px;
		height: 33px;
		background: var(--theme-color-355e5a);
		color: var(--theme-color-ffffff);
		box-shadow:
			0 0 0 4px var(--theme-color-ffffff88),
			0 1px 5px var(--theme-color-133b4233);
	}
	.location-map :global(.location-extra-point.selected) {
		background: var(--theme-color-8761a7);
		color: var(--theme-color-ffffff);
		box-shadow:
			0 0 0 5px var(--theme-color-ffffff),
			0 0 0 8px var(--theme-color-8761a777);
		z-index: 2;
	}
	.nearby-place-choices {
		position: absolute;
		top: 62px;
		left: 12px;
		max-width: min(340px, calc(100% - 24px));
		max-height: calc(100% - 110px);
		overflow: auto;
		padding: 13px;
		background: var(--theme-color-fffdf8f5);
		border: 1px solid var(--theme-color-d3ded5);
		border-radius: 12px;
		box-shadow: 0 8px 25px var(--theme-color-25423622);
		display: grid;
		gap: 7px;
		font-size: 12px;
	}
	.nearby-place-choices > div {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.nearby-place-choices p {
		color: var(--theme-color-67776f);
		font-size: 11px;
		margin: 0 0 3px;
	}
	.nearby-place-choices :global(button) {
		white-space: normal;
		height: auto;
		min-height: 36px;
		text-align: left;
	}
	.location-map :global(.location-street-label) {
		font-size: 10px;
		color: var(--theme-color-576761);
		text-shadow:
			0 1px 2px var(--theme-color-ffffff),
			0 -1px 2px var(--theme-color-ffffff),
			1px 0 2px var(--theme-color-ffffff),
			-1px 0 2px var(--theme-color-ffffff);
		pointer-events: none;
		white-space: nowrap;
	}
	@media (max-width: 550px) {
		.point-toolbar {
			gap: 6px;
			padding: 9px;
		}
		.point-toolbar :global(button) {
			font-size: 11px;
			padding-inline: 9px;
		}
		.location-map-stage {
			height: 380px;
		}
		.map-picking-hint {
			font-size: 11px;
			top: 9px;
			left: 9px;
			padding: 7px 8px;
		}
	}
</style>
