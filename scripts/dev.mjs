import { access } from 'node:fs/promises';
import path from 'node:path';
import {
	backendAddress,
	backendStatus,
	configureEnvironment,
	defaultBackendUrl,
	handleSignals,
	processRunner,
	root,
	setupBackend
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
	const address = backendAddress(process.env.MOBILITY_BACKEND_URL ?? defaultBackendUrl);
	const status = await backendStatus(address);
	let backend;
	if (status === 'occupied')
		throw new Error(
			`Port ${address.port} is occupied by a different or unhealthy service. Stop that service, then retry npm start. The launcher will not replace an existing process.`
		);
	if (status === 'ready') console.log(`Using running mobility backend at ${address.url}`);
	else {
		if (!address.local)
			throw new Error('The configured remote backend is unavailable. Check its service and URL.');
		await setupBackend(runner);
		// Installation can take time; check again so a newly occupied port is never reused silently.
		if ((await backendStatus(address)) !== 'unavailable')
			throw new Error(`Port ${address.port} became occupied during setup. Retry npm start.`);
		backend = runner.start('uv', [
			'run',
			'--directory',
			'backend',
			'--no-sync',
			'uvicorn',
			'app.main:app',
			'--host',
			address.host,
			'--port',
			String(address.port)
		]);
		// Observe failures immediately rather than leaving a rejected spawn promise unhandled.
		let backendExited = false;
		backend.completed.catch(() => {}).finally(() => (backendExited = true));
		const deadline = Date.now() + 120_000;
		while ((await backendStatus(address)) !== 'ready') {
			if (backendExited) {
				await backend.completed;
				throw new Error('The backend exited before becoming ready. See its output above.');
			}
			if (Date.now() > deadline)
				throw new Error(
					'The backend did not become ready within two minutes. See its output above.'
				);
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		console.log(`\nMobility backend ready at ${address.url}`);
	}
	const frontend = runner.start(process.execPath, [vite, 'dev', ...process.argv.slice(2)]);
	const result = await Promise.race([frontend.completed, ...(backend ? [backend.completed] : [])]);
	process.exitCode = result.code;
} catch (error) {
	console.error(`\nStartup failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	await runner.stop();
}
