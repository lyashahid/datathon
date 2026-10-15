<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import {
		CloudSun,
		Wind,
		Waves,
		FileText,
		RefreshCw,
		ArrowRight,
		Check,
		X,
		Route,
		ArrowLeftRight,
		MapPin,
		PanelBottomOpen,
		Expand,
		Minimize2
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { api } from '#lib/api.js';
	import LocationMap from './LocationMap.svelte';
	import {
		locationFromInput,
		providerRouteCoordinates,
		type MapLocation
	} from '#lib/map-location.js';
	type Forecast = {
		status: string;
		current: Record<string, number | string | null>;
		current_units: Record<string, string>;
		grid: { latitude: number; longitude: number; timezone: string };
		hourly: Record<string, (number | string | null)[]>;
		receipt: {
			url: string;
			retrieved_at: string;
			cached: boolean;
			stale: boolean;
			qualification: string;
		};
		warning?: string;
	};
	type Notice = {
		id: string;
		title: string;
		source_url: string;
		status: string;
		ingested_at: string;
		supporting_text: string;
		possible_location: string | null;
		confidence: string;
		proposed_operation: Record<string, unknown> | null;
		receipt: { input_method?: string; sha256: string };
		review?: { valid_from: string; valid_until: string; notes: string } | null;
	};
	type Target = { id: string; name?: string; sourceOsmWayId?: string };
	type Baseline = { graph_edges?: Target[]; facilities: Target[]; patterns: Target[] };
	let {
		initialLatitude = 4.1755,
		initialLongitude = 73.5093,
		scopeLabel = 'Malé',
		onUseNotice,
		active = true
	}: {
		initialLatitude?: number;
		initialLongitude?: number;
		scopeLabel?: string;
		onUseNotice: (operation: Record<string, unknown>) => void;
		active?: boolean;
	} = $props();
	let latitude = $state<number | string>(4.1755),
		longitude = $state<number | string>(73.5093);
	let mounted = $state(false);
	let weatherInspectorOpen = $state(false),
		trafficInspectorOpen = $state(false);
	let inspectorExpanded = $state(false);
	let viewportWidth = $state(1440);
	let weatherInspectorTrigger = $state.raw<HTMLButtonElement | null>(null),
		trafficInspectorTrigger = $state.raw<HTMLButtonElement | null>(null);
	let weatherInspectorClose = $state.raw<HTMLButtonElement | null>(null),
		trafficInspectorClose = $state.raw<HTMLButtonElement | null>(null);
	function closeInspector(kind: 'weather' | 'traffic') {
		if (kind === 'weather') weatherInspectorOpen = false;
		else trafficInspectorOpen = false;
		inspectorExpanded = false;
		void tick().then(() =>
			(kind === 'weather' ? weatherInspectorTrigger : trafficInspectorTrigger)?.focus()
		);
	}
	function openInspector(kind: 'weather' | 'traffic') {
		if (kind === 'weather') weatherInspectorOpen = true;
		else trafficInspectorOpen = true;
		void tick().then(() =>
			(kind === 'weather' ? weatherInspectorClose : trafficInspectorClose)?.focus()
		);
	}
	let lastScope = '';
	let weatherRequest = 0,
		trafficRequest = 0;
	let weatherController: AbortController | undefined,
		trafficController: AbortController | undefined,
		noticeController: AbortController | undefined,
		snapshotController: AbortController | undefined;
	$effect(() => {
		const lat = initialLatitude,
			lon = initialLongitude;
		if (!mounted) return;
		untrack(() => {
			const scope = `${lat}:${lon}`;
			if (scope === lastScope) return;
			lastScope = scope;
			weatherRequest += 1;
			trafficRequest += 1;
			weatherController?.abort();
			trafficController?.abort();
			latitude = lat;
			longitude = lon;
			trafficLatitude = lat;
			trafficLongitude = lon;
			destinationLatitude = '';
			destinationLongitude = '';
			trafficOriginName = `${scopeLabel} · starting point`;
			trafficDestinationName = 'Choose destination';
			weatherLocationName = `${scopeLabel} · forecast location`;
			trafficSelection = 'destination';
			weather = null;
			marine = null;
			traffic = null;
		});
	});
	let view = $state('weather'),
		weather = $state<Forecast | null>(null),
		marine = $state<Forecast | null>(null);
	let busy = $state(''),
		error = $state(''),
		message = $state('');
	let notices = $state<Notice[]>([]),
		baseline = $state<Baseline | null>(null),
		snapshotDate = $state('');
	let historicalAlerts = $state<{ title?: string; headline?: string; description?: string }[]>([]);
	let noticesLoading = $state(false),
		noticesLoaded = $state(false),
		noticesError = $state('');
	let snapshotLoading = $state(false),
		snapshotLoaded = $state(false),
		snapshotError = $state('');
	let sourceUrl = $state(''),
		noticeText = $state(''),
		noticeTitle = $state('');
	let focused = $state<Notice | null>(null),
		decisionType = $state('road_closure'),
		targetId = $state('');
	let validFrom = $state(''),
		validUntil = $state(''),
		reviewNotes = $state('');
	let trafficLatitude = $state<number | string>(4.1755),
		trafficLongitude = $state<number | string>(73.5093);
	let destinationLatitude = $state<number | string>(''),
		destinationLongitude = $state<number | string>('');
	let trafficSelection = $state<'origin' | 'destination' | null>('destination');
	let weatherSelection = $state<'origin' | 'destination' | null>(null);
	let trafficOriginName = $state('Starting point'),
		trafficDestinationName = $state('Choose destination');
	let weatherLocationName = $state('Forecast location');
	let selectedTrafficRoute = $state(0);
	const trafficOrigin = $derived(locationFromInput(trafficLatitude, trafficLongitude));
	const trafficDestination = $derived(locationFromInput(destinationLatitude, destinationLongitude));
	const weatherPoint = $derived(locationFromInput(latitude, longitude));
	type Traffic = {
		data: {
			routes: {
				id?: string;
				summary?: string;
				distance_meters?: number;
				typical_seconds?: number;
				traffic_seconds?: number | null;
				geometry?: { type: 'LineString'; coordinates: number[][] } | null;
			}[];
		};
		receipt: { retrieved_at: string; qualification: string };
	};
	let traffic = $state<Traffic | null>(null);
	const trafficRouteShape = $derived(
		providerRouteCoordinates(traffic?.data.routes[selectedTrafficRoute]?.geometry?.coordinates)
	);
	let lastTrafficPoints = '';
	let lastWeatherPoint = '';
	$effect(() => {
		const key = `${trafficLatitude}:${trafficLongitude}:${destinationLatitude}:${destinationLongitude}`;
		untrack(() => {
			if (key === lastTrafficPoints) return;
			lastTrafficPoints = key;
			trafficRequest++;
			trafficController?.abort();
			traffic = null;
			selectedTrafficRoute = 0;
			if (busy === 'traffic') busy = '';
		});
	});
	$effect(() => {
		const key = `${latitude}:${longitude}`;
		untrack(() => {
			if (key === lastWeatherPoint) return;
			lastWeatherPoint = key;
			weatherRequest++;
			weatherController?.abort();
			weather = null;
			marine = null;
			if (busy === 'weather') busy = '';
		});
	});
	$effect(() => {
		if (!mounted || !active) return;
		const selectedView = view;
		const lat = initialLatitude,
			lon = initialLongitude;
		untrack(() => {
			if (
				selectedView === 'weather' &&
				lastScope === `${lat}:${lon}` &&
				!weather &&
				busy !== 'weather'
			)
				void refreshWeather();
			if (selectedView === 'notices' && !noticesLoaded && !noticesLoading) void loadNoticeContext();
		});
	});
	$effect(() => {
		const visible = active;
		const selectedView = view;
		untrack(() => {
			if (!visible || selectedView !== 'weather') {
				weatherController?.abort();
				weatherRequest++;
				if (busy === 'weather') busy = '';
			}
			if (!visible || selectedView !== 'traffic') {
				trafficController?.abort();
				trafficRequest++;
				if (busy === 'traffic') busy = '';
			}
		});
	});
	let lastView = '';
	$effect(() => {
		const selectedView = view;
		untrack(() => {
			if (selectedView === lastView) return;
			lastView = selectedView;
			error = '';
			message = '';
		});
	});
	function chooseWeather(point: MapLocation) {
		latitude = point.latitude;
		longitude = point.longitude;
		weatherLocationName = 'Selected forecast location';
		void refreshWeather();
	}
	function chooseTraffic(point: MapLocation, endpoint: 'origin' | 'destination') {
		if (endpoint === 'origin') {
			trafficLatitude = point.latitude;
			trafficLongitude = point.longitude;
			trafficOriginName = 'Selected starting point';
		} else {
			destinationLatitude = point.latitude;
			destinationLongitude = point.longitude;
			trafficDestinationName = 'Selected destination';
		}
	}
	function swapTrafficPoints() {
		if (!trafficOrigin || !trafficDestination) return;
		const point = trafficOrigin,
			name = trafficOriginName;
		trafficLatitude = trafficDestination.latitude;
		trafficLongitude = trafficDestination.longitude;
		trafficOriginName = trafficDestinationName;
		destinationLatitude = point.latitude;
		destinationLongitude = point.longitude;
		trafficDestinationName = name;
	}
	function resetTrafficPoints() {
		trafficLatitude = initialLatitude;
		trafficLongitude = initialLongitude;
		destinationLatitude = '';
		destinationLongitude = '';
		trafficOriginName = `${scopeLabel} · starting point`;
		trafficDestinationName = 'Choose destination';
		trafficSelection = 'destination';
	}
	const targets = $derived(
		decisionType === 'road_closure'
			? [
					...new Map(
						(baseline?.graph_edges ?? []).map((t) => [
							t.sourceOsmWayId ?? t.id,
							{ ...t, id: t.sourceOsmWayId ?? t.id }
						])
					).values()
				]
			: decisionType === 'disable_service'
				? (baseline?.patterns ?? [])
				: (baseline?.facilities ?? [])
	);
	const selectedTarget = $derived(
		targets.find((target) => target.id === targetId.replace(/^osm:way:/, ''))
	);
	const date = (value: string) =>
		new Date(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value) ? value + 'Z' : value
		).toLocaleString('en-GB', {
			timeZone: 'Indian/Maldives',
			dateStyle: 'medium',
			timeStyle: 'short'
		}) + ' MVT';
	const number = (value: unknown, unit = '') =>
		typeof value === 'number'
			? `${value.toLocaleString('en', { maximumFractionDigits: 1 })}${unit}`
			: 'Unavailable';
	const weatherSamples = $derived(
		(weather?.hourly.time ?? [])
			.map((t, i) => ({ time: String(t), temperature: weather?.hourly.temperature_2m?.[i] }))
			.filter(
				(s) =>
					s.time >=
					String(weather?.current.time ?? weather?.receipt.retrieved_at.slice(0, 16) ?? '')
			)
			.slice(0, 48)
	);
	const temperatures = $derived(
		weatherSamples.map((s) => s.temperature).filter((v): v is number => typeof v === 'number')
	);
	const points = $derived.by(() => {
		const min = Math.min(...temperatures) - 1,
			max = Math.max(...temperatures) + 1;
		return weatherSamples
			.map((s, i) =>
				typeof s.temperature === 'number'
					? `${i > 0 && typeof weatherSamples[i - 1].temperature === 'number' ? 'L' : 'M'}${20 + (i / Math.max(1, weatherSamples.length - 1)) * 860},${140 - ((s.temperature - min) / Math.max(1, max - min)) * 110}`
					: ''
			)
			.join(' ');
	});
	function coordinates() {
		const point = locationFromInput(latitude, longitude);
		if (!point) throw new Error('Enter valid latitude and longitude.');
		return point;
	}
	async function refreshWeather() {
		await tick();
		if (!active || view !== 'weather') return;
		weatherController?.abort();
		const controller = new AbortController();
		weatherController = controller;
		const request = ++weatherRequest;
		busy = 'weather';
		error = '';
		try {
			const p = coordinates();
			const q = new URLSearchParams({
				latitude: String(p.latitude),
				longitude: String(p.longitude)
			});
			const values = await Promise.allSettled([
				api<Forecast>('conditions/weather?' + q, undefined, controller.signal),
				api<Forecast>('conditions/marine?' + q, undefined, controller.signal)
			]);
			if (request !== weatherRequest || controller.signal.aborted) return;
			if (values[0].status === 'fulfilled') weather = values[0].value;
			if (values[1].status === 'fulfilled') marine = values[1].value;
			error = values
				.filter((v) => v.status === 'rejected')
				.map((v) => String(v.reason instanceof Error ? v.reason.message : v.reason))
				.join(' ');
		} catch (e) {
			if (request === weatherRequest && !controller.signal.aborted)
				error = e instanceof Error ? e.message : String(e);
		} finally {
			if (request === weatherRequest && busy === 'weather') busy = '';
		}
	}
	async function refreshNotices() {
		const response = await api<{ items: Notice[] }>('operations/notices');
		notices = response.items;
		if (focused) focused = notices.find((n) => n.id === focused?.id) ?? null;
	}
	async function loadNoticeContext() {
		noticeController?.abort();
		const controller = new AbortController();
		noticeController = controller;
		noticesLoading = true;
		noticesError = '';
		try {
			const [queue, network] = await Promise.all([
				api<{ items: Notice[] }>('operations/notices', undefined, controller.signal),
				api<Baseline>('planning/baseline', undefined, controller.signal)
			]);
			if (controller.signal.aborted) return;
			notices = queue.items;
			baseline = network;
			noticesLoaded = true;
		} catch (e) {
			if (!controller.signal.aborted) noticesError = e instanceof Error ? e.message : String(e);
		} finally {
			if (noticeController === controller) noticesLoading = false;
		}
	}
	async function loadAdvisories() {
		if (snapshotLoading || snapshotLoaded) return;
		const controller = new AbortController();
		snapshotController = controller;
		snapshotLoading = true;
		snapshotError = '';
		try {
			const snapshot = await api<{ generatedAt?: string; weatherAlerts?: typeof historicalAlerts }>(
				'operations/snapshot',
				undefined,
				controller.signal
			);
			if (controller.signal.aborted) return;
			snapshotDate = snapshot.generatedAt ?? '';
			historicalAlerts = snapshot.weatherAlerts ?? [];
			snapshotLoaded = true;
		} catch (e) {
			if (!controller.signal.aborted) snapshotError = e instanceof Error ? e.message : String(e);
		} finally {
			if (snapshotController === controller) snapshotLoading = false;
		}
	}
	function selectNotice(notice: Notice) {
		focused = notice;
		targetId = String(notice.proposed_operation?.target_id ?? '');
		reviewNotes = notice.review?.notes ?? '';
		decisionType = String(notice.proposed_operation?.type ?? 'road_closure');
		validFrom = new Date(
			(notice.review?.valid_from ? new Date(notice.review.valid_from).getTime() : Date.now()) +
				5 * 3600000
		)
			.toISOString()
			.slice(0, 16);
		validUntil = new Date(
			(notice.review?.valid_until
				? new Date(notice.review.valid_until).getTime()
				: Date.now() + 2 * 3600000) +
				5 * 3600000
		)
			.toISOString()
			.slice(0, 16);
	}
	onMount(() => {
		mounted = true;
		validFrom = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 16);
		validUntil = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16);
		return () => {
			weatherRequest += 1;
			trafficRequest += 1;
			weatherController?.abort();
			trafficController?.abort();
			noticeController?.abort();
			snapshotController?.abort();
		};
	});
	async function importNotice() {
		busy = 'import';
		error = '';
		message = '';
		try {
			const imported = await api<Notice>('operations/notices/ingest', {
				source_url: sourceUrl,
				...(noticeText.trim() ? { text: noticeText.trim() } : {}),
				...(noticeTitle.trim() ? { title: noticeTitle.trim() } : {})
			});
			selectNotice(imported);
			await refreshNotices();
			message = 'Notice imported. Inspect the source and map its affected target before using it.';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = '';
		}
	}
	async function review(decision: 'approved' | 'dismissed') {
		if (!focused) return;
		const noticeId = focused.id;
		busy = 'review';
		error = '';
		try {
			const reviewed = await api<Notice>(
				`operations/notices/${encodeURIComponent(noticeId)}/review`,
				{
					decision,
					...(decision === 'approved'
						? {
								operation_type: decisionType,
								target_id: targetId,
								valid_from: validFrom + ':00+05:00',
								valid_until: validUntil + ':00+05:00'
							}
						: {}),
					notes: reviewNotes
				}
			);
			if (focused?.id === noticeId) focused = reviewed;
			await refreshNotices();
			message =
				decision === 'approved'
					? 'Reviewed and mapped. Add it to a proposal to calculate its effect.'
					: 'Notice dismissed.';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = '';
		}
	}
	async function checkTraffic() {
		if (!trafficOrigin || !trafficDestination) {
			error = 'Choose a starting point and destination on the map first.';
			return;
		}
		const request = ++trafficRequest;
		trafficController?.abort();
		const controller = new AbortController();
		trafficController = controller;
		busy = 'traffic';
		error = '';
		traffic = null;
		try {
			const result = await api<Traffic>(
				'conditions/traffic',
				{
					origin: trafficOrigin,
					destination: trafficDestination,
					mode: 'driving',
					region: 'mv',
					language: 'en'
				},
				controller.signal
			);
			if (request === trafficRequest && !controller.signal.aborted) {
				traffic = result;
				if (viewportWidth <= 640 && active && view === 'traffic') openInspector('traffic');
			}
		} catch (e) {
			if (request === trafficRequest && !controller.signal.aborted)
				error = e instanceof Error ? e.message : String(e);
		} finally {
			if (request === trafficRequest && busy === 'traffic') busy = '';
		}
	}
