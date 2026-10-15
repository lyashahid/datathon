import type { Coordinates, LiveSnapshot } from './types.js';

export interface MovementScope {
	key: string;
	query: string;
	label: string;
}
export interface MovementState {
	snapshot: LiveSnapshot | null;
	loading: boolean;
	error: string;
	scopeKey: string | null;
}

export function movementScope(id: string, name: string, coordinates: Coordinates): MovementScope {
	const [longitude, latitude] = coordinates;
	if (
		!Number.isFinite(longitude) ||
		!Number.isFinite(latitude) ||
		longitude < 72 ||
		longitude > 75 ||
		latitude < -1 ||
		latitude > 8.5
	)
		throw new Error('Choose an island within the Maldives movement coverage.');
	const radiusNm = 10;
	const latitudeRadius = (radiusNm * 1.852) / 111.32;
	const longitudeRadius = latitudeRadius / Math.cos((latitude * Math.PI) / 180);
	const bbox = [
		Math.max(72, longitude - longitudeRadius),
		Math.max(-1, latitude - latitudeRadius),
		Math.min(75, longitude + longitudeRadius),
		Math.min(8.5, latitude + latitudeRadius)
	]
		.map((value) => value.toFixed(6))
		.join(',');
	const query = new URLSearchParams({
		latitude: String(latitude),
		longitude: String(longitude),
		radius_nm: String(radiusNm),
		bbox,
		island_name: name,
		discover_nearby: 'true',
		include_stale: 'false',
		max_age_seconds: '300'
	}).toString();
	return { key: `${id}:${longitude}:${latitude}`, query, label: `${name} · within 18.5 km` };
}

/** Owns one visible scope, cancels obsolete requests, and never polls a hidden workspace. */
export class MovementSession {
	private scope: MovementScope | null = null;
	private previousKey: string | null = null;
	private generation = 0;
	private controller: AbortController | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	private state: MovementState = { snapshot: null, loading: false, error: '', scopeKey: null };

	constructor(
		private fetchSnapshot: (scope: MovementScope, signal: AbortSignal) => Promise<LiveSnapshot>,
		private change: (state: MovementState) => void,
		private intervalSeconds: () => number = () => 60
	) {}

	configure(scope: MovementScope | null) {
		if (this.disposed || this.scope?.key === scope?.key) return;
		this.cancel();
		this.scope = scope;
		if (!scope) {
			this.emit({ loading: false });
			return;
		}
		if (scope.key !== this.previousKey) {
			this.previousKey = scope.key;
			this.emit({ snapshot: null, error: '', scopeKey: scope.key });
		}
		void this.refresh();
	}

	async refresh() {
		if (!this.scope || this.disposed) return;
		this.cancel();
		const scope = this.scope;
		const generation = this.generation;
		const controller = new AbortController();
		this.controller = controller;
		this.emit({ loading: true, error: '' });
		try {
			const snapshot = await this.fetchSnapshot(scope, controller.signal);
			if (this.disposed || controller.signal.aborted || generation !== this.generation) return;
			this.emit({ snapshot, scopeKey: scope.key });
		} catch (error) {
			if (this.disposed || controller.signal.aborted || generation !== this.generation) return;
			this.emit({
				error: error instanceof Error ? error.message : 'Movement providers could not be reached.'
			});
		} finally {
			if (!this.disposed && generation === this.generation) {
				this.controller = null;
				this.emit({ loading: false });
				const configured = this.intervalSeconds();
				const seconds = Number.isFinite(configured) ? Math.max(60, configured) : 60;
				if (this.scope) this.timer = setTimeout(() => void this.refresh(), seconds * 1000);
			}
		}
	}

	dispose() {
		this.cancel();
		this.scope = null;
		this.disposed = true;
	}

	private cancel() {
		this.generation += 1;
		clearTimeout(this.timer);
		this.controller?.abort();
		this.controller = null;
	}

	private emit(patch: Partial<MovementState>) {
		this.state = { ...this.state, ...patch };
		this.change(this.state);
	}
}
