import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPredictionSource } from './predictionSource.ts';
import {
	buildForecastIssue,
	issueForecast,
	listForecastIssues,
	monthlySourceFingerprint,
	recordForecastScores,
	scoreForecastIssue
} from './predictionSourceLedger.ts';
import { getPredictionBundle, monthlyPointForecast } from '#lib/prediction/index.ts';
const now = new Date('2026-10-11T13:00:00Z');

describe('immutable monthly issue ledger', () => {
	it('pins all source hashes, cutoffs, future/current target and target-specific benchmark estimates', async () => {
		const source = await loadPredictionSource();
		const issue = buildForecastIssue(source, '2026-11', now);
		expect(issue.target.kind).toBe('future');
		expect(issue.provenance.sources).toHaveLength(4);
		expect(issue.provenance.sources.every((item) => item.sha256.length === 64)).toBe(true);
		expect(buildForecastIssue(source, '2026-10', now).target.kind).toBe('nowcast');
		for (const forecast of issue.forecasts) {
			const values = source.series
				.find((item) => item.id === forecast.seriesId)!
				.points.map((item) => item.value);
			for (const benchmark of forecast.benchmarks)
				expect(benchmark.estimate).toBe(
					monthlyPointForecast(values, forecast.horizonMonths, benchmark.model)
				);
		}
		expect(() => buildForecastIssue(source, '2026-09', now)).toThrow(/Past/);
		expect(() => buildForecastIssue(source, '2028-10', now)).toThrow(/supported/);
		expect(() => buildForecastIssue(source, '2026-11', new Date('2026-10-10T12:00:00Z'))).toThrow(
			/future/
		);
	});
	it('concurrent repeat issuance preserves the first complete record and rejects altered issues', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'datathon-issues-'));
		try {
			const source = await loadPredictionSource();
			const results = await Promise.all([
				issueForecast(source, '2026-11', now, directory),
				issueForecast(source, '2026-11', new Date(now.getTime() + 1000), directory)
			]);
			expect(results.filter((result) => result.created)).toHaveLength(1);
			expect(results[0].issue).toEqual(results[1].issue);
			expect(await readdir(directory)).toHaveLength(1);
			const path = join(directory, `${results[0].issue.id}.json`);
			const bytes = await readFile(path, 'utf8');
			await issueForecast(source, '2026-11', new Date(now.getTime() + 2000), directory);
			expect(await readFile(path, 'utf8')).toBe(bytes);
			const corrupt = JSON.parse(bytes);
			corrupt.forecasts[0].estimate++;
			await writeFile(path, JSON.stringify(corrupt));
			await expect(listForecastIssues(source, directory)).rejects.toThrow(/integrity/);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it('source revisions create a different fingerprint while unrelated private bus receipt changes do not', async () => {
		const source = await loadPredictionSource(),
			changed = structuredClone(source);
		changed.series[0].points[0].value++;
		expect(monthlySourceFingerprint(changed)).not.toBe(monthlySourceFingerprint(source));
		const receiptOnly = structuredClone(source);
		receiptOnly.audit.busCapture = {};
		expect(monthlySourceFingerprint(receiptOnly)).toBe(monthlySourceFingerprint(source));
	});
	it('waits for actuals, refuses same/earlier release and scores frozen benchmarks only from eligible later-vintage observations', async () => {
		const source = await loadPredictionSource(),
			issue = buildForecastIssue(source, '2026-11', now);
		expect(
			scoreForecastIssue(issue, source).scores.every(
				(score) => score.status === 'pending' && score.actual === null
			)
		).toBe(true);
		// Synthetic future release for the workflow test; never written to public source data.
		const later = structuredClone(source);
		for (const series of later.series) series.points.push({ month: '2026-11', value: 310000 });
		expect(
			scoreForecastIssue(issue, later).scores.every((score) => score.status === 'ineligible')
		).toBe(true);
		later.audit.publishedAt = '2027-01-15';
		later.audit.monthlyAuditAsOf = '2027-01-16T12:00:00Z';
		const view = scoreForecastIssue(issue, later);
		expect(
			view.scores.every(
				(score) =>
					score.status === 'later-vintage-score' &&
					score.qualification.includes('first-release actuals are not')
			)
		).toBe(true);
		for (const [i, score] of view.scores.entries()) {
			expect(score.absoluteError).toBe(Math.abs(310000 - issue.forecasts[i].estimate!));
			expect(score.benchmarkErrors).toHaveLength(4);
		}
		later.series[0].geography = 'Changed category';
		expect(scoreForecastIssue(issue, later).scores[0].status).toBe('ineligible');
	});
	it('cannot record pending scores; appends a later scoring vintage without rewriting issue or first receipt', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'datathon-score-'));
		try {
			const source = await loadPredictionSource(),
				{ issue } = await issueForecast(source, '2026-11', now, directory);
			const path = join(directory, `${issue.id}.json`),
				bytes = await readFile(path, 'utf8');
			await expect(recordForecastScores(source, issue.id, now, directory)).rejects.toThrow(
				/No eligible/
			);
			const later = structuredClone(source);
			later.audit.publishedAt = '2027-01-15';
			later.audit.monthlyAuditAsOf = '2027-01-16T12:00:00Z';
			later.series[0].points.push({ month: '2026-11', value: 230000 });
			const result = await recordForecastScores(
				later,
				issue.id,
				new Date('2027-01-16T13:00:00Z'),
				directory
			);
			expect(result.created).toBe(true);
			const scorePath = join(directory, 'scores', result.filename),
				scoreBytes = await readFile(scorePath, 'utf8');
			expect(
				(await recordForecastScores(later, issue.id, new Date('2027-01-17T13:00:00Z'), directory))
					.created
			).toBe(false);
			expect(await readFile(scorePath, 'utf8')).toBe(scoreBytes);
			expect(await readFile(path, 'utf8')).toBe(bytes);
			const retrieved = await listForecastIssues(later, directory);
			expect(retrieved[0].recordedScores).toHaveLength(1);
			expect(retrieved[0].recordedScores![0].scores[0].actual).toBe(230000);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe('independent numerical check of published snapshot', () => {
	it('recomputes six-row MAE/WAPE and residual range coverage; preserves the losing bus result', async () => {
		const bundle = getPredictionBundle(await loadPredictionSource(), now, '2026-10');
		for (const forecast of bundle.monthly) {
			const sum = forecast.backtest.reduce(
				(total, row) => total + Math.abs(row.actual - row.estimate),
				0
			);
			const denominator = forecast.backtest.reduce((total, row) => total + row.actual, 0);
			expect(forecast.evaluation!.mae).toBeCloseTo(sum / 6, 9);
			expect(forecast.evaluation!.wape).toBeCloseTo(sum / denominator, 12);
			const lowerResidual = forecast.empiricalRange!.lower - forecast.estimate!,
				upperResidual = forecast.empiricalRange!.upper - forecast.estimate!;
			const covered = forecast.backtest.filter(
				(row) =>
					row.actual - row.estimate >= lowerResidual && row.actual - row.estimate <= upperResidual
			).length;
			expect(forecast.empiricalRange!.historicalCoverage).toBe(covered / 6);
			expect(covered).toBe(forecast.mode === 'bus' ? 3 : 2);
			const persistence = forecast.benchmarks.find((item) => item.model === 'last-month')!;
			expect(forecast.evaluation!.mae > persistence.metrics.mae).toBe(forecast.mode === 'bus');
		}
	});
});
