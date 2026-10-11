import type { PlanningBaseline } from '#lib/planning/index.ts';
import type { TransportContext } from '#lib/context/types.ts';
import type { PolicyEvidenceBundle } from '#lib/server/data/policyEvidenceSource.ts';
import type { OperationsBundle } from '#lib/operations/types.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const [response, auxiliary, policy, operationsResponse] = await Promise.all([
		fetch('/api/planning-baseline'),
		fetch('/api/transport-context').catch(() => null),
		fetch('/api/policy-evidence?view=summary').catch(() => null),
		fetch('/api/operations').catch(() => null)
	]);
	const transportContext = auxiliary?.ok ? ((await auxiliary.json()) as TransportContext) : null;
	const policyEvidence = policy?.ok ? ((await policy.json()) as PolicyEvidenceBundle) : null;
	const operations = operationsResponse?.ok
		? ((await operationsResponse.json()) as OperationsBundle)
		: null;
	if (!response.ok)
		return {
			planning: null,
			unavailable: (await response.json()).error as string,
			snapshotStale: false,
			transportContext,
			policyEvidence,
			operations
		};
	return {
		planning: (await response.json()) as PlanningBaseline,
		unavailable: null,
		snapshotStale: response.headers.get('X-Planning-Snapshot') === 'last-validated',
		transportContext,
		policyEvidence,
		operations
	};
};
