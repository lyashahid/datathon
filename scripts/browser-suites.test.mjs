import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { browserSuites, selectBrowserSuites } from './browser-suites.mjs';
import { browserBaseURL } from './browser-config.mjs';

test('The catalogue covers maintained harnesses and selects each focused suite once in order', () => {
	assert.equal(new Set(browserSuites.map((suite) => suite.id)).size, browserSuites.length);
	assert.equal(new Set(browserSuites.map((suite) => suite.file)).size, browserSuites.length);
	for (const suite of browserSuites) assert.ok(existsSync(new URL(suite.file, import.meta.url)));
	const directChecks = new Set([
		'verify-browser.mjs',
		'verify-policy-api.mjs',
		'verify-subpath.mjs'
	]);
	const harnesses = readdirSync(new URL('.', import.meta.url)).filter(
		(file) => /^verify-.*\.mjs$/.test(file) && !directChecks.has(file)
	);
	assert.deepEqual(
		browserSuites
			.filter((suite) => !suite.api)
			.map((suite) => suite.file)
			.sort(),
		harnesses.sort()
	);
	assert.deepEqual(
		selectBrowserSuites(['sea-network', 'overlays', 'sea-network']).map((suite) => suite.id),
		['sea-network', 'overlays']
	);
	assert.throws(() => selectBrowserSuites(['overaly']), /Unknown browser suite/);
	assert.throws(() => selectBrowserSuites(['--all', 'overlays']), /on its own/);
});

test('The documented URL overrides the legacy alias consistently, including a trailing slash', () => {
	assert.equal(
		browserBaseURL({
			MOBILITY_QA_URL: 'http://localhost:5180/',
			BASE_URL: 'http://localhost:9999'
		}),
		'http://localhost:5180'
	);
	assert.equal(browserBaseURL({ BASE_URL: 'http://localhost:5181/' }), 'http://localhost:5181');
});

test('The public runner lists coverage without a server and rejects typos before launching a browser', () => {
	const runner = fileURLToPath(new URL('./verify-browser.mjs', import.meta.url));
	const listing = spawnSync(process.execPath, [runner, '--list'], { encoding: 'utf8' });
	assert.equal(listing.status, 0, listing.stderr);
	assert.match(listing.stdout, /overlays/);
	assert.match(listing.stdout, /policy-api/);
	const invalid = spawnSync(process.execPath, [runner, 'not-a-suite'], { encoding: 'utf8' });
	assert.equal(invalid.status, 1);
	assert.match(invalid.stderr, /Unknown browser suite/);
	assert.doesNotMatch(invalid.stdout, /Browser suite:/);
});
