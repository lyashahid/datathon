<script lang="ts">
	import { downloadText } from '#lib/download.js';
	import { onMount, untrack } from 'svelte';
	import {
		ArrowRight,
		Download,
		Plus,
		Route,
		Trash2,
		Users,
		PanelRightClose,
		PanelRightOpen,
		Maximize2,
		Minimize2,
		MapPin,
		ArrowLeft,
		Undo2
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { api, subscribeApiInvalidation } from '#lib/api.js';
	import DeliveryCalibration from '#lib/components/DeliveryCalibration.svelte';
	import PlanningMap from '#lib/components/PlanningMap.svelte';
	import type { Coordinates, MapFeatures } from '#lib/types.js';
	import type { CalibrationRecord, FleetResources, ResourceAudit } from '#lib/planning-delivery.js';

	type Origin = { id: string; islandId: string; lon: number; lat: number; population2026: number };
	type Facility = {
		id: string;
		name: string;
		kind: string;
		operatingStatus?: string;
		islandId: string;
		lon: number;
		lat: number;
	};
	type Stop = {
		id: string;
		name?: string;
		islandId: string;
		lon: number;
		lat: number;
		kind?: string;
	};
	type Pattern = {
		id: string;
		routeId: string;
		name: string;
		mode: string;
		fleet?: string;
		stopIds: string[];
		timing: unknown;
		calendar: unknown;
		geometry?: number[][];
	};
	type Edge = {
		id: string;
		name?: string;
		from: string;
		to: string;
		distanceM: number;
		sourceOsmWayId?: string;
		geometry?: number[][];
	};
	type Operation = {
		type: string;
		target_id?: string;
		island_id?: string;
		coordinates?: number[];
		name?: string;
		opening_date?: string;
		headway_minutes?: number;
		minutes?: number;
		fleet?: string;
		disabled_modes?: string[];
		service?: Record<string, unknown>;
		metadata?: Record<string, unknown>;
	};
	type Baseline = {
		status: string;
		planning_island_id: string;
		reference_date: string;
		counts: Record<string, number>;
		origins: Origin[];
		facilities: Facility[];
		stops: Stop[];
		patterns: Pattern[];
		graph_edges: Edge[];
		warnings: string[];
		population_basis: string;
		cost_defaults: Record<string, number>;
		islands: { id: string; name: string }[];
		source_receipts: { path: string; sha256: string }[];
	};
	type Leg = {
		mode: string;
		from: string;
		to: string;
		minutes: number;
		wait_minutes: number;
		pattern_id?: string;
		geometry: number[][];
	};
	type Journey = {
		status: string;
		minutes: number | null;
		destination_id: string | null;
		reason: string | null;
		path: Leg[];
		geometry: number[][];
	};
	type Band = { label: string; residents: number | null };
	type RouteActivity = {
		route_id: string;
		activity_id: string;
		name: string;
		mode: string;
		fleet_type: string;
		departures: number;
		required_fleet: number;
		procurement_fleet: number;
		annual_vehicle_km: number | null;
		service_day_vehicle_km: number | null;
		warnings: string[];
		resource_audit?: ResourceAudit;
		blocks: {
			vehicle: number;
			start: number;
			end: number;
			from: string;
			to: string;
			trip: string;
		}[];
	};
	type Economics = {
		currency: string;
		basis: string;
		before: Record<string, number | null>;
		after: Record<string, number | null>;
		delta: Record<string, number | null>;
		budget: Record<string, number | boolean | null>;
		assumptions: Record<string, number>;
		calibration?: {
			factor_basis: Record<string, string>;
			derived: { factor: string; value: number; formula: string; inputs: Record<string, number> }[];
			meaning: string;
		};
		sensitivity: { capital_mvr: { low: number; central: number; high: number }; meaning: string };
		fleets: {
			before: { routes: RouteActivity[]; required_fleet: number };
			after: { routes: RouteActivity[]; required_fleet: number };
		};
		warnings: string[];
	};
	type Comparison = {
		origin_id: string;
		population: number;
		coordinates: number[];
		before: Journey;
		after: Journey;
		delta_minutes: number | null;
		gained_access: boolean;
		lost_access: boolean;
		became_unavailable: boolean;
	};
	type Evaluation = {
		status: string;
		summary: Record<string, number | null>;
		travel_time_bands: { before: Band[]; after: Band[] };
		origins: Comparison[];
		economics: Economics;
		warnings: string[];
		coverage: { service_date: string; bus_calendar: string; meaning: string };
		assumptions: unknown;
		source_receipts: unknown;
		version_pins: unknown;
		population_basis: string;
		access_method: string;
	};
	type Appointment = {
		status: string;
		outward: Journey;
		return_journey: Journey | null;
		home_at_minutes: number | null;
		return_departure_minutes?: number;
		meets_deadline: boolean | null;
		warnings: string[];
		destination?: Facility;
	};
	type Timetable = {
		patterns: {
			id: string;
			name: string;
			mode: string;
			stop_ids: string[];
			trips: { id: string; stopTimes: { arrivalMinutes: number; departureMinutes: number }[] }[];
		}[];
		official_ferry_calendars: {
			id: string;
			route: string;
			routingEligible: boolean;
			crossingMinutes: number | null;
			limitations: string[];
			dayTypes: {
				label: string;
				departuresFromMale?: string[];
				departuresFromIsland?: string[];
				frequencyWindows?: { start: string; end: string; headwayMinutes: number }[];
				noScheduledService?: boolean;
			}[];
		}[];
	};

	let {
		islandId,
		scenario,
		mapFeatures = null,
		active = true,
		incomingPlacement = null,
		incomingOperation = null,
		onConsume = () => {},
		onExplore = () => {}
	}: {
		islandId: string;
		scenario?: unknown;
		mapFeatures?: MapFeatures | null;
		active?: boolean;
		incomingPlacement?: {
			id: number;
			latitude: number;
			longitude: number;
			kind?: 'add_hospital' | 'add_school' | 'add_stop';
		} | null;
		incomingOperation?: Record<string, unknown> | null;
		onConsume?: () => void;
		onExplore?: () => void;
	} = $props();
	let mounted = $state(false);
	let sourceDirty = $state(false);
	let loadedIsland = '';
	let scope = $state('');
	let baseline = $state<Baseline | null>(null);
	let loading = $state(false);
	let busy = $state(false);
	let busyKind = $state<'evaluation' | 'journey' | 'timetable' | null>(null);
	let error = $state('');
	let view = $state('design');
	let inspectorOpen = $state(false);
	let inspectorExpanded = $state(false);
	let composerOpen = $state(false);
	let editingIndex = $state<number | null>(null);
	let consumedPlacement = $state<number | null>(null);
	let mapNotice = $state('Click the map to choose a place. Confirm it when you are ready.');
	let date = $state('2026-10-10');
	let departure = $state('15:20');
	let target = $state(30);
	let goal = $state<'healthcare' | 'education'>('healthcare');
	let populationYear = $state('2026');
	let operations = $state<Operation[]>([]);
	let changeHistory = $state<Operation[][]>([]);
	let operationType = $state('add_hospital');
	let facilityName = $state('New community hospital');
	let longitude = $state(73.5097);
	let latitude = $state(4.1744);
	let openingDate = $state('2026-10-10');
	let facilityAnnualEmissions = $state<number | undefined>(undefined);
	let facilityEmbodiedEmissions = $state<number | undefined>(undefined);
	let targetId = $state('');
	let serviceHeadway = $state(15);
	let timetableShift = $state(10);
	let fleetType = $state('electric');
	let serviceJson = $state('');
	let proposalIsland = $state('male');
	let serviceMode = $state('bus');
	let serviceFrom = $state('');
	let serviceTo = $state('');
	let servicePick = $state<'from' | 'to'>('from');
	let serviceStart = $state('06:00');
	let serviceEnd = $state('20:00');
	let serviceRuntime = $state(15);
	let serviceDistanceKm = $state(2);
	let serviceReturn = $state(true);
	let serviceRecurring = $state(false);
	let includeStructural = $state(false);
	let wheelchair = $state(false);
	let walkSpeed = $state(80);
	let operatingDays = $state(300);
	let capitalBudget = $state(150000000);
	let annualBudget = $state(25000000);
	let displacedPassengerKm = $state(0);
	let costOverrides = $state<Record<string, number>>({});
	let energyOverrides = $state<Record<string, number>>({});
	let calibrationRecords = $state<CalibrationRecord[]>([]);
	let calibrationSelection = $state<Record<string, string>>({});
	let fleetResources = $state<FleetResources[]>([]);
	let evaluation = $state<Evaluation | null>(null);
	let evaluatedSignature = $state('');
	let originId = $state('');
	let destinationId = $state('');
	let appointmentMinutes = $state(60);
	let returnDeadline = $state('20:00');
	let appointment = $state<Appointment | null>(null);
	let appointmentSignature = $state('');
	let timetable = $state<Timetable | null>(null);
	let timetableSignature = $state('');
	let selectedPattern = $state('');
	let residentFilter = $state('all');
	let residentPage = $state(0);
	let controller: AbortController | undefined;
	let actionController: AbortController | undefined;
	let importInput = $state<HTMLInputElement | null>(null);
	let mapRegion = $state<HTMLElement | null>(null);
	let mapLayout = $state<HTMLDivElement | null>(null);
	let inspectorElement = $state<HTMLDivElement | null>(null);
	let availableMapHeight = $state(460);
	let sequence = 0;
	$effect(() => {
		void view;
		if (!inspectorOpen || !inspectorElement) return;
		const element = inspectorElement;
		const frame = requestAnimationFrame(() => {
			element.scrollTop = 0;
		});
		return () => cancelAnimationFrame(frame);
	});
	$effect(() => {
		const element = mapLayout;
		if (!element) return;
		const measure = () => {
			const top = element.getBoundingClientRect().top + window.scrollY;
			availableMapHeight = Math.max(360, Math.floor(window.innerHeight - top - 18));
		};
		measure();
		const observer = new ResizeObserver(measure);
		for (const sibling of element.parentElement?.children ?? [])
			if (sibling !== element) observer.observe(sibling);
		window.addEventListener('resize', measure);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', measure);
		};
	});
	const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
	const number = (value: number | null | undefined) =>
		value == null ? 'Unavailable' : integerFormat.format(value);
	const residentAreaNames = $derived.by(() => {
		const names: Record<string, string> = {};
		for (const island of baseline?.islands ?? []) {
			const areas = (baseline?.origins ?? [])
				.filter((origin) => origin.islandId === island.id)
				.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
			areas.forEach((origin, index) => {
				names[origin.id] = `${island.name} · Area ${index + 1}`;
			});
		}
		return names;
	});
	const mapOrigins = $derived(
		(baseline?.origins ?? []).map((origin) => ({
			...origin,
			name: residentAreaNames[origin.id] ?? 'Modeled resident area'
		}))
	);
	const minutes = (value: number | null | undefined) =>
		value == null ? 'Unavailable' : `${value.toFixed(1)} min`;
	const minuteValue = (clock: string) => {
		const [hours, mins] = clock.split(':').map(Number);
		return hours * 60 + mins;
	};
	const clock = (value: number | null | undefined) => {
		if (value == null) return '—';
		const rounded = Math.round(value);
		return `${Math.floor(rounded / 1440) ? `Day +${Math.floor(rounded / 1440)} · ` : ''}${String(Math.floor((rounded % 1440) / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
	};
	const label = (value: string) => value.replaceAll('_', ' ');
	function operationTitle(operation: Operation) {
		if (operation.name) return operation.name;
		if (typeof operation.service?.name === 'string') return operation.service.name;
		const target = [
			...(baseline?.facilities ?? []),
			...(baseline?.patterns ?? []),
			...(baseline?.stops ?? []),
			...(baseline?.graph_edges ?? [])
		].find((item) => item.id === operation.target_id);
		const actions: Record<string, string> = {
			disable_facility: 'Close destination',
			disable_service: 'Suspend service',
			disable_stop: 'Close stop',
			enable_service: 'Restore service',
			enable_stop: 'Restore stop',
			road_closure: 'Close road',
			set_fleet: 'Change propulsion',
			shift_timetable: 'Change departure times',
			set_service_frequency: 'Change service frequency'
		};
		const action = actions[operation.type] ?? label(operation.type);
		return target?.name ? `${action} · ${target.name}` : action;
	}
	const request = $derived({
		island_id: scope,
		assumptions: {
			date,
			departure_minutes: minuteValue(departure),
			target_minutes: Number(target),
			goal,
			population_year: Number(populationYear),
			walk_m_per_minute: Number(walkSpeed),
			require_audited_wheelchair: wheelchair,
			annual_operating_days: Number(operatingDays),
			capital_budget_mvr: Number(capitalBudget),
			annual_operating_budget_mvr: Number(annualBudget),
			displaced_passenger_km: Number(displacedPassengerKm),
			cost_overrides: costOverrides,
			energy_overrides: energyOverrides,
			calibration_records: calibrationRecords,
			calibration_selection: calibrationSelection,
			fleet_resources: fleetResources
		},
		operations,
		...(includeStructural && scenario ? { scenario } : {})
	});
	const signature = $derived(JSON.stringify(request));
	const appointmentInputs = $derived(
		JSON.stringify({ signature, originId, destinationId, appointmentMinutes, returnDeadline })
	);
	const stale = $derived(evaluation !== null && signature !== evaluatedSignature);
	const journeyStale = $derived(appointment !== null && appointmentSignature !== appointmentInputs);
	const mapStatus = $derived(
		busy ? 'calculating' : stale ? 'stale' : evaluation ? 'latest' : 'draft'
	);
	const stepTitle = $derived(
		view === 'design'
			? 'Your proposed changes'
			: view === 'access'
				? 'Review resident impact'
				: view === 'journeys'
					? 'Plan an outward and return journey'
					: 'Budget and services'
	);
	const siteDistance = $derived.by(() => {
		if (
			!baseline ||
			!composerOpen ||
			!['add_hospital', 'add_school', 'add_stop'].includes(operationType)
		)
			return null;
		const scaleX = 111320 * Math.cos((Number(latitude) * Math.PI) / 180);
		const scaleY = 111320;
		let nearest = Infinity;
		for (const edge of baseline.graph_edges) {
			const points = edge.geometry ?? [];
			for (let index = 1; index < points.length; index++) {
				const a = points[index - 1],
					b = points[index];
				if (!a?.every(Number.isFinite) || !b?.every(Number.isFinite)) continue;
				const ax = (a[0] - Number(longitude)) * scaleX,
					ay = (a[1] - Number(latitude)) * scaleY;
				const bx = (b[0] - Number(longitude)) * scaleX,
					by = (b[1] - Number(latitude)) * scaleY;
				const dx = bx - ax,
					dy = by - ay;
				const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
				nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
			}
		}
		return Number.isFinite(nearest) ? nearest : null;
	});
	const mapFacilities = $derived([
		...(baseline?.facilities ?? []),
		...operations.flatMap((operation, index) =>
			['add_hospital', 'add_school'].includes(operation.type) && operation.coordinates?.length === 2
				? [
						{
							id: String(operation.metadata?.proposal_id || `proposal:${operation.type}:${index}`),
							name: operation.name || 'Proposed destination',
							kind: operation.type === 'add_school' ? 'school' : 'hospital',
							islandId: operation.island_id || proposalIsland,
							lon: operation.coordinates[0],
							lat: operation.coordinates[1],
							operatingStatus: 'proposed · opening date applies'
						}
					]
				: []
		)
	]);
	const targets = $derived(
		operationType === 'disable_facility'
			? (baseline?.facilities ?? []).map((x) => ({ id: x.id, name: x.name }))
			: operationType === 'road_closure'
				? (baseline?.graph_edges ?? []).map((x) => ({
						id: x.id,
						name: `${x.name || 'Unnamed road'} · ${x.id}`
					}))
				: operationType === 'disable_stop'
					? (baseline?.stops ?? []).map((x) => ({ id: x.id, name: x.name || x.id }))
					: (baseline?.patterns ?? []).map((x) => ({ id: x.id, name: x.name }))
	);
	const residents = $derived(
		(evaluation?.origins ?? []).filter(
			(x) =>
				residentFilter === 'all' ||
				(residentFilter === 'gained' && x.gained_access) ||
				(residentFilter === 'lost' && x.lost_access) ||
				(residentFilter === 'unknown' && x.after.status !== 'reachable')
		)
	);
	const shownResidents = $derived(residents.slice(residentPage * 8, residentPage * 8 + 8));
	const activeTimetable = $derived(
		timetable?.patterns.find((x) => x.id === selectedPattern) ?? timetable?.patterns[0]
	);
	const maximumBand = $derived(
		Math.max(
			1,
			...(evaluation
				? [...evaluation.travel_time_bands.before, ...evaluation.travel_time_bands.after].map(
						(x) => x.residents ?? 0
					)
				: [])
		)
	);
	const relevantCostKeys = [
		'hospital_capital_mvr',
		'school_capital_mvr',
		'hospital_annual_operating_mvr',
		'school_annual_operating_mvr',
		'stop_capital_mvr',
		'diesel_bus_capital_mvr',
		'electric_bus_capital_mvr',
		'diesel_operating_mvr_per_km',
		'electric_operating_mvr_per_km',
		'diesel_kg_co2e_per_km',
		'electric_kg_co2e_per_km'
	];
	const proposedStops = $derived(
		operations.flatMap((operation, index) =>
			operation.type === 'add_stop'
				? [
						{
							id: String(operation.metadata?.proposal_id || `proposal:add_stop:${index}`),
							name: operation.name || 'Proposed stop',
							islandId: operation.island_id || proposalIsland,
							lon: operation.coordinates?.[0] ?? NaN,
							lat: operation.coordinates?.[1] ?? NaN
						}
					]
				: []
		)
	);
	const serviceStops = $derived([...(baseline?.stops ?? []), ...proposedStops]);
	const serviceActivities = $derived.by(() => {
		const all = [
			...(baseline?.patterns ?? []),
			...operations.flatMap((operation) => {
				const service = operation.service;
				return service &&
					typeof service.routeId === 'string' &&
					typeof service.name === 'string' &&
					typeof service.mode === 'string'
					? [service]
					: [];
			})
		];
		const unique: Record<string, { id: string; name: string; fleet: string }> = {};
		for (const pattern of all) {
			const fleet = pattern.mode === 'ferry' ? 'ferry' : String(pattern.fleet || 'diesel');
			const id = `${pattern.routeId}|${pattern.mode}|${fleet}`;
			unique[id] = { id, name: String(pattern.name), fleet };
		}
		for (const route of evaluation?.economics.fleets.after.routes ?? [])
			unique[route.activity_id] = {
				id: route.activity_id,
				name: route.name,
				fleet: route.fleet_type
			};
		return Object.values(unique);
	});

	async function loadBaseline(nextScope: string, preserveDraft = false) {
		controller?.abort();
		actionController?.abort();
		actionController = undefined;
		busy = false;
		busyKind = null;
		const baselineController = new AbortController();
		controller = baselineController;
		const current = ++sequence;
		loading = true;
		error = '';
		baseline = null;
		evaluation = null;
		appointment = null;
		timetable = null;
		destinationId = '';
		editingIndex = null;
		composerOpen = false;
		servicePick = 'from';
		if (!preserveDraft) {
			operations = [];
			changeHistory = [];
			costOverrides = {};
			energyOverrides = {};
			calibrationRecords = [];
			calibrationSelection = {};
			fleetResources = [];
		}
		try {
			const data = await api<Baseline>(
				`planning/baseline?island_id=${encodeURIComponent(nextScope)}`,
				undefined,
				baselineController.signal
			);
			if (current !== sequence) return;
			baseline = data;
			originId = '';
			targetId = data.patterns[0]?.id ?? '';
			proposalIsland = data.planning_island_id || 'male';
			serviceFrom = data.stops[0]?.id ?? '';
			serviceTo = data.stops[1]?.id ?? '';
			const origin = data.origins[Math.floor(data.origins.length / 2)];
			if (origin) {
				longitude = origin.lon;
				latitude = origin.lat;
			}
			const saved = preserveDraft
				? null
				: localStorage.getItem(`policy-workbench-v1:${nextScope || 'greater-male'}`);
			if (saved) {
				try {
					restoreOption(JSON.parse(saved));
				} catch {
					localStorage.removeItem(`policy-workbench-v1:${nextScope || 'greater-male'}`);
				}
			}
		} catch (cause) {
			if (current === sequence && !baselineController.signal.aborted)
				error = cause instanceof Error ? cause.message : 'Planning snapshot failed to load';
		} finally {
			if (current === sequence) loading = false;
		}
	}
	$effect(() => {
		const island = islandId;
		if (!mounted || !active || !island) return;
		void sourceDirty;
		untrack(() => {
			if (loadedIsland !== island) {
				loadedIsland = island;
				scope = island;
				sourceDirty = false;
				void loadBaseline(island);
			} else if (sourceDirty) {
				sourceDirty = false;
				void loadBaseline(scope, true);
			}
		});
	});
	$effect(() => {
		if (
			mounted &&
			incomingPlacement &&
			baseline &&
			!loading &&
			consumedPlacement !== incomingPlacement.id
		) {
			const placement = incomingPlacement;
			untrack(() => {
				consumedPlacement = placement.id;
				if (!Number.isFinite(placement.longitude) || !Number.isFinite(placement.latitude)) return;
				startPlacement(placement.kind ?? 'add_school', [placement.longitude, placement.latitude]);
			});
		}
	});
	$effect(() => {
		if (mounted && incomingOperation && baseline && !loading) {
			const operation = incomingOperation as unknown as Operation;
			untrack(() => {
				const noticeId = operation.metadata?.notice_id;
				const existing = noticeId
					? operations.findIndex((item) => item.metadata?.notice_id === noticeId)
					: -1;
				operations =
					existing >= 0
						? operations.map((item, index) => (index === existing ? operation : item))
						: [...operations, operation];
				evaluation = null;
				view = 'design';
				inspectorOpen = true;
				if (
					operation.target_id &&
					![
						...(baseline?.graph_edges ?? []),
						...(baseline?.patterns ?? []),
						...(baseline?.facilities ?? [])
					].some((item) => item.id === operation.target_id)
				) {
					error =
						'This reviewed notice targets another planning area. Its source ID is retained; switch to all Greater Malé to inspect the full effect.';
				}
				onConsume();
			});
		}
	});
	$effect(() => {
		if (mounted && baseline && !loading) {
			try {
				localStorage.setItem(`policy-workbench-v1:${scope || 'greater-male'}`, signature);
			} catch {
				/* The option remains usable when browser draft storage is unavailable. */
			}
		}
	});
	onMount(() => {
		mounted = true;
		const unsubscribe = subscribeApiInvalidation(() => {
			sequence++;
			controller?.abort();
			actionController?.abort();
			actionController = undefined;
			busy = false;
			busyKind = null;
			baseline = null;
			evaluation = null;
			appointment = null;
			timetable = null;
			composerOpen = false;
			editingIndex = null;
			sourceDirty = true;
			mapNotice =
				'Source evidence changed. Recalculate to review this proposal against the updated data.';
		});
		return () => {
			unsubscribe();
			sequence++;
			controller?.abort();
			actionController?.abort();
		};
	});
	function restoreOption(value: unknown) {
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new Error('Import a policy scenario object');
		const data = value as { operations?: unknown; assumptions?: Record<string, unknown> };
		const evidence = data.assumptions?.calibration_records;
		if (
			evidence !== undefined &&
			(!Array.isArray(evidence) ||
				evidence.length > 100 ||
				evidence.some((item) => {
					if (
						!item ||
						typeof item !== 'object' ||
						typeof item.id !== 'string' ||
						typeof item.factor !== 'string' ||
						typeof item.title !== 'string' ||
						typeof item.source_url !== 'string' ||
						typeof item.value !== 'number' ||
						!Number.isFinite(item.value)
					)
						return true;
					try {
						return !['http:', 'https:'].includes(new URL(item.source_url).protocol);
					} catch {
						return true;
					}
				}))
		)
			throw new Error(
				'Scenario calibration records require valid IDs, numeric values and HTTP source links'
			);
		const fleetPlans = data.assumptions?.fleet_resources;
		if (
			fleetPlans !== undefined &&
			(!Array.isArray(fleetPlans) ||
				fleetPlans.length > 100 ||
				fleetPlans.some(
					(item) => !item || typeof item !== 'object' || typeof item.activity_id !== 'string'
				))
		)
			throw new Error('Scenario fleet resources require up to 100 identified service activities');
		if (
			!Array.isArray(data.operations) ||
			data.operations.length > 100 ||
			data.operations.some(
				(operation) =>
					!operation || typeof operation !== 'object' || typeof operation.type !== 'string'
			)
		)
			throw new Error('The scenario needs up to 100 valid planning operations');
		// Migrate position-based IDs before edits can shift their dependent services.
		const replacements: Record<string, string> = {};
		const imported = (data.operations as Operation[]).map((operation, index) => {
			if (!['add_hospital', 'add_school', 'add_stop'].includes(operation.type)) return operation;
			const oldId = `proposal:${operation.type}:${index}`;
			const proposalId = String(
				operation.metadata?.proposal_id || `proposal:${operation.type}:${crypto.randomUUID()}`
			);
			replacements[oldId] = proposalId;
			return { ...operation, metadata: { ...operation.metadata, proposal_id: proposalId } };
		});
		operations = imported.map((operation) => ({
			...operation,
			...(operation.target_id
				? { target_id: replacements[operation.target_id] || operation.target_id }
				: {}),
			...(Array.isArray(operation.service?.stopIds)
				? {
						service: {
							...operation.service,
							stopIds: operation.service.stopIds.map((id: unknown) =>
								typeof id === 'string' ? replacements[id] || id : id
							)
						}
					}
				: {})
		}));
		const a = data.assumptions ?? {};
		if (typeof a.date === 'string') date = a.date;
		if (typeof a.departure_minutes === 'number')
			departure = clock(a.departure_minutes).split(' · ').at(-1) || '15:20';
		if (typeof a.target_minutes === 'number') target = a.target_minutes;
		if (a.goal === 'healthcare' || a.goal === 'education') goal = a.goal;
		if (a.population_year === 2026 || a.population_year === 2030)
			populationYear = String(a.population_year);
		if (typeof a.walk_m_per_minute === 'number') walkSpeed = a.walk_m_per_minute;
		if (typeof a.annual_operating_days === 'number') operatingDays = a.annual_operating_days;
		if (typeof a.capital_budget_mvr === 'number') capitalBudget = a.capital_budget_mvr;
		if (typeof a.annual_operating_budget_mvr === 'number')
			annualBudget = a.annual_operating_budget_mvr;
		if (typeof a.displaced_passenger_km === 'number')
			displacedPassengerKm = a.displaced_passenger_km;
		if (typeof a.require_audited_wheelchair === 'boolean')
			wheelchair = a.require_audited_wheelchair;
		if (a.cost_overrides && typeof a.cost_overrides === 'object')
			costOverrides = a.cost_overrides as Record<string, number>;
		energyOverrides =
			a.energy_overrides && typeof a.energy_overrides === 'object'
				? (a.energy_overrides as Record<string, number>)
				: {};
		calibrationRecords = Array.isArray(a.calibration_records)
			? (a.calibration_records as CalibrationRecord[])
			: [];
		calibrationSelection =
			a.calibration_selection && typeof a.calibration_selection === 'object'
				? (a.calibration_selection as Record<string, string>)
				: {};
		fleetResources = Array.isArray(a.fleet_resources)
			? (a.fleet_resources as FleetResources[])
			: [];
		evaluation = null;
		appointment = null;
		timetable = null;
	}
	async function importOption(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		try {
			if (file.size > 3_000_000) throw new Error('Use a scenario smaller than 3 MB');
			restoreOption(JSON.parse(await file.text()));
			error = '';
			view = 'design';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Scenario import failed';
		} finally {
			if (importInput) importInput.value = '';
		}
	}

	function rememberChanges() {
		changeHistory = [...changeHistory.slice(-19), JSON.parse(JSON.stringify(operations))];
	}
	function cancelPlacement() {
		composerOpen = false;
		editingIndex = null;
		error = '';
		mapNotice = 'Preview cancelled. Your confirmed changes are still saved.';
	}
	function undoChange() {
		const previous = changeHistory.at(-1);
		if (!previous) return;
		operations = previous;
		changeHistory = changeHistory.slice(0, -1);
		cancelPlacement();
		mapNotice = 'Last change undone. Review impact to update the comparison.';
	}
	function clearDraft() {
		if (!operations.length) return;
		rememberChanges();
		operations = [];
		cancelPlacement();
		mapNotice = 'Draft cleared. Use Undo to restore your changes.';
	}
	function removeChange(index: number) {
		rememberChanges();
		operations = operations.filter((_, i) => i !== index);
		if (editingIndex === index) cancelPlacement();
		else if (editingIndex !== null && editingIndex > index) editingIndex--;
		mapNotice = 'Change removed. Use Undo to bring it back.';
	}
	function startServiceChange() {
		operationType = 'add_service';
		facilityName = 'Proposed connection';
		editingIndex = null;
		composerOpen = true;
		openStep('design');
	}
	function addOperation() {
		try {
			const operation: Operation = { type: operationType, island_id: proposalIsland };
			if (['add_hospital', 'add_school', 'add_stop'].includes(operationType)) {
				if (!composerOpen) throw new Error('Choose a location on the map first.');
				if (
					!Number.isFinite(Number(longitude)) ||
					!Number.isFinite(Number(latitude)) ||
					Math.abs(Number(longitude)) > 180 ||
					Math.abs(Number(latitude)) > 90
				)
					throw new Error('Choose a valid location on the map.');
				if (!facilityName.trim()) throw new Error('Give the proposed location a name.');
				operation.coordinates = [Number(longitude), Number(latitude)];
				operation.name = facilityName.trim();
				if (operationType !== 'add_stop')
					goal = operationType === 'add_school' ? 'education' : 'healthcare';
				operation.metadata = {
					...(editingIndex !== null ? operations[editingIndex]?.metadata : {}),
					proposal_id:
						editingIndex !== null
							? operations[editingIndex]?.metadata?.proposal_id
							: `proposal:${operationType}:${crypto.randomUUID()}`
				};
				if (operationType !== 'add_stop') {
					operation.opening_date = openingDate;
					operation.metadata.costs = {
						...(facilityAnnualEmissions !== undefined
							? { annual_operating_kg_co2e: Number(facilityAnnualEmissions) }
							: {}),
						...(facilityEmbodiedEmissions !== undefined
							? { embodied_kg_co2e: Number(facilityEmbodiedEmissions) }
							: {})
					};
				}
			} else if (operationType === 'add_service') {
				if (serviceJson.trim()) {
					const imported: unknown = JSON.parse(serviceJson);
					if (!imported || typeof imported !== 'object' || Array.isArray(imported))
						throw new Error('Import one complete service pattern');
					operation.service = imported as Record<string, unknown>;
				} else {
					if (!serviceFrom || !serviceTo || serviceFrom === serviceTo)
						throw new Error('Choose two different boarding locations');
					if (minuteValue(serviceEnd) <= minuteValue(serviceStart))
						throw new Error('The service end must follow its start');
					const id = `proposal:service:${crypto.randomUUID()}`;
					operation.name = facilityName.trim() || 'Proposed service';
					operation.service = {
						id,
						routeId: id,
						name: operation.name,
						mode: serviceMode,
						stopIds: [serviceFrom, serviceTo],
						calendar: serviceRecurring
							? { weekdays: [0, 1, 2, 3, 4, 5, 6] }
							: { weekdays: [], includedDates: [date] },
						timing: {
							kind: 'frequency',
							segmentMinutes: [Number(serviceRuntime)],
							windows: [
								{
									startMinutes: minuteValue(serviceStart),
									endMinutes: minuteValue(serviceEnd),
									headwayMinutes: Number(serviceHeadway)
								}
							]
						},
						distanceM: Number(serviceDistanceKm) * 1000,
						fleet: fleetType
					};
					if (serviceReturn) {
						const reverse: Operation = {
							type: 'add_service',
							island_id: proposalIsland,
							name: `${operation.name} · return`,
							service: {
								...operation.service,
								id: `${id}:return`,
								name: `${operation.name} · return`,
								stopIds: [serviceTo, serviceFrom],
								timing: {
									kind: 'frequency',
									segmentMinutes: [Number(serviceRuntime)],
									windows: [
										{
											startMinutes: minuteValue(serviceStart) + Number(serviceRuntime),
											endMinutes: minuteValue(serviceEnd) + Number(serviceRuntime),
											headwayMinutes: Number(serviceHeadway)
										}
									]
								}
							}
						};
						rememberChanges();
						operations = [...operations, operation, reverse];
						error = '';
						composerOpen = false;
						mapNotice =
							'Outward and return services added. Recalculate impact to inspect their effect.';
						return;
					}
				}
			} else {
				if (!targetId) throw new Error('Choose a target from the source snapshot');
				operation.target_id = targetId;
			}
			if (operationType === 'set_frequency') operation.headway_minutes = Number(serviceHeadway);
			if (operationType === 'shift_timetable') operation.minutes = Number(timetableShift);
			if (operationType === 'set_fleet') operation.fleet = fleetType;
			if (operationType === 'road_closure') operation.disabled_modes = ['walk', 'bus'];
			rememberChanges();
			operations =
				editingIndex !== null
					? operations.map((item, index) => (index === editingIndex ? operation : item))
					: [...operations, operation];
			error = '';
			composerOpen = false;
			mapNotice = `${operationTitle(operation)} ${editingIndex !== null ? 'updated' : 'added'}. Review impact to see who benefits.`;
			editingIndex = null;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The proposal is invalid';
		}
	}
	function openStep(next: string) {
		view = next;
		inspectorOpen = true;
	}
	function startPlacement(kind: 'add_hospital' | 'add_school' | 'add_stop', point?: Coordinates) {
		editingIndex = null;
		facilityAnnualEmissions = undefined;
		facilityEmbodiedEmissions = undefined;
		operationType = kind;
		openingDate = date;
		facilityName =
			kind === 'add_hospital'
				? 'New community hospital'
				: kind === 'add_school'
					? 'New community school'
					: 'Proposed bus stop';
		if (point) {
			longitude = Number(point[0].toFixed(6));
			latitude = Number(point[1].toFixed(6));
			const nearest = baseline?.origins.reduce<Origin | null>(
				(best, origin) =>
					!best ||
					Math.hypot(origin.lon - point[0], origin.lat - point[1]) <
						Math.hypot(best.lon - point[0], best.lat - point[1])
						? origin
						: best,
				null
			);
			if (nearest) proposalIsland = nearest.islandId;
		}
		composerOpen = true;
		view = 'design';
		inspectorOpen = false;
		mapNotice = 'Drag the preview pin to move it, then confirm or cancel beside the pin.';
	}
	function editPlacement(index: number) {
		const operation = operations[index];
		if (
			!operation?.coordinates ||
			!['add_hospital', 'add_school', 'add_stop'].includes(operation.type)
		)
			return;
		editingIndex = index;
		operationType = operation.type;
		longitude = operation.coordinates[0];
		latitude = operation.coordinates[1];
		facilityName = operation.name ?? 'Proposed location';
		proposalIsland = operation.island_id ?? proposalIsland;
		openingDate = operation.opening_date ?? date;
		const costs = operation.metadata?.costs as Record<string, unknown> | undefined;
		facilityAnnualEmissions =
			typeof costs?.annual_operating_kg_co2e === 'number'
				? costs.annual_operating_kg_co2e
				: undefined;
		facilityEmbodiedEmissions =
			typeof costs?.embodied_kg_co2e === 'number' ? costs.embodied_kg_co2e : undefined;
		composerOpen = true;
		view = 'design';
		inspectorOpen = false;
		mapNotice =
			'Editing this draft location. Drag its preview pin and save the change to update the proposal.';
	}
	function beginAction(kind: 'evaluation' | 'journey' | 'timetable') {
		actionController?.abort();
		const pending = new AbortController();
		actionController = pending;
		busy = true;
		busyKind = kind;
		error = '';
		return pending;
	}
	function finishAction(pending: AbortController) {
		if (actionController !== pending) return;
		actionController = undefined;
		busy = false;
		busyKind = null;
	}
	async function runEvaluation() {
		const pending = beginAction('evaluation');
		const submitted = JSON.parse(signature);
		const pin = signature;
		const current = sequence;
		try {
			const result = await api<Evaluation>('planning/evaluate', submitted, pending.signal);
			if (current !== sequence || pending.signal.aborted) return;
			evaluation = result;
			evaluatedSignature = pin;
			residentPage = 0;
			view = 'access';
			inspectorOpen = true;
			mapNotice = 'Impact updated. Select a resident tile to see what changed.';
		} catch (cause) {
			if (current === sequence && !pending.signal.aborted)
				error = cause instanceof Error ? cause.message : 'Evaluation failed';
		} finally {
			finishAction(pending);
		}
	}
	async function runJourney() {
		const pending = beginAction('journey');
		const pin = appointmentInputs;
		const current = sequence;
		try {
			const result = await api<Appointment>(
				'planning/journey',
				{
					...request,
					origin_id: originId,
					...(destinationId ? { destination_id: destinationId } : {}),
					appointment_minutes: Number(appointmentMinutes),
					return_deadline_minutes: minuteValue(returnDeadline)
				},
				pending.signal
			);
			if (current !== sequence || pending.signal.aborted) return;
			appointment = result;
			appointmentSignature = pin;
		} catch (cause) {
			if (current === sequence && !pending.signal.aborted)
				error = cause instanceof Error ? cause.message : 'Journey calculation failed';
		} finally {
			finishAction(pending);
		}
	}
	async function loadTimetable() {
		const pending = beginAction('timetable');
		const pin = signature;
		const current = sequence;
		try {
			const result = await api<Timetable>('planning/timetable', request, pending.signal);
			if (current !== sequence || pending.signal.aborted) return;
			timetable = result;
			timetableSignature = pin;
			selectedPattern = timetable.patterns[0]?.id ?? '';
		} catch (cause) {
			if (current === sequence && !pending.signal.aborted)
				error = cause instanceof Error ? cause.message : 'Timetable failed';
		} finally {
			finishAction(pending);
		}
	}
	function download(value: unknown, filename: string, type = 'application/json') {
		downloadText(
			typeof value === 'string' ? value : JSON.stringify(value, null, 2),
			filename,
			type
		);
	}
	function exportResidents() {
		const rows = [
			[
				'origin_id',
				'projected_residents',
				'before_minutes',
				'after_minutes',
				'gained_access',
				'lost_access',
				'evidence_unavailable'
			],
			...residents.map((x) => [
				x.origin_id,
				x.population,
				x.before.minutes ?? '',
				x.after.minutes ?? '',
				x.gained_access,
				x.lost_access,
				x.after.status !== 'reachable'
			])
		];
		download(
			rows
				.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','))
				.join('\n'),
			'resident-access.csv',
			'text/csv'
		);
	}
	function stopName(id: string) {
		if (id === 'return:destination')
			return appointment?.destination?.name ?? 'Appointment destination';
		const proposal = operations.find((operation) => operation.metadata?.proposal_id === id);
		return (
			residentAreaNames[id] ??
			baseline?.stops.find((x) => x.id === id)?.name ??
			baseline?.facilities.find((x) => x.id === id)?.name ??
			proposal?.name ??
			(id.startsWith('wp:')
				? 'Resident area'
				: id.startsWith('proposal:')
					? 'Proposed destination'
					: id)
		);
	}
	function serviceName(id: string | undefined) {
		if (!id) return '';
		return (
			baseline?.patterns.find((pattern) => pattern.id === id)?.name ??
			operations.find((operation) => operation.service?.id === id)?.service?.name ??
			'Scheduled service'
		);
	}
</script>

<section class="policy-workbench" aria-label="Policy planning workbench">
	<div class="policy-heading">
		<div>
			<h2>
				{baseline?.islands.length === 1
					? `Plan for ${baseline.islands[0].name}.`
					: baseline?.islands.length
						? 'Plan for Greater Malé.'
						: 'Plan on the map.'}
			</h2>
			<p>Explore a resident area, place a change, then compare its impact.</p>
		</div>
		<Button
			variant="outline"
			disabled={!evaluation || stale}
			onclick={() => download({ request, evaluation }, 'policy-decision-brief.json')}
			><Download size={16} /> Export decision brief</Button
		>
	</div>
	{#if error}<p class="policy-error" role="alert">{error}</p>{/if}
	{#if loading}<Card.Root
			><Card.Content><p aria-live="polite">Loading the audited planning snapshot…</p></Card.Content
			></Card.Root
		>
	{:else if baseline?.status === 'outside_snapshot'}
		<Card.Root
			><Card.Content
				><h3>This island needs a planning dataset.</h3>
				<p>
					National island and facility context remains available on the map. Resident travel-time
					outcomes require connected roads, resident allocation and dated services. We have those
					inputs for Greater Malé.
				</p>
				<Button
					onclick={() => {
						scope = '';
						void loadBaseline(scope);
					}}>Use the Greater Malé planning area <ArrowRight size={16} /></Button
				><Button variant="outline" onclick={onExplore}
					><ArrowLeft size={16} /> Back to Explore</Button
				></Card.Content
			></Card.Root
		>
	{:else if baseline}
		<div class="policy-workflow" aria-label="Proposal workflow">
			<Button variant="ghost" size="sm" onclick={onExplore}
				><ArrowLeft size={15} /> Back to Explore</Button
			>
			{#each [{ id: 'design', label: 'Changes' }, { id: 'access', label: 'Impact' }, { id: 'journeys', label: 'Journey' }, { id: 'delivery', label: 'Budget & services' }] as step (step.id)}
				<Button
					variant={view === step.id ? 'secondary' : 'outline'}
					size="sm"
					aria-pressed={view === step.id}
					aria-current={view === step.id ? 'step' : undefined}
					aria-expanded={view === step.id && inspectorOpen}
					aria-controls="policy-inspector"
					onclick={() => openStep(step.id)}>{step.label}</Button
				>
			{/each}
			<Button
				variant="ghost"
				size="sm"
				aria-expanded={inspectorOpen}
				aria-controls="policy-inspector"
				onclick={() => (inspectorOpen = !inspectorOpen)}
				>{#if inspectorOpen}<PanelRightClose size={15} /> Hide details{:else}<PanelRightOpen
						size={15}
					/> Open details{/if}</Button
			>
			<span class="policy-workflow-note" role="status">{mapNotice}</span>
		</div>
		<div
			class="policy-map-layout"
			bind:this={mapLayout}
			style:--available-map-height={`${availableMapHeight}px`}
			class:inspector-open={inspectorOpen}
			class:inspector-expanded={inspectorExpanded}
		>
			<aside class="policy-map-region" bind:this={mapRegion} aria-label="Proposal preview">
				<PlanningMap
					origins={mapOrigins}
					facilities={mapFacilities}
					stops={serviceStops}
					edges={baseline.graph_edges}
					patterns={baseline.patterns}
					{operations}
					comparisons={evaluation?.origins ?? []}
					{mapFeatures}
					{originId}
					{destinationId}
					outward={appointment?.outward ?? null}
					returning={appointment?.return_journey ?? null}
					{journeyStale}
					status={mapStatus}
					busyLabel={busyKind === 'journey'
						? 'Calculating outward and return paths…'
						: busyKind === 'timetable'
							? 'Loading dated service departures…'
							: 'Recalculating resident access on the network…'}
					{active}
					canCreate={view === 'design'}
					canUndo={changeHistory.length > 0}
					editing={editingIndex !== null}
					onconfirm={() => {
						addOperation();
						if (!error) inspectorOpen = false;
					}}
					oncancel={cancelPlacement}
					ondetails={() => openStep('design')}
					onundo={undoChange}
					onclear={clearDraft}
					inspectorInset={inspectorOpen ? (inspectorExpanded ? 680 : 460) : 0}
					placement={view === 'design' &&
					composerOpen &&
					['add_hospital', 'add_school', 'add_stop'].includes(operationType)
						? {
								coordinates: [Number(longitude), Number(latitude)] as Coordinates,
								name: facilityName,
								kind: operationType
							}
						: null}
					draftService={view === 'design' && composerOpen && operationType === 'add_service'
						? { from: serviceFrom, to: serviceTo, mode: serviceMode }
						: null}
					targetMode={view === 'design' && composerOpen && operationType === 'road_closure'
						? 'road'
						: view === 'design' &&
							  composerOpen &&
							  ['disable_service', 'set_frequency', 'shift_timetable', 'set_fleet'].includes(
									operationType
							  )
							? 'service'
							: null}
					ontarget={(id) => {
						targetId = id;
						openStep('design');
					}}
					onpick={(point) => {
						longitude = Number(point[0].toFixed(6));
						latitude = Number(point[1].toFixed(6));
					}}
					oncreate={startPlacement}
					onedit={editPlacement}
					onstop={(id) => {
						if (operationType === 'disable_stop') targetId = id;
						else if (composerOpen && operationType === 'add_service') {
							if (servicePick === 'from') {
								serviceFrom = id;
								servicePick = 'to';
							} else serviceTo = id;
							openStep('design');
						} else
							mapNotice = `Bus stop · ${serviceStops.find((stop) => stop.id === id)?.name ?? 'Mapped boarding location'}`;
					}}
					onorigin={(id) => {
						originId = id;
						if (view !== 'design') openStep(evaluation && !stale ? 'access' : 'journeys');
					}}
					ondestination={(id) => {
						if (operationType === 'disable_facility' && view === 'design') {
							targetId = id;
							inspectorOpen = true;
							return;
						}
						destinationId = id;
						goal =
							mapFacilities.find((item) => item.id === id)?.kind === 'school'
								? 'education'
								: 'healthcare';
						if (view !== 'design') openStep('journeys');
					}}
					onrecalculate={runEvaluation}
				/>
			</aside>
			<div
				class="policy-editor"
				id="policy-inspector"
				bind:this={inspectorElement}
				hidden={!inspectorOpen}
				aria-label={stepTitle}
			>
				<div class="policy-inspector-heading">
					<div>
						<small
							>{operations.length} draft changes · {mapStatus === 'latest'
								? 'Latest impact'
								: mapStatus === 'stale'
									? 'Recalculate needed'
									: 'Draft preview'}</small
						><strong>{stepTitle}</strong>
					</div>
					<Button
						variant="ghost"
						size="icon"
						aria-label={inspectorExpanded ? 'Reduce planning details' : 'Expand planning details'}
						onclick={() => (inspectorExpanded = !inspectorExpanded)}
						>{#if inspectorExpanded}<Minimize2 size={16} />{:else}<Maximize2
								size={16}
							/>{/if}</Button
					>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Close planning details"
						onclick={() => (inspectorOpen = false)}><PanelRightClose size={17} /></Button
					>
				</div>
				<div class="policy-map-return">
					<span
						>{operations.length} draft changes · {mapStatus === 'latest'
							? 'Latest impact'
							: mapStatus === 'stale'
								? 'Recalculation needed'
								: 'Live map preview'}</span
					><Button
						variant="outline"
						size="sm"
						onclick={() => mapRegion?.scrollIntoView({ behavior: 'instant', block: 'start' })}
						><Route size={14} />Show map</Button
					>
				</div>
				<details class="policy-context-disclosure">
					<summary>Planning date, access goal and assumptions</summary>
					<Card.Root class="policy-context"
						><Card.Content>
							<div class="policy-context-title">
								<strong>{baseline.islands.map((x) => x.name).join(' · ') || 'Greater Malé'}</strong
								><Badge variant="outline">Partial service evidence</Badge><span
									>{number(baseline.counts.origins)} resident areas · {number(
										baseline.counts.patterns
									)} bus patterns</span
								>
								{#if scope}<Button
										variant="ghost"
										size="sm"
										onclick={() => {
											scope = '';
											void loadBaseline(scope);
										}}>Plan across Greater Malé</Button
									>{/if}
							</div>
							<div class="policy-inputs">
								<div>
									<Label for="policy-date">Service date · MVT</Label><Input
										id="policy-date"
										type="date"
										bind:value={date}
									/>
								</div>
								<div>
									<Label for="policy-departure">Leave home</Label><Input
										id="policy-departure"
										type="time"
										bind:value={departure}
									/>
								</div>
								<div>
									<Label for="policy-goal">Destination goal</Label><NativeSelect.Root
										id="policy-goal"
										bind:value={goal}
										><NativeSelect.Option value="healthcare">General healthcare</NativeSelect.Option
										><NativeSelect.Option value="education">Schools</NativeSelect.Option
										></NativeSelect.Root
									>
								</div>
								<div>
									<Label for="policy-target">Access target · minutes</Label><Input
										id="policy-target"
										type="number"
										min="1"
										max="180"
										bind:value={target}
									/>
								</div>
								<div>
									<Label for="policy-year">Resident projection</Label><NativeSelect.Root
										id="policy-year"
										bind:value={populationYear}
										><NativeSelect.Option value="2026">2026 projection</NativeSelect.Option
										><NativeSelect.Option value="2030">2030 projection</NativeSelect.Option
										></NativeSelect.Root
									>
								</div>
								<Button disabled={busy || !baseline.origins.length} onclick={runEvaluation}
									>{busy ? 'Calculating…' : 'Evaluate proposal'} <ArrowRight size={16} /></Button
								>
							</div>
							<p class="policy-note">
								The verified bus snapshot is 10 October 2026 from 15:20. Changing the date uses
								walking and explicitly calendared imported services. Missing observations are shown
								as unavailable.
							</p>
						</Card.Content></Card.Root
					>
				</details>
				<Tabs.Root bind:value={view} class="policy-tabs">
					<Tabs.List
						aria-label="Policy analysis"
						class="group-data-[orientation=horizontal]/tabs:h-auto"
						><Tabs.Trigger value="design">Changes</Tabs.Trigger><Tabs.Trigger value="access"
							>Impact</Tabs.Trigger
						><Tabs.Trigger value="journeys">Journey</Tabs.Trigger><Tabs.Trigger value="delivery"
							>Budget & services</Tabs.Trigger
						></Tabs.List
					>
					<Tabs.Content value="design">
						<div class="policy-two-col">
							{#if composerOpen}
								<Card.Root
									><Card.Content>
										<h3>
											<MapPin size={19} />
											{editingIndex !== null
												? 'Edit proposed place'
												: ['add_hospital', 'add_school', 'add_stop'].includes(operationType)
													? 'Place details'
													: 'Service or road change'}
										</h3>
										<p class="policy-note">
											Proposals are conditional destinations and services. They do not alter
											observed facility records.
										</p>
										<details class="policy-change-type">
											<summary>Change what you are proposing</summary><Label for="policy-operation"
												>Change type</Label
											><NativeSelect.Root
												id="policy-operation"
												bind:value={operationType}
												onchange={() => {
													targetId = '';
													editingIndex = null;
													composerOpen = true;
													facilityName =
														operationType === 'add_hospital'
															? 'New community hospital'
															: operationType === 'add_school'
																? 'New community school'
																: operationType === 'add_service'
																	? 'Proposed connection'
																	: 'Proposed bus stop';
												}}
												><NativeSelect.Option value="add_hospital">New hospital</NativeSelect.Option
												><NativeSelect.Option value="add_school">New school</NativeSelect.Option
												><NativeSelect.Option value="add_stop">New bus stop</NativeSelect.Option
												><NativeSelect.Option value="road_closure">Road closure</NativeSelect.Option
												><NativeSelect.Option value="disable_facility"
													>Close a destination</NativeSelect.Option
												><NativeSelect.Option value="disable_stop"
													>Disable a stop</NativeSelect.Option
												><NativeSelect.Option value="disable_service"
													>Suspend a service</NativeSelect.Option
												><NativeSelect.Option value="set_frequency"
													>Change service frequency</NativeSelect.Option
												><NativeSelect.Option value="shift_timetable"
													>Shift departures</NativeSelect.Option
												><NativeSelect.Option value="set_fleet"
													>Change bus propulsion</NativeSelect.Option
												><NativeSelect.Option value="add_service"
													>Create a bus/ferry service</NativeSelect.Option
												></NativeSelect.Root
											>
										</details>
										{#if ['add_hospital', 'add_school', 'add_stop'].includes(operationType)}
											<Label for="policy-proposal-island">Physical island</Label><NativeSelect.Root
												id="policy-proposal-island"
												bind:value={proposalIsland}
												>{#each baseline.islands as island (island.id)}<NativeSelect.Option
														value={island.id}>{island.name}</NativeSelect.Option
													>{/each}</NativeSelect.Root
											>
											<Label for="policy-name">Proposal name</Label><Input
												id="policy-name"
												bind:value={facilityName}
											/>
											<div class="policy-location-choice">
												<MapPin size={17} />
												<div>
													<strong>Choose this location visually</strong>
													<p class="policy-note">
														Drag the preview pin or use Place on map. The coordinates update
														automatically.
													</p>
												</div>
												<Button
													variant="outline"
													size="sm"
													onclick={() => {
														composerOpen = true;
														inspectorOpen = false;
													}}>Show location</Button
												>
											</div>
											{#if composerOpen}<p
													class:policy-site-warning={siteDistance === null || siteDistance > 100}
													class="policy-site-hint"
													role="status"
												>
													{siteDistance === null
														? 'This site has no located network evidence. Access is confirmed only after evaluation.'
														: siteDistance > 100
															? `This site is about ${number(siteDistance)} m from the supplied network. It may be outside the connected planning area; journey and resident access can remain unavailable.`
															: `About ${number(siteDistance)} m from the mapped network. Evaluate to confirm connectivity and resident access.`}
												</p>{/if}
											<details>
												<summary>Precise coordinates (optional)</summary>
												<div class="policy-two-fields">
													<div>
														<Label for="policy-lon">Longitude</Label><Input
															id="policy-lon"
															type="number"
															step="0.00001"
															min="-180"
															max="180"
															bind:value={longitude}
														/>
													</div>
													<div>
														<Label for="policy-lat">Latitude</Label><Input
															id="policy-lat"
															type="number"
															step="0.00001"
															min="-90"
															max="90"
															bind:value={latitude}
														/>
													</div>
												</div>
											</details>
											{#if operationType !== 'add_stop'}<Label for="policy-opening"
													>Assumed opening date</Label
												><Input id="policy-opening" type="date" bind:value={openingDate} />
												<details>
													<summary>Facility emissions assumptions (optional)</summary>
													<div class="policy-two-fields">
														<div>
															<Label for="policy-facility-annual-carbon"
																>Annual facility emissions · kg CO₂e</Label
															>
															<Input
																id="policy-facility-annual-carbon"
																type="number"
																min="0"
																placeholder="Unknown until estimated"
																bind:value={facilityAnnualEmissions}
															/>
														</div>
														<div>
															<Label for="policy-facility-embodied-carbon"
																>Construction emissions · kg CO₂e</Label
															>
															<Input
																id="policy-facility-embodied-carbon"
																type="number"
																min="0"
																placeholder="Unknown until estimated"
																bind:value={facilityEmbodiedEmissions}
															/>
														</div>
													</div>
													<p class="policy-note">
														Optional explicit estimates from the facility energy and construction
														plan. Leaving them blank keeps emissions unknown. These values are
														assumptions.
													</p>
												</details>
											{/if}
											<p class="policy-note">
												Coordinates start at a mapped resident area. The model snaps within 100 m of
												the walking graph. Capacity, staffing and admissions need a delivery plan.
											</p>
										{:else if operationType === 'add_service'}
											<div class="policy-service-pickers">
												<Button
													variant="outline"
													size="sm"
													onclick={() => {
														servicePick = 'from';
														inspectorOpen = false;
														mapNotice =
															'Click a bus or ferry boarding icon to choose the departure stop.';
													}}><MapPin size={14} /> Pick departure on map</Button
												><Button
													variant="outline"
													size="sm"
													onclick={() => {
														servicePick = 'to';
														inspectorOpen = false;
														mapNotice =
															'Click a bus or ferry boarding icon to choose the arrival stop.';
													}}><MapPin size={14} /> Pick arrival on map</Button
												>
											</div>
											<Label for="policy-service-name">Service name</Label><Input
												id="policy-service-name"
												bind:value={facilityName}
											/>
											<div class="policy-two-fields">
												<div>
													<Label for="policy-service-mode">Service mode</Label><NativeSelect.Root
														id="policy-service-mode"
														bind:value={serviceMode}
														><NativeSelect.Option value="bus">Bus</NativeSelect.Option
														><NativeSelect.Option value="ferry">Ferry</NativeSelect.Option
														></NativeSelect.Root
													>
												</div>
												<div>
													<Label for="policy-service-headway">A departure every · minutes</Label
													><Input
														id="policy-service-headway"
														type="number"
														min="1"
														max="720"
														bind:value={serviceHeadway}
													/>
												</div>
											</div>
											<div class="policy-two-fields">
												<div>
													<Label for="policy-service-from">From boarding location</Label
													><NativeSelect.Root id="policy-service-from" bind:value={serviceFrom}
														>{#each serviceStops as stop, stopIndex (stopIndex)}<NativeSelect.Option
																value={stop.id}
																>{stop.name || stop.id} · {stop.islandId}</NativeSelect.Option
															>{/each}</NativeSelect.Root
													>
												</div>
												<div>
													<Label for="policy-service-to">To boarding location</Label
													><NativeSelect.Root id="policy-service-to" bind:value={serviceTo}
														>{#each serviceStops as stop, stopIndex (stopIndex)}<NativeSelect.Option
																value={stop.id}
																>{stop.name || stop.id} · {stop.islandId}</NativeSelect.Option
															>{/each}</NativeSelect.Root
													>
												</div>
											</div>
											<div class="policy-two-fields">
												<div>
													<Label for="policy-service-start">First departure · MVT</Label><Input
														id="policy-service-start"
														type="time"
														bind:value={serviceStart}
													/>
												</div>
												<div>
													<Label for="policy-service-end">Departure window ends · MVT</Label><Input
														id="policy-service-end"
														type="time"
														bind:value={serviceEnd}
													/>
												</div>
												<div>
													<Label for="policy-service-runtime">Runtime/crossing · minutes</Label
													><Input
														id="policy-service-runtime"
														type="number"
														min="1"
														max="180"
														bind:value={serviceRuntime}
													/>
												</div>
												<div>
													<Label for="policy-service-distance">Routed length · km</Label><Input
														id="policy-service-distance"
														type="number"
														min="0.01"
														step="0.1"
														bind:value={serviceDistanceKm}
													/>
												</div>
											</div>
											<div class="policy-check">
												<input
													id="policy-service-return"
													type="checkbox"
													bind:checked={serviceReturn}
												/><Label for="policy-service-return"
													>Include the reverse direction and vehicle circulation</Label
												>
											</div>
											<div class="policy-check">
												<input
													id="policy-service-recurring"
													type="checkbox"
													bind:checked={serviceRecurring}
												/><Label for="policy-service-recurring"
													>Assume this proposed service operates every day</Label
												>
											</div>
											<p class="policy-note">
												This two-stop proposed service uses your explicit runtime and distance.
												Default operation is the selected date only. Boarding access and
												ferry-terminal suitability require verification. Reverse departures start
												one runtime later.
											</p>
											<details>
												<summary>Import a complete timetable instead</summary><Label
													for="policy-service-json">Complete service pattern JSON</Label
												><textarea
													id="policy-service-json"
													bind:value={serviceJson}
													rows="8"
													placeholder="Paste a complete source-backed bus or ferry service pattern"
												></textarea>
												<p class="policy-note">
													JSON replaces the form above. Full stop chains, dated exceptions and exact
													scheduled arrival/departure pairs are supported.
												</p>
											</details>
											<p class="policy-note">
												Use source stop IDs or add reconciled stops first. Supply real
												crossing/runtime and routed distance. Imports are labeled assumptions and
												checked on the backend.
											</p>
											<Button
												variant="outline"
												onclick={() =>
													download(
														{ stops: baseline?.stops, patterns: baseline?.patterns },
														'service-import-reference.json'
													)}>Download IDs and templates</Button
											>
										{:else}
											<Button
												variant="outline"
												size="sm"
												onclick={() => {
													inspectorOpen = false;
													mapNotice =
														operationType === 'road_closure'
															? 'Click a highlighted street segment to select its closure.'
															: operationType === 'disable_facility'
																? 'Click a mapped destination icon to select it.'
																: operationType === 'disable_stop'
																	? 'Click a boarding icon to select its closure.'
																	: 'Click a highlighted service line to select the source pattern.';
												}}><MapPin size={14} />Choose target on map</Button
											>
											<Label for="policy-target-id">Source target</Label><NativeSelect.Root
												id="policy-target-id"
												bind:value={targetId}
												><NativeSelect.Option value="">Choose a source record</NativeSelect.Option
												>{#each targets as item (item.id)}<NativeSelect.Option value={item.id}
														>{item.name}</NativeSelect.Option
													>{/each}</NativeSelect.Root
											>
											{#if operationType === 'set_frequency'}<Label for="policy-headway"
													>A departure every · minutes</Label
												><Input
													id="policy-headway"
													type="number"
													min="1"
													max="720"
													bind:value={serviceHeadway}
												/>{:else if operationType === 'shift_timetable'}<Label for="policy-shift"
													>Shift · minutes</Label
												><Input
													id="policy-shift"
													type="number"
													min="-720"
													max="720"
													bind:value={timetableShift}
												/>{:else if operationType === 'set_fleet'}<Label for="policy-fleet"
													>Propulsion assumption</Label
												><NativeSelect.Root id="policy-fleet" bind:value={fleetType}
													><NativeSelect.Option value="electric">Electric</NativeSelect.Option
													><NativeSelect.Option value="diesel">Diesel</NativeSelect.Option
													></NativeSelect.Root
												>{/if}
										{/if}
										{#if ['add_hospital', 'add_school', 'add_stop'].includes(operationType)}
											<Button onclick={() => (inspectorOpen = false)}
												><MapPin size={16} /> Back to pin to confirm</Button
											>
										{:else}<Button onclick={addOperation}
												><Plus size={16} /> Save this change</Button
											>{/if}
										<Button variant="outline" onclick={cancelPlacement}>Cancel changes</Button>
									</Card.Content></Card.Root
								>
							{/if}
							<Card.Root
								><Card.Content
									><h3>
										Your proposed changes <Badge variant="secondary">{operations.length}</Badge>
									</h3>
									{#if !operations.length}<p class="policy-note">
											Click anywhere on the map, choose a school, hospital or bus stop, then confirm
											its pin. Review impact to compare your plan with today.
										</p>{/if}
									{#each operations as operation, index (index)}<div class="policy-operation-row">
											<div>
												<strong>{operationTitle(operation)}</strong><small
													>{baseline.islands.find((island) => island.id === operation.island_id)
														?.name ?? 'Greater Malé'}{operation.opening_date
														? ` · Opens ${operation.opening_date}`
														: ''}</small
												>
											</div>
											{#if operation.coordinates}<Button
													variant="ghost"
													size="sm"
													aria-label={`Edit proposed change ${index + 1}`}
													onclick={() => editPlacement(index)}>Edit on map</Button
												>{/if}
											<Button
												variant="ghost"
												size="icon"
												aria-label={`Remove proposed change ${index + 1}`}
												onclick={() => removeChange(index)}><Trash2 size={15} /></Button
											>
										</div>{/each}
									<Button
										disabled={busy || !baseline.origins.length || composerOpen}
										onclick={runEvaluation}>Review impact <ArrowRight size={16} /></Button
									>
									{#if changeHistory.length}<Button size="sm" variant="outline" onclick={undoChange}
											><Undo2 size={14} /> Undo last change</Button
										>{/if}
									<details>
										<summary>More changes: services and roads</summary>
										<p class="policy-note">
											Create a bus or ferry connection, change an existing service, or close a road.
										</p>
										<Button variant="outline" onclick={startServiceChange}
											>Plan a service or road change</Button
										>
									</details>
									<details>
										<summary>Advanced assumptions, saved files and source edits</summary>
										<div class="policy-check">
											<input
												id="policy-structural"
												type="checkbox"
												bind:checked={includeStructural}
											/><Label for="policy-structural">Include current map proposal edits</Label>
										</div>
										<p class="policy-note">
											Only reconciled planning graph/service edits change timed journeys. Other
											structural edits are disclosed with warnings.
										</p>
										<div class="policy-two-fields">
											<div>
												<Label for="policy-walk">Walking speed · m/min</Label><Input
													id="policy-walk"
													type="number"
													min="10"
													max="180"
													bind:value={walkSpeed}
												/>
											</div>
											<div class="policy-check">
												<input
													id="policy-wheelchair"
													type="checkbox"
													bind:checked={wheelchair}
												/><Label for="policy-wheelchair">Require audited wheelchair paths</Label>
											</div>
										</div>
										<Button
											variant="outline"
											onclick={() =>
												download(
													{ ...request, source_receipts: baseline?.source_receipts },
													'policy-scenario.json'
												)}><Download size={16} /> Export reproducible option</Button
										>
										<Input
											type="file"
											accept="application/json,.json"
											bind:ref={importInput}
											onchange={importOption}
											class="hidden"
											aria-label="Import policy scenario file"
										/>
										<Button variant="outline" onclick={() => importInput?.click()}
											>Import saved policy option</Button
										>
									</details>
								</Card.Content></Card.Root
							>
						</div>
					</Tabs.Content>
					<Tabs.Content value="access">
						{#if evaluation}
							{#if stale}<p class="policy-stale" role="status">
									Inputs changed. Re-evaluate to update these results.
								</p>{/if}
							<div class="policy-metrics">
								{#each [{ label: 'Reached before', value: evaluation.summary.baseline_reachable_residents }, { label: 'Reached after', value: evaluation.summary.scenario_reachable_residents }, { label: 'Gained target access', value: evaluation.summary.gained_residents }, { label: 'Lost target access', value: evaluation.summary.lost_residents }, { label: 'Unavailable evidence', value: evaluation.summary.unknown_residents }] as metric (metric.label)}<Card.Root
										><Card.Content
											><small>{metric.label}</small><strong>{number(metric.value)}</strong><span
												>projected residents</span
											></Card.Content
										></Card.Root
									>{/each}
							</div>
							<div class="policy-two-col">
								<Card.Root
									><Card.Content
										><h3><Users size={18} /> Travel-time bands</h3>
										<p class="policy-note">
											Elapsed journeys include walking, waits and transfers. Violet is baseline;
											green is the proposal.
										</p>
										{#each evaluation.travel_time_bands.before as band, index (band.label)}<div
												class="policy-band"
											>
												<strong>{band.label}</strong>
												<div class="policy-band-row">
													<span
														class="policy-bar baseline"
														style:width={`${((band.residents ?? 0) / maximumBand) * 100}%`}
													></span><small>{number(band.residents)}</small>
												</div>
												<div class="policy-band-row">
													<span
														class="policy-bar proposed"
														style:width={`${((evaluation.travel_time_bands.after[index].residents ?? 0) / maximumBand) * 100}%`}
													></span><small
														>{number(evaluation.travel_time_bands.after[index].residents)}</small
													>
												</div>
											</div>{/each}</Card.Content
									></Card.Root
								><Card.Root
									><Card.Content
										><h3>Read the result correctly</h3>
										<p>{evaluation.access_method}</p>
										<p class="policy-note">{evaluation.population_basis}</p>
										<div class="policy-inline-stat">
											<strong>{number(evaluation.summary.became_unavailable_residents)}</strong
											><span
												>residents became unavailable. This is reported separately from known target
												access loss.</span
											>
										</div>
										<div class="policy-inline-stat">
											<strong>{number(evaluation.summary.worsened_residents)}</strong><span
												>residents have a slower computed journey.</span
											>
										</div>
										<details>
											<summary>Evidence and assumptions</summary>
											<p class="policy-note">
												Area numbers identify modeled resident cells, not official neighborhoods. {residentAreaNames[
													originId
												] ?? 'Selected resident area'} · Source origin ID: {originId}
											</p>
											{#each evaluation.warnings as warning, warningIndex (warningIndex)}<p
													class="policy-note"
												>
													{warning}
												</p>{/each}
										</details></Card.Content
									></Card.Root
								>
							</div>
							<Card.Root
								><Card.Content
									><div class="policy-table-heading">
										<h3>Inspect resident areas</h3>
										<NativeSelect.Root
											aria-label="Resident result filter"
											bind:value={residentFilter}
											onchange={() => {
												residentPage = 0;
											}}
											><NativeSelect.Option value="all">All areas</NativeSelect.Option
											><NativeSelect.Option value="gained">Gained access</NativeSelect.Option
											><NativeSelect.Option value="lost">Lost access</NativeSelect.Option
											><NativeSelect.Option value="unknown"
												>Evidence unavailable</NativeSelect.Option
											></NativeSelect.Root
										><Button variant="outline" onclick={exportResidents}
											><Download size={15} /> CSV</Button
										>
									</div>
									<div class="policy-table-scroll">
										<table>
											<thead
												><tr
													><th>Resident area</th><th>Projected residents</th><th>Baseline</th><th
														>Proposal</th
													><th>Time saved</th><th>Journey</th></tr
												></thead
											><tbody
												>{#each shownResidents as row (row.origin_id)}<tr
														><td
															><span class="policy-area-id"
																>{residentAreaNames[row.origin_id] ?? 'Modeled resident area'}</span
															></td
														><td>{number(row.population)}</td><td>{minutes(row.before.minutes)}</td
														><td>{minutes(row.after.minutes)}</td><td
															>{minutes(row.delta_minutes)}</td
														><td
															><Button
																variant="ghost"
																size="sm"
																onclick={() => {
																	originId = row.origin_id;
																	view = 'journeys';
																}}>Inspect <Route size={14} /></Button
															></td
														></tr
													>{/each}</tbody
											>
										</table>
									</div>
									{#if !residents.length}<p>No areas match this filter.</p>{/if}
									<div class="policy-table-heading">
										<span>{number(residents.length)} resident areas</span><Button
											variant="outline"
											size="sm"
											disabled={residentPage === 0}
											onclick={() => {
												residentPage--;
											}}>Previous</Button
										><Button
											variant="outline"
											size="sm"
											disabled={(residentPage + 1) * 8 >= residents.length}
											onclick={() => {
												residentPage++;
											}}>Next</Button
										>
									</div></Card.Content
								></Card.Root
							>
						{:else}<Card.Root
								><Card.Content
									><h3>Establish the baseline and compare.</h3>
									<p>
										Choose a goal, date and resident projection, then evaluate your option to
										calculate actual before-and-after journeys.
									</p>
									<Button disabled={busy} onclick={runEvaluation}>Evaluate proposal</Button
									></Card.Content
								></Card.Root
							>{/if}
					</Tabs.Content>
					<Tabs.Content value="journeys"
						><div class="policy-two-col">
							<Card.Root
								><Card.Content
									><h3>Can a resident get there and home?</h3>
									<Label for="policy-origin">Mapped resident area</Label><NativeSelect.Root
										id="policy-origin"
										bind:value={originId}
										><NativeSelect.Option value=""
											>Click a resident tile on the map, or choose an area</NativeSelect.Option
										>{#each baseline.origins as origin (origin.id)}<NativeSelect.Option
												value={origin.id}
												>{residentAreaNames[origin.id] ?? 'Modeled resident area'} · {number(
													origin.population2026
												)} residents</NativeSelect.Option
											>{/each}</NativeSelect.Root
									><Label for="policy-destination">Destination</Label><NativeSelect.Root
										id="policy-destination"
										bind:value={destinationId}
										><NativeSelect.Option value="">Best eligible destination</NativeSelect.Option
										>{#each mapFacilities.filter( (x) => (goal === 'healthcare' ? ['hospital', 'clinic'].includes(x.kind) : x.kind === 'school') ) as facility (facility.id)}<NativeSelect.Option
												value={facility.id}
												>{facility.name} · {facility.operatingStatus ||
													'unverified'}</NativeSelect.Option
											>{/each}</NativeSelect.Root
									>
									<div class="policy-two-fields">
										<div>
											<Label for="policy-appointment">Appointment · minutes</Label><Input
												id="policy-appointment"
												type="number"
												min="0"
												max="720"
												bind:value={appointmentMinutes}
											/>
										</div>
										<div>
											<Label for="policy-deadline">Home by · MVT</Label><Input
												id="policy-deadline"
												type="time"
												bind:value={returnDeadline}
											/>
										</div>
									</div>
									<Button disabled={busy || !originId} onclick={runJourney}
										>{busy ? 'Routing…' : 'Calculate outward and return'}
										<ArrowRight size={16} /></Button
									>
									<p class="policy-note">
										Uses the selected proposal and departure date. Return routing goes back from the
										same destination after your appointment, with service calendars checked across
										midnight.
									</p></Card.Content
								></Card.Root
							><Card.Root
								><Card.Content
									>{#if appointment}{#if appointmentSignature !== appointmentInputs}<p
												class="policy-stale"
											>
												Journey inputs changed. Calculate the outward and return trip again.
											</p>{/if}<Badge variant="secondary">{label(appointment.status)}</Badge>
										<h3>Outward {minutes(appointment.outward.minutes)}</h3>
										{#each appointment.outward.path as leg, legIndex (legIndex)}<div
												class="policy-leg"
											>
												<Badge variant="outline">{leg.mode}</Badge>
												<div>
													{#if leg.pattern_id}<strong>{serviceName(leg.pattern_id)}</strong>{/if}
													<strong>{stopName(leg.from)} → {stopName(leg.to)}</strong><small
														>{minutes(leg.minutes)} · wait {minutes(leg.wait_minutes)}</small
													>
												</div>
											</div>{/each}{#if appointment.outward.reason}<p>
												{appointment.outward.reason}
											</p>{/if}{#if appointment.return_journey}<h3>
												Return {minutes(appointment.return_journey.minutes)}
											</h3>
											{#each appointment.return_journey.path as leg, legIndex (legIndex)}<div
													class="policy-leg"
												>
													<Badge variant="outline">{leg.mode}</Badge>
													<div>
														{#if leg.pattern_id}<strong>{serviceName(leg.pattern_id)}</strong>{/if}
														<strong>{stopName(leg.from)} → {stopName(leg.to)}</strong><small
															>{minutes(leg.minutes)} · wait {minutes(leg.wait_minutes)}</small
														>
													</div>
												</div>{/each}{#if appointment.return_journey.reason}<p>
													{appointment.return_journey.reason}
												</p>{/if}{/if}
										<p>
											<strong>Home at {clock(appointment.home_at_minutes)}</strong
											>{appointment.meets_deadline === false
												? ' · Deadline missed'
												: appointment.meets_deadline === true
													? ' · Meets your deadline'
													: ''}
										</p>
										<Button
											variant="outline"
											disabled={appointmentSignature !== appointmentInputs}
											onclick={() => download({ request, appointment }, 'appointment-journey.json')}
											><Download size={15} /> Export actual journey geometry</Button
										>{:else}<Route size={30} />
										<h3>A complete appointment journey.</h3>
										<p>
											Inspect walking access, departure waits, bus/ferry legs and the return
											deadline. Unverified services remain unavailable.
										</p>{/if}</Card.Content
								></Card.Root
							>
						</div></Tabs.Content
					>
					<Tabs.Content value="delivery">
						<DeliveryCalibration
							bind:records={calibrationRecords}
							bind:selection={calibrationSelection}
							bind:energy={energyOverrides}
							bind:costs={costOverrides}
							bind:resources={fleetResources}
							serviceDate={date}
							activities={serviceActivities}
							stops={serviceStops}
							audits={evaluation?.economics.fleets.after.routes ?? []}
							{stale}
						/>
						<div class="policy-two-col">
							<Card.Root
								><Card.Content
									><h3>Delivery envelope</h3>
									<div class="policy-two-fields">
										<div>
											<Label for="policy-capital-budget">Capital budget · MVR</Label><Input
												id="policy-capital-budget"
												type="number"
												min="0"
												bind:value={capitalBudget}
											/>
										</div>
										<div>
											<Label for="policy-annual-budget">Annual added budget · MVR</Label><Input
												id="policy-annual-budget"
												type="number"
												min="0"
												bind:value={annualBudget}
											/>
										</div>
										<div>
											<Label for="policy-days">Operating days per year</Label><Input
												id="policy-days"
												type="number"
												min="1"
												max="366"
												bind:value={operatingDays}
											/>
										</div>
										<div>
											<Label for="policy-displacement">Assumed displaced passenger-km</Label><Input
												id="policy-displacement"
												type="number"
												min="0"
												bind:value={displacedPassengerKm}
											/>
										</div>
									</div>
									<details>
										<summary>Edit cost and emissions assumptions</summary>
										<p class="policy-note">
											Illustrative defaults, not official prices. Use operator quotations and
											staffing plans when available. Manual entries override selected evidence.
											Clear a manual entry to restore its evidence or default.
										</p>
										{#each relevantCostKeys as key (key)}<div class="policy-cost-row">
												<Label for={`cost-${key}`}>{label(key)}</Label><Input
													id={`cost-${key}`}
													type="number"
													min="0"
													value={costOverrides[key] ??
														calibrationRecords.find(
															(record) => record.id === calibrationSelection[key]
														)?.value ??
														(!stale ? evaluation?.economics.assumptions[key] : undefined) ??
														baseline.cost_defaults[key]}
													oninput={(event) => {
														const next = { ...costOverrides };
														if (event.currentTarget.value === '') delete next[key];
														else next[key] = Number(event.currentTarget.value);
														costOverrides = next;
													}}
												/>
											</div>{/each}
									</details>
									<Button disabled={busy} onclick={runEvaluation}
										>Recalculate access and delivery</Button
									>
									<p class="policy-note">
										Daily fleet and timetable totals use conditions at your selected departure time.
										A notice active then changes the whole daily service illustration; its hours are
										interpreted separately for outward and return journeys. Import amended trips for
										an operational day plan.
									</p></Card.Content
								></Card.Root
							><Card.Root
								><Card.Content
									><h3>Capital, operating cost and emissions</h3>
									{#if evaluation}<Badge variant="outline">{evaluation.economics.basis}</Badge
										>{#if stale}<p class="policy-stale">
												Inputs changed. Recalculate to apply the current budgets.
											</p>{/if}
										<div class="policy-finance-row">
											<span>New investment</span><strong
												>MVR {number(evaluation.economics.delta.capital_mvr)}</strong
											>
										</div>
										<div class="policy-finance-row">
											<span>Annual added operating cost</span><strong
												>MVR {number(evaluation.economics.delta.annual_operating_mvr)}</strong
											>
										</div>
										<div class="policy-finance-row">
											<span>Net annual emissions change</span><strong
												>{number(evaluation.economics.delta.net_annual_kg_co2e)} kg CO₂e</strong
											>
										</div>
										<div class="policy-finance-row">
											<span>Fleet operating emissions change</span><strong
												>{number(evaluation.economics.delta.annual_fleet_operating_kg_co2e)} kg CO₂e</strong
											>
										</div>
										<div class="policy-finance-row">
											<span>Proposed facility operating emissions</span><strong
												>{number(evaluation.economics.delta.annual_facility_operating_kg_co2e)} kg CO₂e</strong
											>
										</div>
										<div class="policy-finance-row">
											<span>Proposed facility construction emissions</span><strong
												>{number(evaluation.economics.delta.embodied_facility_kg_co2e)} kg CO₂e</strong
											>
										</div>
										<div class="policy-finance-row">
											<span>Capital remaining</span><strong
												>MVR {number(
													evaluation.economics.budget.capital_remaining_mvr as number | null
												)}</strong
											>
										</div>
										<p class="policy-note">
											Positive emissions means an increase. Accessibility gains do not imply mode
											shift. Displaced travel is a separate editable annual assumption. Facility
											emissions remain unavailable until you supply estimates; fleet emissions stay
											visible separately. Construction is separate from annual operation. Vehicle
											manufacture and existing facility energy are outside this project-change
											account.
										</p>
										<p class="policy-note">
											Cost sensitivity: MVR {number(
												evaluation.economics.sensitivity.capital_mvr.low
											)}–{number(evaluation.economics.sensitivity.capital_mvr.high)}. {evaluation
												.economics.sensitivity.meaning}.
										</p>
										{#if evaluation.economics.calibration}<details>
												<summary>Applied factor evidence and energy calculations</summary>
												<p class="policy-note">{evaluation.economics.calibration.meaning}</p>
												{#each Object.entries(evaluation.economics.calibration.factor_basis) as [key, basis] (key)}
													<p class="policy-note">
														{label(key)} · {evaluation.economics.assumptions[key] ?? 'Energy input'} ·
														{label(basis)}
													</p>
												{/each}
												{#each evaluation.economics.calibration.derived as calculation (calculation.factor)}
													<p class="policy-note">
														<strong
															>{label(calculation.factor)} = {calculation.value.toFixed(3)}</strong
														><br />{calculation.formula}<br />{Object.entries(calculation.inputs)
															.map(([key, value]) => `${label(key)}: ${value}`)
															.join(' · ')}
													</p>
												{/each}
											</details>{/if}
										<details>
											<summary>Financial measurement limits</summary
											>{#each evaluation.economics.warnings as warning, warningIndex (warningIndex)}<p
													class="policy-note"
												>
													{warning}
												</p>{/each}
										</details>{:else}<p>
											Evaluate the proposal to calculate before, after and incremental costs.
											Capital and annual operating budgets remain separate.
										</p>{/if}</Card.Content
								></Card.Root
							>
						</div>
						{#if evaluation}<Card.Root
								><Card.Content
									><h3>Fleet and vehicle circulation</h3>
									<p class="policy-note">
										Reuse requires enough layover time and a co-located terminal. Add your resource
										envelope above to screen capacity, battery range and overnight charging.
										Deadhead, crew and shared charging schedules require an operating plan.
									</p>
									<div class="policy-table-scroll">
										<table>
											<thead
												><tr
													><th>Route</th><th>Propulsion</th><th>Departures</th><th>Fleet</th><th
														>With reserve</th
													><th>Annual vehicle-km</th></tr
												></thead
											><tbody
												>{#each evaluation.economics.fleets.after.routes as route, routeIndex (routeIndex)}<tr
														><td>{route.name}</td><td
															>{route.mode === 'ferry' ? 'Vessel' : route.fleet_type}</td
														><td>{route.departures}</td><td>{route.required_fleet}</td><td
															>{route.procurement_fleet}</td
														><td>{number(route.annual_vehicle_km)}</td></tr
													>{/each}</tbody
											>
										</table>
									</div>
									<Button
										variant="outline"
										onclick={() => download(evaluation?.economics.fleets, 'fleet-blocks.json')}
										><Download size={15} /> Export vehicle blocks</Button
									></Card.Content
								></Card.Root
							>{/if}
						<Card.Root
							><Card.Content
								><div class="policy-table-heading">
									<h3>Scheduled bus and ferry evidence</h3>
									<Button variant="outline" disabled={busy} onclick={loadTimetable}
										>Load selected-date timetable</Button
									>
								</div>
								{#if timetable}{#if timetableSignature !== signature}<p class="policy-stale">
											Planning inputs changed. Load the timetable again for the selected
											assumptions.
										</p>{/if}<NativeSelect.Root
										aria-label="Timetable route"
										bind:value={selectedPattern}
										>{#each timetable.patterns as pattern (pattern.id)}<NativeSelect.Option
												value={pattern.id}>{pattern.name}</NativeSelect.Option
											>{/each}</NativeSelect.Root
									>{#if activeTimetable}<p class="policy-note">
											{activeTimetable.trips.length} recorded departures on {date}.
											Arrival/departure rows retain source stop order.
										</p>
										<div class="policy-table-scroll">
											<table>
												<thead
													><tr
														><th>Trip</th
														>{#each activeTimetable.stop_ids as stop, stopIndex (stopIndex)}<th
																>{stopName(stop)}</th
															>{/each}</tr
													></thead
												><tbody
													>{#each activeTimetable.trips.slice(0, 12) as trip (trip.id)}<tr
															><td>{trip.id}</td
															>{#each trip.stopTimes as time, timeIndex (timeIndex)}<td
																	>{clock(time.departureMinutes)}</td
																>{/each}</tr
														>{/each}</tbody
												>
											</table>
										</div>
										<p class="policy-note">
											Showing the first 12 trips. Export includes every loaded trip.
										</p>{/if}<Button
										variant="outline"
										onclick={() => download(timetable, 'service-timetable.json')}
										><Download size={15} /> Export full timetable</Button
									>
									<h3>Official ferry calendars</h3>
									{#each timetable.official_ferry_calendars as calendar (calendar.id)}<details>
											<summary
												>{label(calendar.route)} · crossing time {calendar.crossingMinutes == null
													? 'not supplied'
													: `${calendar.crossingMinutes} min`}</summary
											>{#each calendar.dayTypes as day (day.label)}<p>
													<strong>{day.label}</strong>{day.noScheduledService
														? ' · No scheduled service'
														: ''}
												</p>
												{#if day.departuresFromMale}<p class="policy-note">
														From Malé: {day.departuresFromMale.join(' · ') || 'No departures'}
													</p>
													<p class="policy-note">
														From island: {day.departuresFromIsland?.join(' · ') || 'No departures'}
													</p>{/if}{#each day.frequencyWindows ?? [] as window, windowIndex (windowIndex)}<p
														class="policy-note"
													>
														{window.start}–{window.end} · every {window.headwayMinutes} minutes
													</p>{/each}{/each}{#each calendar.limitations as warning, warningIndex (warningIndex)}<p
													class="policy-note"
												>
													{warning}
												</p>{/each}
										</details>{/each}{:else}<p class="policy-note">
										View official direction-specific ferry departures, day types and the dated RTL
										bus snapshot. Departure columns are not arrival times.
									</p>{/if}</Card.Content
							></Card.Root
						>
					</Tabs.Content>
				</Tabs.Root>
			</div>
		</div>
	{/if}
</section>

<style>
	.policy-workbench {
		padding: 14px 18px;
		display: grid;
		gap: 12px;
		max-width: 1900px;
		margin: 0 auto;
		color: #23252b;
	}
	.policy-map-layout {
		position: relative;
		height: var(--available-map-height, max(360px, calc(100dvh - 245px)));
		min-width: 0;
	}
	.policy-map-region {
		position: absolute;
		inset: 0;
		min-width: 0;
		border-radius: 19px;
	}
	.policy-map-region :global(.planning-map) {
		height: 100%;
	}
	.policy-editor {
		position: absolute;
		right: 14px;
		top: 14px;
		bottom: 14px;
		z-index: 6;
		width: min(460px, calc(100% - 28px));
		min-width: 0;
		display: grid;
		align-content: start;
		gap: 14px;
		overflow: auto;
		overscroll-behavior: contain;
		padding: 0 12px 14px;
		background: #fffefaf7;
		border: 1px solid #d9e4d9;
		border-radius: 16px;
		box-shadow: 0 7px 30px #203f3824;
		animation: inspector-enter 180ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.policy-editor[hidden] {
		display: none;
	}
	.inspector-expanded .policy-editor {
		width: min(680px, calc(100% - 28px));
	}
	.policy-inspector-heading {
		display: flex;
		align-items: center;
		gap: 4px;
		position: sticky;
		top: 0;
		z-index: 8;
		background: #fffefa;
		padding: 14px 0;
		border-bottom: 1px solid #e0e7dc;
	}
	.policy-inspector-heading > div {
		flex: 1;
		display: grid;
		gap: 4px;
	}
	.policy-inspector-heading small {
		font-size: 10px;
		color: #708371;
	}
	.policy-inspector-heading strong {
		font-size: 15px;
	}
	.policy-workflow {
		display: flex;
		gap: 6px;
		align-items: center;
		flex-wrap: wrap;
	}
	.policy-workflow-note {
		font-size: 11px;
		color: #617565;
		width: 100%;
		line-height: 1.5;
	}
	.policy-context-disclosure {
		border: 0;
		padding-top: 0;
	}
	.policy-context-disclosure summary {
		padding: 10px 12px;
		background: #f0f3ea;
		border-radius: 10px;
	}
	.policy-location-choice {
		display: flex;
		align-items: center;
		gap: 9px;
		background: #edf4eb;
		padding: 12px;
		border-radius: 11px;
	}
	.policy-location-choice strong {
		font-size: 12px;
	}
	.policy-location-choice .policy-note {
		font-size: 11px;
	}
	.policy-site-hint {
		color: #52715c;
		font-size: 11px;
		line-height: 1.5;
	}
	.policy-site-warning {
		color: #906428;
		background: #fff2d9;
		border-radius: 9px;
		padding: 10px;
	}
	.policy-service-pickers {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
	}
	:global(.policy-tabs > [data-slot='tabs-list']) {
		display: none;
	}
	@keyframes inspector-enter {
		from {
			opacity: 0;
			transform: translateX(10px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
	.policy-map-return {
		display: none;
	}
	.policy-editor .policy-two-col {
		grid-template-columns: 1fr;
	}
	.policy-editor .policy-inputs {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.policy-editor .policy-metrics {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}
	.policy-editor .policy-metrics > :global([data-slot='card']) {
		min-width: 0;
	}
	.policy-editor .policy-metrics > :global([data-slot='card']:last-child) {
		grid-column: 1 / -1;
	}
	.policy-editor .policy-metrics :global([data-slot='card-content']) {
		padding: 16px;
		gap: 6px;
	}
	.policy-editor .policy-metrics strong {
		font-size: 28px;
		line-height: 1.15;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	.policy-editor .policy-metrics small,
	.policy-editor .policy-metrics span {
		line-height: 1.4;
	}
	.policy-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
	}
	h2 {
		margin: 0 0 4px;
		font-size: 23px;
		letter-spacing: -1px;
		font-weight: 650;
	}
	h3 {
		margin: 0;
		font-size: 18px;
		font-weight: 650;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	p {
		font-size: 14px;
		line-height: 1.65;
		margin: 0;
	}
	.policy-heading p,
	.policy-note {
		color: #656575;
		font-size: 13px;
	}
	:global(.policy-workbench [data-slot='card-content']) {
		padding: 23px;
		gap: 16px;
	}
	:global(.policy-workbench [data-slot='native-select-wrapper']) {
		width: 100%;
	}
	:global(.policy-workbench [data-slot='tabs-list']) {
		justify-content: flex-start;
		flex-wrap: wrap;
		flex-shrink: 0;
		height: auto;
		width: 100%;
		background: #e7e3f0;
		padding: 5px;
		gap: 4px;
	}
	:global(.policy-workbench [data-slot='tabs-trigger']) {
		height: auto;
		min-height: 39px;
		flex: 1 1 auto;
	}
	.policy-context-title,
	.policy-table-heading {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
	}
	.policy-context-title span {
		font-size: 12px;
		color: #656575;
	}
	.policy-inputs {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr)) auto;
		align-items: end;
		gap: 14px;
	}
	.policy-inputs > div,
	.policy-two-fields > div {
		display: grid;
		gap: 8px;
		min-width: 0;
	}
	.policy-two-col {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 20px;
		margin-bottom: 20px;
	}
	.policy-two-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}
	.policy-check {
		display: flex !important;
		align-items: center;
		gap: 10px;
		font-size: 13px;
	}
	.policy-operation-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 12px;
		border-radius: 12px;
		background: #f4f1f8;
	}
	.policy-operation-row strong,
	.policy-leg strong {
		display: block;
		font-size: 13px;
	}
	.policy-operation-row small,
	.policy-leg small {
		display: block;
		margin-top: 5px;
		color: #656575;
		overflow-wrap: anywhere;
	}
	.policy-metrics {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 14px;
		margin: 0 0 22px;
	}
	.policy-metrics strong {
		font-size: clamp(24px, 2.5vw, 33px);
		letter-spacing: -1px;
	}
	.policy-metrics small,
	.policy-metrics span {
		font-size: 12px;
		color: #656575;
	}
	.policy-band {
		display: grid;
		gap: 8px;
		margin-bottom: 5px;
	}
	.policy-band strong {
		font-size: 12px;
	}
	.policy-band-row {
		display: flex;
		gap: 12px;
		align-items: center;
		min-height: 18px;
	}
	.policy-band-row small {
		font-size: 11px;
		min-width: 55px;
	}
	.policy-bar {
		display: block;
		min-width: 0;
		height: 13px;
		border-radius: 5px;
		flex-shrink: 1;
	}
	.policy-bar.baseline {
		background: #b897f1;
	}
	.policy-bar.proposed {
		background: #88ccae;
	}
	.policy-inline-stat {
		display: flex;
		align-items: center;
		gap: 15px;
		border-top: 1px solid #eeebf2;
		padding-top: 15px;
	}
	.policy-inline-stat strong {
		font-size: 26px;
	}
	.policy-inline-stat span {
		font-size: 13px;
		color: #656575;
	}
	.policy-table-heading > h3 {
		margin-right: auto;
	}
	.policy-table-heading :global([data-slot='native-select-wrapper']) {
		width: auto;
		min-width: 170px;
	}
	.policy-table-scroll {
		overflow: auto;
		max-width: 100%;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 12px;
	}
	th {
		text-align: left;
		color: #686577;
		font-weight: 550;
		background: #f8f6fb;
	}
	th,
	td {
		padding: 12px;
		border-bottom: 1px solid #efecf3;
		white-space: nowrap;
	}
	.policy-area-id {
		max-width: 230px;
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.policy-leg {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		border-bottom: 1px solid #efecf3;
		padding-bottom: 14px;
	}
	.policy-finance-row {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		padding: 12px 0;
		border-bottom: 1px solid #efecf3;
		font-size: 13px;
	}
	.policy-finance-row strong {
		text-align: right;
	}
	.policy-cost-row {
		display: grid;
		grid-template-columns: 1.3fr 1fr;
		align-items: center;
		gap: 12px;
		padding-top: 12px;
	}
	details {
		border-top: 1px solid #e8e4ee;
		padding-top: 14px;
	}
	details p {
		margin-top: 10px;
	}
	summary {
		cursor: pointer;
		font-size: 13px;
		font-weight: 550;
	}
	textarea {
		width: 100%;
		border: 1px solid #dcd7e7;
		border-radius: 12px;
		padding: 12px;
		font: 12px/1.6 monospace;
		resize: vertical;
		background: #faf8fe;
	}
	.policy-error {
		color: #8a2b35;
		padding: 14px;
		border: 1px solid #e6bec5;
		background: #fff2f4;
		border-radius: 12px;
	}
	.policy-stale {
		color: #77551d;
		background: #fff5da;
		padding: 12px;
		border-radius: 12px;
		margin-bottom: 16px;
	}
	@media (max-width: 1000px) {
		.policy-inputs {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.policy-metrics {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (max-width: 650px) {
		.policy-workbench {
			padding: 10px;
			gap: 10px;
		}
		.policy-heading {
			align-items: center;
		}
		.policy-heading p,
		.policy-heading > :global(button) {
			display: none;
		}
		.policy-two-col {
			grid-template-columns: minmax(0, 1fr);
			gap: 14px;
		}
		.policy-inputs {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.policy-metrics {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		:global(.policy-workbench [data-slot='card-content']) {
			padding: 18px;
		}
		.policy-finance-row {
			flex-direction: column;
			gap: 6px;
		}
		.policy-finance-row strong {
			text-align: left;
		}
		.policy-two-fields {
			gap: 10px;
		}
		.policy-map-layout {
			height: var(--available-map-height, max(360px, calc(100dvh - 338px)));
		}
		.policy-editor {
			left: 8px;
			right: 8px;
			top: auto;
			bottom: 8px;
			width: auto;
			max-height: 54%;
			border-radius: 18px 18px 12px 12px;
			animation-name: mobile-inspector-enter;
		}
		.inspector-expanded .policy-editor {
			width: auto;
			max-height: 88%;
		}
		.policy-heading :global(button) {
			font-size: 11px;
		}
		.policy-workflow :global(button) {
			flex: 0 0 auto;
			font-size: 11px;
		}
		.policy-workflow {
			flex-wrap: nowrap;
			overflow-x: auto;
			padding-bottom: 3px;
		}
		.policy-workflow-note {
			display: none;
		}
		.policy-editor .policy-inputs {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@keyframes mobile-inspector-enter {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (min-width: 651px) and (max-width: 899px) {
		.policy-editor {
			left: 10px;
			right: 10px;
			top: auto;
			bottom: 10px;
			width: auto;
			max-height: 54%;
		}
		.inspector-expanded .policy-editor {
			width: auto;
			max-height: 88%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.policy-editor {
			animation: none;
		}
	}
</style>
