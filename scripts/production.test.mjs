import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureProductionBuild, frontendAddress, productionFingerprint } from './production.mjs';

/** Remove only an explicitly checked temporary fixture.
 * @param {string} directory
 */
async function removeFixture(directory) {
	const target = path.resolve(directory);
	assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
	assert.ok(path.basename(target).startsWith('mobility-production-'));
	await rm(target, { recursive: true, force: true });
}

test('production startup validates its listener and keeps Vite flags in development', () => {
	assert.deepEqual(frontendAddress([], {}), { host: '127.0.0.1', port: 5173, forceBuild: false });
	assert.deepEqual(frontendAddress(['--host', '::1', '--port=5180', '--force-build'], {}), {
		host: '::1',
		port: 5180,
		forceBuild: true
	});
	assert.equal(frontendAddress(['--host', '--strictPort'], {}).host, '0.0.0.0');
	for (const args of [['--port'], ['--port=0'], ['--port=65536'], ['--port=4.5'], ['--open']])
		assert.throws(() => frontendAddress(args, {}));
});

test('optimized builds survive restarts but source, settings and dependency changes invalidate them', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'mobility-production-'));
	let builds = 0;
	const runner = {
		async run() {
			builds++;
			for (const entry of [
				'index.js',
				'handler.js',
				'server/adapter-index.js',
				'server/manifest.js',
				'client/_app/version.json'
			]) {
				const target = path.join(directory, 'build', entry);
				await mkdir(path.dirname(target), { recursive: true });
				await writeFile(target, '// compiled');
			}
		}
	};
	try {
		await mkdir(path.join(directory, 'src'));
		await writeFile(path.join(directory, 'src/app.html'), 'one');
		const options = { directory, environment: {} };
		assert.equal(await ensureProductionBuild(runner, options), true);
		assert.equal(await ensureProductionBuild(runner, options), false);
		assert.equal(builds, 1);
		await writeFile(path.join(directory, 'src/app.html'), 'two');
		assert.equal(await ensureProductionBuild(runner, options), true);
		await writeFile(path.join(directory, 'package-lock.json'), '{"lockfileVersion":3}');
		assert.equal(await ensureProductionBuild(runner, options), true);
		await rm(path.join(directory, 'src/app.html'));
		assert.equal(await ensureProductionBuild(runner, options), true);
		const secret = 'a-private-test-value';
		const privateOptions = { directory, environment: { VELA_API_KEY: secret } };
		assert.equal(await ensureProductionBuild(runner, privateOptions), true);
		assert.equal(await ensureProductionBuild(runner, privateOptions), false);
		assert.equal(
			(await readFile(path.join(directory, 'build/.mobility-build.json'), 'utf8')).includes(secret),
			false
		);
		assert.equal(await ensureProductionBuild(runner, { ...privateOptions, force: true }), true);
		assert.equal(builds, 6);
		await rm(path.join(directory, 'build/index.js'));
		assert.equal(await ensureProductionBuild(runner, privateOptions), true);
		assert.equal(builds, 7);
		await rm(path.join(directory, 'build/server/manifest.js'));
		assert.equal(await ensureProductionBuild(runner, privateOptions), true);
		assert.equal(builds, 8);
	} finally {
		await removeFixture(directory);
	}
});

test('runtime artifacts do not invalidate the frontend and failed builds are never marked ready', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'mobility-production-'));
	try {
		const before = await productionFingerprint(directory, {});
		await mkdir(path.join(directory, 'backend'));
		await writeFile(path.join(directory, 'backend/ignored-runtime.json'), 'changing data');
		assert.equal(await productionFingerprint(directory, {}), before);
		await assert.rejects(
			ensureProductionBuild(
				{
					async run() {
						throw new Error('failed compilation');
					}
				},
				{ directory, environment: {} }
			),
			/failed compilation/
		);
		await assert.rejects(readFile(path.join(directory, 'build/.mobility-build.json')), {
			code: 'ENOENT'
		});
	} finally {
		await removeFixture(directory);
	}
});
