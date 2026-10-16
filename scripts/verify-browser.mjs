import { handleSignals, processRunner } from './runtime.mjs';
import { browserSuites, selectBrowserSuites } from './browser-suites.mjs';

// Keep the default end-to-end command aligned with the current user journey.
// Suites run sequentially to avoid competing for the map renderer or planning cache.
const runner = processRunner();
handleSignals(runner);
try {
	const args = process.argv.slice(2);
	if (args.length === 1 && args[0] === '--list') {
		for (const suite of browserSuites)
			console.log(
				`${suite.id}${suite.core ? ' [default]' : suite.api ? ' [API]' : ''}: ${suite.covers}`
			);
	} else {
		const suites = selectBrowserSuites(args);
		for (const suite of suites) {
			console.log(`\nBrowser suite: ${suite.id} (${suite.file})`);
			await runner.run(process.execPath, [`scripts/${suite.file}`]);
		}
		console.log(`\nAll ${suites.length} browser suites passed.`);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
} finally {
	await runner.stop();
}
