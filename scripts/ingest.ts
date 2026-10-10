/**
 * Runs the ingestion pipeline on a manifest and writes canonical output.
 *
 *   npm run ingest                                   # fixture manifest → data/processed/
 *   npm run ingest -- path/to/manifest.json out/dir  # your own sources
 *
 * Runs on Node's built-in TypeScript support; no build step or extra dependency.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { demoIslandAt } from '#lib/analysis/h3DemoData.ts';
import { formatReport } from '#lib/analysis/ingestion/report.ts';
import {
	infrastructureToGeoJSON,
	routesToGeoJSON,
	runIngestion,
	type IngestionManifest
} from '#lib/analysis/ingestion/run.ts';

const manifestPath = resolve(process.argv[2] ?? 'data/fixtures/ingestion/manifest.json');
const outDir = resolve(process.argv[3] ?? 'data/processed');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as IngestionManifest;
const sourceDir = dirname(manifestPath);

// Island assignment uses the demo outlines until official island boundaries are imported.
const output = runIngestion(
	manifest,
	(file) => readFileSync(join(sourceDir, file), 'utf8'),
	(p) => {
		const island = demoIslandAt(p);
		return island ? { island, atoll: null } : null;
	}
);

mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown) =>
	writeFileSync(join(outDir, name), `${JSON.stringify(data, null, '\t')}\n`);
write('infrastructure.geojson', infrastructureToGeoJSON(output.infrastructure));
write('routes.geojson', routesToGeoJSON(output.routes));
write('demographics.json', output.demographics);
write('ingestion-report.json', {
	manifest: manifestPath.replace(`${process.cwd()}/`, ''),
	reports: output.reports,
	crossCheck: output.crossCheck
});

for (const report of output.reports) console.log(`${formatReport(report)}\n`);
console.log(
	`merge: ${output.crossCheck.duplicatesAcrossSources.length} cross-source duplicates, ` +
		`${output.crossCheck.unknownRouteStops} unknown route stops removed`
);
console.log(`wrote ${outDir.replace(`${process.cwd()}/`, '')}/`);
