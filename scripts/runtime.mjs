import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const defaultBackendUrl = 'http://127.0.0.1:8000';

export function configureEnvironment() {
	if (Number(process.versions.node.split('.')[0]) < 24)
		throw new Error('Node.js 24 or later is required. Install Node.js 24 LTS, then run npm ci.');
	try {
		process.loadEnvFile(path.join(root, '.env'));
	} catch (error) {
		if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
	}
	process.env.MOBILITY_BACKEND_URL ||= defaultBackendUrl;
}

/** @param {string} value */
export function backendAddress(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error('MOBILITY_BACKEND_URL must be an HTTP or HTTPS origin.');
	}
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	)
		throw new Error('MOBILITY_BACKEND_URL must be an HTTP or HTTPS origin without credentials.');
	return {
		url: url.origin,
		host: url.hostname.replace(/^\[|\]$/g, ''),
		port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
		local: url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
	};
}

/** @param {string} host @param {number} port @returns {Promise<boolean>} */
function portOccupied(host, port) {
	return new Promise((resolve) => {
		const socket = net.connect({ host, port });
		/** @param {boolean} occupied */
		const finish = (occupied) => {
			socket.destroy();
			resolve(occupied);
		};
		socket.setTimeout(1500);
		socket.once('connect', () => finish(true));
		socket.once('error', () => finish(false));
		socket.once('timeout', () => finish(true));
	});
}

/** @param {ReturnType<typeof backendAddress>} address */
export async function backendStatus(address) {
	try {
		const response = await fetch(new URL('/health', address.url), {
			signal: AbortSignal.timeout(2000)
		});
		const body = await response.json();
		return response.ok && body.status === 'ok' && body.service === 'Mobility Sandbox MV API'
			? 'ready'
			: 'occupied';
	} catch {
		return (await portOccupied(address.host, address.port)) ? 'occupied' : 'unavailable';
	}
}

/** Start only a missing local backend; preserve separately managed services.
 * @param {ReturnType<typeof processRunner>} runner
 */
export async function prepareBackend(runner) {
	const address = backendAddress(process.env.MOBILITY_BACKEND_URL ?? defaultBackendUrl);
	const status = await backendStatus(address);
	if (status === 'occupied')
		throw new Error(
			`Port ${address.port} is occupied by a different or unhealthy service. Stop that service, then retry. The launcher will not replace an existing process.`
		);
	if (status === 'ready') {
		console.log(`Using running mobility backend at ${address.url}`);
		return undefined;
	}
	if (!address.local)
		throw new Error('The configured remote backend is unavailable. Check its service and URL.');
	await setupBackend(runner);
	if ((await backendStatus(address)) !== 'unavailable')
		throw new Error(`Port ${address.port} became occupied during setup. Retry startup.`);
	const backend = runner.start('uv', [
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
	let backendExited = false;
	backend.completed.catch(() => {}).finally(() => (backendExited = true));
	const deadline = Date.now() + 120_000;
	while ((await backendStatus(address)) !== 'ready') {
		if (backendExited) {
			await backend.completed;
			throw new Error('The backend exited before becoming ready. See its output above.');
		}
		if (Date.now() > deadline)
			throw new Error('The backend did not become ready within two minutes. See its output above.');
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	console.log(`Mobility backend ready at ${address.url}`);
	return backend;
}

// Every spawned process has its own group on Unix so Ctrl+C also stops uv's Python child.
export function processRunner() {
	/** @type {Set<import('node:child_process').ChildProcess>} */
	const children = new Set();
	let stopping = false;
	/**
	 * @param {string} command
	 * @param {string[]} args
	 * @param {import('node:child_process').SpawnOptions} [options]
	 */
	function start(command, args, options = {}) {
		const child = spawn(command, args, {
			cwd: root,
			stdio: 'inherit',
			windowsHide: true,
			detached: process.platform !== 'win32',
			...options
		});
		children.add(child);
		/** @type {Promise<{code: number, signal: NodeJS.Signals | null}>} */
		const completed = new Promise((resolve, reject) => {
			child.once('error', (error) => {
				children.delete(child);
				reject(error);
			});
			child.once('exit', (code, signal) => {
				children.delete(child);
				resolve({ code: code ?? (stopping ? 0 : 1), signal });
			});
		});
		return { child, completed };
	}
	/**
	 * @param {string} command
	 * @param {string[]} args
	 * @param {import('node:child_process').SpawnOptions} [options]
	 */
	async function run(command, args, options) {
		const { code } = await start(command, args, options).completed;
		if (code !== 0) throw new Error(`${command} exited with code ${code}.`);
	}
	async function stop() {
		if (stopping) return;
		stopping = true;
		await Promise.all(
			[...children].map(async (child) => {
				if (!child.pid || child.exitCode !== null) return;
				if (process.platform === 'win32') {
					await new Promise((resolve) => {
						const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
							windowsHide: true,
							stdio: 'ignore'
						});
						killer.once('error', () => resolve(undefined));
						killer.once('exit', () => resolve(undefined));
					});
				} else {
					try {
						process.kill(-child.pid, 'SIGTERM');
					} catch (error) {
						if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
					}
					await new Promise((resolve) => {
						const childPid = child.pid;
						const timer = setTimeout(() => {
							try {
								if (childPid) process.kill(-childPid, 'SIGKILL');
							} catch (error) {
								if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
									console.error(error instanceof Error ? error.message : String(error));
							}
							resolve(undefined);
						}, 2000);
						child.once('exit', () => {
							clearTimeout(timer);
							resolve(undefined);
						});
					});
				}
			})
		);
	}
	return { start, run, stop };
}

/** @param {ReturnType<typeof processRunner>} runner */
export function handleSignals(runner) {
	for (const signal of ['SIGINT', 'SIGTERM'])
		process.once(signal, () => {
			void runner.stop().finally(() => process.exit(0));
		});
}

/**
 * @param {ReturnType<typeof processRunner>} runner
 * @param {{development?: boolean, systemDependencies?: boolean}} [options]
 */
export async function setupBackend(
	runner,
	{ development = false, systemDependencies = false } = {}
) {
	try {
		await runner.run('uv', ['--version']);
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
			throw new Error(
				'uv is required. Install it from https://docs.astral.sh/uv/getting-started/installation/, reopen your terminal, and run npm start.',
				{ cause: error }
			);
		throw error;
	}
	console.log('\nPreparing the locked Python backend (uv downloads Python 3.14 automatically).');
	await runner.run('uv', [
		'sync',
		'--directory',
		'backend',
		'--locked',
		'--python',
		'3.14',
		'--managed-python',
		...(development ? [] : ['--no-dev'])
	]);
	if (process.env.VELA_BROWSER_ENABLED?.toLowerCase() === 'false') return;
	console.log('\nPreparing Chromium for place reviews. Existing downloads are reused.');
	const python = ['run', '--directory', 'backend', '--no-sync', 'python'];
	await runner.run('uv', [
		...python,
		'-m',
		'playwright',
		'install',
		...(systemDependencies ? ['--with-deps'] : []),
		'chromium'
	]);
	try {
		await runner.run('uv', [
			...python,
			'-c',
			[
				'from playwright.sync_api import sync_playwright',
				'with sync_playwright() as p:',
				'    browser = p.chromium.launch(headless=True)',
				'    browser.close()'
			].join('\n')
		]);
	} catch {
		throw new Error(
			'Chromium could not start. On Linux, run npm run setup -- --with-system-deps to install its system libraries, then retry npm start. On Windows or macOS, rerun npm run setup and inspect the browser error above.'
		);
	}
}
