import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
	getPredictionBundle,
	type PredictionSource,
	type ForecastIssue,
	type ForecastIssueView,
	type ForecastScore
} from '#lib/prediction/index.ts';

const defaultDirectory = () => join(process.cwd(), 'data/public/forecast-issues');
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value !== null && typeof value === 'object')
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b, 'en'))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(',')}}`;
	return JSON.stringify(value);
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export function monthlySourceFingerprint(source: PredictionSource): string {
	const bundle = getPredictionBundle(source);
	return hash({
		series: source.series,
		sourceAsOf: bundle.provenance?.checkedAt,
		provenance: bundle.provenance
	});
}
export function buildForecastIssue(
	source: PredictionSource,
	targetMonth: string,
	now = new Date()
): ForecastIssue {
	const bundle = getPredictionBundle(source, now, targetMonth);
	if (bundle.target?.kind === 'retrospective-preview')
		throw new Error('Past target months cannot be issued as prospective forecasts.');
	if (
		!bundle.provenance ||
		bundle.provenance.sources.length !== source.sourceIds.length ||
		!bundle.provenance.sources.length ||
		bundle.provenance.sources.some((s) => !/^[a-f0-9]{64}$/.test(s.sha256)) ||
		!/^\d{4}-\d{2}-\d{2}$/.test(bundle.provenance.latestPublicationDate) ||
		!Number.isFinite(Date.parse(bundle.provenance.checkedAt))
	)
		throw new Error('Complete checked source provenance is required before issuance.');
	if (
		Date.parse(bundle.provenance.checkedAt) > now.getTime() ||
		Date.parse(bundle.provenance.latestPublicationDate) > now.getTime()
	)
		throw new Error('Cannot issue using source evidence from the future.');
	if (
		!bundle.monthly.every(
			(f) =>
				f.status === 'exploratory' &&
				f.estimate !== null &&
				f.benchmarks.length === 4 &&
				f.benchmarks.every((b) => b.estimate !== null && Number.isFinite(b.estimate))
		)
	)
		throw new Error(
			'Every source series needs a supported forecast and four benchmark estimates for issuance.'
		);
	const issueDateMvt = new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
	const sourceFingerprint = monthlySourceFingerprint(source);
	const id = `${issueDateMvt}_${targetMonth}_${hash({ sourceFingerprint, modelVersion: bundle.provenance.modelVersion }).slice(0, 24)}`;
	const content = {
		version: 1 as const,
		id,
		issuedAt: now.toISOString(),
		issueDateMvt,
		target: bundle.target!,
		sourceFingerprint,
		sourceAsOf: source.asOf,
		provenance: bundle.provenance,
		forecasts: bundle.monthly
	};
	return { ...content, integritySha256: hash(content) };
}
function verifyIssue(value: unknown): ForecastIssue {
	if (!value || typeof value !== 'object') throw new Error('Invalid forecast issue');
	const { integritySha256, ...content } = value as ForecastIssue;
	if (
		content.version !== 1 ||
		!/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}_[a-f0-9]{24}$/.test(content.id) ||
		integritySha256 !== hash(content)
	)
		throw new Error('Forecast issue integrity check failed');
	return value as ForecastIssue;
}
async function appendJson(directory: string, name: string, value: unknown): Promise<boolean> {
	await mkdir(directory, { recursive: true });
	const temporary = join(directory, `.pending-${randomUUID()}`);
	try {
		await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
		try {
			await link(temporary, join(directory, name));
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
			throw error;
		}
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
}
export async function issueForecast(
	source: PredictionSource,
	targetMonth: string,
	now = new Date(),
	directory = defaultDirectory()
) {
	const candidate = buildForecastIssue(source, targetMonth, now);
	const created = await appendJson(directory, `${candidate.id}.json`, candidate);
	const issue = verifyIssue(
		JSON.parse(await readFile(join(directory, `${candidate.id}.json`), 'utf8'))
	);
	return { created, issue };
}
export function scoreForecastIssue(
	issue: ForecastIssue,
	source: PredictionSource
): ForecastIssueView {
	const provenance = getPredictionBundle(source).provenance!;
	const laterPublication =
		Date.parse(provenance.latestPublicationDate) > Date.parse(issue.issuedAt);
	const scores: ForecastScore[] = issue.forecasts.map((forecast) => {
		const series = source.series.find((item) => item.id === forecast.seriesId);
		const observation = series?.points.find((point) => point.month === issue.target.month);
		const base = {
			seriesId: forecast.seriesId,
			actual: null,
			absoluteError: null,
			benchmarkErrors: [],
			rangeCovered: null
		};
		if (!observation)
			return {
				...base,
				status: 'pending',
				qualification:
					'Waiting for a checked official observation for this target month. No prospective accuracy result is available.'
			};
		if (
			!laterPublication ||
			series?.name !== forecast.name ||
			series?.mode !== forecast.mode ||
			series?.unit !== forecast.unit ||
			series?.geography !== forecast.geography ||
			forecast.estimate === null
		)
			return {
				...base,
				status: 'ineligible',
				qualification:
					'Actual is not from a verified later publication with matching source category, geography and unit. It cannot score this issue.'
			};
		return {
			...base,
			status: 'later-vintage-score',
			actual: observation.value,
			absoluteError: Math.abs(observation.value - forecast.estimate),
			benchmarkErrors: forecast.benchmarks.flatMap((b) =>
				typeof b.estimate === 'number'
					? [{ model: b.model, absoluteError: Math.abs(observation.value - b.estimate) }]
					: []
			),
			rangeCovered: forecast.empiricalRange
				? observation.value >= forecast.empiricalRange.lower &&
					observation.value <= forecast.empiricalRange.upper
				: null,
			qualification:
				'Forecast was frozen before this later publication. Score uses this checked later vintage; first-release actuals are not reconstructed or claimed. A single issue does not establish general accuracy.'
		};
	});
	return {
		issue,
		scoredAgainst: {
			sourceFingerprint: monthlySourceFingerprint(source),
			publicationDate: provenance.latestPublicationDate,
			checkedAt: provenance.checkedAt
		},
		scores
	};
}
export async function listForecastIssues(
	source: PredictionSource,
	directory = defaultDirectory()
): Promise<ForecastIssueView[]> {
	let names: string[];
	try {
		names = await readdir(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
	const issues = await Promise.all(
		names
			.filter((name) => /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}_[a-f0-9]{24}\.json$/.test(name))
			.map(async (name) =>
				scoreForecastIssue(
					verifyIssue(JSON.parse(await readFile(join(directory, name), 'utf8'))),
					source
				)
			)
	);
	let scoreNames: string[] = [];
	try {
		scoreNames = await readdir(join(directory, 'scores'));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	for (const view of issues) {
		view.recordedScores = await Promise.all(
			scoreNames
				.filter((name) => name.startsWith(`${view.issue.id}_`) && /^[\d_a-f-]+\.json$/.test(name))
				.map(async (name) => {
					const raw = JSON.parse(await readFile(join(directory, 'scores', name), 'utf8'));
					const { integritySha256, ...content } = raw;
					if (
						content.version !== 1 ||
						integritySha256 !== hash(content) ||
						content.issue.id !== view.issue.id
					)
						throw new Error('Forecast score receipt integrity check failed');
					verifyIssue(content.issue);
					return {
						recordedAt: content.recordedAt,
						scoredAgainst: content.scoredAgainst,
						scores: content.scores
					};
				})
		);
	}
	return issues.sort((a, b) => b.issue.issuedAt.localeCompare(a.issue.issuedAt));
}
export async function recordForecastScores(
	source: PredictionSource,
	issueId: string,
	now = new Date(),
	directory = defaultDirectory()
) {
	const view = (await listForecastIssues(source, directory)).find(
		(view) => view.issue.id === issueId
	);
	if (!view) throw new Error('Forecast issue not found');
	if (!view.scores.some((score) => score.status === 'later-vintage-score'))
		throw new Error('No eligible later actuals are available to record.');
	if (
		Date.parse(view.scoredAgainst.checkedAt) > now.getTime() ||
		Date.parse(view.scoredAgainst.publicationDate) > now.getTime()
	)
		throw new Error('Scoring evidence cannot come from the future');
	const content = {
		version: 1,
		recordedAt: now.toISOString(),
		issue: view.issue,
		scoredAgainst: view.scoredAgainst,
		scores: view.scores
	};
	const filename = `${issueId}_${view.scoredAgainst.sourceFingerprint}.json`;
	const created = await appendJson(join(directory, 'scores'), filename, {
		...content,
		integritySha256: hash(content)
	});
	return { created, filename };
}
