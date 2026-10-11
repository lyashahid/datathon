<script lang="ts">
	import DiscreteTabs from './controls/DiscreteTabs.svelte';
	import type { PlanningAssumptions } from '#lib/planning/types.ts';
	let {
		assumptions,
		onchange
	}: { assumptions: PlanningAssumptions; onchange: (patch: Partial<PlanningAssumptions>) => void } =
		$props();
	function patch(value: NonNullable<PlanningAssumptions['destinationRequirements']>) {
		onchange({ destinationRequirements: { ...assumptions.destinationRequirements, ...value } });
	}
</script>

<details class="requirements">
	<summary>Which service is suitable?</summary>
	{#if assumptions.goal === 'healthcare'}
		<DiscreteTabs
			label="Healthcare service required"
			items={[
				{ id: 'general', label: 'General care' },
				{ id: 'emergency', label: 'Emergency' },
				{ id: 'specialist', label: 'Specialist' }
			]}
			value={assumptions.destinationRequirements?.healthcareService ?? 'general'}
			onchange={(value) =>
				patch({ healthcareService: value as 'general' | 'emergency' | 'specialist' })}
		/>
	{:else}
		<DiscreteTabs
			label="School level required"
			items={[
				{ id: 'any', label: 'Any level' },
				{ id: 'primary', label: 'Primary' },
				{ id: 'lower-secondary', label: 'Lower secondary' },
				{ id: 'higher-secondary', label: 'Higher secondary' }
			]}
			value={assumptions.destinationRequirements?.schoolLevel ?? 'any'}
			onchange={(value) =>
				patch({
					schoolLevel:
						value === 'any'
							? undefined
							: (value as 'primary' | 'lower-secondary' | 'higher-secondary')
				})}
		/>
	{/if}
	<label
		><input
			type="checkbox"
			checked={assumptions.destinationRequirements?.publicAccess === 'public'}
			onchange={(event) => patch({ publicAccess: event.currentTarget.checked ? 'public' : 'any' })}
		/> Require a public institution</label
	>
	<label
		><input
			type="checkbox"
			checked={assumptions.destinationRequirements?.requireOpenAtDeparture ?? false}
			onchange={(event) => patch({ requireOpenAtDeparture: event.currentTarget.checked })}
		/> Require verified opening hours at departure</label
	>
	<p>
		Unknown services, grades, eligibility, or hours stay unavailable when required. A nearby
		institution does not guarantee an appointment or admission.
	</p>
</details>

<style>
	.requirements {
		border: 1px solid #dae4d7;
		border-radius: 12px;
		padding: 13px;
		margin: 14px 0;
	}
	summary {
		font-size: 14px;
		font-weight: 650;
		color: #294e3a;
		cursor: pointer;
		margin-bottom: 8px;
	}
	label {
		display: flex;
		gap: 9px;
		align-items: center;
		font-size: 13px;
		line-height: 1.5;
		margin: 12px 0;
		color: #52654d;
	}
	input {
		accent-color: #087c79;
	}
	p {
		font-size: 12px;
		line-height: 1.6;
		color: #6d7d65;
		margin-bottom: 0;
	}
</style>