</script>

<svelte:window
	bind:innerWidth={viewportWidth}
	onkeydown={(event) => {
		if (event.key !== 'Escape') return;
		if (view === 'weather' && weatherInspectorOpen) closeInspector('weather');
		if (view === 'traffic' && trafficInspectorOpen) closeInspector('traffic');
	}}
/>
<section class="operations-workspace">
	<div class="heading">
		<div>
			<span class="eyebrow">OPERATING CONTEXT</span>
			<h1>Conditions around {scopeLabel}</h1>
			<p>Choose locations on the map. Check forecasts, driving conditions or public notices.</p>
		</div>
		<span class="scope">{scopeLabel} · Indian/Maldives</span>
	</div>
	<Tabs.Root bind:value={view}
		><Tabs.List aria-label="Operating context"
			><Tabs.Trigger value="weather"><CloudSun size={15} />Weather & sea</Tabs.Trigger><Tabs.Trigger
				value="traffic"><Route size={15} />Live traffic</Tabs.Trigger
			><Tabs.Trigger value="notices"
				><FileText size={15} />Public notices
				{#if noticesLoaded}<span class="pill">{notices.length}</span>{/if}</Tabs.Trigger
			></Tabs.List
		>
		{#if error}<p class="error" role="alert">{error}</p>{/if}{#if message}<p
				class="success"
				role="status"
			>
				{message}
			</p>{/if}
		<Tabs.Content value="weather">
			<div class="mobile-map-actions" aria-label="Weather map actions">
				<Button disabled={!!busy} onclick={refreshWeather}
					><RefreshCw size={14} />{busy === 'weather' ? 'Updating…' : 'Update forecast'}</Button
				>
				<Button
					bind:ref={weatherInspectorTrigger}
					variant="outline"
					aria-expanded={weatherInspectorOpen}
					onclick={() =>
						weatherInspectorOpen ? closeInspector('weather') : openInspector('weather')}
					><PanelBottomOpen size={15} />Weather details</Button
				>
			</div>
			<div class="weather-location-layout">
				<LocationMap
					center={{ latitude: initialLatitude, longitude: initialLongitude }}
					origin={weatherPoint}
					originLabel={weatherLocationName}
					selection={weatherSelection}
					showDestination={false}
					active={active && view === 'weather'}
					label="Weather forecast location map"
					onorigin={chooseWeather}
					onselection={(value) => (weatherSelection = value)}
				/>
				<div
					class="weather-inspector"
					class:inspector-open={weatherInspectorOpen}
					class:expanded={inspectorExpanded}
					role="region"
					aria-label="Weather details inspector"
				>
					<div class="mobile-inspector-heading">
						<b>Weather around your pin</b>
						<div>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={inspectorExpanded ? 'Reduce weather details' : 'Expand weather details'}
								onclick={() => (inspectorExpanded = !inspectorExpanded)}
								>{#if inspectorExpanded}<Minimize2 size={16} />{:else}<Expand
										size={16}
									/>{/if}</Button
							><Button
								bind:ref={weatherInspectorClose}
								variant="ghost"
								size="icon-sm"
								aria-label="Close weather details"
								onclick={() => closeInspector('weather')}><X size={16} /></Button
							>
						</div>
					</div>
					<Card.Root class="weather-location-card">
						<span class="eyebrow">FORECAST LOCATION</span>
						<h2><MapPin size={18} />{weatherLocationName}</h2>
						<p>
							Choose a location on the map to update its weather and sea forecast. The pin marks the
							requested location; forecasts use the provider's nearest model grid.
						</p>
						<Button disabled={!!busy} onclick={refreshWeather}
							><RefreshCw size={15} />{busy === 'weather' ? 'Updating…' : 'Update forecast'}</Button
						>
						<Button
							variant="outline"
							onclick={() => {
								latitude = initialLatitude;
								longitude = initialLongitude;
								weatherLocationName = `${scopeLabel} · forecast location`;
								void refreshWeather();
							}}>Use {scopeLabel}</Button
						>
						<details class="advanced-coordinates">
							<summary>Advanced · exact coordinates</summary>
							<div class="coordinate-grid">
								<Label for="conditions-lat"
									>Latitude<Input
										id="conditions-lat"
										type="number"
										step="any"
										bind:value={latitude}
									/></Label
								>
								<Label for="conditions-lon"
									>Longitude<Input
										id="conditions-lon"
										type="number"
										step="any"
										bind:value={longitude}
									/></Label
								>
							</div>
						</details>
					</Card.Root>
					<div class="metrics">
						<Card.Root class="metric temperature"
							><CloudSun size={26} /><span>Air temperature</span><strong
								>{number(weather?.current.temperature_2m, '°C')}</strong
							><small>Feels like {number(weather?.current.apparent_temperature, '°C')}</small
							></Card.Root
						><Card.Root class="metric wind"
							><Wind size={26} /><span>Wind speed · 10 m</span><strong
								>{number(weather?.current.wind_speed_10m, ' km/h')}</strong
							><small>Gusts {number(weather?.current.wind_gusts_10m, ' km/h')}</small></Card.Root
						><Card.Root class="metric sea"
							><Waves size={26} /><span>Significant wave height</span><strong
								>{number(marine?.current.wave_height, ' m')}</strong
							><small
								>Period {number(marine?.current.wave_period, ' s')} · {marine?.status ??
									'Loading'}</small
							></Card.Root
						>
					</div>
					<Card.Root class="chart"
						><div class="card-heading">
							<div>
								<span class="eyebrow">NEXT HOURLY FORECASTS · UP TO 48 HOURS</span>
								<h2>Temperature outlook</h2>
							</div>
							<span>°C · hourly model forecast</span>
						</div>
						{#if temperatures.length}<svg
								viewBox="0 0 900 165"
								role="img"
								aria-label={`Hourly temperature forecast ranges from ${Math.min(...temperatures)} to ${Math.max(...temperatures)} degrees Celsius`}
								><line x1="20" y1="145" x2="880" y2="145" stroke="#e7e6ee" /><path
									d={points}
									fill="none"
									stroke="#9170c6"
									stroke-width="3"
								/><text x="20" y="162" fill="#676778" font-size="12"
									>{weatherSamples[0]?.time.replace('T', ' ')} UTC</text
								><text x="660" y="162" fill="#676778" font-size="12"
									>{weatherSamples.at(-1)?.time.replace('T', ' ')} UTC</text
								></svg
							>{:else}<p class="muted">
								{busy === 'weather'
									? 'Fetching current model forecast…'
									: 'No temperature forecast available.'}
							</p>{/if}</Card.Root
					>
					<div class="receipts">
						{#each [weather, marine].filter((f): f is Forecast => f !== null) as forecast (forecast.receipt.url)}<Card.Root
								class="receipt"
								><b>{forecast === weather ? 'Weather' : 'Marine'} · {forecast.status}</b>
								<p>{forecast.receipt.qualification}</p>
								<small
									>Valid {String(forecast.current.time).replace('T', ' ')} UTC · grid {number(
										forecast.grid.latitude
									)}, {number(forecast.grid.longitude)}</small
								>
								<small
									>Retrieved {date(forecast.receipt.retrieved_at)} · {forecast.receipt.stale
										? 'stale cached value'
										: forecast.receipt.cached
											? 'cached'
											: 'fresh'} ·
									<a href={forecast.receipt.url} target="_blank" rel="noreferrer"
										>Open-Meteo / CC BY 4.0</a
									></small
								></Card.Root
							>{/each}
					</div>
					<details
						ontoggle={(event) => {
							if (event.currentTarget.open) void loadAdvisories();
						}}
					>
						<summary
							>{snapshotLoaded
								? `${historicalAlerts.length} preserved advisory records`
								: 'Preserved advisory records'}{snapshotDate
								? ` · ${date(snapshotDate)}`
								: ''}</summary
						>
						<p>
							Historical advisory evidence. Check the issuing authority for current warnings; these
							records do not cancel services.
						</p>
						{#if snapshotLoading}<p role="status">Loading preserved advisories…</p>{/if}
						{#if snapshotError}<p role="alert">
								{snapshotError}<Button variant="outline" size="sm" onclick={loadAdvisories}
									>Retry advisories</Button
								>
							</p>{/if}
						<div class="alerts">
							{#each historicalAlerts.slice(0, 8) as alert, i (i)}<div>
									{alert.headline ?? alert.title ?? alert.description ?? 'Source advisory'}
								</div>{/each}
						</div>
					</details>
				</div>
			</div>
		</Tabs.Content>
		<Tabs.Content value="traffic">
			<div class="mobile-map-actions" aria-label="Traffic map actions">
				<Button disabled={!!busy || !trafficOrigin || !trafficDestination} onclick={checkTraffic}
					>{busy === 'traffic' ? 'Checking…' : 'Check traffic'}<ArrowRight size={14} /></Button
				>
				<Button
					bind:ref={trafficInspectorTrigger}
					variant="outline"
					aria-expanded={trafficInspectorOpen}
					onclick={() =>
						trafficInspectorOpen ? closeInspector('traffic') : openInspector('traffic')}
					><PanelBottomOpen size={15} />Route details</Button
				>
			</div>
			<div class="traffic-location-layout">
				<LocationMap
					center={{ latitude: initialLatitude, longitude: initialLongitude }}
					origin={trafficOrigin}
					destination={trafficDestination}
					originLabel={trafficOriginName}
					destinationLabel={trafficDestinationName}
					selection={trafficSelection}
					routeCoordinates={trafficRouteShape}
					routeLabel={traffic?.data.routes[selectedTrafficRoute]?.summary ??
						'Provider driving route'}
					active={active && view === 'traffic'}
					label="Live traffic route map"
					onorigin={(point) => chooseTraffic(point, 'origin')}
					ondestination={(point) => chooseTraffic(point, 'destination')}
					onselection={(value) => (trafficSelection = value)}
				/>
				<div
					class="traffic-inspector"
					class:inspector-open={trafficInspectorOpen}
					class:expanded={inspectorExpanded}
					role="region"
					aria-label="Traffic details inspector"
				>
					<div class="mobile-inspector-heading">
						<b>{traffic ? 'Your drive and its traffic' : 'Set up your drive'}</b>
						<div>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={inspectorExpanded ? 'Reduce route details' : 'Expand route details'}
								onclick={() => (inspectorExpanded = !inspectorExpanded)}
								>{#if inspectorExpanded}<Minimize2 size={16} />{:else}<Expand
										size={16}
									/>{/if}</Button
							><Button
								bind:ref={trafficInspectorClose}
								variant="ghost"
								size="icon-sm"
								aria-label="Close route details"
								onclick={() => closeInspector('traffic')}><X size={16} /></Button
							>
						</div>
					</div>
					<Card.Root class="traffic-card">
						<span class="eyebrow">CURRENT DRIVING CONDITIONS</span>
						<h2>Choose a drive on the map.</h2>
						<p>
							Set A and B by clicking the map or dragging their pins. Then compare typical and
							provider-supplied traffic time.
						</p>
						<div class="traffic-endpoint-list">
							<Button variant="outline" onclick={() => (trafficSelection = 'origin')}
								><span class="endpoint-letter">A</span>{trafficOriginName}</Button
							>
							<Button variant="outline" onclick={() => (trafficSelection = 'destination')}
								><span class="endpoint-letter destination">B</span>{trafficDestinationName}</Button
							>
						</div>
						<div class="actions">
							<Button
								variant="ghost"
								size="sm"
								disabled={!trafficDestination}
								onclick={swapTrafficPoints}><ArrowLeftRight size={14} />Swap A & B</Button
							>
							<Button variant="ghost" size="sm" onclick={resetTrafficPoints}>Reset points</Button>
						</div>
						<Button
							disabled={!!busy || !trafficOrigin || !trafficDestination}
							onclick={checkTraffic}
							>{busy === 'traffic' ? 'Checking provider…' : 'Check traffic-aware routes'}<ArrowRight
								size={15}
							/></Button
						>
						{#if !trafficDestination}<p class="muted">
								Start by choosing B on the map. No coordinates are needed.
							</p>{/if}
						<details class="advanced-coordinates">
							<summary>Advanced · exact coordinates</summary>
							<div class="coordinate-grid">
								<Label
									>Origin latitude<Input
										type="number"
										step="any"
										bind:value={trafficLatitude}
									/></Label
								>
								<Label
									>Origin longitude<Input
										type="number"
										step="any"
										bind:value={trafficLongitude}
									/></Label
								>
								<Label
									>Destination latitude<Input
										type="number"
										step="any"
										bind:value={destinationLatitude}
									/></Label
								>
								<Label
									>Destination longitude<Input
										type="number"
										step="any"
										bind:value={destinationLongitude}
									/></Label
								>
							</div>
						</details>
					</Card.Root>
					{#if traffic}
						<Card.Root class="traffic-results">
							<div class="card-heading">
								<div>
									<span class="eyebrow">PROVIDER ROUTE EVIDENCE</span>
									<h2>
										{traffic.data.routes.length
											? 'Routes for your selected drive'
											: 'No provider route returned'}
									</h2>
								</div>
								<small>Retrieved {date(traffic.receipt.retrieved_at)}</small>
							</div>
							{#if traffic.data.routes.length}
								<div class="traffic-alternatives" aria-label="Traffic route alternatives">
									{#each traffic.data.routes as route, i (i)}
										<button
											class:selected={selectedTrafficRoute === i}
											aria-pressed={selectedTrafficRoute === i}
											onclick={() => (selectedTrafficRoute = i)}
										>
											<b>{route.summary ?? `Route ${i + 1}`}</b>
											<span
												>{number(
													route.distance_meters == null ? null : route.distance_meters / 1000,
													' km'
												)} · typical {number(
													route.typical_seconds == null ? null : route.typical_seconds / 60,
													' min'
												)}</span
											>
											<strong
												>{number(
													route.traffic_seconds == null ? null : route.traffic_seconds / 60,
													' min'
												)} with traffic</strong
											>
											<small
												>{providerRouteCoordinates(route.geometry?.coordinates).length > 1
													? selectedTrafficRoute === i
														? 'Route shown on the map'
														: 'Show this route on the map'
													: 'Provider route shape unavailable · endpoint guide only'}</small
											>
										</button>
									{/each}
								</div>
							{:else}<p class="muted">
									No driving route was returned. Choose two places connected by road on the same
									island and try again.
								</p>{/if}
							<p class="muted">
								Traffic estimates come from the route provider. When traffic data is unavailable,
								the usual journey time is shown separately.
							</p>
							<details>
								<summary>Traffic source details</summary>
								<p>{traffic.receipt.qualification}</p>
							</details>
						</Card.Root>
					{/if}
				</div>
			</div>
		</Tabs.Content>
		<Tabs.Content value="notices"
			>{#if noticesLoading}<p role="status" class="notice-context-status">
					Loading notices and their mapped targets…
				</p>{/if}
			{#if noticesError}<p role="alert" class="error">
					{noticesError}<Button
						size="sm"
						variant="outline"
						disabled={noticesLoading}
						onclick={loadNoticeContext}>Retry notices</Button
					>
				</p>{/if}
			<div class="notice-layout">
				<Card.Root class="notice-import"
					><span class="eyebrow">1 · BRING IN THE SOURCE</span>
					<h2>Import a public notice</h2>
					<p>
						Retrieve a public source URL, or paste its text with the source URL for an auditable
						receipt.
					</p>
					<Label for="notice-url">Public source URL</Label><Input
						id="notice-url"
						type="url"
						placeholder="https://www.mtcc.mv/…"
						bind:value={sourceUrl}
					/><Label for="notice-title">Title (optional)</Label><Input
						id="notice-title"
						bind:value={noticeTitle}
					/><Label for="notice-text">Source text (optional)</Label><textarea
						id="notice-text"
						bind:value={noticeText}
						placeholder="Leave empty to retrieve the public page."
						rows="5"></textarea><Button
						disabled={!!busy || noticesLoading || !sourceUrl}
						onclick={importNotice}
						>{busy === 'import' ? 'Importing…' : 'Import notice'}<FileText size={15} /></Button
					>
					<div class="notice-list">
						{#each notices as notice (notice.id)}<button
								class:active={focused?.id === notice.id}
								onclick={() => selectNotice(notice)}
								><b>{notice.title}</b><span
									>{notice.status} · {notice.confidence} extraction confidence</span
								></button
							>{:else}<p class="muted">No imported notices yet.</p>{/each}
					</div></Card.Root
				><Card.Root class="notice-review"
					><span class="eyebrow">2 · INSPECT AND MAP</span>
					<h2>{focused?.title ?? 'Choose a notice to review'}</h2>
					{#if focused}<a href={focused.source_url} target="_blank" rel="noreferrer"
							>Read the original public source ↗</a
						>
						<blockquote>{focused.supporting_text}</blockquote>
						<p class="muted">
							Possible location: {focused.possible_location ?? 'Unmatched'}. {focused.receipt
								.input_method === 'user_supplied_text'
								? 'Text supplied by the importer.'
								: 'Text retrieved from the source URL.'} Extraction does not establish a closure.
						</p>
						<Label for="notice-kind">Interpretation</Label><NativeSelect.Root
							id="notice-kind"
							bind:value={decisionType}
							onchange={() => (targetId = '')}
							><NativeSelect.Option value="road_closure">Road closure</NativeSelect.Option
							><NativeSelect.Option value="disable_service">Service suspension</NativeSelect.Option
							><NativeSelect.Option value="disable_facility">Facility closure</NativeSelect.Option
							></NativeSelect.Root
						><Label for="notice-target">Verified planning target</Label><Input
							id="notice-target"
							list="notice-targets"
							bind:value={targetId}
							placeholder="Select or enter a known source ID"
						/><datalist id="notice-targets"
							>{#each targets as target (target.id)}<option value={target.id}
									>{target.name ?? target.id}</option
								>{/each}</datalist
						>
						{#if selectedTarget?.name}<p class="selected-target">
								Selected target: <strong>{selectedTarget.name}</strong>
							</p>{/if}
						<div class="coordinate-grid">
							<Label
								>Effective from · MVT<Input type="datetime-local" bind:value={validFrom} /></Label
							><Label
								>Valid until · MVT<Input type="datetime-local" bind:value={validUntil} /></Label
							>
						</div>
						<Label for="review-notes">Review notes</Label><textarea
							id="review-notes"
							bind:value={reviewNotes}
							rows="2"></textarea>
						<div class="actions">
							<Button disabled={!!busy || !targetId} onclick={() => review('approved')}
								><Check size={15} />Approve mapping</Button
							><Button variant="outline" disabled={!!busy} onclick={() => review('dismissed')}
								><X size={15} />Dismiss</Button
							>
						</div>
						{#if focused.proposed_operation && focused.status === 'approved'}<div
								class="review-result"
							>
								<b>Mapped and reviewed</b>
								<p>
									Only applies inside its validity window. Add this operation to your editable
									proposal, then evaluate resident impacts.
								</p>
								<Button onclick={() => onUseNotice(focused!.proposed_operation!)}
									>Use in proposal<ArrowRight size={15} /></Button
								>
							</div>{/if}<small
							>Imported {date(focused.ingested_at)} · checksum {focused.receipt.sha256.slice(
								0,
								12
							)}</small
						>{:else}<p class="muted">
							Review requires an affected road, service or facility and an explicit time window. The
							baseline remains source evidence.
						</p>{/if}</Card.Root
				>
			</div></Tabs.Content
		>
	</Tabs.Root>
</section>

<style>
	.weather-inspector,
	.traffic-inspector {
		display: contents;
	}
	.mobile-map-actions,
	.mobile-inspector-heading {
		display: none;
	}
	.operations-workspace :global(.weather-location-layout .metrics),
	.operations-workspace :global(.weather-location-layout .chart),
	.operations-workspace :global(.weather-location-layout .receipts),
	.operations-workspace :global(.weather-inspector > details),
	.operations-workspace :global(.traffic-location-layout .traffic-results) {
		grid-column: 1 / -1;
	}
	.operations-workspace {
		max-width: 1480px;
		margin: auto;
		padding: 22px 28px 48px;
		color: #282b35;
	}
	.operations-workspace :global(.heading) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 16px;
	}
	.operations-workspace :global(.eyebrow) {
		font-size: 10px;
		letter-spacing: 0.12em;
		font-weight: 700;
		color: #767387;
	}
	.operations-workspace :global(h1) {
		font-size: clamp(22px, 2vw, 28px);
		letter-spacing: -0.045em;
		font-weight: 650;
		margin: 7px 0;
	}
	.operations-workspace :global(h2) {
		font-size: 19px;
		font-weight: 620;
		letter-spacing: -0.03em;
		margin: 8px 0;
	}
	.operations-workspace :global(p) {
		font-size: 13px;
		color: #747483;
		line-height: 1.65;
		margin: 8px 0;
	}
	.operations-workspace :global(.scope),
	.operations-workspace :global(.pill) {
		font-size: 11px;
		background: #ece7f5;
		color: #68578d;
		border-radius: 20px;
		padding: 8px 12px;
	}
	.operations-workspace :global(.pill) {
		padding: 2px 7px;
	}
	.operations-workspace :global(.location) {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 20px 0;
	}
	.operations-workspace :global(.location input) {
		max-width: 135px;
	}
	.operations-workspace :global(.metrics) {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 20px;
		margin: 20px 0;
	}
	.operations-workspace :global(.metric) {
		padding: 25px;
		gap: 8px;
		border: none;
		box-shadow: none;
	}
	.operations-workspace :global(.metric svg) {
		margin-bottom: 8px;
	}
	.operations-workspace :global(.metric span),
	.operations-workspace :global(.metric small) {
		font-size: 12px;
	}
	.operations-workspace :global(.metric strong) {
		font-size: 36px;
		font-weight: 600;
		letter-spacing: -0.04em;
	}
	.operations-workspace :global(.temperature) {
		background: #f0e7fa;
	}
	.operations-workspace :global(.wind) {
		background: #e8f0dc;
	}
	.operations-workspace :global(.sea) {
		background: #e2eef7;
	}
	.operations-workspace :global(.chart),
	.operations-workspace :global(.traffic-card),
	.operations-workspace :global(.notice-import),
	.operations-workspace :global(.notice-review),
	.operations-workspace :global(.receipt) {
		padding: 24px;
		border-color: #e6e4ee;
		box-shadow: none;
		gap: 12px;
	}
	.operations-workspace :global(.card-heading) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}
	.operations-workspace :global(.card-heading > span),
	.operations-workspace :global(.muted),
	.operations-workspace :global(small) {
		font-size: 11px;
		color: #747483;
	}
	.operations-workspace :global(.chart svg) {
		width: 100%;
		margin-top: 12px;
	}
	.operations-workspace :global(.receipts) {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 18px;
		margin: 20px 0;
	}
	.operations-workspace :global(.receipt b) {
		font-size: 13px;
	}
	.operations-workspace :global(.receipt p) {
		font-size: 12px;
	}
	.operations-workspace :global(.receipt a),
	.operations-workspace :global(.notice-review > a) {
		color: #70569c;
		text-decoration: underline;
	}
	.operations-workspace :global(details) {
		padding: 18px;
		background: #f2f1f6;
		border-radius: 14px;
		font-size: 12px;
	}
	.operations-workspace :global(summary) {
		cursor: pointer;
		font-weight: 600;
	}
	.operations-workspace :global(.alerts) {
		display: grid;
		gap: 10px;
		margin-top: 15px;
	}
	.operations-workspace :global(.alerts > div) {
		padding: 10px;
		background: white;
		border-radius: 8px;
	}
	.operations-workspace :global(.traffic-card) {
		margin-top: 0;
		min-width: 0;
		align-self: start;
	}
	.operations-workspace :global(.traffic-location-layout),
	.operations-workspace :global(.weather-location-layout) {
		display: grid;
		grid-template-columns: minmax(0, 1.8fr) minmax(280px, 1fr);
		gap: 18px;
		margin: 20px 0;
		align-items: start;
	}
	.operations-workspace :global(.weather-location-card),
	.operations-workspace :global(.traffic-results) {
		padding: 22px;
		gap: 14px;
		border-color: #dbe3dc;
		box-shadow: none;
		min-width: 0;
	}
	.operations-workspace :global(.weather-location-card h2) {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.operations-workspace :global(.traffic-endpoint-list) {
		display: grid;
		gap: 8px;
	}
	.operations-workspace :global(.traffic-endpoint-list button) {
		justify-content: flex-start;
		width: 100%;
		white-space: normal;
		height: auto;
		min-height: 44px;
		text-align: left;
	}
	.operations-workspace :global(.endpoint-letter) {
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 23px;
		height: 23px;
		flex-shrink: 0;
		border-radius: 50%;
		background: #2d626a;
		color: white;
		font-size: 11px;
	}
	.operations-workspace :global(.endpoint-letter.destination) {
		background: #8761a7;
	}
	.operations-workspace :global(.traffic-results) {
		margin: 18px 0;
	}
	.operations-workspace :global(.traffic-alternatives) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 10px;
	}
	.operations-workspace :global(.traffic-alternatives button) {
		display: grid;
		gap: 7px;
		padding: 15px;
		border: 1px solid #dce4dd;
		border-radius: 12px;
		background: #fbfcf9;
		text-align: left;
		cursor: pointer;
		font-size: 12px;
	}
	.operations-workspace :global(.traffic-alternatives button.selected) {
		background: #eef5ee;
		border-color: #6f9a8b;
	}
	.operations-workspace :global(.traffic-alternatives button:focus-visible) {
		outline: 2px solid #356659;
		outline-offset: 2px;
	}
	.operations-workspace :global(.advanced-coordinates) {
		padding: 12px;
		background: #f5f6f1;
		border: 1px solid #e4e8df;
		border-radius: 10px;
	}
	.operations-workspace :global(.advanced-coordinates summary) {
		font-size: 11px;
		color: #6b756f;
	}
	.operations-workspace :global(.coordinate-grid) {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
		margin: 10px 0;
	}
	.operations-workspace :global(.coordinate-grid label) {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 8px;
	}
	.operations-workspace :global(.table-scroll) {
		overflow: auto;
	}
	.operations-workspace :global(table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.operations-workspace :global(th),
	.operations-workspace :global(td) {
		text-align: left;
		padding: 15px 12px;
		border-bottom: 1px solid #eceaf1;
	}
	.operations-workspace :global(th) {
		font-weight: 500;
		color: #777482;
	}
	.operations-workspace :global(.notice-layout) {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
		gap: 22px;
		margin-top: 20px;
	}
	.operations-workspace :global(.notice-import),
	.operations-workspace :global(.notice-review) {
		align-self: start;
		min-width: 0;
	}
	.operations-workspace :global(.notice-import label),
	.operations-workspace :global(.notice-review label) {
		margin-top: 6px;
	}
	.operations-workspace :global(.notice-review [data-slot='native-select-wrapper']) {
		width: 100%;
	}
	.operations-workspace :global(textarea) {
		font: inherit;
		font-size: 13px;
		width: 100%;
		border: 1px solid #dad7e3;
		border-radius: 8px;
		padding: 10px;
		resize: vertical;
		background: white;
	}
	.operations-workspace :global(textarea:focus-visible) {
		outline: 2px solid #a98bd4;
		outline-offset: 2px;
	}
	.operations-workspace :global(.notice-list) {
		display: grid;
		gap: 8px;
		margin-top: 12px;
	}
	.operations-workspace :global(.notice-list > button) {
		border: 1px solid #e9e6ef;
		border-radius: 10px;
		padding: 13px;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 7px;
		cursor: pointer;
		background: #faf9fc;
	}
	.operations-workspace :global(.notice-list > button.active) {
		border-color: #b79bcf;
		background: #f2edf8;
	}
	.operations-workspace :global(.notice-list b) {
		font-size: 13px;
	}
	.operations-workspace :global(.notice-list span) {
		font-size: 10px;
		color: #747483;
	}
	.operations-workspace :global(blockquote) {
		font-size: 13px;
		line-height: 1.8;
		background: #f5f2f9;
		border-left: 3px solid #bc9ada;
		padding: 16px;
		border-radius: 0 10px 10px 0;
		margin: 8px 0;
	}
	.operations-workspace :global(.actions) {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
	.operations-workspace :global(.review-result) {
		background: #edf3e6;
		padding: 18px;
		border-radius: 12px;
	}
	.operations-workspace :global(.review-result b) {
		font-size: 13px;
	}
	.operations-workspace :global(.error),
	.operations-workspace :global(.success) {
		padding: 13px 16px;
		border-radius: 9px;
		margin: 14px 0;
	}
	.operations-workspace :global(.error) {
		background: #fbe9e8;
		color: #9c3328;
	}
	.operations-workspace :global(.success) {
		background: #edf4e4;
		color: #3d6633;
	}
	.operations-workspace :global([data-slot='tabs-list']) {
		max-width: 100%;
	}
	@media (max-width: 800px) {
		.operations-workspace :global(.traffic-location-layout),
		.operations-workspace :global(.weather-location-layout) {
			grid-template-columns: 1fr;
		}
		.operations-workspace {
			padding: 24px 20px 45px;
		}
		.operations-workspace :global(.heading) {
			align-items: flex-start;
			flex-direction: column;
		}
		.operations-workspace :global(.metrics) {
			gap: 12px;
		}
		.operations-workspace :global(.metric) {
			padding: 18px;
		}
		.operations-workspace :global(.metric strong) {
			font-size: 26px;
		}
		.operations-workspace :global(.notice-layout),
		.operations-workspace :global(.receipts) {
			grid-template-columns: 1fr;
		}
		.operations-workspace :global(.location) {
			flex-wrap: wrap;
		}
		.operations-workspace :global(.coordinate-grid) {
			gap: 12px;
		}
		.operations-workspace :global(.card-heading) {
			align-items: flex-start;
		}
		.operations-workspace :global(.scope) {
			align-self: flex-start;
		}
	}
	@media (max-width: 480px) {
		.operations-workspace {
			padding: 18px 14px 35px;
		}
		.operations-workspace :global(.metrics) {
			grid-template-columns: 1fr;
		}
		.operations-workspace :global(.metric) {
			display: grid;
			grid-template-columns: auto 1fr;
			align-items: center;
			gap: 6px 16px;
		}
		.operations-workspace :global(.metric strong) {
			grid-column: 2;
		}
		.operations-workspace :global(.metric small) {
			grid-column: 2;
		}
		.operations-workspace :global(.metric svg) {
			grid-row: 1/4;
			margin: 0;
		}
		.operations-workspace :global(.card-heading) {
			flex-direction: column;
		}
		.operations-workspace :global(.chart),
		.operations-workspace :global(.traffic-card),
		.operations-workspace :global(.notice-import),
		.operations-workspace :global(.notice-review),
		.operations-workspace :global(.receipt) {
			padding: 18px;
		}
		.operations-workspace :global(.coordinate-grid) {
			grid-template-columns: 1fr;
		}
		.operations-workspace :global([data-slot='tabs-list']) {
			width: 100%;
			height: auto;
			flex-wrap: wrap;
		}
		.operations-workspace :global([data-slot='tabs-trigger']) {
			font-size: 11px;
			white-space: normal;
		}
	}
	@media (max-width: 640px) {
		.operations-workspace {
			padding: 10px 10px 14px;
		}
		.operations-workspace :global(.heading) {
			margin: 0 0 8px;
			gap: 0;
		}
		.operations-workspace :global(.heading .eyebrow),
		.operations-workspace :global(.heading p),
		.operations-workspace :global(.heading .scope) {
			display: none;
		}
		.operations-workspace :global(.heading h1) {
			font-size: 18px;
			margin: 0;
			letter-spacing: -0.03em;
		}
		.operations-workspace :global([data-slot='tabs-list']) {
			height: 38px;
			width: 100%;
			flex-wrap: nowrap;
		}
		.operations-workspace :global([data-slot='tabs-trigger']) {
			font-size: 10px;
			padding: 6px 8px;
			white-space: nowrap;
			flex: 1;
		}
		.operations-workspace :global(.traffic-location-layout),
		.operations-workspace :global(.weather-location-layout) {
			margin: 8px 0 0;
			gap: 0;
		}
		.mobile-map-actions {
			display: flex;
			align-items: center;
			gap: 7px;
			margin: 8px 0;
		}
		.mobile-map-actions :global(button) {
			min-height: 38px;
			font-size: 12px;
			flex: 1;
		}
		.operations-workspace :global(.location-map-stage) {
			height: clamp(255px, calc(100dvh - 485px), 345px);
			min-height: 255px;
		}
		.operations-workspace :global(.location-map .point-toolbar) {
			padding: 7px;
			gap: 5px;
		}
		.operations-workspace :global(.location-map .point-toolbar button) {
			min-height: 30px;
			height: 30px;
			font-size: 10px;
		}
		.operations-workspace :global(.location-map .map-source) {
			font-size: 9px;
			padding: 6px 9px;
		}
		.weather-inspector,
		.traffic-inspector {
			display: none;
		}
		.weather-inspector.inspector-open,
		.traffic-inspector.inspector-open {
			display: flex;
			flex-direction: column;
			position: fixed;
			z-index: 65;
			inset: auto 8px 8px;
			height: 62dvh;
			min-height: 300px;
			padding: 10px;
			overflow-y: auto;
			overscroll-behavior: contain;
			background: #fffdf8;
			border: 1px solid #cad8cf;
			border-radius: 18px;
			box-shadow: 0 -8px 40px #24403433;
		}
		.weather-inspector.expanded,
		.traffic-inspector.expanded {
			height: calc(100dvh - 20px);
		}
		.mobile-inspector-heading {
			display: flex;
			flex-shrink: 0;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
			order: 0;
			position: sticky;
			top: -10px;
			z-index: 1;
			background: #fffdf8;
			padding: 5px 3px 9px;
			border-bottom: 1px solid #e0e7dd;
			font-size: 13px;
		}
		.mobile-inspector-heading > div {
			display: flex;
			gap: 5px;
		}
		.mobile-inspector-heading :global(button) {
			width: 34px;
			height: 34px;
		}
		.operations-workspace :global(.traffic-inspector .traffic-results) {
			order: 1;
			flex-shrink: 0;
			margin: 0;
			border: 0;
			padding: 13px 5px;
		}
		.operations-workspace :global(.traffic-inspector .traffic-card) {
			order: 2;
			flex-shrink: 0;
			padding: 13px 5px;
			border: 0;
		}
		.operations-workspace :global(.weather-inspector .metrics) {
			order: 1;
			margin: 12px 0;
			flex-shrink: 0;
		}
		.operations-workspace :global(.weather-inspector .chart) {
			order: 2;
			padding: 13px;
			flex-shrink: 0;
		}
		.operations-workspace :global(.weather-inspector .weather-location-card) {
			order: 3;
			padding: 13px;
			margin-top: 10px;
			flex-shrink: 0;
		}
		.operations-workspace :global(.weather-inspector .receipts) {
			order: 4;
			margin: 12px 0;
			flex-shrink: 0;
		}
		.operations-workspace :global(.weather-inspector > details) {
			order: 5;
			flex-shrink: 0;
		}
		.operations-workspace :global(.error),
		.operations-workspace :global(.success) {
			margin: 8px 0;
			padding: 8px 10px;
			font-size: 11px;
		}
	}
</style>
