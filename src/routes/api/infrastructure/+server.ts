import { json } from '@sveltejs/kit';
import { baselineSource } from '#lib/server/data/baselineSource.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await baselineSource.getInfrastructure());
