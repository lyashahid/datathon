import type { OperationalRoadEvent, OperationsBundle, WeatherAlert } from './types.ts';

function timestamp(value: string | null): number | null {
	if (!value) return null;
	const result = Date.parse(value);
	return Number.isFinite(result) ? result : null;
}

/** Half-open validity intervals prevent an expired advisory appearing current. */
export function eventIsActive(
	event: Pick<OperationalRoadEvent, 'validFrom' | 'validUntil'>,
	at: string | number
): boolean {
	const instant = typeof at === 'number' ? at : Date.parse(at);
	const from = timestamp(event.validFrom),
		until = timestamp(event.validUntil);
	// Missing expiry is unresolved evidence, not an indefinitely active closure.
	return (
		Number.isFinite(instant) &&
		from !== null &&
		until !== null &&
		from <= instant &&
		instant < until
	);
}

export function alertState(
	alert: WeatherAlert,
	at: string | number
): 'active' | 'upcoming' | 'expired' | 'unresolved' {
	const instant = typeof at === 'number' ? at : Date.parse(at);
	const from = timestamp(alert.validFrom),
		until = timestamp(alert.validUntil);
	if (!Number.isFinite(instant) || from === null || until === null) return 'unresolved';
	if (instant < from) return 'upcoming';
	return instant >= until ? 'expired' : 'active';
}

/** Apply CAP update/cancel references only after that publisher message was issued. */
export function activeWeatherAlerts(
	bundle: Pick<OperationsBundle, 'weatherAlerts'>,
	at: string | number
): WeatherAlert[] {
	const instant = typeof at === 'number' ? at : Date.parse(at);
	if (!Number.isFinite(instant)) return [];
	const available = bundle.weatherAlerts
		.filter(
			(alert) =>
				alert.status === 'Actual' && alert.scope === 'Public' && Date.parse(alert.sentAt) <= instant
		)
		.sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
	const superseded = new Set<string>();
	for (const message of available) {
		if (message.messageType === 'Update' || message.messageType === 'Cancel')
			for (const id of message.references) superseded.add(id);
	}
	return available.filter(
		(alert) =>
			alert.messageType !== 'Cancel' &&
			!superseded.has(alert.id) &&
			alertState(alert, instant) === 'active'
	);
}
