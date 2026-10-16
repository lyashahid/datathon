<script lang="ts">
	import {
		ArrowLeft,
		ArrowUpRight,
		BusFront,
		Check,
		Download,
		Info,
		LoaderCircle,
		Maximize2,
		MapPin,
		Minimize2,
		Ship,
		TrendingUp,
		X
	} from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import { shouldAnimateMotion } from '#lib/motion.js';
	import { resizable, toggleResizableMaximized } from '#lib/resizable.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import TransportImpact from './TransportImpact.svelte';
	import { transportImpactHeadline } from '#lib/transport-impact.js';
	import {
		downloadProposalPdf,
		finiteValue,
		fiscalProjections,
		formatAmount,
		operationLabel,
		operationName,
		proposedBusServiceGroups,
		proposedFerryServiceGroups,
		type PlanningEvaluation,
		type PlanningReviewRequest
	} from '#lib/proposal-review.js';

	let {
		open,
		title = 'Community investment proposal',
		islandName = 'Selected area',
		request,
		evaluation = null,
		pending = false,
		stale = false,
		error = '',
		onClose = () => {},
		onEvaluate = () => {},
		onFocusOperation
	}: {
		open: boolean;
		title?: string;
		islandName?: string;
		request: PlanningReviewRequest;
		evaluation?: PlanningEvaluation | null;
		pending?: boolean;
		stale?: boolean;
		error?: string;
		onClose?: () => void;
		onEvaluate?: () => void;
		onFocusOperation?: (index: number) => void;
	} = $props();
	let dialog = $state<HTMLDialogElement | null>(null);
	let dialogVisible = $state(false);
	let exporting = $state(false);
	let exportError = $state('');
	let maximized = $state(false);
	let dialogAnimation: Animation | null = null;
	let dialogMotionVersion = 0;
	let expectedCloseEvents = 0;
	const summary = $derived(evaluation?.summary);
	const economics = $derived(evaluation?.economics);
	const capital = $derived(finiteValue(economics?.delta.capital_mvr));
	const annual = $derived(finiteValue(economics?.delta.annual_operating_mvr));
	const projections = $derived(fiscalProjections(capital, annual));
	const maximumSpend = $derived(Math.max(1, ...projections.map((row) => Math.abs(row.total ?? 0))));
	const population = $derived(finiteValue(summary?.population));
	const before = $derived(finiteValue(summary?.baseline_reachable_residents));
	const after = $derived(finiteValue(summary?.scenario_reachable_residents));
	const gained = $derived(finiteValue(summary?.gained_residents));
	const lost = $derived(finiteValue(summary?.lost_residents));
	const unknown = $derived(finiteValue(summary?.unknown_residents));
	const target = $derived(
		finiteValue(evaluation?.target_minutes ?? request.assumptions.target_minutes) ?? 30
	);
	const goal = $derived(
		request.assumptions.goal === 'transport'
			? 'public transport'
			: request.assumptions.goal === 'education'
				? 'education'
				: 'healthcare'
	);
	const walkingGoal = $derived(request.assumptions.goal === 'transport');
	const transport = $derived(evaluation?.transport_connectivity);
	const transportImpact = $derived(transport?.impact);
	const transportBenefitHeadline = $derived(transportImpactHeadline(transportImpact));
	const proposedFerries = $derived(proposedFerryServiceGroups(transport?.after));
	const proposedBuses = $derived(proposedBusServiceGroups(transport?.after));
	const proposedServices = $derived([...proposedBuses, ...proposedFerries]);
	const hasFerryProposal = $derived(
		request.operations.some((operation) => operation.service?.mode === 'ferry') ||
			!!transportImpact?.lines?.some((line) => line.mode === 'ferry' && line.change !== 'unchanged')
	);
	const hasBusProposal = $derived(
		request.operations.some((operation) => operation.service?.mode === 'bus') ||
			proposedBuses.length > 0 ||
			!!transportImpact?.lines?.some((line) => line.mode === 'bus' && line.change !== 'unchanged')
	);
	const hasTransportProposal = $derived(hasBusProposal || hasFerryProposal);
	const proposalItems = $derived(
		request.operations.flatMap((operation, index) =>
			typeof operation.metadata?.ui_package === 'string' &&
			((operation.metadata.ui_package.startsWith('ferry-service:') &&
				!operation.metadata.ui_ferry_summary) ||
				(operation.metadata.ui_package.startsWith('bus-route:') &&
					!operation.metadata.ui_bus_summary))
				? []
				: [{ operation, index }]
		)
	);
	const maximumBand = $derived(
		Math.max(
			1,
			...(evaluation
				? [...evaluation.travel_time_bands.before, ...evaluation.travel_time_bands.after].map(
						(row) => row.residents ?? 0
					)
				: [])
		)
	);
	const warnings = $derived([
		...new Set([...(evaluation?.warnings ?? []), ...(economics?.warnings ?? [])])
	]);
	const withinCapital = $derived(economics?.budget.capital_within_budget);
	const annualRemaining = $derived(finiteValue(economics?.budget.annual_remaining_mvr));
	const withinOperating = $derived(annualRemaining === null ? null : annualRemaining >= 0);
	const ready = $derived(evaluation !== null && !pending && !stale);

	$effect(() => {
		if (!dialog) return;
		const element = dialog;
		const shouldOpen = open;
		const version = ++dialogMotionVersion;
		const interrupted = dialogAnimation !== null;
		const current = interrupted ? getComputedStyle(element) : null;
		const from = current ? { opacity: current.opacity, transform: current.transform } : null;
		dialogAnimation?.cancel();
		dialogAnimation = null;
		if (!shouldOpen && !element.open) {
			dialogVisible = false;
			return;
		}
		if (shouldOpen && !element.open) element.showModal();
		dialogVisible = true;
		if (!shouldAnimateMotion()) {
			if (!shouldOpen) {
				closeDialog(element);
				dialogVisible = false;
			}
			return;
		}
		const settled = { opacity: '1', transform: 'scale(1)' };
		const dismissed = {
			opacity: '0',
			transform: 'scale(0.985)'
		};
		const animation = element.animate(
			[from ?? (shouldOpen ? dismissed : settled), shouldOpen ? settled : dismissed],
			{
				duration: shouldOpen ? 230 : 150,
				easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
				fill: 'forwards'
			}
		);
		dialogAnimation = animation;
		void animation.finished.then(
			() => {
				if (version !== dialogMotionVersion) return;
				if (!shouldOpen) {
					closeDialog(element);
					dialogVisible = false;
				}
				animation.cancel();
				dialogAnimation = null;
			},
			() => {}
		);
	});
	$effect(() => {
		if (!dialog) return;
		const element = dialog;
		const updateMaximized = () => {
			maximized = element.dataset.resizableMaximized === 'true';
		};
		element.addEventListener('resizablechange', updateMaximized);
		return () => element.removeEventListener('resizablechange', updateMaximized);
	});
	onDestroy(() => {
		++dialogMotionVersion;
		dialogAnimation?.cancel();
	});
	function closeDialog(element: HTMLDialogElement) {
		if (!element.open) return;
		expectedCloseEvents += 1;
		element.close();
	}
	function percentage(value: number | null) {
		return value === null || population === null || population <= 0
			? 'Unavailable'
			: `${((value / population) * 100).toFixed(1)}%`;
	}
	async function exportPdf() {
		if (!ready || exporting) return;
		exporting = true;
		exportError = '';
		try {
			await downloadProposalPdf(request, title);
		} catch (cause) {
			exportError = cause instanceof Error ? cause.message : 'PDF export failed. Please retry.';
		} finally {
			exporting = false;
		}
	}
	function focusOperation(index: number) {
		onClose();
		onFocusOperation?.(index);
	}
