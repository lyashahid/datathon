/** Only public source snapshots belong in browser caches. Live and scenario reads stay fresh. */
export function apiCachePolicy(path: string) {
	const pathname = path.split('?')[0];
	// Published observations are stable; fitted forecasts keep fresh response semantics.
	if (pathname === 'forecasts' && path.split('?')[1] === 'history_only=true')
		return { maxAge: 60_000, persistent: true };
	if (
		/^(?:national\/summary|map\/features|accessibility\/(?:summary|score)|islands(?:\/[^/]+(?:\/profile)?)?|routing\/stops|planning\/(?:baseline|connectivity|opportunities(?:\/[^/]+)?))$/.test(
			pathname
		)
	)
		return { maxAge: 60_000, persistent: true };
	if (/^datasets(?:\/[^/]+\/schema)?$/.test(pathname)) return { maxAge: 30_000, persistent: true };
	return null;
}

/** Sorting query keys lets independently mounted views share the same source request. */
export function canonicalApiPath(path: string) {
	const [pathname, query = ''] = path.split('?');
	const parameters = new URLSearchParams(query);
	parameters.sort();
	const search = parameters.toString();
	return `${pathname}${search ? `?${search}` : ''}`;
}

export function changesPublicSources(path: string) {
	return /^(?:forecasts\/sources\/[a-f0-9]{32}\/accept|data-updates\/schedules\/[a-f0-9]{64}\/accept|operations\/notices\/(?:ingest|[^/]+\/review))$/.test(
		path.split('?')[0]
	);
}
