import { handleSignals, processRunner } from './runtime.mjs';

// Keep the default end-to-end command aligned with the current user journey.
// Suites run sequentially to avoid competing for the map renderer or planning cache.
const suites = [
	'verify-analytics-redesign.mjs',
	'verify-analytics-decision-flow.mjs',
	'verify-forecast-data-browser.mjs',
	'verify-capital-map-start.mjs',
	'verify-restored-navigation.mjs',
	'verify-nearby-bus-stops.mjs',
	'verify-nearby-access-analysis.mjs',
	'verify-map-floating-controls.mjs',
	'verify-proposal-experience.mjs',
	'verify-proposal-map-comparison.mjs',
	'verify-motion-windows.mjs',
	'verify-review-window.mjs',
	'verify-island-connections.mjs'
];
const runner = processRunner();
handleSignals(runner);
try {
	for (const suite of suites) {
		console.log(`\nBrowser suite: ${suite}`);
		await runner.run(process.execPath, [`scripts/${suite}`]);
	}
	console.log(`\nAll ${suites.length} browser suites passed.`);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
} finally {
	await runner.stop();
}
