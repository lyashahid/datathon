import { fetchInfrastructure } from '#lib/data/infrastructure.ts';
import { fetchRoutes } from '#lib/data/routes.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const [infrastructure, routes] = await Promise.all([
		fetchInfrastructure(fetch),
		fetchRoutes(fetch)
	]);
	return { infrastructure, routes };
};
