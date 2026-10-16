import { redirect } from '@sveltejs/kit';
import { PUBLIC_BASE_PATH } from '$app/env/public';
export function load() {
	redirect(307, `${PUBLIC_BASE_PATH}/?view=evidence`);
}
