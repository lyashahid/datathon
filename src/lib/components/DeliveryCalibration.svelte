<script lang="ts">
	import { downloadJson } from '#lib/download.js';
	import { onMount, untrack } from 'svelte';
	import { Download, FileCheck, Plus, Trash2, Upload } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { api } from '#lib/api.js';
	import {
		fleetResourceError,
		type CalibrationRecord,
		type FleetResources,
		type ResourceAudit
	} from '#lib/planning-delivery.js';
	let {
		records = $bindable([]),
		selection = $bindable({}),
		energy = $bindable({}),
		costs = $bindable({}),
		resources = $bindable([]),
		serviceDate,
		activities,
		stops,
		audits = [],
		stale = false
	}: {
		records?: CalibrationRecord[];
		selection?: Record<string, string>;
		energy?: Record<string, number>;
		costs?: Record<string, number>;
		resources?: FleetResources[];
		serviceDate: string;
		activities: { id: string; name: string; fleet: string }[];
		stops: { id: string; name?: string }[];
		audits?: { activity_id: string; name: string; resource_audit?: ResourceAudit }[];
		stale?: boolean;
	} = $props();
	let factors = $state<{ key: string; unit: string; illustrative_default: number | null }[]>([]);
	type ReferenceSources = {
		sources?: {
			id: string;
			url: string;
			publisher: string;
			sha256?: string | null;
			retrieval_status?: string;
		}[];
		tariffs?: { id: string; title: string; bands: { up_to_kwh: number | null; rate: number }[] }[];
		historical_energy?: {
			reported_kg_co2_per_kwh: number;
			reference_year: number;
			meaning: string;
		};
		limitations?: string[];
	};
	let references = $state<ReferenceSources>({});
	let tariffId = $state('male_commercial');
	let baselineKwh = $state<number | undefined>(undefined);
	let addedKwh = $state<number | undefined>(undefined);
	let fuelAdjustment = $state<number | undefined>(undefined);
	let tariffResult = $state<{
		added_base_charge_mvr: number;
		added_charge_with_fuel_adjustment_mvr: number | null;
		effective_added_base_rate_mvr_per_kwh: number | null;
		meaning: string;
	} | null>(null);
	let tariffSignature = $state('');
	const tariffInputs = $derived(
		JSON.stringify({
			tariff_id: tariffId,
			baseline_kwh: baselineKwh,
			added_kwh: addedKwh,
			fuel_adjustment_mvr_per_kwh: fuelAdjustment ?? null
		})
	);
	let error = $state('');
	let message = $state('');
	let busy = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	let factor = $state('electricity_mvr_per_kwh');
	let value = $state<number | undefined>(undefined);
	let title = $state('');
	let publisher = $state('');
	let sourceUrl = $state('');
	let publishedDate = $state(untrack(() => serviceDate));
	let validFrom = $state(untrack(() => serviceDate));
	let validTo = $state('');
	let geography = $state('Greater Malé');
	let basis = $state('');
	let evidenceType = $state<CalibrationRecord['evidence_type']>('operator_quote');
	let activityId = $state('');
	let vehicles = $state<number | undefined>(undefined);
	let capacity = $state<number | undefined>(undefined);
	let peak = $state<number | undefined>(undefined);
	let duty = $state<number | undefined>(undefined);
	let depot = $state('');
	let battery = $state<number | undefined>(undefined);
	let reserve = $state(20);
	let consumption = $state<number | undefined>(undefined);
	let chargers = $state<number | undefined>(undefined);
	let power = $state<number | undefined>(undefined);
	let chargingHours = $state<number | undefined>(undefined);
	let efficiency = $state(90);
	const label = (key: string) => key.replaceAll('_', ' ');
	const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
	const stopNames = $derived(new Map(stops.map((stop) => [stop.id, stop.name || stop.id])));
	const number = (item: unknown) =>
		typeof item === 'number'
			? numberFormatter.format(item)
			: Array.isArray(item)
				? item.map((id) => stopNames.get(id) ?? id).join(', ')
				: item == null
					? 'Not entered'
					: String(item);
	const currentActivity = $derived(activities.find((item) => item.id === activityId));
	const energyFactors = $derived(factors.filter((item) => item.illustrative_default == null));
	const supportedAudits = $derived(
		audits.filter((item) => resources.some((r) => r.activity_id === item.activity_id))
	);
	onMount(() => {
		const controller = new AbortController();
		void api<{ factors: typeof factors; references: ReferenceSources }>(
			'planning/calibration',
			undefined,
			controller.signal
		)
			.then((data) => {
				if (controller.signal.aborted) return;
				factors = data.factors;
				references = data.references;
			})
			.catch((cause) => {
				if (!controller.signal.aborted)
					error = cause instanceof Error ? cause.message : 'Calibration catalog unavailable';
			});
		return () => controller.abort();
	});
	function editResource(id: string) {
		activityId = id;
		const item = resources.find((r) => r.activity_id === id);
		vehicles = item?.available_vehicles;
		capacity = item?.vehicle_capacity;
		peak = item?.peak_passengers_per_departure;
		duty = item?.max_vehicle_duty_hours;
		depot = item?.depot_stop_ids?.[0] ?? '';
		battery = item?.battery_kwh;
		reserve = (item?.battery_reserve_share ?? 0.2) * 100;
		consumption = item?.energy_kwh_per_km;
		chargers = item?.charger_count;
		power = item?.charger_power_kw;
		chargingHours = item?.overnight_charging_hours;
		efficiency = (item?.charging_efficiency ?? 0.9) * 100;
	}
	function saveResource() {
		if (!currentActivity) {
			error = 'Select a service activity before adding resources.';
			return;
		}
		const next: FleetResources = {
			activity_id: activityId,
			depot_stop_ids: depot ? [depot] : [],
			...(vehicles !== undefined ? { available_vehicles: vehicles } : {}),
			...(capacity !== undefined ? { vehicle_capacity: capacity } : {}),
			...(peak !== undefined ? { peak_passengers_per_departure: peak } : {}),
			...(duty !== undefined ? { max_vehicle_duty_hours: duty } : {}),
			...(currentActivity.fleet === 'electric'
				? {
						battery_reserve_share: reserve / 100,
						charging_efficiency: efficiency / 100,
						...(battery !== undefined ? { battery_kwh: battery } : {}),
						...(consumption !== undefined ? { energy_kwh_per_km: consumption } : {}),
						...(chargers !== undefined ? { charger_count: chargers } : {}),
						...(power !== undefined ? { charger_power_kw: power } : {}),
						...(chargingHours !== undefined ? { overnight_charging_hours: chargingHours } : {})
					}
				: {})
		};
		const validationError = fleetResourceError(next);
		if (validationError) {
			error = validationError;
			message = '';
			return;
		}
		resources = [...resources.filter((r) => r.activity_id !== activityId), next];
		message = 'Resources saved in this proposal.';
		error = '';
	}
	async function validateRecords(incoming: unknown) {
		busy = true;
		error = '';
		message = '';
		try {
			const data = await api<{ records: (CalibrationRecord & { record_sha256: string })[] }>(
				'planning/calibration/validate',
				incoming
			);
			const clean = data.records.map((item) => {
				const record = { ...item } as CalibrationRecord & { record_sha256?: string };
				delete record.record_sha256;
				return record;
			});
			const existingRecords = new Map(records.map((record) => [record.id, record]));
			for (const record of clean) {
				const existing = existingRecords.get(record.id);
				if (existing && JSON.stringify(existing) !== JSON.stringify(record))
					throw new Error(
						`Record ${record.id} already exists. Use a new ID for a revised quotation.`
					);
			}
			records = [...records, ...clean.filter((record) => !existingRecords.has(record.id))];
			message = `${clean.length} evidence record${clean.length === 1 ? '' : 's'} validated. Select Apply to use a record.`;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Evidence validation failed';
		} finally {
			busy = false;
		}
	}
	async function addRecord() {
		await validateRecords({
			records: [
				{
					id: `quote:${crypto.randomUUID()}`,
					factor,
					value,
					unit: factors.find((item) => item.key === factor)?.unit,
					title,
					publisher,
					source_url: sourceUrl,
					published_date: publishedDate,
					valid_from: validFrom,
					valid_to: validTo || null,
					geography,
					basis,
					evidence_type: evidenceType,
					source_sha256: null
				}
			]
		});
	}
	async function importRecords(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		try {
			if (file.size > 1_000_000) throw new Error('Use an evidence register smaller than 1 MB.');
			await validateRecords(JSON.parse(await file.text()));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Evidence import failed';
		} finally {
			if (fileInput) fileInput.value = '';
		}
	}
	function exportRecords() {
		downloadJson({ records }, 'local-delivery-evidence.json');
	}
	function applyRecord(record: CalibrationRecord) {
		selection = { ...selection, [record.factor]: record.id };
		const manual = { ...costs };
		delete manual[record.factor];
		costs = manual;
		const energyManual = { ...energy };
		delete energyManual[record.factor];
		energy = energyManual;
		message =
			'Evidence selected for this proposal. Service-date validity is checked when evaluating.';
	}
	function removeRecord(record: CalibrationRecord) {
		records = records.filter((item) => item.id !== record.id);
		if (selection[record.factor] === record.id) {
			const next = { ...selection };
			delete next[record.factor];
			selection = next;
		}
	}
	function unapplyRecord(record: CalibrationRecord) {
		const next = { ...selection };
		delete next[record.factor];
		selection = next;
		message = 'Evidence selection cleared.';
	}
	async function calculateTariff() {
		const submitted = tariffInputs;
		busy = true;
		error = '';
		try {
			const result = await api<NonNullable<typeof tariffResult>>(
				'planning/calibration/tariff',
				JSON.parse(submitted)
			);
			if (submitted === tariffInputs) {
				tariffResult = result;
				tariffSignature = submitted;
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Tariff calculation failed';
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root class="delivery-calibration"
	><Card.Content>
		<div class="delivery-heading">
			<div>
				<p class="delivery-eyebrow">Operating costs and resources</p>
				<h3>Can this proposal operate?</h3>
			</div>
			<FileCheck size={22} />
		</div>
		<p class="delivery-note">
			Link local quotations and energy measurements, then check the proposed vehicle blocks against
			actual resources. Blank inputs stay unknown.
		</p>
		{#if error}<p class="delivery-error" role="alert">{error}</p>{/if}
		{#if message}<p class="delivery-message" role="status">{message}</p>{/if}
		<details>
			<summary>Cost and energy evidence <span>{records.length} records</span></summary>
			<div class="delivery-actions">
				<Button variant="outline" disabled={busy} onclick={() => fileInput?.click()}
					><Upload size={14} /> Import evidence JSON</Button
				><Button variant="outline" disabled={!records.length} onclick={exportRecords}
					><Download size={14} /> Export register</Button
				>
			</div>
			<input
				class="delivery-hidden"
				type="file"
				accept=".json,application/json"
				bind:this={fileInput}
				onchange={importRecords}
				aria-label="Import local delivery evidence"
			/>
			{#each records as record (record.id)}<div class="delivery-record">
					<div>
						<strong>{record.title}</strong>
						<p>{label(record.factor)} · {number(record.value)} {record.unit}</p>
						<p>
							<a href={record.source_url} target="_blank" rel="noreferrer">{record.publisher}</a> · {record.geography}
							· {record.valid_from}{record.valid_to ? `–${record.valid_to}` : ' onward'}
						</p>
						<p>{record.basis}</p>
						<Badge variant="outline">Your input · {label(record.evidence_type)}</Badge
						>{#if selection[record.factor] === record.id}<Badge>Selected</Badge
							>{/if}{#if record.valid_from > serviceDate || (record.valid_to && record.valid_to < serviceDate) || record.published_date > serviceDate}<p
								class="delivery-error"
							>
								Outside selected service date. Choose another date or record.
							</p>{/if}
					</div>
					<div class="delivery-record-actions">
						<Button
							variant="outline"
							onclick={() =>
								selection[record.factor] === record.id
									? unapplyRecord(record)
									: applyRecord(record)}
							>{selection[record.factor] === record.id ? 'Unapply' : 'Apply'}</Button
						><Button
							variant="ghost"
							size="icon"
							aria-label={`Remove ${record.title}`}
							onclick={() => removeRecord(record)}><Trash2 size={15} /></Button
						>
					</div>
				</div>{/each}
			{#if !records.length}<p class="delivery-note">
					No calibrated quotations loaded. Existing cost defaults remain labelled illustrations.
				</p>{/if}
			<details class="delivery-inner">
				<summary>Add a quotation or measurement</summary>
				<div class="delivery-fields">
					<div>
						<Label for="cal-factor">Planning factor</Label><NativeSelect.Root
							id="cal-factor"
							bind:value={factor}
							>{#each factors as item (item.key)}<NativeSelect.Option value={item.key}
									>{label(item.key)} · {item.unit}</NativeSelect.Option
								>{/each}</NativeSelect.Root
						>
					</div>
					<div>
						<Label for="cal-value"
							>Value · {factors.find((item) => item.key === factor)?.unit ?? ''}</Label
						><Input id="cal-value" type="number" min="0" step="any" bind:value />
					</div>
					<div>
						<Label for="cal-title">Document or quotation title</Label><Input
							id="cal-title"
							bind:value={title}
						/>
					</div>
					<div>
						<Label for="cal-publisher">Publisher or operator</Label><Input
							id="cal-publisher"
							bind:value={publisher}
						/>
					</div>
					<div>
						<Label for="cal-url">Source link</Label><Input
							id="cal-url"
							type="url"
							placeholder="https://…"
							bind:value={sourceUrl}
						/>
					</div>
					<div>
						<Label for="cal-geography">Applicable geography</Label><Input
							id="cal-geography"
							bind:value={geography}
						/>
					</div>
					<div>
						<Label for="cal-published">Published date</Label><Input
							id="cal-published"
							type="date"
							bind:value={publishedDate}
						/>
					</div>
					<div>
						<Label for="cal-from">Valid from</Label><Input
							id="cal-from"
							type="date"
							bind:value={validFrom}
						/>
					</div>
					<div>
						<Label for="cal-to">Valid until · optional</Label><Input
							id="cal-to"
							type="date"
							bind:value={validTo}
						/>
					</div>
					<div>
						<Label for="cal-kind">Evidence kind</Label><NativeSelect.Root
							id="cal-kind"
							bind:value={evidenceType}
							><NativeSelect.Option value="operator_quote">Operator quotation</NativeSelect.Option
							><NativeSelect.Option value="measurement">Measurement</NativeSelect.Option
							><NativeSelect.Option value="official_statistic"
								>Official statistic</NativeSelect.Option
							><NativeSelect.Option value="assumption">Explicit assumption</NativeSelect.Option
							></NativeSelect.Root
						>
					</div>
					<div class="delivery-full">
						<Label for="cal-basis">Inclusions, exclusions and calculation basis</Label><Input
							id="cal-basis"
							placeholder="Vehicle type, staffing, tax, measurement method, scale…"
							bind:value={basis}
						/>
					</div>
				</div>
				<Button
					disabled={busy ||
						value === undefined ||
						!title ||
						!publisher ||
						!sourceUrl ||
						basis.length < 8}
					onclick={addRecord}><Plus size={14} /> Add evidence record</Button
				>
			</details>
			<details class="delivery-inner">
				<summary>Energy calculation inputs</summary>
				<p class="delivery-note">
					Electric emissions = battery kWh/km ÷ charging efficiency × grid factor. Operating cost
					includes a separate non-energy cost input. Diesel uses litres/km × fuel price or carbon
					factor. Complete input sets replace per-km illustrations; direct per-km overrides take
					precedence.
				</p>
				<div class="delivery-fields">
					{#each energyFactors as item (item.key)}<div>
							<Label for={`energy-${item.key}`}>{label(item.key)} · {item.unit}</Label><Input
								id={`energy-${item.key}`}
								type="number"
								min="0"
								step="any"
								value={energy[item.key]}
								placeholder={selection[item.key] ? 'Selected evidence' : 'Not entered'}
								oninput={(event) => {
									const next = { ...energy };
									if (event.currentTarget.value === '') delete next[item.key];
									else next[item.key] = Number(event.currentTarget.value);
									energy = next;
								}}
							/>
						</div>{/each}
				</div>
			</details>
			{#if references.tariffs?.length}<details class="delivery-inner">
					<summary>Official electricity references and bill calculator</summary>
					<p class="delivery-note">
						STELCO tariffs use progressive 30-day bands. Calculate the extra base charge for one
						account using its existing consumption, rather than charging every unit at the highest
						band.
					</p>
					<div class="delivery-fields">
						<div class="delivery-full">
							<Label for="tariff-account">Account category</Label><NativeSelect.Root
								id="tariff-account"
								bind:value={tariffId}
								>{#each references.tariffs as item (item.id)}<NativeSelect.Option value={item.id}
										>{item.title}</NativeSelect.Option
									>{/each}</NativeSelect.Root
							>
						</div>
						<div>
							<Label for="tariff-existing">Existing account consumption · kWh/30 days</Label><Input
								id="tariff-existing"
								type="number"
								min="0"
								step="any"
								bind:value={baselineKwh}
							/>
						</div>
						<div>
							<Label for="tariff-added">Additional charging consumption · kWh/30 days</Label><Input
								id="tariff-added"
								type="number"
								min="0"
								step="any"
								bind:value={addedKwh}
							/>
						</div>
						<div>
							<Label for="tariff-fuel">Fuel adjustment · MVR/kWh · optional</Label><Input
								id="tariff-fuel"
								type="number"
								min="-10"
								step="any"
								bind:value={fuelAdjustment}
							/>
						</div>
					</div>
					<Button
						variant="outline"
						disabled={busy || baselineKwh === undefined || addedKwh === undefined}
						onclick={calculateTariff}>Calculate extra electricity charge</Button
					>
					{#if tariffResult}<div class="delivery-message">
							{#if tariffSignature !== tariffInputs}<strong>Inputs changed. Calculate again.</strong
								>{:else}<strong
									>Extra base charge: MVR {number(tariffResult.added_base_charge_mvr)}</strong
								>
								<p>
									With fuel adjustment: {tariffResult.added_charge_with_fuel_adjustment_mvr === null
										? 'Not entered'
										: `MVR ${number(tariffResult.added_charge_with_fuel_adjustment_mvr)}`}
								</p>
								<p>
									Effective extra base rate: {number(
										tariffResult.effective_added_base_rate_mvr_per_kwh
									)} MVR/kWh.
								</p>{/if}
							<p>{tariffResult.meaning}</p>
						</div>{/if}
					{#if references.historical_energy}<p class="delivery-note">
							<strong>Historical carbon reference:</strong>
							{references.historical_energy.reported_kg_co2_per_kwh} kg CO₂/kWh for STELCO {references
								.historical_energy.reference_year}. {references.historical_energy.meaning} It is not applied
							as a current CO₂e factor.
						</p>{/if}
					{#each references.sources ?? [] as source (source.id)}<p class="delivery-note">
							<a href={source.url} target="_blank" rel="noreferrer">{source.publisher} source</a> · {source.sha256
								? 'Captured source has a SHA-256 receipt'
								: 'Original download unavailable; indexed primary reference only'}
						</p>{/each}
					{#each references.limitations ?? [] as limit (limit)}<p class="delivery-note">
							{limit}
						</p>{/each}
				</details>{/if}
		</details>
		<details>
			<summary>Fleet capacity, depots and charging <span>{resources.length} plans</span></summary>
			<p class="delivery-note">
				Use peak onboard demand for one departure. Monthly passenger totals cannot identify
				route-level peak loads. Resources are dedicated to one route and propulsion group; sharing
				is not inferred.
			</p>
			<div>
				<Label for="resource-activity">Service activity</Label><NativeSelect.Root
					id="resource-activity"
					value={activityId}
					onchange={(event) => editResource(event.currentTarget.value)}
					><NativeSelect.Option value="">Select a route and propulsion</NativeSelect.Option
					>{#each activities as activity (activity.id)}<NativeSelect.Option value={activity.id}
							>{activity.name} · {activity.fleet}</NativeSelect.Option
						>{/each}</NativeSelect.Root
				>
			</div>
			{#if currentActivity}<div class="delivery-fields">
					<div>
						<Label for="resource-vehicles">Available vehicles · including reserve</Label><Input
							id="resource-vehicles"
							type="number"
							min="0"
							max="10000"
							bind:value={vehicles}
						/>
					</div>
					<div>
						<Label for="resource-capacity">Onboard capacity · per vehicle</Label><Input
							id="resource-capacity"
							type="number"
							min="1"
							max="10000"
							bind:value={capacity}
						/>
					</div>
					<div>
						<Label for="resource-demand">Peak passengers · per departure</Label><Input
							id="resource-demand"
							type="number"
							min="0"
							max="1000000"
							step="any"
							bind:value={peak}
						/>
					</div>
					<div>
						<Label for="resource-duty">Maximum vehicle duty · hours</Label><Input
							id="resource-duty"
							type="number"
							min="0.1"
							max="48"
							step="0.1"
							bind:value={duty}
						/>
					</div>
					<div class="delivery-full">
						<Label for="resource-depot">Depot terminal · no assumed deadhead</Label
						><NativeSelect.Root id="resource-depot" bind:value={depot}
							><NativeSelect.Option value="">Not entered</NativeSelect.Option
							>{#each stops as stop (stop.id)}<NativeSelect.Option value={stop.id}
									>{stop.name || stop.id}</NativeSelect.Option
								>{/each}</NativeSelect.Root
						>
					</div>
					{#if currentActivity.fleet === 'electric'}<div>
							<Label for="resource-battery">Battery capacity · kWh</Label><Input
								id="resource-battery"
								type="number"
								min="1"
								max="100000"
								step="any"
								bind:value={battery}
							/>
						</div>
						<div>
							<Label for="resource-reserve">Protected battery reserve · %</Label><Input
								id="resource-reserve"
								type="number"
								min="0"
								max="99"
								bind:value={reserve}
							/>
						</div>
						<div>
							<Label for="resource-energy">Battery consumption · kWh/km</Label><Input
								id="resource-energy"
								type="number"
								min="0.001"
								max="100"
								step="any"
								placeholder="Or selected energy evidence"
								bind:value={consumption}
							/>
						</div>
						<div>
							<Label for="resource-chargers">Dedicated chargers</Label><Input
								id="resource-chargers"
								type="number"
								min="0"
								max="10000"
								bind:value={chargers}
							/>
						</div>
						<div>
							<Label for="resource-power">Power · kW per charger</Label><Input
								id="resource-power"
								type="number"
								min="0.1"
								max="10000"
								step="any"
								bind:value={power}
							/>
						</div>
						<div>
							<Label for="resource-hours">Charging window · hours</Label><Input
								id="resource-hours"
								type="number"
								min="0.1"
								max="24"
								step="0.1"
								bind:value={chargingHours}
							/>
						</div>
						<div>
							<Label for="resource-efficiency">Charging efficiency · %</Label><Input
								id="resource-efficiency"
								type="number"
								min="1"
								max="100"
								bind:value={efficiency}
							/>
						</div>{/if}
				</div>
				<Button onclick={saveResource}>Save resource envelope</Button>{/if}
			{#each resources as resource (resource.activity_id)}<div class="delivery-record">
					<div>
						<strong
							>{activities.find((item) => item.id === resource.activity_id)?.name ||
								resource.activity_id}</strong
						>
						<p>
							{number(resource.available_vehicles)} vehicles · capacity {number(
								resource.vehicle_capacity
							)} · peak {number(resource.peak_passengers_per_departure)}
						</p>
					</div>
					<div class="delivery-record-actions">
						<Button variant="outline" onclick={() => editResource(resource.activity_id)}
							>Edit</Button
						><Button
							variant="ghost"
							size="icon"
							aria-label={`Remove resource envelope ${resource.activity_id}`}
							onclick={() =>
								(resources = resources.filter((item) => item.activity_id !== resource.activity_id))}
							><Trash2 size={15} /></Button
						>
					</div>
				</div>{/each}
			{#if resources.length && !supportedAudits.length}<p class="delivery-note">
					Recalculate delivery to screen the actual vehicle blocks. Inactive routes have no
					service-day audit.
				</p>{/if}
			{#if stale && supportedAudits.length}<p class="delivery-error">
					Inputs changed. Recalculate before using these resource checks.
				</p>{/if}
			{#each supportedAudits as activity (activity.activity_id)}{#if activity.resource_audit}<div
						class="delivery-audit"
					>
						<h4>
							{activity.name}
							<Badge variant="outline"
								>{stale ? 'Needs recalculation' : label(activity.resource_audit.status)}</Badge
							>
						</h4>
						{#each activity.resource_audit.checks as check (check.key)}<div class="delivery-check">
								<div>
									<strong>{label(check.key)}</strong>
									<p>{check.explanation}</p>
								</div>
								<div>
									<Badge variant={check.status === 'failed' ? 'destructive' : 'outline'}
										>{stale ? 'Stale' : check.status}</Badge
									>
									<p>
										Required: {number(check.required)}<br />Available: {number(check.available)}
									</p>
								</div>
							</div>{/each}
						<p class="delivery-note">{activity.resource_audit.meaning}</p>
					</div>{/if}{/each}
		</details>
		<p class="delivery-note">
			Evidence and resource plans stay with this browser's proposal and its JSON export. Linked
			evidence is not independently certified. Resource checks are necessary screens, not dispatch
			approval.
		</p>
	</Card.Content></Card.Root
>

<style>
	.delivery-heading,
	.delivery-record,
	.delivery-check {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
	}
	.delivery-heading h3 {
		margin: 0;
		font-size: 1.1rem;
	}
	.delivery-eyebrow {
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 0.67rem;
		margin: 0 0 0.3rem;
	}
	.delivery-note {
		font-size: 0.78rem;
		color: var(--muted-foreground);
		line-height: 1.65;
		margin: 0.8rem 0;
	}
	details {
		margin-top: 1rem;
		border-top: 1px solid var(--border);
		padding-top: 0.8rem;
	}
	summary {
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 600;
		padding: 0.2rem 0;
	}
	summary span {
		color: var(--muted-foreground);
		font-weight: 400;
		font-size: 0.74rem;
		margin-left: 0.4rem;
	}
	.delivery-inner {
		background: color-mix(in srgb, var(--muted) 50%, transparent);
		padding: 0.8rem;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
	}
	.delivery-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.8rem;
		margin: 1rem 0;
	}
	.delivery-fields > div {
		min-width: 0;
	}
	.delivery-full {
		grid-column: 1 / -1;
	}
	.delivery-record {
		border-bottom: 1px solid var(--border);
		padding: 0.9rem 0;
		font-size: 0.8rem;
	}
	.delivery-record > div:first-child {
		min-width: 0;
	}
	.delivery-record p,
	.delivery-check p {
		font-size: 0.74rem;
		line-height: 1.6;
		color: var(--muted-foreground);
		margin: 0.3rem 0;
		overflow-wrap: anywhere;
	}
	.delivery-record a {
		color: var(--primary);
		text-decoration: underline;
	}
	.delivery-record-actions,
	.delivery-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.delivery-actions {
		margin: 0.8rem 0;
	}
	.delivery-record-actions {
		flex-shrink: 0;
	}
	.delivery-check {
		padding: 0.9rem 0;
		border-bottom: 1px solid var(--border);
		font-size: 0.78rem;
	}
	.delivery-check > div:first-child {
		flex: 1;
	}
	.delivery-check > div:last-child {
		min-width: 7rem;
	}
	.delivery-audit {
		margin-top: 1rem;
	}
	.delivery-audit h4 {
		font-size: 0.85rem;
	}
	.delivery-error {
		font-size: 0.78rem;
		line-height: 1.6;
		color: var(--destructive);
	}
	.delivery-message {
		font-size: 0.78rem;
		line-height: 1.6;
		background: var(--muted);
		padding: 0.7rem;
		border-radius: 0.5rem;
	}
	.delivery-hidden {
		display: none;
	}
	@media (max-width: 600px) {
		.delivery-fields {
			grid-template-columns: 1fr;
		}
		.delivery-record,
		.delivery-check {
			flex-direction: column;
			gap: 0.5rem;
		}
		.delivery-record-actions {
			align-self: flex-start;
		}
		.delivery-check > div:last-child {
			display: flex;
			gap: 0.75rem;
			align-items: flex-start;
		}
	}
</style>
