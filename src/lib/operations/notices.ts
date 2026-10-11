import type { OperationalNoticeCandidate } from './types.ts';

export const PUBLIC_NOTICE_HOSTS = new Set([
	'cap.meteorology.gov.mv',
	'www.meteorology.gov.mv',
	'meteorology.gov.mv',
	'malecity.gov.mv',
	'www.malecity.gov.mv',
	'maavehi.gov.mv',
	'police.gov.mv',
	'www.police.gov.mv',
	'rtl.mv',
	'www.rtl.mv',
	'mtcc.mv',
	'www.mtcc.mv',
	'hdc.mv',
	'www.hdc.mv',
	'english.sun.mv',
	'sun.mv',
	'psmnews.mv',
	'www.psmnews.mv',
	'edition.mv',
	'avas.mv'
]);

export function publicNoticeUrl(value: unknown): string {
	if (typeof value !== 'string' || value.length > 2048 || !URL.canParse(value))
		throw new Error('A public publisher URL is required.');
	const url = new URL(value);
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.port ||
		!PUBLIC_NOTICE_HOSTS.has(url.hostname.toLowerCase())
	)
		throw new Error('Use an allowlisted Maldives public notice publisher over HTTPS.');
	url.hash = '';
	return url.toString();
}

function stableId(text: string): string {
	let value = 2166136261;
	for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
	return (value >>> 0).toString(16);
}

/** Deliberately conservative: unqualified dates or named roads still need planner confirmation. */
export function extractNoticeRules(input: {
	sourceUrl: string;
	text: string;
	title?: string;
	publishedAt?: string | null;
}): OperationalNoticeCandidate {
	const sourceUrl = publicNoticeUrl(input.sourceUrl);
	const content = input.text.replace(/\s+/g, ' ').trim();
	if (content.length < 20 || content.length > 16000)
		throw new Error('Provide 20–16,000 characters of public notice text.');
	const relevant =
		/\b(closed?|closure|blocked?|obstruct(?:ed|ion)?|diversion|detour|roadworks?|construction|maintenance|suspend(?:ed|sion)?|cancel(?:led|lation)?|flood(?:ed|ing)?)\b/i;
	const sentences = content.match(/[^.!?]+[.!?]?/g) ?? [content];
	const supportingText =
		sentences.find((sentence) => relevant.test(sentence))?.trim() ?? content.slice(0, 500);
	const location =
		supportingText.match(
			/\b(?:[A-Z][\w'’.-]*\s+){0,3}(?:Magu|Road|Street|Bridge|Terminal|Harbour|Harbor)\b/
		)?.[0] ?? '';
	const timestamps = [
		...content.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})/g)
	]
		.map((m) => m[0])
		.filter((t) => Number.isFinite(Date.parse(t)));
	const validFrom = timestamps[0] ?? null;
	const validUntil =
		timestamps[1] && validFrom && Date.parse(timestamps[1]) > Date.parse(validFrom)
			? timestamps[1]
			: null;
	return {
		id: `notice:${stableId(sourceUrl + content)}`,
		sourceId: 'public-notice-import',
		sourceUrl,
		title:
			input.title?.trim().slice(0, 180) ||
			(relevant.test(content) ? 'Possible transport disruption' : 'Public notice to inspect'),
		description: supportingText.slice(0, 1200),
		supportingText: supportingText.slice(0, 1200),
		publishedAt:
			input.publishedAt && Number.isFinite(Date.parse(input.publishedAt))
				? input.publishedAt
				: null,
		validFrom,
		validUntil,
		geometry: null,
		locationLabel: location,
		mode: /ferry|boat|sailing|marine/i.test(supportingText)
			? 'marine'
			: /road|magu|street|bridge|traffic/i.test(supportingText)
				? 'road'
				: 'unknown',
		evidenceStatus: 'candidate',
		provenance: 'observed',
		routingEffect: 'candidate-only',
		extractionMethod: 'rules',
		extractionStatus: 'needs-mapping-confirmation',
		geographyStatus: 'unmatched',
		confidence: { extraction: relevant.test(content) ? 'medium' : 'low', geography: 'unmatched' },
		missingFields: [
			!validFrom && 'Effective start',
			!validUntil && 'Expiry / reopening',
			'Directed road or service matching',
			'Mapping and validity confirmation'
		].filter((v): v is string => !!v),
		qualification:
			'Text extraction is a candidate, not confirmation of a current road closure or cancellation. Match the source, dates, affected direction and transport mode before applying a temporary scenario overlay.'
	};
}
