import { redirect } from '@sveltejs/kit';
export function load() {
	redirect(307, '/?view=map&tool=proposals&proposal=policy');
}
