import type { AirNetwork, AirRoute } from '#lib/air-connectivity.js';
import { seaPressureColors } from '#lib/sea-connectivity.js';

/** Native disclosure keeps route provenance inspectable without opening another panel. */
export function airRouteCard(network: AirNetwork, route: AirRoute): HTMLElement {
	const panel = document.createElement('section');
	panel.className = 'map-record-card map-network-route-card';
	panel.setAttribute('aria-label', 'Domestic flight route');
	panel.dataset.airRoute = route.id;
	const eyebrow = document.createElement('small');
	eyebrow.className = 'map-record-kind';
	eyebrow.textContent = `Domestic flight · ${route.from_iata} ${route.bidirectional ? '↔' : '→'} ${route.to_iata}`;
	const title = document.createElement('h3');
	title.textContent = route.name;
	const badge = document.createElement('span');
	badge.className = 'sea-route-pressure';
	badge.dataset.pressure = route.pressure.level;
	const dot = document.createElement('i');
	dot.style.backgroundColor = seaPressureColors[route.pressure.level] ?? seaPressureColors.unknown;
	dot.setAttribute('aria-hidden', 'true');
	const pressureLabel = { low: 'Low', medium: 'Moderate', high: 'High', unknown: 'Unknown' }[
		route.pressure.level
	];
	badge.append(
		dot,
		route.pressure.level === 'unknown' ? 'Pressure unknown' : `${pressureLabel} estimated pressure`
	);
	const summary = document.createElement('dl');
	function row(list: HTMLDListElement, label: string, value: unknown) {
		if (value === undefined || value === null || value === '') return;
		const term = document.createElement('dt');
		term.textContent = label;
		const description = document.createElement('dd');
		description.textContent = String(value);
		list.append(term, description);
	}
	row(summary, 'Operator', route.operator);
	row(summary, 'Direction', route.bidirectional ? 'Outbound & return' : 'Published direction');
	row(
		summary,
		'Flight schedule',
		route.schedule.departures_per_week == null
			? 'Current frequency unconfirmed'
			: `${route.schedule.departures_per_week.toLocaleString()} departures / week`
	);
	panel.append(eyebrow, title, badge, summary);
	const details = document.createElement('details');
	details.className = 'sea-route-details';
	const toggle = document.createElement('summary');
	toggle.textContent = 'Route details';
	const evidence = document.createElement('dl');
	row(evidence, 'From', route.from_airport?.name ?? route.from_iata);
	row(evidence, 'To', route.to_airport?.name ?? route.to_iata);
	if (route.via_iata?.length) {
		row(
			evidence,
			'Via',
			route.via_iata
				.map((iata) => network.airports.find((airport) => airport.iata === iata)?.name ?? iata)
				.join(' → ')
		);
	}
	row(evidence, 'Date being viewed', network.service_date);
	row(
		evidence,
		'Route evidence',
		route.evidence === 'historical_timetable'
			? 'Historical timetable'
			: 'Published airline connection'
	);
	if (route.valid_from || route.valid_until)
		row(
			evidence,
			'Published validity',
			`${route.valid_from ?? 'Unspecified'} – ${route.valid_until ?? 'Unspecified'}`
		);
	row(evidence, 'Flight path', 'Schematic airport connection');
	if (typeof route.published_schedule?.publication_date === 'string')
		row(evidence, 'Publication date', route.published_schedule.publication_date);
	if (route.pressure.capacity != null)
		row(evidence, 'Published capacity', route.pressure.capacity.toLocaleString());
	details.append(toggle, evidence);
	if (route.published_schedule?.departures?.length) {
		const heading = document.createElement('p');
		heading.className = 'sea-route-detail-heading';
		heading.textContent = 'Published departures · Maldives time';
		const departures = document.createElement('dl');
		const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
		for (const departure of route.published_schedule.departures) {
			row(
				departures,
				`${departure.from_iata} → ${departure.to_iata}`,
				`${departure.iso_weekdays.map((day) => weekdays[day - 1]).join(', ')} · ${departure.departure_times.join(', ')}`
			);
		}
		details.append(heading, departures);
	}
	if (typeof route.published_schedule?.description === 'string') {
		const historical = document.createElement('p');
		historical.className = 'sea-route-qualification';
		historical.textContent = `Historical publication · ${route.published_schedule.description}`;
		details.append(historical);
	}
	for (const text of new Set([
		route.qualification,
		route.pressure.explanation,
		route.geometry_qualification,
		'Aircraft on this line are route illustrations. Live positions are shown separately; no flight or aircraft assignment is inferred.'
	])) {
		if (!text) continue;
		const note = document.createElement('p');
		note.className = 'sea-route-qualification';
		note.textContent = text;
		details.append(note);
	}
	const sources = document.createElement('div');
	sources.className = 'sea-route-sources';
	for (const source of network.sources) {
		if (
			(!route.source_ids.includes(source.id) && source.id !== 'openstreetmap') ||
			!source.url ||
			!/^https?:\/\//i.test(source.url)
		)
			continue;
		const link = document.createElement('a');
		link.href = source.url;
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		link.textContent = source.title;
		sources.append(link);
	}
	if (sources.childElementCount) details.append(sources);
	panel.append(details);
	return panel;
}
