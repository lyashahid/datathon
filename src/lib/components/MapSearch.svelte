<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { surfaceMotion } from '#lib/surface-motion.js';
	import LoadingSkeleton from '#lib/components/LoadingSkeleton.svelte';
	import {
		Bus,
		GraduationCap,
		Hospital,
		Layers,
		MapPin,
		Plane,
		Search,
		Ship,
		X
	} from '@lucide/svelte';
	import type { Feature, FeatureCollection, Geometry } from 'geojson';
	import { api, subscribeApiInvalidation } from '#lib/api.js';
	import { pointWithinIsland } from '#lib/map-policy.js';
	import { validPoint } from '#lib/planning-map.js';
	import { placesQuery, type ConsumerEnvelope, type ConsumerSearch } from '#lib/places.js';
	import type { JourneyPlace } from '#lib/explore-journey.js';
	import type { SearchDirectionPoint } from '#lib/search-directions.js';
	import type { Coordinates, IslandFeature, MapFeatures } from '#lib/types.js';

	type SearchIsland = {
		id: string;
		name: string;
		coordinates?: Coordinates;
		boundary?: Geometry;
	};
	type SearchPlace = {
		id: string;
		name: string;
		coordinates: Coordinates;
		category?: string;
		feature?: Feature;
		aliases?: string;
	};
	type Result = {
		kind: 'place' | 'island' | 'atoll' | 'center';
		id: string;
		name: string;
		detail: string;
		category?: string;
		place?: SearchPlace;
		islandId?: string;
		mapped?: boolean;
	};
	let {
		islands,
		island,
		features,
		loading = false,
		open = $bindable(false),
		globalAtoll = null,
		variant = 'search',
		selectedPoint = null,
		endpointLabel = 'Journey point',
		places = [],
		onEndpoint,
		onQueryChange,
		onIsland,
		onAtoll,
		onPlace
	}: {
		islands: IslandFeature[];
		island: SearchIsland | null;
		features: MapFeatures | null;
		loading?: boolean;
		open?: boolean;
		globalAtoll?: string | null;
		variant?: 'search' | 'endpoint';
		selectedPoint?: SearchDirectionPoint | null;
		endpointLabel?: string;
		places?: JourneyPlace[];
		onEndpoint?: (point: SearchDirectionPoint) => void;
		onQueryChange?: (text: string) => void;
		onIsland?: (id: string) => void;
		onAtoll?: (name: string) => void;
		onPlace?: (place: SearchPlace) => void;
	} = $props();

	let element: HTMLDivElement;
	let input: HTMLInputElement;
	let query = $state('');
	let scopeId = $state<string | null>(null);
	let atollFilter = $state<string | null | undefined>(undefined);
	let activeIndex = $state(-1);
	let retry = $state(0);
	let syncedIslandId: string | null | undefined;
	let syncedGlobalAtoll: string | null | undefined;
	let syncedPointKey: string | undefined;
	let dropdownStyle = $state('');
	let scopeData = $state.raw<{
		id: string;
		data: MapFeatures | null;
		loading: boolean;
		error: boolean;
	}>({ id: '', data: null, loading: false, error: false });
	const componentId = $props.id();
	const resultsId = $derived(
		variant === 'endpoint' ? `${componentId}-results` : 'island-search-results'
	);
	const optionId = (index: number) =>
		variant === 'endpoint' ? `${componentId}-option-${index}` : `map-search-option-${index}`;
	let remote = $state.raw<{
		key: string;
		places: SearchPlace[];
		loading: boolean;
		error: boolean;
		expires: number;
		boundary: Geometry | null;
	}>({ key: '', places: [], loading: false, error: false, expires: 0, boundary: null });
	onMount(() =>
		subscribeApiInvalidation(() => {
			remote = { key: '', places: [], loading: false, error: false, expires: 0, boundary: null };
			scopeData = { id: '', data: null, loading: false, error: false };
			retry += 1;
		})
	);

	const normalizedQuery = $derived(normalize(query));
	const scope = $derived.by((): SearchIsland | null => {
		if (!scopeId) return null;
		if (island?.id === scopeId) return island;
		const match = islands.find((item) => item.properties.id === scopeId);
		return match
			? {
					id: match.properties.id,
					name: match.properties.name,
					coordinates: match.properties.centroid ?? geometryCenter(match.geometry) ?? undefined,
					boundary: match.geometry
				}
			: null;
	});
	const filterAtoll = $derived(atollFilter === undefined ? globalAtoll : atollFilter);
	const boundary = $derived.by(() => {
		if (!scope) return null;
		const detailed =
			scopeData.id === scope.id
				? scopeData.data?.features.find(
						(item) => String(item.properties?.id ?? item.id ?? '') === scope.id
					)?.geometry
				: null;
		const geometry =
			detailed ??
			scope.boundary ??
			islands.find((item) => item.properties.id === scope.id)?.geometry;
		return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon' ? geometry : null;
	});
	const requestKey = $derived(`${scope?.id ?? ''}:${normalizedQuery}`);
	const currentRemote = $derived(
		remote.key === requestKey ? remote : { places: [], loading: false, error: false }
	);
	const mappedPlaces = $derived.by(() => {
		if (!scope) return [];
		const found = new SvelteMap<string, SearchPlace>();
		for (const feature of [
			...(features?.features ?? []),
			...(scopeData.id === scope.id ? (scopeData.data?.features ?? []) : [])
		]) {
			const properties = feature.properties ?? {};
			if (
				String(properties.island_id ?? '') !== scope.id ||
				properties.geometry_quality === 'island_context_only' ||
				properties.match_status === 'island_context_only' ||
				String(properties.id ?? feature.id ?? '') === scope.id ||
				!feature.geometry
			)
				continue;
			const tags = properties.tags && typeof properties.tags === 'object' ? properties.tags : {};
			const category = String(
				properties.category === 'public_transport' &&
					(tags.bus === 'yes' || tags.highway === 'bus_stop')
					? 'bus_stop'
					: (properties.category ?? tags.amenity ?? tags.shop ?? tags.tourism ?? 'place')
			);
			if (/^(residential island|island|street|road|building)$/i.test(category)) continue;
			const name =
				String(properties.name ?? tags['name:en'] ?? tags.name ?? '').trim() || humanize(category);
			const coordinates = geometryCenter(feature.geometry);
			if (!coordinates) continue;
			const id = String(
				properties.id ?? feature.id ?? `${category}:${coordinates.join(',')}:${name}`
			);
			if (!found.has(id))
				found.set(id, {
					id,
					name,
					aliases: [tags['name:en'], tags.name, tags.alt_name, tags.official_name]
						.filter((value) => typeof value === 'string')
						.join(' '),
					coordinates,
					category,
					feature: { ...feature, geometry: feature.geometry }
				});
		}
		{
			const boundaryFeatures: FeatureCollection | null = boundary
				? {
						type: 'FeatureCollection',
						features: [{ type: 'Feature', properties: { id: scope.id }, geometry: boundary }]
					}
				: null;
			for (const place of places) {
				if (
					!found.has(place.id) &&
					validPoint(place.coordinates) &&
					(place.islandId
						? place.islandId === scope.id
						: boundaryFeatures &&
							pointWithinIsland(place.coordinates, boundaryFeatures, scope.id) === true)
				)
					found.set(place.id, { ...place });
			}
		}
		return [...found.values()];
	});
	const results = $derived.by((): Result[] => {
		if (!scope) {
			const allAtolls = [
				...new Set(
					islands
						.map((item) => item.properties.atoll?.trim())
						.filter((name): name is string => !!name)
				)
			];
			const atolls: Result[] = filterAtoll
				? []
				: allAtolls
						.filter((name) => matches(name, normalizedQuery))
						.map((name) => ({ kind: 'atoll', id: name, name, detail: 'Explore atoll' }));
			const islandRows: Result[] = islands
				.filter(
					(item) =>
						(!filterAtoll || normalize(item.properties.atoll ?? '') === normalize(filterAtoll)) &&
						matches(`${item.properties.name} ${item.properties.atoll ?? ''}`, normalizedQuery)
				)
				.map((item) => ({
					kind: 'island',
					id: item.properties.id,
					name: item.properties.name,
					detail: item.properties.atoll || 'Island',
					islandId: item.properties.id
				}));
			return [...atolls, ...islandRows]
				.sort(
					(a, b) =>
						rank(a.name, normalizedQuery) - rank(b.name, normalizedQuery) ||
						a.name.localeCompare(b.name)
				)
				.slice(0, normalizedQuery ? 14 : 10);
		}
		const places: Result[] = mappedPlaces
			.filter((place) =>
				matches(
					`${place.name} ${place.aliases ?? ''} ${humanize(place.category ?? '')} ${categoryAliases(place.category)}`,
					normalizedQuery
				)
			)
			.map((place) => ({
				kind: 'place',
				id: place.id,
				name: place.name,
				detail: humanize(place.category ?? 'Place'),
				category: place.category,
				place,
				islandId: scope.id,
				mapped: true
			}));
		for (const place of currentRemote.places) {
			if (
				places.some(
					(row) =>
						row.id === place.id ||
						(normalize(row.name) === normalize(place.name) &&
							row.place &&
							nearby(row.place.coordinates, place.coordinates))
				)
			)
				continue;
			places.push({
				kind: 'place',
				id: place.id,
				name: place.name,
				detail: humanize(place.category ?? 'Place'),
				category: place.category,
				place,
				islandId: scope.id
			});
		}
		const ranked = places
			.sort(
				(a, b) =>
					rank(a.name, normalizedQuery) - rank(b.name, normalizedQuery) ||
					Number(!!b.mapped) - Number(!!a.mapped) ||
					a.name.localeCompare(b.name)
			)
			.slice(0, 16);
		if (variant === 'endpoint' && (!normalizedQuery || matches(scope.name, normalizedQuery))) {
			const coordinates = validPoint(scope.coordinates)
				? scope.coordinates
				: boundary
					? geometryCenter(boundary)
					: null;
			if (coordinates)
				ranked.unshift({
					kind: 'center',
					id: `center:${scope.id}`,
					name: `Use ${scope.name} island center`,
					detail: 'Island center · choose a specific place for a precise route',
					islandId: scope.id,
					place: {
						id: `center:${scope.id}`,
						name: `${scope.name} island center`,
						coordinates,
						category: 'island_center'
					}
				});
		}
		return ranked;
	});
	const scopeLoading = $derived(
		variant === 'endpoint' && scopeData.id === scope?.id && scopeData.loading
	);
	const scopeError = $derived(
		variant === 'endpoint' && scopeData.id === scope?.id && scopeData.error
	);
	const busy = $derived(loading || scopeLoading || (!!scope && currentRemote.loading));
	const activeResult = $derived(open && activeIndex >= 0 ? results[activeIndex] : undefined);
	$effect(() => {
		if (variant !== 'endpoint' || !open) return;
		function positionDropdown() {
			if (!element) return;
			const rect = element.getBoundingClientRect();
			const viewport = window.visualViewport;
			const viewportTop = viewport?.offsetTop ?? 0;
			const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
			const width = Math.min(rect.width + 61, window.innerWidth - 24);
			const left = Math.max(12, Math.min(rect.left - 27, window.innerWidth - width - 12));
			const below = viewportBottom - rect.bottom - 14;
			const above = rect.top - viewportTop - 14;
			const upwards = below < 175 && above > below;
			const height = Math.max(90, Math.min(365, upwards ? above : below));
			dropdownStyle = `position:fixed;left:${left}px;right:auto;width:${width}px;max-height:${height}px;${upwards ? `top:auto;bottom:${window.innerHeight - rect.top + 6}px` : `bottom:auto;top:${rect.bottom + 6}px`}`;
		}
		positionDropdown();
		window.addEventListener('resize', positionDropdown);
		window.addEventListener('scroll', positionDropdown, true);
		window.visualViewport?.addEventListener('resize', positionDropdown);
		return () => {
			window.removeEventListener('resize', positionDropdown);
			window.removeEventListener('scroll', positionDropdown, true);
			window.visualViewport?.removeEventListener('resize', positionDropdown);
		};
	});

	$effect(() => {
		if (variant === 'endpoint') return;
		const nextId = island?.id ?? null;
		// Boundary and inventory refreshes must not restore a scope the user removed.
		if (nextId !== syncedIslandId) {
			syncedIslandId = nextId;
			scopeId = nextId;
			query = '';
			activeIndex = -1;
			atollFilter = undefined;
		}
	});
	$effect(() => {
		if (variant !== 'endpoint') return;
		const key = `${selectedPoint?.id ?? ''}:${selectedPoint?.name ?? ''}:${selectedPoint?.coordinates?.join(',') ?? ''}:${selectedPoint?.islandId ?? ''}`;
		if (key === syncedPointKey) return;
		const first = syncedPointKey === undefined;
		syncedPointKey = key;
		query = selectedPoint?.name ?? '';
		activeIndex = -1;
		if (first || selectedPoint?.coordinates)
			scopeId = selectedPoint?.islandId ?? island?.id ?? null;
	});
	$effect(() => {
		if (globalAtoll !== syncedGlobalAtoll) {
			syncedGlobalAtoll = globalAtoll;
			atollFilter = undefined;
			activeIndex = -1;
		}
	});
	$effect(() => {
		const id = scope?.id;
		const retryAttempt = retry;
		void retryAttempt;
		if (
			variant !== 'endpoint' ||
			!open ||
			!id ||
			(island?.id === id &&
				(island.boundary?.type === 'Polygon' || island.boundary?.type === 'MultiPolygon'))
		)
			return;
		const controller = new AbortController();
		const previous = untrack(() => (scopeData.id === id ? scopeData.data : null));
		scopeData = { id, data: previous, loading: true, error: false };
		void api<MapFeatures>(
			`map/features?layer=all&island_id=${encodeURIComponent(id)}`,
			undefined,
			controller.signal
		)
			.then((data) => {
				if (!controller.signal.aborted) scopeData = { id, data, loading: false, error: false };
			})
			.catch(() => {
				if (!controller.signal.aborted)
					scopeData = { id, data: previous, loading: false, error: true };
			});
		return () => controller.abort();
	});

	$effect(() => {
		const selectedScope = scope;
		const geometry = boundary;
		const text = query.trim();
		const key = requestKey;
		void retry;
		const previous = untrack(() => remote);
		if (!open) {
			if (previous.loading) remote = { ...previous, loading: false };
			return;
		}
		if (!selectedScope || !geometry || normalizedQuery.length < 2) {
			remote = { key, places: [], loading: false, error: false, expires: 0, boundary: null };
			return;
		}
		// Reopening a completed search should be immediate. Keep this one response
		// briefly, within the same exact island boundary; source updates clear it.
		if (
			previous.key === key &&
			previous.boundary === geometry &&
			previous.expires > Date.now() &&
			!previous.error
		)
			return;
		const coordinates = validPoint(selectedScope.coordinates)
			? selectedScope.coordinates
			: geometryCenter(geometry);
		if (!coordinates) return;
		const boundaryFeatures: FeatureCollection = {
			type: 'FeatureCollection',
			features: [{ type: 'Feature', properties: { id: selectedScope.id }, geometry }]
		};
		const controller = new AbortController();
		remote = { key, places: [], loading: true, error: false, expires: 0, boundary: geometry };
		const timer = setTimeout(async () => {
			try {
				const response = await api<ConsumerEnvelope<ConsumerSearch>>(
					`places/search?${placesQuery({ query: text, latitude: coordinates[1], longitude: coordinates[0], span_meters: searchSpan(geometry), offset: 0, language: 'en', region: 'MV' })}`,
					undefined,
					controller.signal
				);
				if (controller.signal.aborted) return;
				const places = (response.data.places ?? []).flatMap((place): SearchPlace[] => {
					const point: Coordinates = [place.location?.longitude, place.location?.latitude];
					if (
						!place.name?.trim() ||
						place.geometry_quality === 'island_context_only' ||
						place.match_status === 'island_context_only' ||
						!validPoint(point) ||
						pointWithinIsland(point, boundaryFeatures, selectedScope.id) !== true
					)
						return [];
					return [
						{
							id: String(place.id),
							name: place.name.trim(),
							coordinates: point,
							category: place.category || undefined
						}
					];
				});
				remote = {
					key,
					places,
					loading: false,
					error: false,
					expires: Date.now() + 30_000,
					boundary: geometry
				};
			} catch {
				if (!controller.signal.aborted)
					remote = { key, places: [], loading: false, error: true, expires: 0, boundary: geometry };
			}
		}, 250);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	function normalize(value: string) {
		return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
	}
	function matches(value: string, text: string) {
		const haystack = normalize(value);
		return text.split(/\s+/).every((word) => haystack.includes(word));
	}
	function rank(name: string, text: string) {
		const value = normalize(name);
		return !text
			? 3
			: value === text
				? 0
				: value.startsWith(text)
					? 1
					: value.includes(text)
						? 2
						: 3;
	}
	function humanize(value: string) {
		const label = value.replaceAll('_', ' ').replaceAll('-', ' ').trim();
		return label ? label[0].toUpperCase() + label.slice(1) : 'Place';
	}
	function categoryAliases(category?: string) {
		return /hospital|clinic|health|medical/i.test(category ?? '')
			? 'health healthcare hospital clinic'
			: /school|college|university|education/i.test(category ?? '')
				? 'education school'
				: /bus|ferry|terminal|public_transport|airport|jetty|pier/i.test(category ?? '')
					? 'transport connection stop'
					: '';
	}
	function geometryBounds(geometry: Geometry): [number, number, number, number] | null {
		let west = Infinity,
			south = Infinity,
			east = -Infinity,
			north = -Infinity;
		function visit(value: unknown) {
			if (!Array.isArray(value)) return;
			if (validPoint(value)) {
				west = Math.min(west, value[0]);
				east = Math.max(east, value[0]);
				south = Math.min(south, value[1]);
				north = Math.max(north, value[1]);
			} else for (const child of value) visit(child);
		}
		if (geometry.type === 'GeometryCollection') {
			for (const child of geometry.geometries) {
				const bounds = geometryBounds(child);
				if (bounds) {
					visit(bounds.slice(0, 2));
					visit(bounds.slice(2, 4));
				}
			}
		} else visit(geometry.coordinates);
		return Number.isFinite(west) ? [west, south, east, north] : null;
	}
	function geometryCenter(geometry: Geometry): Coordinates | null {
		const bounds = geometryBounds(geometry);
		return bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : null;
	}
	function searchSpan(geometry: Geometry) {
		const bounds = geometryBounds(geometry);
		return bounds
			? Math.max(
					1000,
					Math.min(
						50000,
						Math.ceil(Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * 111320 * 1.4)
					)
				)
			: 5000;
	}
	function nearby(a: Coordinates, b: Coordinates) {
		return Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111320 < 60;
	}
	function resultIcon(result: Result) {
		if (result.kind === 'atoll') return Layers;
		if (result.kind === 'island') return MapPin;
		const category = result.category ?? '';
		return /hospital|clinic|health|medical/i.test(category)
			? Hospital
			: /school|college|university|education/i.test(category)
				? GraduationCap
				: /bus/i.test(category)
					? Bus
					: /ferry|terminal|jetty|pier/i.test(category)
						? Ship
						: /airport/i.test(category)
							? Plane
							: MapPin;
	}
	function focusInput() {
		void tick().then(() => input?.focus());
	}
	export function focusGlobal(atoll: string | null = null) {
		scopeId = null;
		atollFilter = atoll;
		query = '';
		activeIndex = -1;
		open = true;
		focusInput();
	}
	export function focus() {
		open = true;
		focusInput();
	}
	function removeScope() {
		scopeId = null;
		atollFilter = null;
		activeIndex = -1;
		open = true;
		focusInput();
	}
	function clearQuery() {
		query = '';
		onQueryChange?.('');
		activeIndex = -1;
		open = true;
		focusInput();
	}
	function choose(result: Result) {
		activeIndex = -1;
		open = false;
		if (
			variant === 'endpoint' &&
			(result.kind === 'place' || result.kind === 'center') &&
			result.place
		) {
			query = result.place.name;
			onEndpoint?.({
				id: result.place.id,
				name: result.place.name,
				coordinates: result.place.coordinates,
				islandId: result.islandId ?? scope?.id ?? null
			});
		} else if (result.kind === 'place' && result.place) {
			query = result.name;
			onPlace?.(result.place);
		} else if (result.kind === 'island') {
			scopeId = result.id;
			atollFilter = null;
			query = '';
			if (variant === 'endpoint') {
				onQueryChange?.('');
				open = true;
				focusInput();
			} else onIsland?.(result.id);
		} else if (result.kind === 'atoll') {
			scopeId = null;
			atollFilter = result.name;
			query = '';
			if (variant === 'endpoint') {
				onQueryChange?.('');
				open = true;
				focusInput();
			} else onAtoll?.(result.name);
		}
	}
	function handleKeydown(event: KeyboardEvent) {
		if (event.isComposing) return;
		if (
			event.key === 'Backspace' &&
			scope &&
			!query &&
			input.selectionStart === 0 &&
			input.selectionEnd === 0
		) {
			event.preventDefault();
			removeScope();
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const wasOpen = open;
			open = true;
			if (!results.length) return;
			activeIndex =
				event.key === 'ArrowDown'
					? !wasOpen || activeIndex < 0
						? 0
						: (activeIndex + 1) % results.length
					: !wasOpen || activeIndex < 0
						? results.length - 1
						: (activeIndex - 1 + results.length) % results.length;
			void tick().then(() =>
				document
					.getElementById(optionId(activeIndex))
					?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
			);
		} else if (event.key === 'Enter' && open && (activeResult || (normalizedQuery && results[0]))) {
			event.preventDefault();
			choose(activeResult ?? results[0]);
		}
	}
	function handleOutside(event: Event) {
		if (open && event.target instanceof Node && !element?.contains(event.target)) {
			open = false;
			activeIndex = -1;
		}
	}
	function handleEscape(event: KeyboardEvent) {
		if (
			event.key === 'Escape' &&
			open &&
			event.target instanceof Node &&
			element?.contains(event.target)
		) {
			event.preventDefault();
			event.stopPropagation();
			input?.focus();
			open = false;
			activeIndex = -1;
		}
	}
</script>

<svelte:document onpointerdown={handleOutside} onfocusin={handleOutside} onkeydown={handleEscape} />

<div
	class="map-search"
	class:map-search-endpoint={variant === 'endpoint'}
	data-testid={variant === 'endpoint' ? 'directions-endpoint-search' : 'map-search'}
	bind:this={element}
>
	<div class="scoped-search-field" class:scoped-search-expanded={open}>
		{#if variant !== 'endpoint'}<Search size={16} strokeWidth={1.8} aria-hidden="true" />{/if}
		{#if scope}
			<span class="scoped-search-scope" data-testid="map-search-scope" data-island-id={scope.id}>
				<span title={scope.name}>{scope.name}</span>
				<button
					type="button"
					aria-label="Remove island filter"
					title="Search all islands and atolls"
					onclick={removeScope}><X size={12} aria-hidden="true" /></button
				>
			</span>
		{/if}
		<input
			bind:this={input}
			bind:value={query}
			id={`${componentId}-input`}
			data-testid={variant === 'endpoint' ? 'directions-endpoint-input' : 'map-search-input'}
			type="text"
			role="combobox"
			aria-label={variant === 'endpoint'
				? endpointLabel
				: scope
					? `Search places in ${scope.name}`
					: 'Search islands and atolls'}
			aria-autocomplete="list"
			aria-expanded={open}
			aria-controls={open ? resultsId : undefined}
			aria-activedescendant={activeResult ? optionId(activeIndex) : undefined}
			placeholder={variant === 'endpoint'
				? scope
					? 'Search places'
					: 'Search islands or places'
				: scope
					? 'Search places'
					: 'Find an island or atoll'}
			autocomplete="off"
			spellcheck="false"
			onfocus={() => {
				open = true;
			}}
			onclick={() => {
				open = true;
			}}
			oninput={(event) => {
				query = event.currentTarget.value;
				activeIndex = -1;
				open = true;
				onQueryChange?.(query);
			}}
			onkeydown={handleKeydown}
		/>
		{#if query}
			<button
				class="scoped-search-clear"
				type="button"
				aria-label="Clear search"
				onclick={clearQuery}><X size={14} aria-hidden="true" /></button
			>
		{/if}
	</div>
	{#if open}
		<div
			class="scoped-search-dropdown"
			style={variant === 'endpoint' ? dropdownStyle : undefined}
			in:surfaceMotion={{
				axis: 'y',
				distance: -4,
				scale: 0.985,
				origin: 'top left',
				duration: 180
			}}
			out:surfaceMotion={{ direction: 'out', axis: 'y', distance: -2, duration: 100 }}
		>
			<div class="scoped-search-heading">
				<span
					>{scope
						? `Places in ${scope.name}`
						: filterAtoll
							? `Islands in ${filterAtoll}`
							: normalizedQuery
								? 'Islands & atolls'
								: 'Explore the Maldives'}</span
				>
				{#if !scope && filterAtoll}
					<button
						type="button"
						onclick={() => {
							atollFilter = null;
							activeIndex = -1;
							focusInput();
						}}>All atolls</button
					>
				{:else if scope}<span class="scoped-search-local-label">Within island</span>{/if}
			</div>
			<div
				id={resultsId}
				class="scoped-search-results"
				role="listbox"
				aria-label={scope ? `Places in ${scope.name}` : 'Islands and atolls'}
				aria-busy={busy}
			>
				{#each results as result, index (`${result.kind}:${result.id}`)}
					{@const Icon = resultIcon(result)}
					<button
						type="button"
						id={optionId(index)}
						class="scoped-search-result"
						class:scoped-search-active={activeIndex === index}
						role="option"
						aria-selected={activeIndex === index}
						tabindex="-1"
						data-search-kind={result.kind}
						data-search-id={result.id}
						data-island-id={result.islandId}
						onpointerdown={(event) => event.preventDefault()}
						onpointermove={() => {
							activeIndex = index;
						}}
						onclick={() => choose(result)}
					>
						<span class="scoped-search-result-icon"
							><Icon size={17} strokeWidth={1.65} aria-hidden="true" /></span
						>
						<span class="scoped-search-result-copy"
							><strong>{result.name}</strong><span>{result.detail}</span></span
						>
						{#if result.kind === 'atoll' || result.kind === 'island'}<span
								class="scoped-search-kind">{result.kind === 'atoll' ? 'Atoll' : 'Island'}</span
							>{/if}
					</button>
				{/each}
			</div>
			{#if !results.length && !busy && !currentRemote.error && !scopeError}
				<div class="scoped-search-empty" role="status">
					<strong
						>{scope
							? normalizedQuery
								? 'No places found on this island'
								: 'Find a place on this island'
							: 'No islands or atolls found'}</strong
					>
					<p>
						{scope
							? normalizedQuery
								? 'Try a different name, or search for a school, clinic or bus stop.'
								: 'Search by name or try a school, clinic or bus stop.'
							: 'Try another name or check the spelling.'}
					</p>
				</div>
			{/if}
			{#if busy && !results.length}
				<div class="scoped-search-skeleton">
					<LoadingSkeleton
						rows={3}
						label={scope ? 'Finding places on this island…' : 'Loading islands…'}
					/>
				</div>
			{:else if busy}
				<div class="scoped-search-status" role="status">
					<span class="scoped-search-status-dot"></span>{loading
						? scope
							? 'Loading mapped places…'
							: 'Loading islands…'
						: 'Finding places on this island…'}
				</div>
			{:else if scope && (currentRemote.error || scopeError)}
				<div class="scoped-search-status scoped-search-error" role="status">
					<span>{scopeError ? 'Island places couldn’t load.' : 'More places couldn’t load.'}</span
					><button
						type="button"
						onclick={() => {
							retry += 1;
						}}>Retry</button
					>
				</div>
			{:else if scope && normalizedQuery.length >= 2 && !boundary}
				<div class="scoped-search-status" role="status">
					{results.length
						? 'Showing mapped places. Island boundary is not available for a wider search.'
						: 'Island boundary is not available for a wider search.'}
				</div>
			{/if}
			{#if scope && !busy && !currentRemote.error && !normalizedQuery}
				<div class="scoped-search-footer">
					Remove the island filter to search islands and atolls.
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.map-search {
		position: relative;
		min-width: 0;
		width: 100%;
	}
	.scoped-search-skeleton {
		padding: 8px 15px 15px;
	}
	.map-search-endpoint:has(.scoped-search-expanded) {
		z-index: 60;
	}
	.map-search-endpoint .scoped-search-field {
		min-height: 42px;
		padding-left: 10px;
		border-color: var(--theme-color-d6e1db);
		border-radius: 10px;
		background: var(--theme-color-f7faf7);
		gap: 6px;
	}
	.map-search-endpoint .scoped-search-field input {
		font-size: 12px;
	}
	.map-search-endpoint .scoped-search-scope {
		max-width: 39%;
		padding-left: 7px;
	}
	.map-search-endpoint .scoped-search-dropdown {
		top: calc(100% + 6px);
		left: -27px;
		right: -34px;
		max-height: min(365px, calc(100dvh - 260px));
		border-radius: 12px;
	}
	.scoped-search-field {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
		min-height: 40px;
		padding: 4px 9px 4px 13px;
		border: 1px solid transparent;
		border-radius: 11px;
		background: var(--theme-color-ffffff);
		color: var(--theme-color-65746c);
	}
	.map-search:not(.map-search-endpoint) .scoped-search-field {
		border-radius: 999px;
	}
	.scoped-search-field > :global(svg) {
		flex: 0 0 auto;
	}
	.scoped-search-field:focus-within {
		border-color: var(--theme-color-9cb9af);
		box-shadow: 0 0 0 3px var(--theme-color-1737350a);
	}
	.scoped-search-field input {
		flex: 1 1 90px;
		width: 100%;
		min-width: 0;
		height: 28px;
		padding: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--theme-color-25272d);
		font: inherit;
		font-size: 12px;
		line-height: 1.4;
		text-overflow: ellipsis;
	}
	.scoped-search-field input::placeholder {
		color: var(--theme-color-65746c);
		opacity: 1;
	}
	.scoped-search-field input:focus-visible {
		outline: none;
	}
	.scoped-search-scope {
		display: inline-flex;
		flex: 0 1 auto;
		align-items: center;
		gap: 4px;
		min-width: 0;
		max-width: 42%;
		height: 27px;
		margin-left: -2px;
		padding: 0 4px 0 9px;
		border: 1px solid var(--theme-color-d8e7e5);
		border-radius: 14px;
		background: var(--theme-color-eef6f4);
		color: var(--theme-color-365b54);
	}
	.scoped-search-scope > span {
		overflow: hidden;
		font-size: 11px;
		font-weight: 650;
		line-height: 1.3;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.scoped-search-scope button,
	.scoped-search-clear {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 24px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--theme-color-65746c);
		cursor: pointer;
	}
	.scoped-search-scope button:hover,
	.scoped-search-clear:hover {
		background: var(--theme-color-d8e7e5);
		color: var(--theme-color-243a36);
	}
	.scoped-search-clear {
		width: 26px;
		height: 28px;
	}
	.scoped-search-dropdown {
		position: absolute;
		z-index: 50;
		top: calc(100% + 12px);
		right: 0;
		left: 0;
		display: flex;
		flex-direction: column;
		max-height: min(480px, calc(100dvh - 220px));
		overflow: hidden;
		border: 1px solid var(--theme-color-d6e1db);
		border-radius: 17px;
		background: var(--theme-color-ffffff);
		color: var(--theme-color-25272d);
		box-shadow:
			0 12px 38px var(--theme-color-14282029),
			0 2px 8px var(--theme-color-1737350a);
	}
	.scoped-search-heading {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-height: 41px;
		padding: 11px 13px 9px;
		border-bottom: 1px solid var(--theme-color-e7eeea);
		color: var(--theme-color-365b54);
		font-size: 11px;
		font-weight: 650;
		line-height: 1.4;
	}
	.scoped-search-heading > span:first-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.scoped-search-heading .scoped-search-local-label {
		flex-shrink: 0;
		color: var(--theme-color-73877d);
		font-size: 10px;
		font-weight: 450;
	}
	.scoped-search-heading button,
	.scoped-search-status button {
		flex-shrink: 0;
		padding: 3px 4px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--theme-color-1d645e);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.scoped-search-results {
		flex: 0 1 auto;
		min-height: 0;
		padding: 5px;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
	}
	.scoped-search-results:empty {
		padding: 0;
	}
	.scoped-search-result {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 57px;
		padding: 9px 8px;
		border: 0;
		border-radius: 10px;
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.scoped-search-result:hover,
	.scoped-search-active {
		background: var(--theme-color-eef6f4);
	}
	.scoped-search-result-icon {
		display: grid;
		flex: 0 0 auto;
		place-items: center;
		width: 33px;
		height: 33px;
		border: 1px solid var(--theme-color-e1e7e0);
		border-radius: 10px;
		background: var(--theme-color-f7faf7);
		color: var(--theme-color-48716e);
	}
	.scoped-search-result-copy {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.scoped-search-result-copy strong {
		overflow: hidden;
		font-size: 12px;
		font-weight: 550;
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.scoped-search-result-copy > span {
		overflow: hidden;
		color: var(--theme-color-73877d);
		font-size: 10px;
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.scoped-search-kind {
		flex: 0 0 auto;
		padding-left: 4px;
		color: var(--theme-color-73877d);
		font-size: 10px;
	}
	.scoped-search-empty {
		padding: 23px 18px 24px;
		text-align: center;
	}
	.scoped-search-empty strong {
		font-size: 12px;
		font-weight: 550;
		line-height: 1.5;
	}
	.scoped-search-empty p {
		max-width: 260px;
		margin: 6px auto 0;
		color: var(--theme-color-73877d);
		font-size: 11px;
		line-height: 1.6;
	}
	.scoped-search-status,
	.scoped-search-footer {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 8px;
		padding: 11px 14px;
		border-top: 1px solid var(--theme-color-e7eeea);
		color: var(--theme-color-65746c);
		font-size: 11px;
		line-height: 1.5;
	}
	.scoped-search-status-dot {
		flex: 0 0 auto;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--theme-color-9cb9af);
	}
	.scoped-search-error {
		justify-content: space-between;
	}
	.scoped-search-footer {
		font-size: 10px;
	}
	button:focus-visible {
		outline: 2px solid var(--theme-color-087f78);
		outline-offset: 2px;
	}
	button:active {
		transform: scale(0.98);
	}
	@media (max-width: 700px) {
		.map-search:not(.map-search-endpoint) .scoped-search-field {
			min-height: 44px;
		}
	}
	@media (max-width: 640px) {
		.map-search-endpoint .scoped-search-field input {
			font-size: 16px;
		}
		.scoped-search-field input {
			font-size: 16px;
		}
		.scoped-search-scope {
			max-width: 43%;
		}
		.scoped-search-dropdown {
			max-height: min(440px, calc(100dvh - 220px));
		}
		.scoped-search-result {
			min-height: 59px;
		}
	}
</style>
