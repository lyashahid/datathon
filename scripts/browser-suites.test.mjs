import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { selectBrowserSuites } from './browser-suites.mjs';
import { browserBaseURL } from './browser-config.mjs';

test('Selecting several focused suites runs each once and preserves requested order', () => {
	assert.deepEqual(
		selectBrowserSuites(['connections', 'overlays', 'connections']).map((suite) => suite.id),
		['connections', 'overlays']
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
