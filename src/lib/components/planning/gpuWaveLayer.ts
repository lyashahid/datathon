import earcut, { flatten } from 'earcut';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as LibreMap } from 'maplibre-gl';
import { WAVE_DEEPEN_MS, type RecalculationWave } from './recalculationWave.ts';

type Cells = RecalculationWave['cells'];
export interface WaveMesh {
	anchor: [number, number];
	triangles: Float32Array;
	edges: Float32Array;
}

function mercator(point: number[]): [number, number] {
	const lat = Math.max(-85.05112878, Math.min(85.05112878, point[1]));
	const radians = (lat * Math.PI) / 180;
	return [
		(point[0] + 180) / 360,
		(1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2
	];
}

/** Land geometry is triangulated once per edit; holes and split coastlines stay empty. */
export function buildWaveMesh(cells: Cells): WaveMesh {
	const triangles: number[] = [];
	const edges: number[] = [];
	let anchor: [number, number] | null = null;
	for (const cell of cells.features) {
		const polygons =
			cell.geometry.type === 'Polygon' ? [cell.geometry.coordinates] : cell.geometry.coordinates;
		const rawArrival = Number(cell.properties?.arrivalMs);
		const arrival = Number.isFinite(rawArrival) ? Math.max(0, rawArrival) : 0;
		for (const polygon of polygons) {
			const rings = polygon.map((ring) => {
				const points = ring.filter(
					(point) => Number.isFinite(point[0]) && Number.isFinite(point[1])
				);
				if (
					points.length > 1 &&
					points[0][0] === points.at(-1)![0] &&
					points[0][1] === points.at(-1)![1]
				)
					points.pop();
				return points.map((point) => {
					const projected = mercator(point);
					anchor ??= projected;
					return [projected[0] - anchor[0], projected[1] - anchor[1]];
				});
			});
			// A malformed outer ring must never promote a hole into highlighted land.
			if (!rings[0] || rings[0].length < 3) continue;
			const validRings = [rings[0], ...rings.slice(1).filter((ring) => ring.length >= 3)];
			const flat = flatten(validRings);
			for (const vertex of earcut(flat.vertices, flat.holes, 2))
				triangles.push(flat.vertices[vertex * 2], flat.vertices[vertex * 2 + 1], arrival);
			for (const ring of validRings) {
				for (let index = 0; index < ring.length; index++) {
					const next = ring[(index + 1) % ring.length];
					edges.push(ring[index][0], ring[index][1], arrival, next[0], next[1], arrival);
				}
			}
		}
	}
	return {
		anchor: anchor ?? [0, 0],
		triangles: new Float32Array(triangles),
		edges: new Float32Array(edges)
	};
}

const VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
layout(location = 1) in float a_arrival;
uniform mat4 u_matrix;
uniform float u_elapsed;
out float v_age;
void main() {
  gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
  v_age = u_elapsed - a_arrival;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
in float v_age;
uniform float u_opacity;
uniform float u_static;
uniform float u_edges;
out vec4 colour;
void main() {
  // The bright, soft leading ring makes travel visible; the quieter blue trail
  // holds while analysis is pending. A cell appears gradually, never as a flash.
  float reveal = smoothstep(0.0, 65.0, v_age);
  float settle = smoothstep(110.0, ${WAVE_DEEPEN_MS.toFixed(1)}, v_age);
  vec3 light = vec3(0.87, 1.0, 0.96);
  vec3 teal = vec3(0.39, 0.97, 0.85);
  vec3 blue = vec3(0.18, 0.48, 0.67);
  vec3 fill = mix(mix(light, teal, reveal), blue, settle);
  float alpha = (0.64 * reveal - 0.22 * settle);
  if (u_edges > 0.5) {
    fill = mix(vec3(0.10, 0.76, 0.65), vec3(0.14, 0.40, 0.58), settle);
    alpha = 0.80 * reveal - 0.42 * settle;
  }
  if (u_static > 0.5) {
    fill = u_edges > 0.5 ? vec3(0.2784, 0.4824, 0.5686) : vec3(0.7765, 0.8902, 0.9137);
    alpha = u_edges > 0.5 ? 0.10 : 0.24;
  }
  alpha *= u_opacity;
  colour = vec4(fill * alpha, alpha);
}`;

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const result = gl.createShader(type);
	if (!result) throw new Error('Recalculation overlay could not allocate a shader.');
	gl.shaderSource(result, source);
	gl.compileShader(result);
	if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
		const reason = gl.getShaderInfoLog(result);
		gl.deleteShader(result);
		throw new Error(`Recalculation overlay shader failed: ${reason}`);
	}
	return result;
}

/** MapLibre 6 custom layer: static mesh buffers plus scalar uniforms, no tile reloads. */
export class GPUWaveLayer implements CustomLayerInterface {
	readonly id = 'recalculation-wave';
	readonly type = 'custom';
	readonly renderingMode = '2d';
	#map: LibreMap | null = null;
	#gl: WebGL2RenderingContext | null = null;
	#program: WebGLProgram | null = null;
	#triangles: WebGLBuffer | null = null;
	#edges: WebGLBuffer | null = null;
	#triangleVAO: WebGLVertexArrayObject | null = null;
	#edgeVAO: WebGLVertexArrayObject | null = null;
	#uniforms: Record<string, WebGLUniformLocation | null> = {};
	#cells: Cells | null = null;
	#mesh: WaveMesh = { anchor: [0, 0], triangles: new Float32Array(), edges: new Float32Array() };
	#elapsed = 0;
	#opacity = 0;
	#static = false;
	#matrix = new Float32Array(16);

	onAdd(map: LibreMap, gl: WebGL2RenderingContext) {
		this.#map = map;
		this.#gl = gl;
		this.#initialize(gl);
	}

	#initialize(gl: WebGL2RenderingContext) {
		this.#release(gl);
		let vertex: WebGLShader | null = null;
		let fragment: WebGLShader | null = null;
		let program: WebGLProgram | null = null;
		try {
			vertex = shader(gl, gl.VERTEX_SHADER, VERTEX);
			fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
			program = gl.createProgram();
			if (!program) throw new Error('Recalculation overlay could not allocate a program.');
			gl.attachShader(program, vertex);
			gl.attachShader(program, fragment);
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				const reason = gl.getProgramInfoLog(program);
				gl.deleteProgram(program);
				throw new Error(`Recalculation overlay could not link: ${reason}`);
			}
		} finally {
			gl.deleteShader(vertex);
			gl.deleteShader(fragment);
		}
		this.#program = program;
		this.#uniforms = Object.fromEntries(
			['matrix', 'elapsed', 'opacity', 'static', 'edges'].map((key) => [
				key,
				gl.getUniformLocation(program, `u_${key}`)
			])
		);
		this.#triangles = gl.createBuffer();
		this.#edges = gl.createBuffer();
		this.#triangleVAO = gl.createVertexArray();
		this.#edgeVAO = gl.createVertexArray();
		if (!this.#triangles || !this.#edges || !this.#triangleVAO || !this.#edgeVAO) {
			this.#release(gl);
			throw new Error('Recalculation overlay could not allocate mesh buffers.');
		}
		this.#upload();
	}

	#upload() {
		const gl = this.#gl;
		if (!gl || !this.#program) return;
		for (const [vao, buffer, data] of [
			[this.#triangleVAO, this.#triangles, this.#mesh.triangles],
			[this.#edgeVAO, this.#edges, this.#mesh.edges]
		] as const) {
			gl.bindVertexArray(vao);
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
			gl.enableVertexAttribArray(1);
			gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
		}
		gl.bindVertexArray(null);
	}

	setCells(cells: Cells | null) {
		if (cells === this.#cells) return;
		this.#cells = cells;
		this.#mesh = cells
			? buildWaveMesh(cells)
			: { anchor: [0, 0], triangles: new Float32Array(), edges: new Float32Array() };
		if (cells) this.#upload();
		this.#map?.triggerRepaint();
	}

	setFrame(elapsed: number, opacity: number, reducedMotion: boolean) {
		this.#elapsed = elapsed;
		this.#opacity = opacity;
		this.#static = reducedMotion;
		this.#map?.triggerRepaint();
	}

	render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
		if (!this.#program || this.#opacity <= 0 || !this.#mesh.triangles.length || gl.isContextLost())
			return;
		const matrix = options.defaultProjectionData.mainMatrix;
		this.#matrix.set(matrix);
		// Compose the local-origin translation in double precision before upload;
		// absolute Float32 mercator vertices drift several pixels at street zoom.
		for (let row = 0; row < 4; row++)
			this.#matrix[12 + row] =
				matrix[row] * this.#mesh.anchor[0] +
				matrix[4 + row] * this.#mesh.anchor[1] +
				matrix[12 + row];
		gl.useProgram(this.#program);
		gl.uniformMatrix4fv(this.#uniforms.matrix, false, this.#matrix);
		gl.uniform1f(this.#uniforms.elapsed, this.#elapsed);
		gl.uniform1f(this.#uniforms.opacity, this.#opacity);
		gl.uniform1f(this.#uniforms.static, this.#static ? 1 : 0);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.CULL_FACE);
		gl.bindVertexArray(this.#triangleVAO);
		gl.uniform1f(this.#uniforms.edges, 0);
		gl.drawArrays(gl.TRIANGLES, 0, this.#mesh.triangles.length / 3);
		gl.bindVertexArray(this.#edgeVAO);
		gl.uniform1f(this.#uniforms.edges, 1);
		gl.lineWidth(1);
		gl.drawArrays(gl.LINES, 0, this.#mesh.edges.length / 3);
		gl.bindVertexArray(null);
	}

	#release(gl: WebGL2RenderingContext) {
		gl.deleteProgram(this.#program);
		gl.deleteBuffer(this.#triangles);
		gl.deleteBuffer(this.#edges);
		gl.deleteVertexArray(this.#triangleVAO);
		gl.deleteVertexArray(this.#edgeVAO);
		this.#program = null;
	}

	onRemove(_map: LibreMap, gl: WebGL2RenderingContext) {
		this.#release(gl);
		this.#map = null;
		this.#gl = null;
		this.#cells = null;
		this.#mesh = { anchor: [0, 0], triangles: new Float32Array(), edges: new Float32Array() };
	}
}
