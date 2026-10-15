import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { backendAddress, backendStatus, defaultBackendUrl, processRunner } from './runtime.mjs';

test('backend origins reject embedded credentials and route suffixes', () => {
	assert.deepEqual(backendAddress(defaultBackendUrl), {
		url: 'http://127.0.0.1:8000',
		host: '127.0.0.1',
		port: 8000,
		local: true
	});
	assert.equal(backendAddress('https://api.example.test').local, false);
	for (const invalid of [
		'not a url',
		'file:///tmp/api',
		'http://user:password@localhost:8000',
		'http://127.0.0.1:8000/api/v1',
		'http://127.0.0.1:8000/?token=value'
	])
		assert.throws(() => backendAddress(invalid), /MOBILITY_BACKEND_URL/);
});

test('a reused backend must identify itself; other listeners are never treated as missing', async () => {
	let body = { status: 'ok', service: 'Mobility Sandbox MV API' };
	const server = http.createServer((_request, response) => {
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify(body));
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const listeningAddress = server.address();
	assert.ok(listeningAddress && typeof listeningAddress !== 'string');
	const address = backendAddress(`http://127.0.0.1:${listeningAddress.port}`);
	try {
		assert.equal(await backendStatus(address), 'ready');
		body = { status: 'ok', service: 'Unrelated service' };
		assert.equal(await backendStatus(address), 'occupied');
		body = { status: 'failed', service: 'Mobility Sandbox MV API' };
		assert.equal(await backendStatus(address), 'occupied');
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
	assert.equal(await backendStatus(address), 'unavailable');
});

test('shutdown closes the spawned service and releases its listening port', async () => {
	const runner = processRunner();
	const service = runner.start(
		process.execPath,
		[
			'-e',
			"const server=require('node:http').createServer((req,res)=>res.end('test'));server.listen(0,'127.0.0.1',()=>console.log(server.address().port));"
		],
		{ stdio: ['ignore', 'pipe', 'pipe'] }
	);
	try {
		assert.ok(service.child.stdout);
		const [output] = await once(service.child.stdout, 'data');
		const address = backendAddress(`http://127.0.0.1:${Number(output.toString().trim())}`);
		assert.equal(await backendStatus(address), 'occupied');
		await runner.stop();
		await service.completed;
		assert.equal(await backendStatus(address), 'unavailable');
	} finally {
		await runner.stop();
	}
});
