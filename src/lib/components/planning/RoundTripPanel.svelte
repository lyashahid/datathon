<script lang="ts">
	import { ArrowRight, Clock3, House, CalendarClock } from '@lucide/svelte';
	import JourneyRibbon, { type JourneyLegView } from './JourneyRibbon.svelte';
	import type {
		AppointmentDepartureScan,
		AppointmentJourney,
		AppointmentOptions
	} from '#lib/planning/returnJourney.ts';
	import type { PlanningJourney } from '#lib/planning/types.ts';
	let {
		result,
		options,
		onoptions,
		busy = false,
		departureScan = null,
		onscan
	}: {
		result: AppointmentJourney | null;
		options: AppointmentOptions;
		onoptions: (options: AppointmentOptions) => void;
		busy?: boolean;
		departureScan?: AppointmentDepartureScan | null;
		onscan?: () => void;
	} = $props();
	const titles = {
		feasible: 'There and back',
		'deadline-missed': 'Return misses the deadline',
		unreachable: 'No modeled return journey',
		unavailable: 'Return evidence incomplete'
	};
	function clock(minutes: number | null) {
		if (minutes === null) return 'Unknown';
		const rounded = Math.round(minutes),
			day = Math.floor(rounded / 1440);
		return `${String(Math.floor((rounded % 1440) / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}${day ? ` +${day}d` : ''}`;
	}
	function legs(journey: PlanningJourney | null): JourneyLegView[] {
		return (
			journey?.path.flatMap((leg) => [
				...(leg.waitMinutes > 0 ? [{ mode: 'wait' as const, minutes: leg.waitMinutes }] : []),
				{ mode: leg.mode, minutes: leg.minutes }
			]) ?? []
		);
	}
	function updateAppointment(value: number) {
		if (Number.isFinite(value))
			onoptions({ ...options, appointmentMinutes: Math.min(720, Math.max(0, value)) });
	}
	function updateDeadline(value: string) {
		const [hours, minutes] = value.split(':').map(Number);
		if (Number.isFinite(hours) && Number.isFinite(minutes))
			onoptions({
				...options,
				returnDeadlineMinutes:
					hours * 60 + minutes + (options.returnDeadlineMinutes >= 1440 ? 1440 : 0)
			});
	}
	const feasibleSamples = $derived(
		departureScan?.samples.filter((sample) => sample.status === 'feasible') ?? []
	);
</script>

