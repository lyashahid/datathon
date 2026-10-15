import { MOBILITY_BACKEND_URL, VELA_API_KEY } from '$app/env/private';
import { forwardBackend } from '#lib/server/backend.js';
import type { RequestHandler } from './$types';

const handler: RequestHandler = ({ request, params, fetch }) =>
	forwardBackend(request, params.path, MOBILITY_BACKEND_URL, fetch, VELA_API_KEY);
export const GET = handler;
export const POST = handler;
