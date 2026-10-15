import { configureEnvironment, handleSignals, processRunner, setupBackend } from './runtime.mjs';

const runner = processRunner();
handleSignals(runner);
try {
	configureEnvironment();
	const unknown = process.argv
		.slice(2)
		.filter((flag) => !['--dev', '--with-system-deps'].includes(flag));
	if (unknown.length) throw new Error('Supported setup options: --dev, --with-system-deps.');
	await setupBackend(runner, {
		development: process.argv.includes('--dev'),
		systemDependencies: process.argv.includes('--with-system-deps')
	});
	console.log('\nSetup complete. Run npm start. No environment file is required.');
} catch (error) {
	console.error(`\nSetup failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	await runner.stop();
}
