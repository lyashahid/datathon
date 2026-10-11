import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { CustomRenderMethodInput, Map as LibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { buildWaveMesh, GPUWaveLayer } from './gpuWaveLayer.ts';

const rectangle = (west: number, south: number, east: number, north: number) => [
	[west, south],
	[east, south],
	[east, north],
	[west, north],
	[west, south]
];
const cells = (geometry: Polygon | MultiPolygon): FeatureCollection<Polygon | MultiPolygon> => ({
	type: 'FeatureCollection',
	features: [{ type: 'Feature', id: 'coast', properties: { arrivalMs: 320 }, geometry }]
});
const projectedY = (lat: number) =>
	(1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const projectedArea = (west: number, south: number, east: number, north: number) =>
	((east - west) / 360) * (projectedY(south) - projectedY(north));
function meshArea(vertices: Float32Array) {
	let area = 0;
	for (let index = 0; index < vertices.length; index += 9) {
		const [ax, ay, , bx, by, , cx, cy] = vertices.slice(index, index + 9);
		area += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
	}
	return area;
}

describe('geographically grounded wave mesh', () => {
	it('keeps coastline holes empty and preserves every cell arrival without changing GeoJSON', () => {
		const input = cells({
			type: 'Polygon',
			coordinates: [rectangle(73.5, 4.1, 73.51, 4.11), rectangle(73.502, 4.102, 73.508, 4.108)]
		});
		const before = structuredClone(input);
		const mesh = buildWaveMesh(input);
		const expected =
			projectedArea(73.5, 4.1, 73.51, 4.11) - projectedArea(73.502, 4.102, 73.508, 4.108);
		expect(meshArea(mesh.triangles) / expected).toBeCloseTo(1, 6);
		expect(mesh.edges.length / 6).toBe(8);
		for (let index = 2; index < mesh.triangles.length; index += 3)
			expect(mesh.triangles[index]).toBe(320);
		expect(input).toEqual(before);
		expect(
			Math.max(...mesh.triangles.filter((_, index) => index % 3 !== 2).map(Math.abs))
		).toBeLessThan(0.0001);
	});

	it('triangulates split coastal islands separately without bridging their sea gap', () => {
		const mesh = buildWaveMesh(
			cells({
				type: 'MultiPolygon',
				coordinates: [[rectangle(73.5, 4.1, 73.51, 4.11)], [rectangle(73.53, 4.1, 73.54, 4.11)]]
			})
		);
		const expected = projectedArea(73.5, 4.1, 73.51, 4.11) + projectedArea(73.53, 4.1, 73.54, 4.11);
		expect(meshArea(mesh.triangles) / expected).toBeCloseTo(1, 6);
		for (let index = 0; index < mesh.triangles.length; index += 9) {
			const xs = [mesh.triangles[index], mesh.triangles[index + 3], mesh.triangles[index + 6]];
			expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.011 / 360);
		}
	});

	it('does not turn a hole into land if the outer boundary is degenerate', () => {
		const mesh = buildWaveMesh(
			cells({
				type: 'Polygon',
				coordinates: [
					[
						[73.5, 4.1],
						[73.5, 4.1]
					],
					rectangle(73.502, 4.102, 73.508, 4.108)
				]
			})
		);
		expect(mesh.triangles.length).toBe(0);
		expect(mesh.edges.length).toBe(0);
	});

	it('produces a valid empty mesh when there is no covered land', () => {
		expect(buildWaveMesh({ type: 'FeatureCollection', features: [] })).toEqual({
			anchor: [0, 0],
			triangles: new Float32Array(),
			edges: new Float32Array()
		});
	});
});

function renderer() {
	const gl = {
		VERTEX_SHADER: 1,
		FRAGMENT_SHADER: 2,
		COMPILE_STATUS: 3,
		LINK_STATUS: 4,
		ARRAY_BUFFER: 5,
		STATIC_DRAW: 6,
		FLOAT: 7,
		BLEND: 8,
		ONE: 9,
		ONE_MINUS_SRC_ALPHA: 10,
		DEPTH_TEST: 11,
		CULL_FACE: 12,
		TRIANGLES: 13,
		LINES: 14,
		createShader: vi.fn(() => ({})),
		shaderSource: vi.fn(),
		compileShader: vi.fn(),
		getShaderParameter: vi.fn(() => true),
		deleteShader: vi.fn(),
		createProgram: vi.fn(() => ({})),
		attachShader: vi.fn(),
		linkProgram: vi.fn(),
		getProgramParameter: vi.fn(() => true),
		deleteProgram: vi.fn(),
		getUniformLocation: vi.fn((_, name: string) => name),
		createBuffer: vi.fn(() => ({})),
		createVertexArray: vi.fn(() => ({})),
		bindVertexArray: vi.fn(),
		bindBuffer: vi.fn(),
		bufferData: vi.fn(),
		enableVertexAttribArray: vi.fn(),
		vertexAttribPointer: vi.fn(),
		isContextLost: vi.fn(() => false),
		useProgram: vi.fn(),
		uniformMatrix4fv: vi.fn(),
		uniform1f: vi.fn(),
		enable: vi.fn(),
		blendFunc: vi.fn(),
		disable: vi.fn(),
		drawArrays: vi.fn(),
		lineWidth: vi.fn(),
		deleteBuffer: vi.fn(),
		deleteVertexArray: vi.fn()
	};
	const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
	const map = { getCanvas: () => canvas, triggerRepaint: vi.fn() };
	const layer = new GPUWaveLayer();
	layer.onAdd(map as unknown as LibreMap, gl as unknown as WebGL2RenderingContext);
	return { layer, gl, canvas, map };
}

describe('GPU-only animation clock', () => {
	it('uploads only on geometry changes while frames and latest-request rebinding reuse buffers', () => {
		const { layer, gl, map } = renderer();
		const input = cells({ type: 'Polygon', coordinates: [rectangle(73.5, 4.1, 73.51, 4.11)] });
		layer.setCells(input);
		const uploads = gl.bufferData.mock.calls.length;
		const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
		const projection = {
			defaultProjectionData: { mainMatrix: identity }
		} as unknown as CustomRenderMethodInput;
		for (let frame = 0; frame < 100; frame++) {
			layer.setFrame(frame * 16, 1, false);
			layer.render(gl as unknown as WebGL2RenderingContext, projection);
		}
		layer.setCells(input);
		expect(gl.bufferData.mock.calls.length).toBe(uploads);
		expect(gl.drawArrays).toHaveBeenCalledTimes(200);
		expect(gl.drawArrays.mock.calls.slice(0, 2).map((call) => call[0])).toEqual([
			gl.TRIANGLES,
			gl.LINES
		]);
		expect(
			gl.uniform1f.mock.calls.filter(([name]) => name === 'u_elapsed').map(([, elapsed]) => elapsed)
		).toEqual(Array.from({ length: 100 }, (_, frame) => frame * 16));
		expect(gl.uniform1f).toHaveBeenCalledWith('u_elapsed', 1584);
		const uploadMatrix = gl.uniformMatrix4fv.mock.calls[0][2] as Float32Array;
		expect(uploadMatrix[12]).toBeCloseTo((73.5 + 180) / 360, 6);
		expect(uploadMatrix[13]).toBeCloseTo(projectedY(4.1), 6);
		layer.setCells(null);
		layer.render(
			gl as unknown as WebGL2RenderingContext,
			{ defaultProjectionData: { mainMatrix: identity } } as unknown as CustomRenderMethodInput
		);
		expect(gl.drawArrays).toHaveBeenCalledTimes(200);
		layer.onRemove(map as unknown as LibreMap, gl as unknown as WebGL2RenderingContext);
		expect(gl.deleteBuffer).toHaveBeenCalledTimes(4); // empty initialization cleanup plus owned buffers
	});

	it('uses the reduced-motion uniform for a quiet static highlight and stops drawing after fade', () => {
		const { layer, gl } = renderer();
		layer.setCells(cells({ type: 'Polygon', coordinates: [rectangle(73.5, 4.1, 73.51, 4.11)] }));
		const projection = {
			defaultProjectionData: { mainMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
		} as unknown as CustomRenderMethodInput;
		layer.setFrame(0, 1, true);
		layer.render(gl as unknown as WebGL2RenderingContext, projection);
		expect(gl.uniform1f).toHaveBeenCalledWith('u_static', 1);
		layer.setFrame(500, 0, true);
		layer.render(gl as unknown as WebGL2RenderingContext, projection);
		expect(gl.drawArrays).toHaveBeenCalledTimes(2);
	});
});