<section class="round-trip" aria-label="Appointment and return journey" aria-busy={busy}>
	<header>
		<div class="title">
			<CalendarClock size={17} aria-hidden="true" />
			<h3>Can they get there and back?</h3>
		</div>
		<span class="tag">MVT</span>
	</header>
	{#if result}
		<div
			class="verdict"
			class:success={result.status === 'feasible'}
			class:warning={result.status !== 'feasible'}
		>
			<strong>{titles[result.status]}</strong>
			{#if result.destination}<span>{result.destination.name}</span>{/if}
			{#if result.reason}<p>{result.reason}</p>{/if}
		</div>
		<div class="times" aria-label="Journey and appointment times">
			<div>
				<Clock3 size={15} aria-hidden="true" /><span>Arrive</span><strong
					>{clock(result.arriveAt)}</strong
				>
			</div>
			<ArrowRight size={14} aria-hidden="true" />
			<div>
				<CalendarClock size={15} aria-hidden="true" /><span>Leave care</span><strong
					>{clock(result.returnDepartAt)}</strong
				>
			</div>
			<ArrowRight size={14} aria-hidden="true" />
			<div>
				<House size={15} aria-hidden="true" /><span>Back home</span><strong
					>{clock(result.homeAt)}</strong
				>
			</div>
		</div>
	{:else}
		<p class="empty" role="status">
			{busy
				? 'Checking the outward and return journey…'
				: 'Select a resident area to check the whole journey.'}
		</p>
	{/if}
	<div class="controls">
		<label class="duration"
			>Visit length
			<span
				><input
					type="number"
					min="0"
					max="720"
					step="15"
					value={options.appointmentMinutes}
					onchange={(event) => updateAppointment(event.currentTarget.valueAsNumber)}
					aria-label="Appointment duration in minutes"
				/><span>min</span></span
			>
		</label>
		<label
			>Home by
			<input
				type="time"
				value={clock(options.returnDeadlineMinutes % 1440)}
				onchange={(event) => updateDeadline(event.currentTarget.value)}
				aria-label="Return home deadline in Maldives time"
			/>
		</label>
	</div>
	<details>
		<summary>Journey legs and assumptions</summary>
		<div class="details-body">
			<label class="next-day"
				><input
					type="checkbox"
					checked={options.returnDeadlineMinutes >= 1440}
					onchange={(event) =>
						onoptions({
							...options,
							returnDeadlineMinutes:
								(options.returnDeadlineMinutes % 1440) + (event.currentTarget.checked ? 1440 : 0)
						})}
				/>Deadline is the following day</label
			>
			{#if result?.outward.status === 'reachable'}<JourneyRibbon
					title="Outward"
					legs={legs(result.outward)}
					totalMinutes={result.outward.minutes}
				/>{/if}
			{#if result?.returnJourney?.status === 'reachable'}<JourneyRibbon
					title="Return to the same area"
					legs={legs(result.returnJourney)}
					totalMinutes={result.returnJourney.minutes}
				/>{/if}
			<p>
				The visit begins on arrival. Return routes obey direction, calendars and transfer limits.
				Journey times estimate transport access; they do not establish appointment availability,
				admissions or capacity.
			</p>
			{#each result?.warnings ?? [] as warning (warning)}<p class="note">{warning}</p>{/each}
			{#if onscan}<button class="scan" onclick={onscan}>Check other departure times</button>{/if}
			{#if departureScan}
				<p>{departureScan.label}</p>
				{#if feasibleSamples.length}
					<div class="samples" aria-label="Checked feasible departure times">
						{#each feasibleSamples as sample (sample.departureMinutes)}<span
								>{clock(sample.departureMinutes)}</span
							>{/each}
					</div>
				{:else}<p class="note">
						No checked departure has a confirmed return before this deadline. Unknown evidence is
						separate from infeasible journeys.
					</p>{/if}
			{/if}
		</div>
	</details>
</section>

<style>
	.round-trip {
		border: 1px solid #dce7e2;
		border-radius: 14px;
		color: #243d36;
		background: white;
		overflow: hidden;
		min-width: 0;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 13px;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}
	h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 650;
		line-height: 1.4;
	}
	.tag {
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.04em;
		color: #65796e;
	}
	.verdict {
		margin: 0 12px;
		padding: 10px 12px;
		border-radius: 9px;
		display: grid;
		gap: 3px;
	}
	.success {
		background: #edf7f0;
		color: #216845;
	}
	.warning {
		background: #fbf5e8;
		color: #735926;
	}
	.verdict strong {
		font-size: 14px;
	}
	.verdict span,
	.verdict p {
		font-size: 12px;
		line-height: 1.5;
		margin: 0;
		overflow-wrap: anywhere;
	}
	.times {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 5px;
		padding: 14px 13px 9px;
	}
	.times div {
		display: grid;
		justify-items: start;
		gap: 4px;
		min-width: 0;
	}
	.times div :global(svg) {
		color: #72887c;
	}
	.times span {
		font-size: 11px;
		color: #65796e;
	}
	.times strong {
		font-size: 15px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		padding: 9px 13px 13px;
	}
	.controls > label {
		display: grid;
		gap: 5px;
		flex: 1 1 115px;
		font-size: 12px;
		color: #60756a;
	}
	input[type='time'],
	.duration > span {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid #d7e4dc;
		border-radius: 8px;
		color: #243d36;
		background: #f8fbf9;
		height: 38px;
		font-size: 14px;
		padding: 7px 9px;
	}
	.duration > span {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.duration input {
		min-width: 0;
		width: 100%;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
	}
	.duration span > span {
		font-size: 11px;
		color: #65796e;
	}
	input:focus-visible,
	button:focus-visible,
	summary:focus-visible {
		outline: 2px solid #27795e;
		outline-offset: 2px;
	}
	.empty {
		font-size: 13px;
		line-height: 1.5;
		margin: 0;
		padding: 0 13px 12px;
		color: #65796e;
	}
	details {
		border-top: 1px solid #e8eee9;
	}
	summary {
		cursor: pointer;
		font-size: 12px;
		color: #60756a;
		padding: 10px 13px;
	}
	.details-body {
		display: grid;
		gap: 10px;
		padding: 2px 13px 13px;
		font-size: 12px;
		line-height: 1.5;
		color: #60756a;
	}
	.details-body p {
		margin: 0;
	}
	.note {
		background: #fbf7ed;
		padding: 8px;
		border-radius: 6px;
		color: #735926;
	}
	.next-day {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.next-day input {
		accent-color: #27795e;
	}
	.scan {
		color: #216845;
		background: #edf7f0;
		border: 1px solid #d8e8dd;
		padding: 8px;
		border-radius: 8px;
		cursor: pointer;
		font: inherit;
	}
	.scan:active {
		transform: scale(0.98);
	}
	.samples {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.samples span {
		background: #edf7f0;
		color: #216845;
		border-radius: 5px;
		padding: 3px 6px;
		font-variant-numeric: tabular-nums;
	}
	@media (pointer: coarse) {
		summary {
			min-height: 44px;
			box-sizing: border-box;
			padding-top: 14px;
		}
		input[type='time'],
		.duration > span,
		.scan {
			min-height: 44px;
		}
	}
</style>
