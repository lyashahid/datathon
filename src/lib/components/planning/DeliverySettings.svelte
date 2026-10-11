<script lang="ts">
	import type { PlanningAssumptions } from '#lib/planning/types.ts';
	let {
		assumptions,
		onchange,
		mode = 'delivery'
	}: {
		assumptions: PlanningAssumptions;
		onchange: (patch: Partial<PlanningAssumptions>) => void;
		mode?: 'delivery' | 'fare';
	} = $props();
	const delivery = $derived(
		assumptions.policyDelivery ?? {
			responsibleAgency: '',
			phases: [
				'Verify the site, service calendar and local costs',
				'Pilot the service and collect boarding and journey data',
				'Review access, operations and emissions before expansion'
			],
			outstandingVerification: [
				'Complete service calendars',
				'Entrances, crossings and boarding access',
				'Local operating costs, staffing, capacity and land permissions'
			]
		}
	);
	const fare = $derived(
		assumptions.fareAffordability ?? {
			oneWayFareMvr: 0,
			monthlyTrips: 44,
			monthlyHouseholdBudgetMvr: 0
		}
	);
	function updateDelivery(patch: Partial<NonNullable<PlanningAssumptions['policyDelivery']>>) {
		onchange({ policyDelivery: { ...delivery, ...patch } });
	}
	function updateFare(patch: Partial<NonNullable<PlanningAssumptions['fareAffordability']>>) {
		onchange({ fareAffordability: { ...fare, ...patch } });
	}
</script>

{#if mode === 'fare'}
	<details class="delivery-settings">
		<summary>Fare affordability scenario</summary>
		<p>
			Compare travel spending with an editable household budget. HIES 2019 provides broad historical
			context; it is not neighborhood income or a ridership forecast.
		</p>
		<div class="fare-fields">
			<label
				>One-way fare (MVR)<input
					type="number"
					min="0"
					step="1"
					value={fare.oneWayFareMvr}
					onchange={(event) =>
						updateFare({ oneWayFareMvr: Math.max(0, Number(event.currentTarget.value)) })}
				/></label
			>
			<label
				>Trips per month<input
					type="number"
					min="0"
					step="1"
					value={fare.monthlyTrips}
					onchange={(event) =>
						updateFare({ monthlyTrips: Math.max(0, Number(event.currentTarget.value)) })}
				/></label
			>
			<label
				>Household budget (MVR/month)<input
					type="number"
					min="0"
					step="100"
					value={fare.monthlyHouseholdBudgetMvr}
					onchange={(event) =>
						updateFare({
							monthlyHouseholdBudgetMvr: Math.max(0, Number(event.currentTarget.value))
						})}
				/></label
			>
		</div>
		<strong
			>{fare.monthlyHouseholdBudgetMvr > 0
				? `${(((fare.oneWayFareMvr * fare.monthlyTrips) / fare.monthlyHouseholdBudgetMvr) * 100).toFixed(1)}% of the assumed monthly budget`
				: 'Enter a household budget to estimate the share'}</strong
		>
		<p>
			{(fare.oneWayFareMvr * fare.monthlyTrips).toLocaleString('en')} MVR/month for these trips. Fare
			concessions and other household journeys are not included.
		</p>
	</details>
{:else}
	<details class="delivery-settings">
		<summary>Agency, implementation & verification</summary>
		<p>
			These notes travel with the saved scenario and policy brief. The planning model does not
			establish institutional approval or project feasibility.
		</p>
		<label
			>Responsible agency<input
				type="text"
				maxlength="200"
				placeholder="To be confirmed with the relevant operator / council"
				value={delivery.responsibleAgency}
				onchange={(event) => updateDelivery({ responsibleAgency: event.currentTarget.value })}
			/></label
		>
		<label
			>Implementation phases (one per line)<textarea
				rows="3"
				value={delivery.phases.join('\n')}
				onchange={(event) =>
					updateDelivery({
						phases: event.currentTarget.value
							.split('\n')
							.map((line) => line.trim())
							.filter(Boolean)
							.slice(0, 12)
					})}></textarea></label
		>
		<label
			>Outstanding verification (one per line)<textarea
				rows="3"
				value={delivery.outstandingVerification.join('\n')}
				onchange={(event) =>
					updateDelivery({
						outstandingVerification: event.currentTarget.value
							.split('\n')
							.map((line) => line.trim())
							.filter(Boolean)
							.slice(0, 20)
					})}></textarea></label
		>
	</details>
{/if}

<style>
	.delivery-settings {
		border: 1px solid #dae4d7;
		border-radius: 12px;
		padding: 14px;
		margin: 16px 0;
	}
	summary {
		font-size: 14px;
		font-weight: 650;
		color: #294e3a;
		cursor: pointer;
	}
	p {
		font-size: 12px;
		line-height: 1.6;
		color: #6d7d65;
	}
	label {
		display: grid;
		gap: 7px;
		margin: 14px 0;
		font-size: 13px;
		font-weight: 550;
		color: #52654d;
	}
	input,
	textarea {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		padding: 10px;
		border: 1px solid #d3dece;
		border-radius: 8px;
		font: inherit;
		color: #294e3a;
		background: #fff;
	}
	textarea {
		resize: vertical;
		line-height: 1.6;
	}
	strong {
		color: #087c79;
		font-size: 14px;
	}
	.fare-fields {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}
	@media (max-width: 500px) {
		.fare-fields {
			grid-template-columns: 1fr;
			gap: 0;
		}
	}
</style>
