import { access } from 'node:fs/promises';
import path from 'node:path';
import { ensureProductionBuild, frontendAddress } from './production.mjs';
import {
	configureEnvironment,
	handleSignals,
	prepareBackend,
	processRunner,
	root
} from './runtime.mjs';

const runner = processRunner();
handleSignals(runner);
try {
	configureEnvironment();
	try {
		await access(path.join(root, 'node_modules/vite/bin/vite.js'));
	} catch {
		throw new Error('Frontend dependencies are missing. Run npm ci, then npm start.');
	}
	const address = frontendAddress(process.argv.slice(2));
	await ensureProductionBuild(runner, { force: address.forceBuild });
	const backend = await prepareBackend(runner);
	const frontend = runner.start(process.execPath, [path.join(root, 'build', 'index.js')], {
		env: {
			...process.env,
			NODE_ENV: 'production',
			HOST: address.host,
			PORT: String(address.port),
			// Imported schedules and proposal reports can exceed the adapter's 512k default.
			BODY_SIZE_LIMIT: process.env.BODY_SIZE_LIMIT || '16M'
		}
	});
	const host = address.host.includes(':') ? `[${address.host}]` : address.host;
	console.log(`Optimized application: http://${host}:${address.port}`);
	console.log('Use npm run dev when editing source with hot reload.');
	const result = await Promise.race([frontend.completed, ...(backend ? [backend.completed] : [])]);
	process.exitCode = result.code;
} catch (error) {
	console.error(`Startup failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	await runner.stop();
}