</script>

<dialog
	bind:this={dialog}
	use:resizable={{
		key: 'proposal-review',
		enabled: dialogVisible,
		minWidth: 720,
		minHeight: 440,
		anchor: 'center',
		viewportMargin: 16
	}}
	class="forecast-review"
	data-motion={open ? 'open' : 'closing'}
	aria-labelledby="proposal-forecast-title"
	oncancel={(event) => {
		event.preventDefault();
		onClose();
	}}
	onclose={() => {
		if (expectedCloseEvents > 0) expectedCloseEvents -= 1;
		else if (open) onClose();
	}}
>
	<div class="forecast-shell" aria-busy={pending}>
		<header class="forecast-header">
			<Button variant="ghost" onclick={onClose} class="back-to-map"
				><ArrowLeft size={16} /> Back to map</Button
			>
			<div class="header-actions">
				<Badge variant="outline">Draft proposal</Badge>
				<Button
					variant="ghost"
					size="icon"
					class="review-size-control"
					aria-label={maximized ? 'Restore review size' : 'Maximize review'}
					title={maximized ? 'Restore review size' : 'Maximize review'}
					onclick={() => {
						if (dialog) maximized = toggleResizableMaximized(dialog);
					}}
					>{#if maximized}<Minimize2 size={17} />{:else}<Maximize2 size={17} />{/if}</Button
				><Button variant="outline" onclick={exportPdf} disabled={!ready || exporting}
					><Download size={15} />{exporting ? 'Preparing PDF…' : 'Save as PDF'}</Button
				><Button variant="ghost" size="icon" aria-label="Close proposal review" onclick={onClose}
					><X size={18} /></Button
				>
			</div>
		</header>
		<main class="forecast-content">
			<div class="report-heading">
				<div>
					<span class="eyebrow">{islandName} · Decision brief</span>
					<h1 id="proposal-forecast-title">{title}</h1>
					<p>
						{hasTransportProposal
							? 'Transport services, return journeys, resident access and the full funding commitment.'
							: 'What changes for residents, what it costs, and what the evidence can support.'}
					</p>
				</div>
				<div class="report-date">
					<small>Evaluation date</small><strong
						>{String(request.assumptions.date ?? 'Not selected')}</strong
					><span>{request.assumptions.population_year ?? 'Selected year'} resident projection</span>
				</div>
			</div>
			{#if error || exportError}<div class="report-alert error" role="alert">
					{error || exportError}
				</div>{/if}
			{#if pending}<div class="report-alert" role="status">
					<LoaderCircle size={16} class="report-spinner" /> Recalculating journeys and costs for your
					latest changes…
				</div>
			{:else if stale}<div class="report-alert stale" role="status">
					<Info size={16} /><span
						>Your proposal changed. These results describe the previous version.</span
					><Button size="sm" onclick={onEvaluate}>Update impact</Button>
				</div>{/if}
			{#if !evaluation}
				<section class="empty-review">
					<span class="empty-icon"><TrendingUp size={28} /></span>
					<h2>See the impact of your proposal</h2>
					<p>
						Compare the same resident areas and services before and after your changes. Costs use
						editable planning assumptions.
					</p>
					<Button onclick={onEvaluate} disabled={pending || !request.operations.length}
						>{pending ? 'Calculating…' : 'Calculate forecast and impact'}<ArrowUpRight
							size={16}
						/></Button
					>{#if !request.operations.length}<p>Add a proposed change on the map first.</p>{/if}
				</section>
			{:else}
				<div class="headline-metrics" class:outdated={stale || pending}>
					<article class="metric reach">
						{#if transportBenefitHeadline}<small>Transport service benefit</small><strong
								class="service-headline">{transportBenefitHeadline}</strong
							><span>Scheduled service comparison; walking access is shown separately below.</span>
						{:else if hasTransportProposal}<small
								>{hasBusProposal && hasFerryProposal
									? 'Transport services in your proposal'
									: hasBusProposal
										? 'Bus services in your proposal'
										: 'Ferry services in your proposal'}</small
							><strong>{transport ? proposedServices.length : 'Unavailable'}</strong><span
								>Departure schedules are reviewed separately from resident access.</span
							>{:else}<small>Residents gaining {goal} access</small><strong
								>{formatAmount(gained)}</strong
							><span
								>Newly within {target} minutes{walkingGoal ? ' on foot' : ''} in this model</span
							>{/if}
					</article>
					<article class="metric">
						<small>One-time investment</small><strong>MVR {formatAmount(capital, true)}</strong
						><span
							>{withinCapital === false
								? 'Exceeds your capital budget'
								: withinCapital === true
									? 'Within your capital budget'
									: 'Capital budget not set'}</span
						>
					</article>
					<article class="metric">
						<small>Added yearly running cost</small><strong>MVR {formatAmount(annual, true)}</strong
						><span
							>{withinOperating === false
								? 'Exceeds your annual budget'
								: withinOperating === true
									? 'Within your annual budget'
									: 'See operating assumptions below'}</span
						>
					</article>
					<article class="metric">
						<small>10-year added commitment</small><strong
							>MVR {formatAmount(projections[2].total, true)}</strong
						><span>Capital + 10 years of added operating cost</span>
					</article>
				</div>
				{#if transport && hasTransportProposal}<section
						class="report-card transport-card"
						class:outdated={stale || pending}
						aria-label="Public transport and island connections"
					>
						<div class="section-heading">
							<div>
								<span class="eyebrow">Public transport & island connections</span>
								<h2>
									{hasBusProposal && hasFerryProposal
										? 'What your transport services change'
										: hasBusProposal
											? 'What the bus service changes'
											: 'What the ferry service changes'}
								</h2>
							</div>
							{#if hasBusProposal}<BusFront size={23} />{:else}<Ship size={23} />{/if}
						</div>
						<p>
							Compare waiting times, dated departures and direct island connections. Walking to a
							stop can stay the same while your service improves.
						</p>
						<TransportImpact impact={transportImpact} />
						{#if hasFerryProposal}<div class="transport-cost-note">
								<span><strong>MVR 0</strong> new port construction for this ferry service</span>
								<p>
									Existing landing places are reused. Vessel procurement and yearly operation are
									included in the proposal costs above; a mapped landing place still needs
									suitability and permission checks.
								</p>
							</div>{/if}
						{#if hasBusProposal}<p class="method-note">
								Bus vehicle procurement and service operation are included in the proposal costs.
								Walking access counts residents near boarding points; changing a route or frequency
								can improve service without changing that walking distance. Healthcare and education
								comparisons use the modeled journeys and timetable.
							</p>{/if}
						<p class="method-note">{transport.after.qualification}</p>
					</section>{/if}
				<div class="report-grid">
					<section class="report-card access-card">
						<div class="section-heading">
							<div>
								<span class="eyebrow">Resident access</span>
								<h2>Before and after</h2>
							</div>
							<Badge variant="secondary">{target}-minute target</Badge>
						</div>
						<p>
							Residents with a modeled {walkingGoal
								? 'walk to a bus stop or ferry landing place'
								: `journey to ${goal}`}. Each resident origin is counted once, even if several
							proposed sites serve it.
						</p>
						<div class="access-bars">
							{#each [{ label: 'Current services', count: before, className: 'baseline' }, { label: 'With your proposal', count: after, className: 'proposed' }] as row (row.label)}<div
									class="access-row"
								>
									<div>
										<strong>{row.label}</strong><span
											>{formatAmount(row.count)}
											<small>residents · {percentage(row.count)}</small></span
										>
									</div>
									<div class="access-track" aria-hidden="true">
										<span
											class={row.className}
											style:width={`${population && row.count !== null ? Math.min(100, Math.max(0, (row.count / population) * 100)) : 0}%`}
										></span>
									</div>
								</div>{/each}
						</div>
						<div class="access-footnotes">
							<div>
								<strong>{formatAmount(lost)}</strong><span
									>Move outside the target with a known journey</span
								>
							</div>
							<div>
								<strong>{formatAmount(unknown)}</strong><span
									>Residents whose proposal journey evidence is unavailable</span
								>
							</div>
						</div>
						<p class="method-note">
							{evaluation.population_basis ||
								'No source-backed resident allocation is available for this scope.'} Missing journey evidence
							is not proof of no access.
						</p>
					</section>
					<section class="report-card">
						<div class="section-heading">
							<div>
								<span class="eyebrow">Your proposed changes</span>
								<h2>
									{proposalItems.length}
									{proposalItems.length === 1 ? 'intervention' : 'interventions'}
								</h2>
							</div>
							<MapPin size={19} />
						</div>
						<ol class="site-list">
							{#each proposalItems as { operation, index }, rowNumber (index)}<li>
									<span class="site-number">{rowNumber + 1}</span>
									<div>
										<strong>{operationName(operation)}</strong><small
											>{operation.metadata?.ui_ferry_summary
												? 'Return ferry service · existing landing places'
												: operation.metadata?.ui_bus_summary
													? 'Bus stop and return bus service'
													: operationLabel(operation)}</small
										>{#if operation.coordinates}<span
												>Placed on the map{#if operation.island_id}
													· {operation.island_id}{/if}</span
											>{/if}
									</div>
									{#if onFocusOperation && (operation.coordinates || operation.metadata?.ui_map_features)}<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`View ${operationName(operation)} on map`}
											onclick={() => focusOperation(index)}><ArrowUpRight size={16} /></Button
										>{/if}
								</li>{/each}
						</ol>
						{#if !request.operations.length}<p>
								No proposed changes. This is the baseline comparison.
							</p>{/if}
						<p class="method-note">
							This is a draft for review. A budget match or an access improvement does not grant
							planning approval.
						</p>
					</section>
				</div>
				<section class="report-card fiscal-card">
					<div class="section-heading">
						<div>
							<span class="eyebrow">Fiscal outlook</span>
							<h2>Your 1, 5 and 10-year commitment</h2>
						</div>
						<Badge variant="outline">MVR · undiscounted</Badge>
					</div>
					<p>
						A transparent cost projection with the same annual service level throughout. Capital is
						paid once; the added annual operating cost repeats each year.
					</p>
					<div class="fiscal-layout">
						<div class="fiscal-chart" aria-hidden="true">
							{#each projections as row (row.years)}<div class="fiscal-bar-group">
									<span>MVR {formatAmount(row.total, true)}</span>
									<div class="fiscal-track">
										<div
											class="fiscal-bar"
											style:height={`${row.total === null ? 0 : Math.max(2, (Math.abs(row.total) / maximumSpend) * 100)}%`}
											class:saving={(row.total ?? 0) < 0}
										></div>
									</div>
									<strong>{row.years === 1 ? 'Year 1' : `${row.years} years`}</strong>
								</div>{/each}
						</div>
						<div class="fiscal-table-wrap">
							<table>
								<caption class="sr-only"
									>Added project costs across fiscal horizons in Maldivian rufiyaa</caption
								><thead
									><tr
										><th>Horizon</th><th>Capital once</th><th>Operating total</th><th
											>Added total</th
										></tr
									></thead
								><tbody
									>{#each projections as row (row.years)}<tr
											><th>{row.years} {row.years === 1 ? 'year' : 'years'}</th><td
												>{formatAmount(row.capital)}</td
											><td>{formatAmount(row.operating)}</td><td
												><strong>{formatAmount(row.total)}</strong></td
											></tr
										>{/each}</tbody
								>
							</table>
							<p class="method-note">
								Formula: added capital + years × added annual operating cost. No inflation,
								discounting, financing, replacement cycle, residual value or demand growth is
								assumed. Negative values represent modeled savings.
							</p>
						</div>
					</div>
					{#if economics?.sensitivity}<p class="method-note">
							Capital sensitivity: MVR {formatAmount(
								economics.sensitivity.capital_mvr.low
							)}–{formatAmount(economics.sensitivity.capital_mvr.high)}. {economics.sensitivity
								.meaning}
						</p>{/if}
				</section>
				<div class="report-grid">
					<section class="report-card">
						<div class="section-heading">
							<div>
								<span class="eyebrow">Journey distribution</span>
								<h2>Who remains further away?</h2>
							</div>
						</div>
						<div class="band-key">
							<span><i class="baseline-key"></i>Current</span><span
								><i class="proposed-key"></i>Proposal</span
							>
						</div>
						<div class="band-chart">
							{#each evaluation.travel_time_bands.before as band, index (band.label)}{@const proposed =
									evaluation.travel_time_bands.after[index]}
								<div class="band">
									<div>
										<strong>{band.label}</strong><small
											>{formatAmount(band.residents)} → {formatAmount(proposed?.residents)}</small
										>
									</div>
									<div class="band-track" aria-hidden="true">
										<span
											class="baseline"
											style:width={`${((band.residents ?? 0) / maximumBand) * 100}%`}
										></span>
									</div>
									<div class="band-track" aria-hidden="true">
										<span
											class="proposed"
											style:width={`${((proposed?.residents ?? 0) / maximumBand) * 100}%`}
										></span>
									</div>
								</div>{/each}
						</div>
						<p class="method-note">
							Access is a conditional scenario calculation at the selected date and departure time.
							It does not predict admissions, school capacity, actual ridership or future causal
							outcomes.
						</p>
					</section>
					<section class="report-card">
						<div class="section-heading">
							<div>
								<span class="eyebrow">Budget and environment</span>
								<h2>Delivery considerations</h2>
							</div>
						</div>
						<dl class="delivery-stats">
							<div>
								<dt>Capital remaining</dt>
								<dd class:exceeded={withinCapital === false}>
									MVR {formatAmount(economics?.budget.capital_remaining_mvr)}
								</dd>
							</div>
							<div>
								<dt>Annual operating budget remaining</dt>
								<dd class:exceeded={withinOperating === false}>
									MVR {formatAmount(economics?.budget.annual_remaining_mvr)}
								</dd>
							</div>
							<div>
								<dt>Additional vehicles required</dt>
								<dd>{formatAmount(economics?.delta.additional_fleet)}</dd>
							</div>
							<div>
								<dt>Net annual emissions change</dt>
								<dd>{formatAmount(economics?.delta.net_annual_kg_co2e)} kg CO₂e</dd>
							</div>
							<div>
								<dt>Construction emissions change</dt>
								<dd>{formatAmount(economics?.delta.embodied_facility_kg_co2e)} kg CO₂e</dd>
							</div>
						</dl>
						<p class="method-note">
							Unknown costs or emissions stay unavailable. Operating emissions include facility use
							only when an explicit estimate is provided. Avoided transport emissions depend on your
							displaced passenger-kilometre assumption.
						</p>
					</section>
				</div>
				<section class="report-card evidence-card">
					<div class="section-heading">
						<div>
							<span class="eyebrow">Evidence and assumptions</span>
							<h2>What to know before a decision</h2>
						</div>
						<Info size={19} />
					</div>
					<p>{evaluation.coverage.meaning}</p>
					<p>{evaluation.access_method}</p>
					{#if warnings.length}<details class="evidence-disclosure">
							<summary>{warnings.length} evidence notes and limitations</summary>
							<ul>
								{#each warnings as warning (warning)}<li>{warning}</li>{/each}
							</ul>
						</details>{/if}
					<details class="evidence-disclosure">
						<summary>Calculation inputs and source receipts</summary>
						<div class="source-details">
							<h3>Evaluation assumptions</h3>
							<pre>{JSON.stringify(evaluation.assumptions, null, 2)}</pre>
							<h3>Cost factors</h3>
							<p>{economics?.basis}</p>
							<pre>{JSON.stringify(economics?.assumptions, null, 2)}</pre>
							{#if economics?.calibration}<p>{economics.calibration.meaning}</p>
								<pre>{JSON.stringify(economics.calibration.factor_basis, null, 2)}</pre>{/if}
							<h3>Source receipts</h3>
							<pre>{JSON.stringify(evaluation.source_receipts, null, 2)}</pre>
							<h3>Model and data versions</h3>
							<pre>{JSON.stringify(evaluation.version_pins, null, 2)}</pre>
						</div>
					</details>
				</section>
				<footer class="report-footer">
					<span><Check size={15} /> Draft remains editable on the map</span><Button
						onclick={exportPdf}
						disabled={!ready || exporting}
						><Download size={16} />{exporting ? 'Preparing PDF…' : 'Save proposal as PDF'}</Button
					>
				</footer>
			{/if}
		</main>
	</div>
</dialog>

<style>
	.forecast-review {
		width: min(1280px, calc(100vw - 32px));
		max-width: calc(100vw - 32px);
		height: calc(100dvh - 32px);
		max-height: calc(100dvh - 32px);
		inset: 0;
		margin: auto;
		border: 1px solid color-mix(in srgb, var(--border), transparent 20%);
		border-radius: 22px;
		padding: 0;
		background: var(--background);
		color: var(--foreground);
		overflow: hidden;
		box-shadow:
			0 28px 90px #14282029,
			0 2px 10px #14282012;
		transform-origin: center;
		container-type: inline-size;
		container-name: proposal-review;
	}
	.forecast-review::backdrop {
		background: #17251f66;
		opacity: 1;
		transition: opacity 150ms ease-out;
	}
	.forecast-review[data-motion='closing']::backdrop {
		opacity: 0;
	}
	:global(html[data-motion-input='keyboard']) .forecast-review::backdrop {
		transition: none;
	}
	@starting-style {
		.forecast-review::backdrop {
			opacity: 0;
		}
	}
	.forecast-review:not([open]) {
		display: none;
	}
	.forecast-shell {
		height: 100%;
		display: flex;
		flex-direction: column;
	}
	.forecast-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 28px;
		border-bottom: 1px solid var(--border);
		background: var(--card);
		flex-shrink: 0;
	}
	.header-actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.forecast-content {
		overflow: auto;
		flex: 1;
		padding: 36px max(28px, calc((100cqw - 1180px) / 2));
		overscroll-behavior: contain;
	}
	.report-heading {
		display: flex;
		justify-content: space-between;
		gap: 24px;
		margin-bottom: 26px;
	}
	.report-heading h1 {
		margin: 8px 0 10px;
		max-width: 840px;
	}
	.report-heading p,
	.report-card > p {
		color: var(--muted-foreground);
	}
	.eyebrow {
		font-size: 10px;
		font-weight: 650;
		color: var(--muted-foreground);
		letter-spacing: 0.9px;
		text-transform: uppercase;
	}
	.report-date {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
		padding-top: 5px;
		flex-shrink: 0;
	}
	.report-date small,
	.report-date span {
		font-size: 11px;
		color: var(--muted-foreground);
	}
	.report-date strong {
		font-size: 15px;
	}
	.report-alert {
		display: flex;
		align-items: center;
		gap: 10px;
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 12px 15px;
		margin-bottom: 18px;
		background: var(--card);
		font-size: 12px;
	}
	.report-alert.error {
		background: #fff2f0;
		color: var(--destructive);
	}
	.report-alert.stale {
		background: #fff9ed;
	}
	.report-alert :global(button) {
		margin-left: auto;
	}
	.report-alert :global(.report-spinner) {
		animation: turn 0.8s linear infinite;
	}
	@keyframes turn {
		to {
			transform: rotate(360deg);
		}
	}
	.headline-metrics {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 14px;
		margin-bottom: 20px;
	}
	.metric {
		background: var(--card);
		padding: 22px;
		border: 1px solid var(--border);
		border-radius: 18px;
		min-width: 0;
	}
	.metric.reach {
		background: #e8efdf;
		border-color: #dce7d0;
	}
	.metric small {
		font-size: 11px;
		color: #62636a;
		display: block;
		line-height: 1.5;
	}
	.metric strong {
		display: block;
		font-size: clamp(22px, 2.2cqw, 30px);
		font-weight: 580;
		letter-spacing: -1px;
		margin: 12px 0;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	.metric span {
		font-size: 10px;
		color: #6a6e6b;
		line-height: 1.6;
		display: block;
	}
	.metric strong.service-headline {
		font-size: clamp(20px, 2.1cqw, 29px);
		line-height: 1.25;
		letter-spacing: -0.6px;
		overflow-wrap: anywhere;
	}
	.outdated .metric strong {
		color: var(--muted-foreground);
	}
	.report-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
		gap: 20px;
		margin-bottom: 20px;
	}
	.transport-card {
		margin-bottom: 20px;
		border-color: #c7dfe3;
		background: #faffff;
	}
	.transport-card .section-heading > :global(svg) {
		color: #437c8b;
	}
	.transport-cost-note {
		display: flex;
		gap: 25px;
		padding: 18px 0 0;
		margin-top: 22px;
		border-top: 1px solid #dfeaec;
		align-items: center;
	}
	.transport-cost-note > span {
		font-size: 10px;
		color: #6d868d;
		flex-shrink: 0;
		display: grid;
		gap: 5px;
	}
	.transport-cost-note strong {
		font-size: 21px;
		font-weight: 600;
		color: #376c79;
		letter-spacing: -0.5px;
	}
	.transport-cost-note p {
		margin: 0;
		font-size: 11px;
		color: #73888e;
		line-height: 1.8;
	}
	.report-card {
		border: 1px solid var(--border);
		border-radius: 20px;
		background: var(--card);
		padding: 26px;
		min-width: 0;
	}
	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 14px;
	}
	.section-heading h2 {
		font-size: 20px;
		margin-top: 5px;
	}
	.section-heading > :global(svg) {
		color: var(--muted-foreground);
	}
	.access-bars {
		display: grid;
		gap: 22px;
		margin: 25px 0;
	}
	.access-row > div:first-child {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 10px;
		font-size: 12px;
	}
	.access-row strong {
		font-weight: 550;
	}
	.access-row span small {
		color: var(--muted-foreground);
		font-size: 10px;
	}
	.access-track {
		height: 13px;
		background: var(--muted);
		border-radius: 10px;
		overflow: hidden;
	}
	.access-track span,
	.band-track span {
		display: block;
		height: 100%;
		border-radius: inherit;
	}
	.baseline {
		background: #c2b7dc;
	}
	.proposed {
		background: #89ad71;
	}
	.access-footnotes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
		padding: 18px 0;
		border-top: 1px solid var(--border);
	}
	.access-footnotes div {
		display: grid;
		gap: 5px;
	}
	.access-footnotes strong {
		font-size: 20px;
		font-variant-numeric: tabular-nums;
	}
	.access-footnotes span {
		font-size: 10px;
		line-height: 1.6;
		color: var(--muted-foreground);
	}
	.method-note {
		font-size: 10px;
		line-height: 1.7;
		color: var(--muted-foreground);
		margin-top: 14px;
	}
	.site-list {
		list-style: none;
		padding: 0;
		margin: 4px 0 20px;
		max-height: 370px;
		overflow: auto;
	}
	.site-list li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 15px 0;
		border-bottom: 1px solid var(--border);
	}
	.site-number {
		background: var(--muted);
		color: var(--muted-foreground);
		width: 29px;
		height: 29px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		font-size: 11px;
		border-radius: 9px;
	}
	.site-list li > div {
		display: grid;
		gap: 4px;
		flex: 1;
	}
	.site-list strong {
		font-size: 12px;
		font-weight: 600;
	}
	.site-list small,
	.site-list li > div > span {
		font-size: 10px;
		color: var(--muted-foreground);
	}
	.fiscal-card {
		margin-bottom: 20px;
	}
	.fiscal-layout {
		display: grid;
		grid-template-columns: 0.85fr 1.4fr;
		gap: 35px;
		margin-top: 24px;
	}
	.fiscal-chart {
		display: flex;
		justify-content: space-around;
		gap: 24px;
		padding-top: 4px;
	}
	.fiscal-bar-group {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		font-size: 10px;
		color: var(--muted-foreground);
	}
	.fiscal-bar-group > span {
		white-space: nowrap;
	}
	.fiscal-track {
		height: 125px;
		width: min(100%, 70px);
		display: flex;
		align-items: flex-end;
		border-bottom: 1px solid var(--border);
	}
	.fiscal-bar {
		width: 100%;
		background: #aea0ce;
		border-radius: 7px 7px 0 0;
	}
	.fiscal-bar.saving {
		background: #89ad71;
	}
	.fiscal-table-wrap {
		overflow: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 14px 10px;
		border-bottom: 1px solid var(--border);
	}
	thead th {
		font-size: 10px;
		color: var(--muted-foreground);
		font-weight: 500;
		white-space: nowrap;
	}
	tbody th {
		font-weight: 500;
		white-space: nowrap;
	}
	td {
		text-align: right;
	}
	.band-key {
		display: flex;
		justify-content: flex-end;
		gap: 16px;
		font-size: 10px;
		color: var(--muted-foreground);
		margin-bottom: 18px;
	}
	.band-key span {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.band-key i {
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}
	.baseline-key {
		background: #c2b7dc;
	}
	.proposed-key {
		background: #89ad71;
	}
	.band-chart {
		display: grid;
		gap: 16px;
	}
	.band > div:first-child {
		display: flex;
		justify-content: space-between;
		margin-bottom: 7px;
		gap: 10px;
	}
	.band strong {
		font-size: 11px;
		font-weight: 500;
	}
	.band small {
		font-size: 10px;
		color: var(--muted-foreground);
	}
	.band-track {
		height: 5px;
		border-radius: 8px;
		background: var(--muted);
		overflow: hidden;
		margin-top: 3px;
	}
	.delivery-stats {
		margin: 0;
	}
	.delivery-stats div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		padding: 17px 0;
		border-bottom: 1px solid var(--border);
		font-size: 11px;
	}
	.delivery-stats dt {
		color: var(--muted-foreground);
		line-height: 1.7;
	}
	.delivery-stats dd {
		margin: 0;
		font-size: 12px;
		font-weight: 600;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.exceeded {
		color: var(--destructive);
	}
	.evidence-card > p + p {
		margin-top: 10px;
	}
	.evidence-disclosure {
		margin-top: 18px;
		padding-top: 18px;
		border-top: 1px solid var(--border);
		font-size: 12px;
	}
	.evidence-disclosure summary {
		cursor: pointer;
		font-weight: 550;
	}
	.evidence-disclosure ul {
		margin: 14px 0 0;
		padding-left: 20px;
		color: var(--muted-foreground);
		font-size: 11px;
		line-height: 1.8;
	}
	.evidence-disclosure li + li {
		margin-top: 7px;
	}
	.source-details {
		padding-top: 18px;
	}
	.source-details h3 {
		margin-top: 14px;
	}
	.source-details pre {
		font-family: Consolas, monospace;
		font-size: 10px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		background: var(--muted);
		padding: 14px;
		border-radius: 10px;
		color: var(--muted-foreground);
	}
	.report-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		padding: 25px 0 10px;
	}
	.report-footer span {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: var(--muted-foreground);
		font-size: 11px;
	}
	.empty-review {
		display: flex;
		align-items: center;
		text-align: center;
		flex-direction: column;
		gap: 17px;
		padding: 70px 24px;
		border: 1px solid var(--border);
		border-radius: 20px;
		background: var(--card);
	}
	.empty-review p {
		max-width: 440px;
		color: var(--muted-foreground);
	}
	.empty-icon {
		width: 65px;
		height: 65px;
		display: grid;
		place-items: center;
		background: #e8efdf;
		color: #52743f;
		border-radius: 20px;
	}
	@container proposal-review (max-width: 1000px) {
		.headline-metrics {
			grid-template-columns: 1fr 1fr;
		}
		.fiscal-layout {
			grid-template-columns: 1fr 1.2fr;
			gap: 20px;
		}
		.report-card {
			padding: 22px;
		}
	}
	@container proposal-review (max-width: 760px) {
		.transport-cost-note {
			flex-direction: column;
			align-items: flex-start;
			gap: 10px;
		}
		.forecast-header {
			padding: 12px;
			gap: 5px;
		}
		.header-actions {
			gap: 4px;
		}
		.header-actions :global([data-slot='badge']) {
			display: none;
		}
		.forecast-header :global(.back-to-map) {
			padding-inline: 6px;
		}
		.forecast-content {
			padding: 25px 15px;
		}
		.report-heading {
			flex-direction: column;
			gap: 15px;
		}
		.report-heading h1 {
			font-size: 27px;
		}
		.report-date {
			flex-direction: row;
			align-items: center;
			gap: 10px;
			flex-wrap: wrap;
		}
		.report-date span {
			width: 100%;
		}
		.headline-metrics {
			gap: 10px;
		}
		.metric {
			padding: 16px;
		}
		.metric strong {
			font-size: 23px;
		}
		.report-grid {
			grid-template-columns: 1fr;
			gap: 15px;
			margin-bottom: 15px;
		}
		.report-card {
			padding: 20px;
		}
		.section-heading h2 {
			font-size: 19px;
		}
		.fiscal-layout {
			grid-template-columns: 1fr;
		}
		.fiscal-chart {
			max-width: 380px;
		}
		.fiscal-track {
			height: 100px;
		}
		.fiscal-card {
			margin-bottom: 15px;
		}
		.report-footer {
			flex-direction: column;
			align-items: stretch;
		}
		.report-footer :global(button) {
			width: 100%;
		}
		.access-row > div:first-child {
			flex-direction: column;
			gap: 5px;
		}
		.report-alert {
			flex-wrap: wrap;
		}
		.report-alert :global(button) {
			margin-left: 0;
		}
	}
	@media (max-width: 759px) {
		.forecast-review {
			width: 100vw;
			max-width: none;
			height: 100dvh;
			max-height: none;
			border: 0;
			border-radius: 0;
		}
		.header-actions :global(.review-size-control) {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.forecast-review::backdrop {
			transition-duration: 80ms;
		}
		.report-alert :global(.report-spinner) {
			animation: none;
		}
	}
</style>
