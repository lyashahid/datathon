import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = resolve(PROJECT_ROOT, 'static/graphics/generated');
const ARCHIVE_DIR = resolve(PROJECT_ROOT, 'artifacts/graphics/generated');
const ASSETS = [
	'bus-stop',
	'bus-stop-proposed',
	'hospital',
	'hospital-proposed',
	'school',
	'clinic',
	'bus',
	'ferry'
];

/** Require sharp without adding a project dependency or downloading a runtime. */
function loadSharp() {
	const require = createRequire(import.meta.url);
	const bundledModules = join(
		homedir(),
		'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
	);
	const candidates = [null, process.env.MAP_GRAPHICS_NODE_MODULES, bundledModules].filter(
		(value) => value !== undefined
	);
	for (const modules of candidates) {
		try {
			const modulePath = modules
				? require.resolve('sharp', { paths: [dirname(resolve(modules))] })
				: require.resolve('sharp');
			return require(modulePath);
		} catch {
			// Try the next already-installed package location.
		}
	}
	throw new Error(
		'Sharp is unavailable. Set MAP_GRAPHICS_NODE_MODULES to an existing node_modules directory containing sharp.'
	);
}

/** @param {string} path */
async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
			return false;
		throw error;
	}
}

/** @param {string} path */
function assertWorkspaceFile(path) {
	const location = relative(PROJECT_ROOT, resolve(path));
	if (!location || location.startsWith('..') || isAbsolute(location)) {
		throw new Error(`Refusing a file operation outside the project: ${path}`);
	}
}

/**
 * Package generated artwork for the browser. Source PNGs stay in the ignored
 * archive; the 256 px lossless WebP preserves transparency and matches the square
 * UI display box. This changes delivery resolution, never the generated design.
 */
async function main() {
	const sharp = loadSharp();
	await mkdir(ARCHIVE_DIR, { recursive: true });
	await mkdir(RUNTIME_DIR, { recursive: true });
	let sourceBytes = 0;
	let runtimeBytes = 0;
	for (const name of ASSETS) {
		const original = join(RUNTIME_DIR, `${name}.png`);
		const archive = join(ARCHIVE_DIR, `${name}.png`);
		const output = join(RUNTIME_DIR, `${name}.webp`);
		const temporary = `${output}.tmp`;
		for (const path of [original, archive, output, temporary]) assertWorkspaceFile(path);
		if (await exists(original)) await copyFile(original, archive);
		if (!(await exists(archive))) throw new Error(`Missing generated source: ${archive}`);
		const input = await readFile(archive);
		const sourceMetadata = await sharp(input).metadata();
		const buffer = await sharp(input)
			.resize(256, 256, {
				fit: 'contain',
				background: { r: 0, g: 0, b: 0, alpha: 0 },
				withoutEnlargement: true
			})
			.webp({ lossless: true, effort: 6 })
			.toBuffer();
		const metadata = await sharp(buffer).metadata();
		if (metadata.width !== 256 || metadata.height !== 256) {
			throw new Error(`Unexpected runtime dimensions for ${name}`);
		}
		if (sourceMetadata.hasAlpha && !metadata.hasAlpha) {
			throw new Error(`Transparency was lost while packaging ${name}`);
		}
		await writeFile(temporary, buffer);
		await rename(temporary, output);
		// Remove the served high-resolution copy only after both archive and runtime
		// files exist; reruns read the archived source and produce identical artwork.
		if (await exists(original)) await unlink(original);
		sourceBytes += input.byteLength;
		runtimeBytes += buffer.byteLength;
		console.log(
			`${name}: ${input.byteLength} → ${buffer.byteLength} bytes (256 px, alpha preserved)`
		);
	}
	console.log(
		`Runtime bundle: ${runtimeBytes} bytes; ${(100 * (1 - runtimeBytes / sourceBytes)).toFixed(1)}% smaller than generated sources.`
	);
}

await main();
