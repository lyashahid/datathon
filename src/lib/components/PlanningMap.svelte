<script lang="ts">
	import { themeColors } from '#lib/theme.js';
	import { backendUrl } from '#lib/app-paths.js';
	import { onMount, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import {
		Pause,
		Play,
		LocateFixed,
		MapPin,
		RefreshCw,
		Route,
		Layers,
		ArrowRight,
		Hospital,
		GraduationCap,
		Signpost,
		X,
		Undo2,
		Trash2,
		Check
	} from '@lucide/svelte';
	import type { Feature, FeatureCollection, Geometry } from 'geojson';
	import type { Map as LibreMap, GeoJSONSource, Marker } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import { Button } from '#lib/components/ui/button/index.js';
	import { atlasSymbols } from './map/symbols.js';
	import type { Coordinates, MapFeatures } from '#lib/types.js';
	import {
		collection,
		impactHexes,
		impactColors,
		impactClass,
		createPlaybackSampler,
		routeFeatures,
		validPoint
	} from '#lib/planning-map.js';
	import type {
		PlanningPlace,
		PlanningComparison,
		PlanningJourney,
		PlanningOperation
	} from '#lib/planning-map.js';

	let {
		origins,
		facilities,
		stops,
		edges,
		patterns = [],
		operations,
		comparisons = [],
		mapFeatures = null,
		originId,
		destinationId,
		outward = null,
		returning = null,
		journeyStale = false,
		status = 'draft',
		busyLabel = '',
		active = true,
		inspectorInset = 0,
		placement = null,
		draftService = null,
		targetMode = null,
		canCreate = true,
		canUndo = false,
		editing = false,
		onpick = () => {},
		oncreate = () => {},
		onconfirm = () => {},
		oncancel = () => {},
		ondetails = () => {},
		onundo = () => {},
		onclear = () => {},
		onedit = () => {},
		onstop = () => {},
		ontarget = () => {},
		onorigin = () => {},
		ondestination = () => {},
		onrecalculate = () => {}
	}: {
		origins: PlanningPlace[];
		facilities: PlanningPlace[];
		stops: PlanningPlace[];
		edges: { id: string; geometry?: number[][] }[];
		patterns?: { id: string; name: string; geometry?: number[][] }[];
		operations: PlanningOperation[];
		comparisons?: PlanningComparison[];
		mapFeatures?: MapFeatures | null;
		originId: string;
		destinationId: string;
		outward?: PlanningJourney | null;
		returning?: PlanningJourney | null;
		journeyStale?: boolean;
		status?: 'draft' | 'calculating' | 'latest' | 'stale';
		busyLabel?: string;
		active?: boolean;
		inspectorInset?: number;
		placement?: { coordinates: Coordinates; name: string; kind: string } | null;
		draftService?: { from: string; to: string; mode: string } | null;
		targetMode?: 'road' | 'service' | null;
		canCreate?: boolean;
		canUndo?: boolean;
		editing?: boolean;
		onpick?: (point: Coordinates) => void;
		oncreate?: (kind: 'add_hospital' | 'add_school' | 'add_stop', point?: Coordinates) => void;
		onconfirm?: () => void;
		oncancel?: () => void;
		ondetails?: () => void;
		onundo?: () => void;
		onclear?: () => void;
		onedit?: (index: number) => void;
		onstop?: (id: string) => void;
		ontarget?: (id: string) => void;
		onorigin?: (id: string) => void;
		ondestination?: (id: string) => void;
		onrecalculate?: () => void;
	} = $props();
	let container: HTMLDivElement;
	let map = $state.raw<LibreMap | null>(null);
	let ready = $state(false);
	let error = $state('');
	let contextStatus = $state('Loading street context…');
	let impactVisible = $state(true);
	let placesVisible = $state(true);
	let picking = $state(false);
	let pendingKind = $state<'add_hospital' | 'add_school' | 'add_stop' | null>(null);
	let clickedLocation = $state<Coordinates | null>(null);
	let popupPosition = $state({ x: 0, y: 0 });
	let popupElement = $state<HTMLDivElement | null>(null);
	let popupTray = $state(false);
	let adjustingPopupCamera = false;
	let draggingOver = $state(false);
	let direction = $state<'outward' | 'return'>('outward');
	let playing = $state(false);
	let elapsed = $state(0);
	let renderedHexes = $state(0);
	let renderedRoutes = $state(0);
	let selectedInfo = $state('');
	let receipt = $state('');
	let contextController: AbortController | null = null;
	let contextTimer: ReturnType<typeof setTimeout> | undefined;
	let frame = 0;
	let disposed = false;
	let placementFocus = '';
	let lastContext = '';
	let markerConstructor: typeof import('maplibre-gl').Marker | undefined;
	let startMarker: Marker | null = null;
	let endMarker: Marker | null = null;
	let movementMarker: Marker | null = null;
	let previewMarker: Marker | null = null;
	const sourceData = new SvelteMap<string, FeatureCollection>();
	const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const selectedOrigin = $derived(origins.find((item) => item.id === originId));
	const popupLocation = $derived(placement?.coordinates ?? clickedLocation);
	function updatePopupPosition() {
		if (!map || !popupLocation || !container || !active) return;
		const point = map.project(popupLocation);
		const width = container.clientWidth;
		const height = container.clientHeight;
		const popupWidth = popupElement?.offsetWidth ?? Math.min(290, width - 24);
		const popupHeight = popupElement?.offsetHeight ?? 215;
		const markerWidth = previewMarker?.getElement().offsetWidth ?? 30;
		const markerHeight = previewMarker?.getElement().offsetHeight ?? 22;
		const centeredX = Math.max(12, Math.min(point.x - popupWidth / 2, width - popupWidth - 12));
		const centeredY = Math.max(8, Math.min(point.y - popupHeight / 2, height - popupHeight - 8));
		const below = point.y + 18;
		const above = point.y - markerHeight - popupHeight - 18;
		const right = point.x + markerWidth / 2 + 18;
		const left = point.x - markerWidth / 2 - popupWidth - 18;
		popupTray = width < 560;
		if (!popupTray) {
			if (below + popupHeight <= height - 8) {
				popupPosition = { x: centeredX, y: below };
				return;
			}
			if (above >= 8) {
				popupPosition = { x: centeredX, y: above };
				return;
			}
			if (right + popupWidth <= width - 12) {
				popupPosition = { x: right, y: centeredY };
				return;
			}
			if (left >= 12) {
				popupPosition = { x: left, y: centeredY };
				return;
			}
			popupTray = true;
		}
		const trayTop = Math.max(8, height - popupHeight - 8);
		popupPosition = { x: 12, y: trayTop };
		// Let the compact tray render before measuring its safe pin area. Panning
		// changes only the camera; the proposed geographic location stays intact.
		if (!popupElement?.classList.contains('placement-tray') || adjustingPopupCamera) return;
		const maxPinY = trayTop - 18;
		const minPinY = Math.min(markerHeight + 58, maxPinY);
		const targetX = Math.max(markerWidth / 2 + 12, Math.min(point.x, width - markerWidth / 2 - 12));
		const targetY = Math.max(minPinY, Math.min(point.y, maxPinY));
		if (Math.abs(point.x - targetX) > 1 || Math.abs(point.y - targetY) > 1) {
			adjustingPopupCamera = true;
			map.panBy([point.x - targetX, point.y - targetY], { duration: 0 });
			adjustingPopupCamera = false;
		}
	}
	function cancelPlacement() {
		pendingKind = null;
		clickedLocation = null;
		picking = false;
		selectedInfo = '';
		oncancel();
	}
	function createAtClick(kind: 'add_hospital' | 'add_school' | 'add_stop') {
		if (!clickedLocation) return;
		oncreate(kind, clickedLocation);
		clickedLocation = null;
		pendingKind = null;
		picking = false;
	}
	function placeName(id: string | undefined) {
		if (!id) return '';
		if (id === 'return:destination') return selectedDestination?.name ?? 'Journey destination';
		return (
			[...origins, ...facilities, ...stops].find((place) => place.id === id)?.name ??
			(id.startsWith('wp:') ? 'Residential area' : 'Connection point')
		);
	}
	const selectedDestination = $derived(
		facilities.find((item) => item.id === destinationId) ??
			(!journeyStale && outward?.destination_id
				? facilities.find((item) => item.id === outward.destination_id)
				: undefined)
	);
	const selectedComparison = $derived(comparisons.find((item) => item.origin_id === originId));
	const hexes = $derived(impactHexes(origins, comparisons));
	const currentJourney = $derived(direction === 'return' ? returning : outward);
	const maximumElapsed = $derived(currentJourney?.minutes ?? 0);
	const sampleJourney = $derived(createPlaybackSampler(currentJourney));
	const currentPosition = $derived(sampleJourney(elapsed));
	const outwardData = $derived(routeFeatures(outward, 'outward'));
	const returningData = $derived(routeFeatures(returning, 'return'));
	const geometryNotes = $derived.by(() => {
		const legs = currentJourney?.path ?? [];
		const notes = legs.flatMap((leg) => (leg.geometry_warning ? [leg.geometry_warning] : []));
		if (
			legs.some((leg) => leg.mode === 'bus' && leg.geometry_source === 'osm_network_shortest_path')
		)
			notes.push(
				'Bus path estimated from the available road network; operator routing may differ.'
			);
		if (legs.some((leg) => leg.mode !== 'walk' && leg.geometry.filter(validPoint).length < 2))
			notes.push('Some transit legs have no located path. Their vehicle animation is unavailable.');
		return [...new Set(notes)];
	});
	const statusText = $derived(
		status === 'calculating'
			? busyLabel || 'Recalculating resident access…'
			: status === 'latest'
				? 'Latest calculated impact'
				: status === 'stale'
					? 'Proposal changed · recalculate impact'
					: 'Draft preview · impact not calculated'
	);
	const impacts = $derived(
		comparisons.reduce<Record<string, number>>((counts, row) => {
			const key = impactClass(row);
			counts[key] = (counts[key] ?? 0) + 1;
			return counts;
		}, {})
	);
	const minuteLabel = (value: number | null | undefined) =>
		value == null ? 'Unavailable' : `${value.toFixed(1)} min`;
	const placeData = $derived(
		collection(
			[...facilities, ...stops]
				.filter((place) => validPoint([place.lon, place.lat]))
				.map((place) => ({
					type: 'Feature',
					properties: { id: place.id, name: place.name || place.id, kind: place.kind ?? 'bus' },
					geometry: { type: 'Point', coordinates: [place.lon, place.lat] }
				}))
		)
	);
	const draftData = $derived.by(() => {
		const features: Feature<Geometry>[] = [];
		const places = new Map([...stops, ...facilities].map((place) => [place.id, place]));
		for (const [index, operation] of operations.entries()) {
			if (validPoint(operation.coordinates))
				features.push({
					type: 'Feature',
					properties: {
						operationIndex: index,
						kind: operation.type,
						name: operation.name || operation.type.replaceAll('_', ' '),
						icon:
							operation.type === 'add_hospital'
								? 'atlas-health'
								: operation.type === 'add_school'
									? 'atlas-school'
									: 'atlas-bus-stop'
					},
					geometry: { type: 'Point', coordinates: operation.coordinates }
				});
			if (operation.type === 'road_closure') {
				const edge = edges.find((item) => item.id === operation.target_id);
				if (edge?.geometry && edge.geometry.filter(validPoint).length > 1)
					features.push({
						type: 'Feature',
						properties: { kind: 'closure', name: 'Proposed road closure' },
						geometry: { type: 'LineString', coordinates: edge.geometry }
					});
			} else if (operation.target_id && places.has(operation.target_id)) {
				const place = places.get(operation.target_id)!;
				features.push({
					type: 'Feature',
					properties: {
						kind: 'changed-place',
						name: operation.type.replaceAll('_', ' '),
						icon:
							place.kind === 'school'
								? 'atlas-school'
								: ['hospital', 'clinic'].includes(place.kind || '')
									? 'atlas-health'
									: 'atlas-bus-stop'
					},
					geometry: { type: 'Point', coordinates: [place.lon, place.lat] }
				});
			}
			if (
				operation.target_id &&
				!places.has(operation.target_id) &&
				operation.type !== 'road_closure'
			) {
				const pattern = patterns.find((item) => item.id === operation.target_id);
				if (pattern?.geometry && pattern.geometry.filter(validPoint).length > 1)
					features.push({
						type: 'Feature',
						properties: {
							kind: 'changed-service',
							name: `${operation.type.replaceAll('_', ' ')} · ${pattern.name}`
						},
						geometry: { type: 'LineString', coordinates: pattern.geometry }
					});
			}
			if (Array.isArray(operation.service?.stopIds)) {
				const points = operation.service.stopIds.flatMap((id: unknown) => {
					const place = typeof id === 'string' ? places.get(id) : undefined;
					return place ? [[place.lon, place.lat]] : [];
				});
				if (points.length > 1)
					features.push({
						type: 'Feature',
						properties: {
							kind: 'service-preview',
							name: 'Proposed service · conceptual connector'
						},
						geometry: { type: 'LineString', coordinates: points }
					});
			}
		}
		if (draftService) {
			const from = places.get(draftService.from),
				to = places.get(draftService.to);
			if (from && to && from.id !== to.id)
				features.push({
					type: 'Feature',
					properties: {
						kind: 'service-preview',
						name: `${draftService.mode} endpoints · conceptual connector`
					},
					geometry: {
						type: 'LineString',
						coordinates: [
							[from.lon, from.lat],
							[to.lon, to.lat]
						]
					}
				});
		}
		return collection(features);
	});
	const islands = $derived(
		collection(
			(mapFeatures?.features ?? []).filter(
				(feature): feature is Feature<Geometry> =>
					!!feature.geometry &&
					['Polygon', 'MultiPolygon'].includes(feature.geometry.type) &&
					!!feature.properties?.id &&
					!feature.properties?.island_id
			)
		)
	);
	const selectableRoads = $derived(
		collection(
			edges.flatMap((edge) =>
				edge.geometry && edge.geometry.filter(validPoint).length >= 2
					? [
							{
								type: 'Feature' as const,
								properties: { id: edge.id },
								geometry: {
									type: 'LineString' as const,
									coordinates: edge.geometry.filter(validPoint)
								}
							}
						]
					: []
			)
		)
	);
	const selectableServices = $derived(
		collection(
			patterns.flatMap((pattern) =>
				pattern.geometry && pattern.geometry.filter(validPoint).length >= 2
					? [
							{
								type: 'Feature' as const,
								properties: { id: pattern.id, name: pattern.name },
								geometry: {
									type: 'LineString' as const,
									coordinates: pattern.geometry.filter(validPoint)
								}
							}
						]
					: []
			)
		)
	);

	function setData(id: string, data: FeatureCollection) {
		const source = map?.getSource(id) as GeoJSONSource | undefined;
		if (!source || untrack(() => sourceData.get(id)) === data) return;
		untrack(() => sourceData.set(id, data));
		source.setData(data);
	}
	function marker(element: HTMLElement, point: Coordinates): Marker | null {
		if (!markerConstructor || !map) return null;
		return new markerConstructor({ element, anchor: 'bottom' }).setLngLat(point).addTo(map);
	}
	function endpoint(
		kind: string,
		place: PlanningPlace | undefined,
		old: Marker | null
	): Marker | null {
		if (!place || !validPoint([place.lon, place.lat])) {
			old?.remove();
			return null;
		}
		const element = old?.getElement() ?? document.createElement('div');
		element.className = `planning-pin ${kind}`;
		element.dataset.coordinates = `${place.lon},${place.lat}`;
		element.setAttribute(
			'aria-label',
			`${kind === 'start' ? 'Journey start' : 'Journey destination'}: ${place.name || place.id}`
		);
		if (!old) {
			const badge = document.createElement('b');
			badge.textContent = kind === 'start' ? 'A' : 'B';
			element.append(badge, document.createElement('span'));
		}
		const name = element.querySelector('span')!;
		name.textContent =
			kind === 'start' ? `Start · ${place.name || 'Resident area'}` : place.name || 'Destination';
		return old ? old.setLngLat([place.lon, place.lat]) : marker(element, [place.lon, place.lat]);
	}
	function fitPoints(points: Coordinates[]) {
		if (!map || !points.length) return;
		const xs = points.map((point) => point[0]),
			ys = points.map((point) => point[1]);
		map.fitBounds(
			[
				[Math.min(...xs), Math.min(...ys)],
				[Math.max(...xs), Math.max(...ys)]
			],
			{
				padding: {
					top: Math.min(100, container.clientHeight * 0.2),
					bottom:
						container.clientWidth < 900 && inspectorInset
							? Math.min(container.clientHeight * 0.55, 260)
							: Math.min(130, container.clientHeight * 0.25),
					left: Math.min(100, container.clientWidth / 5),
					right:
						container.clientWidth >= 900 && inspectorInset
							? Math.min(inspectorInset + 30, container.clientWidth * 0.58)
							: Math.min(100, container.clientWidth / 5)
				},
				maxZoom: 15.7,
				duration: reducedMotion() ? 0 : 260
			}
		);
	}
	function focus() {
		if (placement && validPoint(placement.coordinates)) {
			fitPoints([placement.coordinates]);
			return;
		}
		if (draftService) {
			const endpoints = [draftService.from, draftService.to].flatMap((id) => {
				const stop = stops.find((place) => place.id === id);
				return stop && validPoint([stop.lon, stop.lat])
					? [[stop.lon, stop.lat] as Coordinates]
					: [];
			});
			if (endpoints.length > 1) {
				fitPoints(endpoints);
				return;
			}
		}
		const journeyPoints = (!journeyStale ? (currentJourney?.geometry ?? []) : []).filter(
			validPoint
		);
		const selected = [selectedOrigin, selectedDestination].flatMap((place) =>
			place ? [[place.lon, place.lat] as Coordinates] : []
		);
		fitPoints(
			journeyPoints.length > 1
				? journeyPoints
				: selected.length > 1
					? selected
					: origins.map((place) => [place.lon, place.lat])
		);
	}
	async function loadContext() {
		if (!map || !ready || !active || disposed) return;
		const bounds = map.getBounds();
		const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
		if (bbox[2] - bbox[0] > 1 || bbox[3] - bbox[1] > 1) return;
		const key = bbox.map((value) => value.toFixed(5)).join(',');
		if (key === lastContext) return;
		lastContext = key;
		contextController?.abort();
		const controller = new AbortController();
		contextController = controller;
		try {
			const response = await fetch(backendUrl(`map/context?bbox=${bbox.join(',')}`), {
				signal: controller.signal
			});
			if (!response.ok) throw new Error('Street context unavailable');
			const data = await response.json();
			if (disposed || controller.signal.aborted) return;
			setData('context', data);
			receipt = String(data.metadata?.retrieved_at ?? '').slice(0, 10);
			contextStatus =
				data.summary?.status === 'unavailable'
					? 'Streets unavailable'
					: `${Number(data.summary?.roads ?? 0).toLocaleString()} street features · ${Number(data.summary?.buildings ?? 0).toLocaleString()} buildings`;
		} catch (cause) {
			if (!controller.signal.aborted) {
				lastContext = '';
				contextStatus = cause instanceof Error ? cause.message : 'Street context unavailable';
			}
		}
	}
	function scheduleContext() {
		clearTimeout(contextTimer);
		if (!active || disposed) return;
		contextTimer = setTimeout(() => void loadContext(), 120);
	}
	function inspect(point: { x: number; y: number }) {
		if (!map) return;
		if (targetMode) {
			const target = map.queryRenderedFeatures([point.x, point.y], {
				layers: [targetMode === 'road' ? 'road-pick' : 'service-pick']
			})[0];
			if (target) {
				ontarget(String(target.properties.id));
				selectedInfo =
					targetMode === 'road'
						? 'Road selected. Add the closure to your proposal.'
						: `Service selected · ${target.properties.name}`;
				return;
			}
		}
		const hits = map.queryRenderedFeatures([point.x, point.y], {
			layers: ['places', 'hex-fill', 'draft-points', 'draft-lines']
		});
		const hit = hits[0];
		if (!hit) return;
		if (hit.layer.id === 'hex-fill') {
			onorigin(String(hit.properties.id));
			selectedInfo = 'Resident area selected. Open Journey to inspect a trip from here.';
		} else if (hit.layer.id === 'draft-points' && hit.properties.operationIndex !== undefined) {
			onedit(Number(hit.properties.operationIndex));
			selectedInfo = `Editing ${hit.properties.name}. Move the preview pin and save the change.`;
		} else if (
			hit.layer.id === 'places' &&
			facilities.some((place) => place.id === hit.properties.id)
		) {
			ondestination(String(hit.properties.id));
			selectedInfo = `Destination selected · ${hit.properties.name}`;
		} else if (hit.layer.id === 'places' && stops.some((place) => place.id === hit.properties.id)) {
			onstop(String(hit.properties.id));
			selectedInfo = `Boarding location selected · ${hit.properties.name}`;
		} else selectedInfo = String(hit.properties.name || 'Proposed change');
	}
	function choosePlacement(kind: 'add_hospital' | 'add_school' | 'add_stop') {
		if (placement) oncancel();
		pendingKind = kind;
		clickedLocation = null;
		picking = true;
		selectedInfo = 'Click a location on the map. Nothing is added until you confirm.';
	}
	function dragPlacement(event: DragEvent, kind: string) {
		event.dataTransfer?.setData('application/x-policy-location', kind);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
	}
	function dropPlacement(event: DragEvent) {
		const kind = event.dataTransfer?.getData('application/x-policy-location');
		if (!map || !['add_hospital', 'add_school', 'add_stop'].includes(kind ?? '')) return;
		event.preventDefault();
		draggingOver = false;
		const bounds = container.getBoundingClientRect();
		const point = map.unproject([event.clientX - bounds.left, event.clientY - bounds.top]);
		oncreate(kind as 'add_hospital' | 'add_school' | 'add_stop', [point.lng, point.lat]);
		pendingKind = null;
		clickedLocation = null;
		picking = false;
		selectedInfo = 'Drag the preview to adjust its position, then confirm or cancel.';
	}
	function drawMovement() {
		if (!map || journeyStale || !active || !currentPosition.point || !currentJourney?.path.length) {
			movementMarker?.remove();
			movementMarker = null;
			return;
		}
		if (movementMarker) {
			movementMarker.setLngLat(currentPosition.point);
			const element = movementMarker.getElement();
			element.setAttribute('aria-label', `Simulated resident journey: ${currentPosition.phase}`);
			if (element.dataset.mode === currentPosition.mode) return;
			movementMarker.remove();
			movementMarker = null;
		}
		const element = document.createElement('div');
		element.className = 'planning-traveller';
		element.dataset.mode = currentPosition.mode;
		const svgPaths: Record<string, string> = {
			walk: '<circle cx="12" cy="4" r="2"/><path d="m8 10 4-3 4 4 4 1M12 7l-2 7-4 7m4-7 6 7"/>',
			bus: '<rect x="5" y="4" width="14" height="15" rx="2"/><path d="M5 12h14M8 8h8M8 16h.1M16 16h.1M7 19v2M17 19v2"/>',
			ferry: '<path d="m5 11 7-3 7 3-2 7H7l-2-7ZM8 9V5h8v4M3 21c3-3 6 3 9 0s6 3 9 0"/>'
		};
		element.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svgPaths[currentPosition.mode] ?? svgPaths.walk}</svg>`;
		element.setAttribute('aria-label', `Simulated resident journey: ${currentPosition.phase}`);
		movementMarker = marker(element, currentPosition.point);
	}
	$effect(() => {
		if (!ready || !map) return;
		setData('islands', islands);
		setData('hexes', hexes);
		setData('places', placeData);
		setData('draft', draftData);
		setData('outward', outwardData);
		setData('return', returningData);
		setData('road-targets', selectableRoads);
		setData('service-targets', selectableServices);
	});
	$effect(() => {
		if (!ready || !map) return;
		map.setLayoutProperty('road-pick', 'visibility', targetMode === 'road' ? 'visible' : 'none');
		map.setLayoutProperty(
			'service-pick',
			'visibility',
			targetMode === 'service' ? 'visible' : 'none'
		);
	});
	$effect(() => {
		if (!ready || !map) return;
		map.setPaintProperty('hex-fill', 'fill-opacity', status === 'latest' ? 0.52 : 0.2);
		map.setPaintProperty(
			'hex-fill',
			'fill-color',
			status === 'latest' ? ['get', 'color'] : themeColors.colora4b2b5
		);
	});
	$effect(() => {
		if (!ready || !map) return;
		map.setFilter('hex-selected', ['==', ['get', 'id'], originId]);
	});
	$effect(() => {
		if (!ready || !map) return;
		for (const id of ['hex-fill', 'hex-outline', 'hex-selected'])
			map.setLayoutProperty(id, 'visibility', impactVisible ? 'visible' : 'none');
	});
	$effect(() => {
		if (!ready || !map) return;
		map.setLayoutProperty('places', 'visibility', placesVisible ? 'visible' : 'none');
	});
	$effect(() => {
		if (!ready || !map) return;
		for (const id of ['outward-line', 'return-line'])
			map.setPaintProperty(id, 'line-opacity', journeyStale ? 0.25 : 1);
		for (const id of ['outward-casing', 'return-casing'])
			map.setPaintProperty(id, 'line-opacity', journeyStale ? 0.15 : 0.75);
	});
	$effect(() => {
		if (!ready || !map) return;
		startMarker = endpoint('start', selectedOrigin, startMarker);
		endMarker = endpoint('end', selectedDestination, endMarker);
	});
	$effect(() => {
		void [popupLocation, popupElement, placement?.name];
		if (ready && active) untrack(updatePopupPosition);
	});
	$effect(() => {
		if (!popupElement || !ready || !active) return;
		const observer = new ResizeObserver(() => untrack(updatePopupPosition));
		observer.observe(popupElement);
		return () => observer.disconnect();
	});
	$effect(() => {
		if (!canCreate) {
			clickedLocation = null;
			pendingKind = null;
			picking = false;
		}
	});
	$effect(() => {
		if (!ready || !map) return;
		if (!placement || !validPoint(placement.coordinates)) {
			previewMarker?.remove();
			previewMarker = null;
			placementFocus = '';
			return;
		}
		const element = previewMarker?.getElement() ?? document.createElement('button');
		if (!previewMarker && markerConstructor) {
			element.setAttribute('type', 'button');
			element.className = 'planning-preview';
			previewMarker = new markerConstructor({ element, anchor: 'bottom', draggable: true })
				.setLngLat(placement.coordinates)
				.addTo(map);
			previewMarker.on('dragend', () => {
				const point = previewMarker?.getLngLat();
				if (point) onpick([point.lng, point.lat]);
				selectedInfo = 'Location moved. Confirm to save it, or cancel to discard this preview.';
			});
		}
		element.textContent = `${placement.kind === 'add_school' ? 'School' : placement.kind === 'add_hospital' ? 'Hospital' : 'Bus stop'} · drag to move`;
		element.setAttribute(
			'aria-label',
			`Draft location: ${placement.name || 'New location'}. Drag to move, or use Place at map center.`
		);
		element.dataset.coordinates = placement.coordinates.join(',');
		previewMarker?.setLngLat(placement.coordinates);
		// A label edit must not move the user's camera or replace the focused pin.
		const key = `${placement.kind}:${placement.coordinates.join(',')}`;
		if (key !== placementFocus) {
			placementFocus = key;
			if (active) untrack(focus);
		}
	});
	$effect(() => {
		if (!ready || !active) return;
		void [origins, selectedOrigin, selectedDestination, currentJourney, journeyStale, draftService];
		untrack(focus);
	});
	$effect(() => {
		void inspectorInset;
		if (active && ready) untrack(focus);
	});
	$effect(() => {
		if (!active || journeyStale) playing = false;
		if (active && ready) untrack(() => map?.resize());
	});
	$effect(() => {
		if (active && ready) untrack(scheduleContext);
		else {
			clearTimeout(contextTimer);
			contextController?.abort();
			lastContext = '';
		}
	});
	$effect(() => {
		void currentJourney;
		void direction;
		void journeyStale;
		untrack(() => {
			playing = false;
			elapsed = 0;
		});
	});
	$effect(() => {
		void ready;
		void currentPosition;
		void journeyStale;
		void active;
		untrack(drawMovement);
	});
	$effect(() => {
		if (!playing || !active || journeyStale) return;
		let previous = performance.now();
		function animate(now: number) {
			const delta = Math.min(100, now - previous);
			previous = now;
			elapsed = Math.min(
				maximumElapsed,
				elapsed + (delta / 1000) * Math.max(1, maximumElapsed / 24)
			);
			if (elapsed >= maximumElapsed) {
				playing = false;
				return;
			}
			frame = requestAnimationFrame(animate);
		}
		frame = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(frame);
	});
	onMount(() => {
		const dragOver = (event: DragEvent) => {
			if (event.dataTransfer?.types.includes('application/x-policy-location')) {
				event.preventDefault();
				draggingOver = true;
				if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
			}
		};
		const dragLeave = () => (draggingOver = false);
		container.addEventListener('dragover', dragOver);
		container.addEventListener('dragleave', dragLeave);
		container.addEventListener('drop', dropPlacement);
		const resize = new ResizeObserver(() => {
			map?.resize();
			if (ready && active) untrack(focus);
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
								paint: { 'background-color': themeColors.colorcce6e6 }
							}
						]
					},
					center: [73.517, 4.19],
					zoom: 12.5,
					attributionControl: false
				});
				map = instance;
				instance.on('load', () => {
					for (const [id, data] of Object.entries(atlasSymbols()))
						instance.addImage(id, data, { pixelRatio: 2 });
					for (const id of [
						'islands',
						'context',
						'hexes',
						'places',
						'draft',
						'outward',
						'return',
						'road-targets',
						'service-targets'
					])
						instance.addSource(id, { type: 'geojson', data: collection() });
					instance.addLayer({
						id: 'land',
						type: 'fill',
						source: 'islands',
						paint: { 'fill-color': themeColors.colorf4f1e8 }
					});
					instance.addLayer({
						id: 'shore',
						type: 'line',
						source: 'islands',
						paint: { 'line-color': themeColors.coloraac8bd, 'line-width': 1.5 }
					});
					instance.addLayer({
						id: 'green',
						type: 'fill',
						source: 'context',
						filter: ['==', ['get', 'kind'], 'green'],
						paint: { 'fill-color': themeColors.colorbad2b4, 'fill-opacity': 0.55 }
					});
					instance.addLayer({
						id: 'buildings',
						type: 'fill',
						source: 'context',
						filter: ['==', ['get', 'kind'], 'building'],
						paint: { 'fill-color': themeColors.colord0d4cd, 'fill-opacity': 0.8 }
					});
					instance.addLayer({
						id: 'streets-casing',
						type: 'line',
						source: 'context',
						filter: ['==', ['get', 'kind'], 'road'],
						paint: {
							'line-color': themeColors.colorc6c8bb,
							'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 5]
						}
					});
					instance.addLayer({
						id: 'streets',
						type: 'line',
						source: 'context',
						filter: ['==', ['get', 'kind'], 'road'],
						paint: {
							'line-color': themeColors.colorfffdf5,
							'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 16, 3.7]
						}
					});
					instance.addLayer({
						id: 'hex-fill',
						type: 'fill',
						source: 'hexes',
						paint: { 'fill-color': themeColors.colora4b2b5, 'fill-opacity': 0.2 }
					});
					instance.addLayer({
						id: 'hex-outline',
						type: 'line',
						source: 'hexes',
						paint: {
							'line-color': themeColors.colorffffff,
							'line-width': 0.8,
							'line-opacity': 0.75
						}
					});
					instance.addLayer({
						id: 'hex-selected',
						type: 'line',
						source: 'hexes',
						filter: ['==', ['get', 'id'], originId],
						paint: { 'line-color': themeColors.color153c42, 'line-width': 3 }
					});
					for (const direction of ['outward', 'return']) {
						instance.addLayer({
							id: `${direction}-casing`,
							type: 'line',
							source: direction,
							layout: { 'line-cap': 'round', 'line-join': 'round' },
							paint: {
								'line-color': themeColors.colorffffff,
								'line-width': direction === 'return' ? 5 : 8,
								'line-opacity': 0.75
							}
						});
						instance.addLayer({
							id: `${direction}-line`,
							type: 'line',
							source: direction,
							layout: { 'line-cap': 'round', 'line-join': 'round' },
							paint: {
								'line-color':
									direction === 'return'
										? themeColors.color8567b1
										: [
												'match',
												['get', 'mode'],
												'bus',
												themeColors.colord18c34,
												'ferry',
												themeColors.color2689b2,
												themeColors.color22796d
											],
								'line-width': direction === 'return' ? 2.5 : 4,
								...(direction === 'return' ? { 'line-dasharray': [2, 1.5] } : {})
							}
						});
					}
					instance.addLayer({
						id: 'draft-lines',
						type: 'line',
						source: 'draft',
						filter: ['==', ['geometry-type'], 'LineString'],
						paint: {
							'line-color': themeColors.colordb6956,
							'line-width': 4,
							'line-dasharray': [2, 1.3]
						}
					});
					instance.moveLayer('draft-lines', 'outward-casing');
					instance.moveLayer('return-casing', 'outward-line');
					instance.addLayer({
						id: 'places',
						type: 'symbol',
						source: 'places',
						layout: {
							'icon-image': [
								'match',
								['get', 'kind'],
								'school',
								'atlas-school',
								['hospital', 'clinic'],
								'atlas-health',
								['ferry', 'ferry_terminal'],
								'atlas-marine',
								'atlas-bus-stop'
							],
							'icon-size': 0.75,
							'icon-allow-overlap': false
						}
					});
					instance.addLayer({
						id: 'draft-halo',
						type: 'circle',
						source: 'draft',
						filter: ['==', ['geometry-type'], 'Point'],
						paint: {
							'circle-color': themeColors.colore2745d,
							'circle-radius': 22,
							'circle-opacity': 0.23,
							'circle-stroke-color': themeColors.colord46d58,
							'circle-stroke-width': 1.2,
							'circle-stroke-opacity': 0.7
						}
					});
					instance.addLayer({
						id: 'road-pick',
						type: 'line',
						source: 'road-targets',
						paint: {
							'line-color': themeColors.colorbb7352,
							'line-width': 10,
							'line-opacity': 0.28
						},
						layout: { visibility: 'none' }
					});
					instance.addLayer({
						id: 'service-pick',
						type: 'line',
						source: 'service-targets',
						paint: { 'line-color': themeColors.color637abd, 'line-width': 8, 'line-opacity': 0.38 },
						layout: { visibility: 'none' }
					});
					instance.addLayer({
						id: 'draft-points',
						type: 'symbol',
						source: 'draft',
						filter: ['==', ['geometry-type'], 'Point'],
						layout: {
							'icon-image': ['get', 'icon'],
							'icon-size': 1.05,
							'icon-allow-overlap': true
						},
						paint: { 'icon-color': themeColors.colordb6956 }
					});
					ready = true;
					scheduleContext();
				});
				instance.on('click', (event) => {
					if (picking && pendingKind) {
						oncreate(pendingKind, [event.lngLat.lng, event.lngLat.lat]);
						pendingKind = null;
						picking = false;
					} else if (picking && placement) {
						onpick([event.lngLat.lng, event.lngLat.lat]);
						picking = false;
						selectedInfo = 'Location moved. Confirm or cancel this preview.';
					} else if (canCreate && !targetMode && !draftService && !placement) {
						const draft = instance.queryRenderedFeatures(event.point, {
							layers: ['draft-points']
						})[0];
						if (draft?.properties.operationIndex !== undefined) {
							onedit(Number(draft.properties.operationIndex));
							return;
						}
						clickedLocation = [event.lngLat.lng, event.lngLat.lat];
						selectedInfo = '';
					} else inspect(event.point);
				});
				instance.on('move', updatePopupPosition);
				instance.on('moveend', scheduleContext);
				instance.on('idle', () => {
					if (!ready) return;
					renderedHexes = instance.queryRenderedFeatures({ layers: ['hex-fill'] }).length;
					renderedRoutes = instance.queryRenderedFeatures({
						layers: ['outward-line', 'return-line']
					}).length;
				});
			} catch (cause) {
				error = cause instanceof Error ? cause.message : 'Planning map failed to load';
			}
		})();
		return () => {
			container.removeEventListener('dragover', dragOver);
			container.removeEventListener('dragleave', dragLeave);
			container.removeEventListener('drop', dropPlacement);
			disposed = true;
			resize.disconnect();
			contextController?.abort();
			clearTimeout(contextTimer);
			cancelAnimationFrame(frame);
			for (const item of [startMarker, endMarker, previewMarker, movementMarker]) item?.remove();
			sourceData.clear();
			map?.remove();
			map = null;
		};
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (
			active &&
			event.key === 'Escape' &&
			(placement || clickedLocation || pendingKind || picking)
		)
			cancelPlacement();
	}}
/>

<section
	class="planning-map"
	style:--inspector-inset={`${inspectorInset ? inspectorInset + 35 : 0}px`}
	aria-label="Interactive proposal map"
	data-status={status}
	data-inspector-open={inspectorInset > 0}
	data-has-journey={!!outward?.path.length}
	data-rendered-hexes={renderedHexes}
	data-rendered-routes={renderedRoutes}
	data-draft-features={draftData.features.length}
	data-preview-longitude={placement?.coordinates[0] ?? ''}
	data-preview-latitude={placement?.coordinates[1] ?? ''}
>
	<div class="planning-map-heading">
		<h3>Your plan</h3>
		<Button
			variant="outline"
			size="sm"
			disabled={status === 'calculating' || !!placement}
			onclick={onrecalculate}
			><RefreshCw size={15} /> {status === 'latest' ? 'Update impact' : 'Review impact'}</Button
		>
	</div>
	<div
		class="planning-map-status"
		class:calculating={status === 'calculating'}
		class:stale={status === 'stale'}
		role="status"
		aria-live="polite"
	>
		<span class="status-light"></span>{statusText}
	</div>
	<div
		class="planning-map-canvas"
		class:picking
		class:dragging-over={draggingOver}
		bind:this={container}
		aria-label="Planning map with resident impact tiles, proposal locations and journey routes"
	>
		<div class="planning-map-tools">
			<Button
				size="sm"
				variant={impactVisible ? 'secondary' : 'outline'}
				onclick={() => (impactVisible = !impactVisible)}
				aria-pressed={impactVisible}><Layers size={14} /> Impact tiles</Button
			>
			<Button
				size="sm"
				variant={placesVisible ? 'secondary' : 'outline'}
				onclick={() => (placesVisible = !placesVisible)}
				aria-pressed={placesVisible}><MapPin size={14} /> Places</Button
			>
			<Button size="sm" variant="outline" onclick={focus}><LocateFixed size={14} /> Fit plan</Button
			>
			{#if canCreate && canUndo}<Button size="sm" variant="outline" onclick={onundo}
					><Undo2 size={14} /> Undo</Button
				>{/if}
			{#if canCreate && operations.length}<Button size="sm" variant="outline" onclick={onclear}
					><Trash2 size={14} /> Clear draft</Button
				>{/if}
			{#if placement}<Button
					size="sm"
					variant={picking ? 'default' : 'outline'}
					onclick={() => (picking = !picking)}
					aria-pressed={picking}
					><MapPin size={14} /> {picking ? 'Click to place' : 'Place on map'}</Button
				><Button
					size="sm"
					variant="outline"
					onclick={() => {
						const center = map?.getCenter();
						if (center) onpick([center.lng, center.lat]);
						picking = false;
					}}>Use map center</Button
				>{/if}
		</div>
		{#if canCreate}<div class="planning-location-tools" aria-label="Add a location to the proposal">
				<span>Add a place</span>
				<Button
					size="sm"
					variant="outline"
					draggable="true"
					ondragstart={(event) => dragPlacement(event, 'add_hospital')}
					onclick={() => choosePlacement('add_hospital')}><Hospital size={15} /> Hospital</Button
				>
				<Button
					size="sm"
					variant="outline"
					draggable="true"
					ondragstart={(event) => dragPlacement(event, 'add_school')}
					onclick={() => choosePlacement('add_school')}><GraduationCap size={15} /> School</Button
				>
				<Button
					size="sm"
					variant="outline"
					draggable="true"
					ondragstart={(event) => dragPlacement(event, 'add_stop')}
					onclick={() => choosePlacement('add_stop')}><Signpost size={15} /> Bus stop</Button
				>
			</div>{/if}
		{#if pendingKind || picking}<div class="placement-picking-hint" role="status">
				<span
					>Click where you want {pendingKind === 'add_school'
						? 'a school'
						: pendingKind === 'add_hospital'
							? 'a hospital'
							: pendingKind === 'add_stop'
								? 'a bus stop'
								: 'this place'}.</span
				>
				{#if pendingKind}<Button
						size="sm"
						variant="outline"
						onclick={() => {
							const center = map?.getCenter();
							if (!center || !pendingKind) return;
							oncreate(pendingKind, [center.lng, center.lat]);
							pendingKind = null;
							picking = false;
						}}>Use map center</Button
					>{/if}
				<Button size="sm" variant="ghost" onclick={cancelPlacement}><X size={14} /> Cancel</Button>
			</div>{/if}
		{#if canCreate && popupLocation && !picking}
			<div
				class="placement-popover"
				class:placement-tray={popupTray}
				bind:this={popupElement}
				style:left={`${popupPosition.x}px`}
				style:top={`${popupPosition.y}px`}
				role="region"
				aria-label={placement ? 'Confirm proposed location' : 'Choose what to add here'}
			>
				<div class="placement-popover-heading">
					<strong
						>{placement
							? popupTray
								? placement.name
								: editing
									? 'Update this place?'
									: 'Add this place to your plan?'
							: 'What would you like to add here?'}</strong
					><Button
						variant="ghost"
						size="icon"
						aria-label="Cancel location selection"
						onclick={cancelPlacement}><X size={15} /></Button
					>
				</div>
				{#if placement}
					<p>{placement.name}</p>
					<small>Drag the pin to move it. Your change is saved only when you confirm.</small>
					<div class="placement-popover-actions">
						<Button
							size="sm"
							onclick={() => {
								onconfirm();
								clickedLocation = null;
							}}><Check size={14} /> {editing ? 'Save change' : 'Confirm place'}</Button
						><Button size="sm" variant="outline" onclick={cancelPlacement}>Cancel</Button>
					</div>
					<Button size="sm" variant="ghost" onclick={ondetails}>Name, opening date & details</Button
					>
				{:else}
					<div class="placement-kind-options">
						<Button size="sm" variant="outline" onclick={() => createAtClick('add_school')}
							><GraduationCap size={16} /> School</Button
						><Button size="sm" variant="outline" onclick={() => createAtClick('add_hospital')}
							><Hospital size={16} /> Hospital</Button
						><Button size="sm" variant="outline" onclick={() => createAtClick('add_stop')}
							><Signpost size={16} /> Bus stop</Button
						>
					</div>
					<small>Choose a type, adjust the pin, then confirm.</small>
				{/if}
			</div>
		{/if}
		{#if draggingOver}<div class="drop-location-hint" aria-hidden="true">
				Drop here to preview a new location
			</div>{/if}
		{#if targetMode}<div class="target-picking-hint" role="status">
				{targetMode === 'road'
					? 'Click a highlighted street segment to choose the road closure.'
					: 'Click a highlighted service line to choose its source pattern.'}
			</div>{/if}
		{#if status === 'calculating'}<div class="recalibration" aria-hidden="true">
				<span></span><span></span><span></span>
			</div>{/if}
		{#if error}<div class="map-error" role="alert">{error}</div>{/if}
		<div class="planning-map-insight">
			{#if selectedComparison}<strong
					>Selected resident area · {selectedOrigin?.name ?? 'Residential area'} · {Number(
						selectedComparison.population
					).toLocaleString(undefined, { maximumFractionDigits: 0 })} estimated residents</strong
				><span
					>Before {minuteLabel(selectedComparison.before.minutes)}
					<ArrowRight size={13} /> After {minuteLabel(selectedComparison.after.minutes)}</span
				><small
					>{status !== 'latest' ? 'Previous calculation · ' : ''}{impactClass(
						selectedComparison
					).replaceAll('_', ' ')}{selectedComparison.delta_minutes !== null
						? ` · ${Math.abs(selectedComparison.delta_minutes).toFixed(1)} min ${selectedComparison.delta_minutes >= 0 ? 'saved' : 'longer'}`
						: ''}</small
				>
			{:else}<strong
					>{canCreate
						? 'Click the map to try a change.'
						: 'Explore the effect of your plan.'}</strong
				><span
					>{canCreate
						? 'Choose a school, hospital or bus stop. Confirm it, then review who benefits.'
						: 'Choose a resident tile or destination to inspect access and journeys.'}</span
				>{/if}
		</div>
	</div>
	<details class="planning-map-key">
		<summary>Map key and source evidence</summary>
		<div class="planning-map-key-content">
			<div class="planning-place-key">
				<span><Signpost size={16} /> Bus stop</span><span><GraduationCap size={16} /> School</span
				><span><Hospital size={16} /> Health facility</span><span
					>Grey hexagons · resident areas awaiting impact calculation</span
				>
			</div>
			<div class="planning-map-legend">
				<span class="legend-item"><i style:background="var(--theme-color-22796d)"></i>Walking</span
				><span class="legend-item"><i style:background="var(--theme-color-d18c34)"></i>Bus</span
				><span class="legend-item"><i style:background="var(--theme-color-2689b2)"></i>Ferry</span
				><span class="legend-item"><i class="return"></i>Return route</span><span
					class="legend-item"><i class="proposal"></i>Draft change / connector</span
				>
			</div>
			<div class="planning-map-footnote">
				{#if selectedOrigin}<small
						>Area numbers identify modeled cells, not official neighborhoods. {selectedOrigin.name} ·
						Source origin ID: {selectedOrigin.id}</small
					>{/if}
				<small
					>Hexes visualize modeled origins, not census boundaries. Connector lines are conceptual;
					calculated paths use retained network geometry or labelled planned corridors. {contextStatus}{receipt
						? ` · OSM ${receipt}`
						: ''} ·
					<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer"
						>© OpenStreetMap contributors</a
					></small
				>
			</div>
		</div>
	</details>
	{#if comparisons.length && impactVisible}<div
			class="impact-legend"
			aria-label="Resident impact legend"
		>
			{#each [['gained', 'Gained target access'], ['improved', 'Faster'], ['lost', 'Lost target access'], ['slower', 'Slower'], ['unchanged', 'Unchanged'], ['disrupted', 'Became unavailable'], ['unavailable', 'Evidence unavailable']] as [key, name] (key)}<span
					><i style:background={status === 'latest' ? impactColors[key] : themeColors.colora4b2b5}
					></i>{name}<b>{impacts[key] ?? 0}</b></span
				>{/each}
		</div>{/if}
	{#if outward?.path.length}
		<div class="journey-playback" role="region" aria-label="Simulated journey playback">
			<div class="playback-title">
				<Route size={17} /><strong>Journey preview</strong><span
					>Simulated from calculated leg times · not vehicle tracking</span
				>
			</div>
			{#if journeyStale}<p class="playback-stale">
					Journey inputs changed. Open Journey and calculate again to update this route.
				</p>{/if}
			<div class="playback-controls">
				<Button
					variant={direction === 'outward' ? 'secondary' : 'outline'}
					size="sm"
					onclick={() => (direction = 'outward')}
					aria-pressed={direction === 'outward'}>Outward</Button
				>
				<Button
					variant={direction === 'return' ? 'secondary' : 'outline'}
					size="sm"
					disabled={!returning?.path.length}
					onclick={() => (direction = 'return')}
					aria-pressed={direction === 'return'}>Return</Button
				>
				<Button
					size="sm"
					disabled={journeyStale || !maximumElapsed || !active}
					onclick={() => {
						if (elapsed >= maximumElapsed) elapsed = 0;
						playing = !playing;
					}}
					aria-label={playing ? 'Pause journey preview' : 'Play journey preview'}
					>{#if playing}<Pause size={15} />Pause{:else}<Play size={15} />Play{/if}</Button
				>
				<input
					aria-label="Journey elapsed minutes"
					type="range"
					min="0"
					max={maximumElapsed || 1}
					step="any"
					bind:value={elapsed}
					disabled={journeyStale}
					oninput={() => (playing = false)}
				/>
				<span class="playback-time">{elapsed.toFixed(1)} / {maximumElapsed.toFixed(1)} min</span>
			</div>
			<p>
				{currentPosition.phase} · {placeName(currentJourney?.path[currentPosition.legIndex]?.from)} →
				{placeName(currentJourney?.path[currentPosition.legIndex]?.to)}
			</p>
			{#each geometryNotes as note (note)}<small class="playback-qualification">{note}</small
				>{/each}
		</div>
	{/if}
	<div class="planning-map-footnote">
		<p>
			{selectedInfo ||
				'Map updates as you choose endpoints and edit the proposal. Calculate impact to color the tiles.'}
		</p>
	</div>
</section>

<style>
	.planning-map {
		border: 1px solid var(--theme-color-d7e1dc);
		border-radius: 19px;
		background: var(--theme-color-fffefa);
		overflow: hidden;
		min-width: 0;
		box-shadow: 0 7px 24px var(--theme-color-243c3710);
		display: flex;
		flex-direction: column;
	}
	.planning-map-heading {
		display: flex;
		justify-content: flex-start;
		align-items: center;
		gap: 16px;
		padding: 14px 18px;
		flex-shrink: 0;
	}
	h3 {
		margin: 0;
		font-size: 19px;
		letter-spacing: -0.6px;
		font-weight: 650;
	}
	.planning-map-status {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 9px 18px;
		background: var(--theme-color-eff4ed);
		color: var(--theme-color-3b6657);
		font-size: 12px;
		border-top: 1px solid var(--theme-color-e8ede5);
	}
	.status-light {
		width: 7px;
		height: 7px;
		border-radius: 100%;
		background: var(--theme-color-369f7b);
	}
	.stale {
		color: var(--theme-color-946837);
		background: var(--theme-color-faf2e7);
	}
	.stale .status-light {
		background: var(--theme-color-c29149);
	}
	.calculating .status-light {
		animation: pulse 950ms ease-in-out infinite;
	}
	.planning-map-canvas {
		min-height: 250px;
		flex: 1;
		position: relative;
	}
	.planning-map-tools {
		position: absolute;
		z-index: 3;
		left: 15px;
		top: 15px;
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
		max-width: calc(100% - 70px);
	}
	.planning-map-tools :global(button) {
		background: var(--theme-color-fffef9ed);
		box-shadow: 0 2px 7px var(--theme-color-234c3a14);
	}
	.planning-map-tools :global(button[aria-pressed='true']) {
		background: var(--theme-color-e4eee3);
	}
	.planning-location-tools {
		position: absolute;
		z-index: 3;
		left: 15px;
		top: 61px;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 5px;
		padding: 7px;
		border-radius: 12px;
		background: var(--theme-color-fffef9ed);
		border: 1px solid var(--theme-color-d7e2d6);
		max-width: calc(100% - 30px);
		box-shadow: 0 2px 7px var(--theme-color-234c3a14);
	}
	.planning-location-tools span {
		font-size: 10px;
		color: var(--theme-color-667b6b);
		padding: 0 5px;
	}
	.planning-location-tools :global(button) {
		cursor: grab;
	}
	.planning-location-tools :global(button:active) {
		cursor: grabbing;
	}
	.placement-popover {
		position: absolute;
		z-index: 5;
		width: min(290px, calc(100% - 24px));
		max-height: calc(100% - 16px);
		overflow-y: auto;
		padding: 12px;
		border: 1px solid var(--theme-color-d5dfd5);
		border-radius: 14px;
		background: var(--theme-color-fffefa);
		box-shadow: 0 8px 30px var(--theme-color-213e3729);
		display: grid;
		gap: 9px;
		animation: popover-in 160ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.placement-popover-heading {
		display: flex;
		gap: 8px;
		align-items: center;
		justify-content: space-between;
		font-size: 13px;
	}
	.placement-popover.placement-tray {
		width: calc(100% - 24px);
		padding: 10px;
		gap: 5px;
	}
	.placement-tray .placement-popover-heading strong {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.placement-tray p,
	.placement-tray small {
		display: none;
	}
	.placement-popover p {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}
	.placement-popover small {
		font-size: 11px;
		line-height: 1.5;
		color: var(--theme-color-68796c);
	}
	.placement-popover-actions,
	.placement-kind-options {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.placement-picking-hint {
		position: absolute;
		left: 15px;
		top: 112px;
		z-index: 4;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 11px;
		background: var(--theme-color-fffefa);
		border-radius: 10px;
		border: 1px solid var(--theme-color-d5dfd5);
		font-size: 12px;
		max-width: calc(100% - 30px);
	}
	@keyframes popover-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.placement-popover {
			animation: none;
		}
	}
	.drop-location-hint {
		position: absolute;
		inset: 125px 30px 80px;
		border: 2px dashed var(--theme-color-2f8363);
		border-radius: 15px;
		background: var(--theme-color-e8f6e96b);
		display: grid;
		place-items: center;
		pointer-events: none;
		font-size: 14px;
		font-weight: 600;
		color: var(--theme-color-2a6c53);
		z-index: 4;
	}
	.target-picking-hint {
		position: absolute;
		top: 112px;
		left: 15px;
		z-index: 3;
		font-size: 11px;
		color: var(--theme-color-805d39);
		background: var(--theme-color-fff8e8ed);
		padding: 10px 13px;
		border-radius: 10px;
		max-width: calc(100% - 90px);
		pointer-events: none;
	}
	.planning-map-key {
		flex-shrink: 0;
		border-top: 1px solid var(--theme-color-dce5da);
	}
	.planning-map-key summary {
		padding: 10px 18px;
		cursor: pointer;
		font-size: 11px;
		color: var(--theme-color-586f5f);
	}
	.planning-map-insight {
		position: absolute;
		z-index: 2;
		bottom: 24px;
		left: 16px;
		display: grid;
		gap: 7px;
		max-width: min(410px, calc(100% - 85px));
		background: var(--theme-color-fffefaed);
		padding: 13px 16px;
		border: 1px solid var(--theme-color-e1e9df);
		border-radius: 12px;
		pointer-events: none;
		box-shadow: 0 3px 16px var(--theme-color-34473f12);
	}
	.planning-map-insight strong {
		font-size: 12px;
	}
	.planning-map-insight span {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 11px;
		line-height: 1.5;
	}
	.planning-map-insight small {
		font-size: 11px;
		color: var(--theme-color-567268);
	}
	.planning-map-legend,
	.impact-legend {
		padding: 13px 23px;
		display: flex;
		flex-wrap: wrap;
		gap: 12px 22px;
		font-size: 11px;
		border-bottom: 1px solid var(--theme-color-e7ece5);
	}
	.planning-place-key {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		padding: 12px 18px;
		font-size: 11px;
	}
	.planning-place-key span {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.legend-item,
	.impact-legend span {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	i {
		display: inline-block;
		width: 16px;
		height: 4px;
		border-radius: 3px;
	}
	i.return {
		border-bottom: 3px dashed var(--theme-color-8567b1);
		height: 0;
	}
	i.proposal {
		border-bottom: 3px dashed var(--theme-color-db6956);
		height: 0;
	}
	.impact-legend i {
		width: 12px;
		height: 12px;
		border-radius: 3px;
	}
	.impact-legend b {
		color: var(--theme-color-6f8177);
		font-weight: 600;
	}
	.journey-playback {
		padding: 12px 18px;
		background: var(--theme-color-f5f6f0);
		border-bottom: 1px solid var(--theme-color-e7ece5);
		display: grid;
		gap: 8px;
		flex-shrink: 0;
	}
	.playback-title {
		display: flex;
		gap: 9px;
		align-items: center;
		flex-wrap: wrap;
		font-size: 13px;
	}
	.playback-title span {
		font-size: 11px;
		color: var(--theme-color-6c796f);
	}
	.playback-controls {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 7px;
	}
	.playback-controls input {
		min-width: 100px;
		flex: 1;
		accent-color: var(--theme-color-44876c);
		cursor: pointer;
	}
	.playback-time {
		font-variant-numeric: tabular-nums;
		font-size: 11px;
		min-width: 90px;
	}
	.journey-playback p {
		margin: 0;
		color: var(--theme-color-687870);
		font-size: 11px;
		overflow-wrap: anywhere;
	}
	.journey-playback p.playback-stale {
		color: var(--theme-color-956831);
	}
	.playback-qualification {
		font-size: 11px;
		line-height: 1.5;
		color: var(--theme-color-6c766f);
	}
	.planning-map-footnote {
		padding: 9px 18px;
		display: grid;
		gap: 7px;
	}
	.planning-map-footnote p {
		font-size: 12px;
		margin: 0;
		color: var(--theme-color-4e6d61);
	}
	.planning-map-footnote small {
		color: var(--theme-color-7c857c);
		font-size: 10px;
		line-height: 1.7;
	}
	.planning-map-footnote a {
		text-decoration: underline;
	}
	.map-error {
		position: absolute;
		z-index: 3;
		top: 80px;
		left: 20px;
		right: 20px;
		padding: 16px;
		background: var(--theme-color-fff1ee);
		border-radius: 10px;
		font-size: 13px;
		color: var(--theme-color-924d40);
	}
	.recalibration {
		position: absolute;
		pointer-events: none;
		inset: 0;
		z-index: 1;
		overflow: hidden;
		background: var(--theme-color-eef8ef25);
	}
	.recalibration span {
		position: absolute;
		inset: -60%;
		border: 1px solid var(--theme-color-31866b55);
		border-radius: 50%;
		animation: recalibrate 2.4s linear infinite;
	}
	.recalibration span:nth-child(2) {
		animation-delay: -0.8s;
	}
	.recalibration span:nth-child(3) {
		animation-delay: -1.6s;
	}
	@keyframes recalibrate {
		from {
			transform: scale(0.15);
			opacity: 0.7;
		}
		to {
			transform: scale(1.15);
			opacity: 0;
		}
	}
	@keyframes pulse {
		50% {
			opacity: 0.25;
		}
	}
	:global(.planning-pin) {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--theme-color-fffef9);
		padding: 6px 10px 6px 6px;
		border-radius: 25px;
		border: 1px solid var(--theme-color-417c6650);
		box-shadow: 0 3px 10px var(--theme-color-253c3025);
		font:
			600 11px Inter,
			sans-serif;
		max-width: 220px;
	}
	:global(.planning-pin b) {
		display: grid;
		place-items: center;
		width: 25px;
		height: 25px;
		border-radius: 50%;
		background: var(--theme-color-216f5c);
		color: var(--theme-color-ffffff);
	}
	:global(.planning-pin.end b) {
		background: var(--theme-color-df735b);
	}
	:global(.planning-pin span) {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	:global(.planning-preview) {
		z-index: 4;
		padding: 8px 12px;
		border-radius: 22px;
		border: 1.5px dashed var(--theme-color-d4735b);
		background: var(--theme-color-fff7ec);
		font:
			600 11px Inter,
			sans-serif;
		color: var(--theme-color-a25642);
		box-shadow: 0 3px 10px var(--theme-color-503c3020);
		max-width: 240px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: grab;
	}
	:global(.planning-preview:active) {
		cursor: grabbing;
	}
	:global(.planning-preview:focus-visible) {
		outline: 3px solid var(--theme-color-2e886b);
		outline-offset: 3px;
	}
	:global(.planning-traveller) {
		border-radius: 50%;
		background: var(--theme-color-fffefa);
		color: var(--theme-color-236e62);
		border: 2px solid var(--theme-color-428d78);
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		box-shadow: 0 3px 13px var(--theme-color-32614c35);
	}
	.picking :global(.maplibregl-canvas) {
		cursor: crosshair;
	}
	@media (max-width: 650px) {
		.planning-map-heading {
			padding: 10px;
			flex-direction: row;
			align-items: center;
			gap: 8px;
		}
		h3 {
			font-size: 15px;
		}
		.planning-map-status {
			padding: 11px 16px;
			font-size: 11px;
		}
		.planning-map-tools {
			left: 9px;
			top: 10px;
			gap: 4px;
		}
		.planning-map-tools :global(button) {
			font-size: 10px;
			padding-left: 8px;
			padding-right: 8px;
		}
		.planning-map-canvas {
			min-height: 150px;
		}
		.planning-map-key {
			position: relative;
		}
		.planning-map-key-content {
			position: absolute;
			bottom: 100%;
			left: 0;
			right: 0;
			z-index: 8;
			max-height: 150px;
			overflow-y: auto;
			background: var(--theme-color-fffefa);
			border-top: 1px solid var(--theme-color-dce5da);
			box-shadow: 0 -6px 22px var(--theme-color-34473f16);
		}
		.planning-map > .planning-map-footnote {
			display: none;
		}
		.planning-map[data-inspector-open='true'] .journey-playback,
		.planning-map[data-inspector-open='true'] .planning-map-key,
		.planning-map[data-inspector-open='true'] .impact-legend,
		.planning-map[data-inspector-open='true'] .planning-map-insight,
		.planning-map[data-has-journey='true'] .planning-map-insight {
			display: none;
		}
		:global(.planning-pin span) {
			display: none;
		}
		.impact-legend {
			padding: 7px 10px;
			gap: 5px 9px;
			font-size: 9px;
			flex-shrink: 0;
		}
		.impact-legend i {
			width: 8px;
			height: 8px;
		}
		.journey-playback {
			max-height: 150px;
			overflow: auto;
		}
		.planning-location-tools {
			left: 9px;
			top: 85px;
			gap: 4px;
			padding: 5px;
		}
		.planning-location-tools span {
			display: none;
		}
		.planning-location-tools :global(button) {
			font-size: 11px;
			padding: 0 8px;
		}
		.planning-map-heading :global(button) {
			font-size: 10px;
			padding: 0 8px;
		}
		.planning-map-insight {
			left: 10px;
			bottom: 25px;
			padding: 10px;
			max-width: calc(100% - 85px);
		}
		.planning-map-legend,
		.impact-legend,
		.journey-playback,
		.planning-map-footnote {
			padding-left: 16px;
			padding-right: 16px;
		}
		.playback-controls input {
			flex-basis: 60%;
		}
	}
	@media (min-width: 900px) {
		.planning-map-heading,
		.planning-map-status,
		.planning-map-key,
		.impact-legend,
		.journey-playback,
		.planning-map > .planning-map-footnote {
			margin-right: var(--inspector-inset);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.recalibration span,
		.calculating .status-light {
			animation: none;
		}
		.recalibration {
			background: var(--theme-color-e1f1e326);
		}
	}
</style>
