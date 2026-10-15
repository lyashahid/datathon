import { access } from 'node:fs/promises';
import path from 'node:path';
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
	const vite = path.join(root, 'node_modules/vite/bin/vite.js');
	try {
		await access(vite);
	} catch {
		throw new Error('Frontend dependencies are missing. Run npm ci, then npm start.');
	}
	const backend = await prepareBackend(runner);
	const frontend = runner.start(process.execPath, [vite, 'dev', ...process.argv.slice(2)]);
	const result = await Promise.race([frontend.completed, ...(backend ? [backend.completed] : [])]);
	process.exitCode = result.code;
} catch (error) {
	console.error(`\nStartup failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	await runner.stop();
}
