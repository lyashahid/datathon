export class ApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public details?: unknown
	) {
		super(message);
	}
}
export async function api<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
	const response = await fetch(`/api/backend/${path}`, {
		method: payload === undefined ? 'GET' : 'POST',
		headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
		body: payload === undefined ? undefined : JSON.stringify(payload),
		signal
	});
	const body = await response.json();
	if (!response.ok)
		throw new ApiError(
			body.error?.message ?? `Request failed (${response.status})`,
			response.status,
			body.error?.details
		);
	return body as T;
}
