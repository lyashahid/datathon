import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './runtime.mjs';

const buildEntries = [
	'index.js',
	'handler.js',
	'server/adapter-index.js',
	'server/manifest.js',
	'client/_app/version.json'
];

/** @param {string} directory */
async function verifyBuild(directory) {
	await Promise.all(buildEntries.map((entry) => access(path.join(directory, 'build', entry))));
}

/** Validate production listener options; never silently select another port.
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [environment]
 */
export function frontendAddress(args, environment = process.env) {
	let host = environment.MOBILITY_FRONTEND_HOST || '127.0.0.1';
	let port = environment.MOBILITY_FRONTEND_PORT || '5173';
	let forceBuild = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === '--host') {
			host = args[index + 1] && !args[index + 1].startsWith('--') ? args[++index] : '0.0.0.0';
		} else if (argument.startsWith('--host=')) host = argument.slice(7);
		else if (argument === '--port') port = args[++index] || '';
		else if (argument.startsWith('--port=')) port = argument.slice(7);
		else if (argument === '--force-build') forceBuild = true;
		else if (argument !== '--strictPort')
			throw new Error(`Unknown startup option ${argument}. Use npm run dev for Vite options.`);
	}
	if (!host || /[\s/\\]/.test(host))
		throw new Error('Choose a valid frontend hostname or IP address.');
	if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
		throw new Error('The frontend port must be an integer between 1 and 65535.');
	return { host: host.replace(/^\[|\]$/g, ''), port: Number(port), forceBuild };
}

/** Hash actual build inputs, including deletions and private build-time settings.
 * Only the digest is saved; environment values never appear in the manifest.
 * @param {string} [directory]
 * @param {NodeJS.ProcessEnv} [environment]
 */
export async function productionFingerprint(directory = root, environment = process.env) {
	const hash = createHash('sha256').update('mobility-production-build-v1\0');
	/** @param {string} relative */
	async function include(relative) {
		const absolute = path.join(directory, relative);
		try {
			const entries = await readdir(absolute, { withFileTypes: true });
			for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
				if (entry.isDirectory() || entry.isFile()) await include(path.join(relative, entry.name));
			}
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
				hash.update(`${relative}\0missing\0`);
				return;
			}
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOTDIR')) throw error;
			const content = await readFile(absolute);
			hash.update(`${relative}\0${content.byteLength}\0`).update(content);
		}
	}
	for (const input of [
		'src',
		'static',
		'vite.config.ts',
		'tsconfig.json',
		'package.json',
		'package-lock.json',
		'.env',
		'.env.local',
		'.env.production',
		'.env.production.local'
	])
		await include(input);
	hash.update(
		JSON.stringify(
			Object.entries(environment)
				.filter(([key]) => /^(PUBLIC_|MOBILITY_BACKEND_URL$|VELA_API_KEY$)/.test(key))
				.sort(([a], [b]) => a.localeCompare(b))
		)
	);
	return hash.digest('hex');
}

/** Reuse an optimized build only when every source and dependency input matches.
 * @param {{run:(command:string,args:string[])=>Promise<void>}} runner
 * @param {{directory?:string, environment?:NodeJS.ProcessEnv, force?:boolean}} [options]
 */
export async function ensureProductionBuild(runner, options = {}) {
	const directory = options.directory || root;
	const fingerprint = await productionFingerprint(directory, options.environment || process.env);
	const manifest = path.join(directory, 'build', '.mobility-build.json');
	try {
		const previous = JSON.parse(await readFile(manifest, 'utf8'));
		await verifyBuild(directory);
		if (!options.force && previous.fingerprint === fingerprint) {
			console.log('Using the existing optimized frontend build.');
			return false;
		}
	} catch (error) {
		if (
			!(error instanceof SyntaxError) &&
			!(error instanceof Error && 'code' in error && error.code === 'ENOENT')
		)
			throw error;
	}
	console.log('Building the optimized frontend. Later starts reuse it until the source changes.');
	await runner.run(process.execPath, [
		path.join(directory, 'node_modules/vite/bin/vite.js'),
		'build'
	]);
	await verifyBuild(directory);
	await mkdir(path.dirname(manifest), { recursive: true });
	await writeFile(manifest, JSON.stringify({ fingerprint }), 'utf8');
	return true;
}
