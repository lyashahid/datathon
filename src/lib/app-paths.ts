import { PUBLIC_BASE_PATH } from '$app/env/public';

/** Keep browser requests and downloads inside this app's reverse-proxy mount. */
export function backendUrl(path: string, basePath = PUBLIC_BASE_PATH): string {
	return `${basePath}/api/backend/${path}`;
}
