import { createServer } from 'vite';

const target = process.argv[2];
const action = process.argv[3] ?? 'issue';
if (!target || (action !== 'issue' && action !== 'score')) {
	throw new Error(
		'Usage: node scripts/issue-monthly-forecast.mjs YYYY-MM [issue] OR ISSUE_ID score'
	);
}
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
	const { loadPredictionSource } = await server.ssrLoadModule(
		'/src/lib/server/data/predictionSource.ts'
	);
	const { issueForecast, recordForecastScores } = await server.ssrLoadModule(
		'/src/lib/server/data/predictionSourceLedger.ts'
	);
	const source = await loadPredictionSource();
	const result =
		action === 'score'
			? await recordForecastScores(source, target)
			: await issueForecast(source, target);
	console.log(
		JSON.stringify(
			action === 'score'
				? result
				: {
						created: result.created,
						id: result.issue.id,
						issuedAt: result.issue.issuedAt,
						target: result.issue.target,
						sourceFingerprint: result.issue.sourceFingerprint
					},
			null,
			2
		)
	);
} finally {
	await server.close();
}
