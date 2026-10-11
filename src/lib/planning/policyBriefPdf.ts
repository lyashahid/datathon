import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export interface PolicyBriefPdfPayload {
	title: string;
	location: string;
	summary?: string;
	mapImage?: string;
	provenance?: unknown;
	carbonRange?: { low?: number | null; high?: number | null; unit?: string; assumption?: string };
	metrics: readonly {
		label: string;
		before?: number | string | null;
		after?: number | string | null;
		unit?: string;
		detail?: string;
		afterTone?: 'neutral' | 'favorable' | 'unfavorable';
	}[];
	interventions: readonly string[];
	evidence: readonly {
		name: string;
		url?: string;
		date?: string;
		status?: string;
		detail?: string;
	}[];
	assumptions: readonly string[];
	delivery?: { agency: string; phases: readonly string[]; verification: readonly string[] };
	islandImpacts?: readonly { name: string; gained: number; lost: number; unknown: number }[];
	version: string;
	date: string;
}

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 30;
const ink = rgb(0.08, 0.2, 0.24);
const muted = rgb(0.34, 0.43, 0.46);
const teal = rgb(0.03, 0.48, 0.45);
const pale = rgb(0.95, 0.975, 0.965);

/** Standard PDF fonts support Latin text; replace unsupported mathematical/UI glyphs explicitly. */
function printable(value: string): string {
	return value
		.replace(/[\u2010-\u2015]/g, '-')
		.replace(/\u2082/g, '2')
		.replace(/[\u2192\u2794]/g, ' -> ')
		.replace(/\u2264/g, '<=')
		.replace(/\u2265/g, '>=')
		.replace(/\u2026/g, '...')
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201c\u201d]/g, '"')
		.replace(/[^\x20-\x7e\xa0-\xff\n]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function formatted(value: number | string | null | undefined, unit = ''): string {
	if (value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value)))
		return 'Not estimated';
	const text =
		typeof value === 'number'
			? new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)
			: value;
	return `${text}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
}

function lines(
	value: string,
	font: PDFFont,
	size: number,
	width: number,
	maxLines: number
): string[] {
	const words = printable(value).split(' ').filter(Boolean);
	const result: string[] = [];
	let line = '';
	for (const word of words) {
		const candidate = line ? `${line} ${word}` : word;
		if (font.widthOfTextAtSize(candidate, size) <= width) {
			line = candidate;
			continue;
		}
		if (line) result.push(line);
		line = word;
		// Long URLs/identifiers must not run past the column edge.
		while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
			let count = line.length - 1;
			while (count > 1 && font.widthOfTextAtSize(line.slice(0, count), size) > width) count--;
			result.push(line.slice(0, count));
			line = line.slice(count);
		}
	}
	if (line) result.push(line);
	if (result.length > maxLines) {
		result.length = maxLines;
		let last = result[maxLines - 1];
		while (last.length && font.widthOfTextAtSize(`${last}...`, size) > width)
			last = last.slice(0, -1);
		result[maxLines - 1] = `${last.trimEnd()}...`;
	}
	return result;
}

function safeUrl(value?: string): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

/** All unabridged inputs accompany the compact page, including source dates, URLs and unavailable values. */
export function serializePolicyBriefSnapshot(payload: PolicyBriefPdfPayload): string {
	return JSON.stringify({ format: 'mobility-policy-brief', schemaVersion: 1, ...payload }, null, 2);
}

/** A fixed one-page brief, generated locally without network or print-dialog dependencies. */
export async function generatePolicyBriefPdf(payload: PolicyBriefPdfPayload): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.setTitle(printable(payload.title));
	doc.setAuthor('Mobility Sandbox MV');
	doc.setSubject('Policy investment comparison; complete assumptions accompany the JSON snapshot');
	await doc.attach(
		new TextEncoder().encode(serializePolicyBriefSnapshot(payload)),
		'policy-brief-evidence.json',
		{
			mimeType: 'application/json',
			description: 'Complete policy brief, sources, assumptions and delivery notes'
		}
	);
	const page = doc.addPage([PAGE.width, PAGE.height]);
	const regular = await doc.embedFont(StandardFonts.Helvetica);
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);
	const contentWidth = PAGE.width - MARGIN * 2;
	function text(
		value: string,
		x: number,
		y: number,
		width: number,
		size = 8,
		maxLines = 1,
		emphasis = false,
		color = ink
	) {
		const font = emphasis ? bold : regular;
		const wrapped = lines(value, font, size, width, maxLines);
		wrapped.forEach((line, index) =>
			page.drawText(line, { x, y: y - index * (size + 2.5), size, font, color })
		);
		return wrapped.length * (size + 2.5);
	}
	function heading(label: string, x: number, y: number, width: number) {
		text(label.toUpperCase(), x, y, width, 8.2, 1, true, teal);
		page.drawLine({
			start: { x, y: y - 6 },
			end: { x: x + width, y: y - 6 },
			thickness: 0.5,
			color: rgb(0.78, 0.85, 0.84)
		});
	}
	text('MOBILITY SANDBOX MV / POLICY BRIEF', MARGIN, 810, contentWidth, 8, 1, true, teal);
	text(`${payload.location} | ${payload.date}`, MARGIN, 791, contentWidth, 9, 1, false, muted);
	text(payload.title, MARGIN, 768, contentWidth, 20, 2, true);
	text(
		payload.summary ??
			'Review investment benefits, operating limits and outstanding evidence before a funding decision.',
		MARGIN,
		716,
		contentWidth,
		9,
		2,
		false,
		muted
	);

	const mapWidth = 314,
		mapHeight = 153,
		mapBottom = 532;
	page.drawRectangle({ x: MARGIN, y: mapBottom, width: mapWidth, height: mapHeight, color: pale });
	let mapRendered = false;
	if (payload.mapImage && /^data:image\/(png|jpe?g);base64,/i.test(payload.mapImage)) {
		try {
			const base64 = payload.mapImage.slice(payload.mapImage.indexOf(',') + 1);
			const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
			// Captured screenshots can carry an incorrect extension/MIME hint; inspect actual bytes.
			const image =
				bytes[0] === 0xff && bytes[1] === 0xd8
					? await doc.embedJpg(bytes)
					: await doc.embedPng(bytes);
			const scale = Math.min(mapWidth / image.width, mapHeight / image.height);
			page.drawImage(image, {
				x: MARGIN + (mapWidth - image.width * scale) / 2,
				y: mapBottom + (mapHeight - image.height * scale) / 2,
				width: image.width * scale,
				height: image.height * scale
			});
			mapRendered = true;
		} catch {
			/* Keep the brief reviewable when a map capture is unavailable. */
		}
	}
	if (!mapRendered)
		text(
			'Map capture unavailable. Open the saved scenario to inspect the intervention geography.',
			MARGIN + 16,
			mapBottom + 82,
			mapWidth - 32,
			9,
			3,
			false,
			muted
		);
	text(
		'Top-down scenario map; population distribution is modeled.',
		MARGIN,
		mapBottom - 12,
		mapWidth,
		7,
		1,
		false,
		muted
	);
	const rightX = MARGIN + mapWidth + 18,
		rightWidth = contentWidth - mapWidth - 18;
	heading('Proposed change', rightX, 681, rightWidth);
	if (!payload.interventions.length)
		text('No intervention selected.', rightX, 659, rightWidth, 8.5, 2, false, muted);
	else
		payload.interventions
			.slice(0, 4)
			.forEach((value, index) =>
				text(`${index + 1}. ${value}`, rightX, 659 - index * 32, rightWidth, 8.2, 2)
			);
	if (payload.interventions.length > 4)
		text(
			`+ ${payload.interventions.length - 4} changes in the JSON snapshot`,
			rightX,
			526,
			rightWidth,
			7,
			1,
			false,
			muted
		);

	const metricTop = 491;
	heading('Investment and impact', MARGIN, 503, contentWidth);
	text('MEASURE', MARGIN, metricTop, 250, 7, 1, true, muted);
	text('BASELINE', 310, metricTop, 105, 7, 1, true, muted);
	text('PROPOSAL', 434, metricTop, 130, 7, 1, true, teal);
	payload.metrics.slice(0, 6).forEach((metric, index) => {
		const y = 471 - index * 27;
		if (index % 2 === 0)
			page.drawRectangle({
				x: MARGIN,
				y: y - 12,
				width: contentWidth,
				height: 27,
				color: rgb(0.96, 0.974, 0.973)
			});
		text(metric.label, MARGIN + 5, y, 260, 8.2, 1, true);
		text(metric.detail ?? '', MARGIN + 5, y - 10.5, 260, 6.6, 1, false, muted);
		text(formatted(metric.before, metric.unit), 310, y, 112, 8, 2, false, muted);
		const resultColor =
			metric.after == null
				? muted
				: metric.afterTone === 'unfavorable'
					? rgb(0.66, 0.29, 0.1)
					: metric.afterTone === 'favorable'
						? teal
						: ink;
		text(formatted(metric.after, metric.unit), 434, y, 126, 8, 2, true, resultColor);
	});
	if (!payload.metrics.length)
		text(
			'No calculated results. Unavailable values must be reviewed.',
			MARGIN,
			465,
			contentWidth,
			9,
			2,
			false,
			muted
		);
	if (payload.carbonRange) {
		const range = payload.carbonRange;
		text(
			`Net annual carbon sensitivity: ${formatted(range.low, range.unit ?? 't CO2e/year')} to ${formatted(range.high, range.unit ?? 't CO2e/year')}. Positive adds emissions. ${range.assumption ?? ''}`,
			MARGIN,
			316,
			contentWidth,
			7,
			1,
			false,
			muted
		);
	}

	heading('Residents gaining and losing access', MARGIN, 302, contentWidth);
	text('ISLAND', MARGIN, 284, 245, 7, 1, true, muted);
	text('GAIN', 312, 284, 67, 7, 1, true, muted);
	text('LOSS', 393, 284, 67, 7, 1, true, muted);
	text('UNKNOWN', 474, 284, 91, 7, 1, true, muted);
	const impacts = payload.islandImpacts ?? [];
	impacts.slice(0, 4).forEach((impact, index) => {
		const y = 269 - index * 12;
		text(impact.name, MARGIN, y, 265, 7.8);
		text(formatted(Math.round(impact.gained)), 312, y, 67, 7.8);
		text(formatted(Math.round(impact.lost)), 393, y, 67, 7.8);
		text(formatted(Math.round(impact.unknown)), 474, y, 91, 7.8);
	});
	if (!impacts.length)
		text('Island-level distribution not supplied.', MARGIN, 273, contentWidth, 8, 1, false, muted);

	const columnWidth = (contentWidth - 20) / 2,
		columnRight = MARGIN + columnWidth + 20;
	heading('Assumptions and limits', MARGIN, 217, columnWidth);
	text(
		payload.assumptions.slice(0, 5).join(' | ') || 'No additional assumptions supplied.',
		MARGIN,
		201,
		columnWidth,
		7.5,
		6,
		false,
		muted
	);
	heading('Delivery and verification', columnRight, 217, columnWidth);
	const delivery = payload.delivery;
	text(
		delivery
			? `Agency: ${delivery.agency}. Phases: ${delivery.phases.join('; ')}. Verify: ${delivery.verification.join('; ')}.`
			: 'Responsible agency, implementation phases and outstanding verification require review.',
		columnRight,
		201,
		columnWidth,
		7.5,
		6,
		false,
		muted
	);

	heading('Sources used - open links for the underlying evidence', MARGIN, 127, contentWidth);
	const sourceRows = payload.evidence.slice(0, 5);
	sourceRows.forEach((source, index) => {
		const y = 110 - index * 12;
		text(`${index + 1}. ${source.name}`, MARGIN, y, 320, 7, 1, false, teal);
		text(
			[source.date || 'Date unavailable', source.status].filter(Boolean).join(' / '),
			355,
			y,
			210,
			6.6,
			1,
			false,
			muted
		);
		const url = safeUrl(source.url);
		if (url) {
			const annotation = doc.context.register(
				doc.context.obj({
					Type: PDFName.of('Annot'),
					Subtype: PDFName.of('Link'),
					Rect: [MARGIN, y - 2, 350, y + 9],
					Border: [0, 0, 0],
					A: { Type: PDFName.of('Action'), S: PDFName.of('URI'), URI: PDFString.of(url) }
				})
			);
			page.node.addAnnot(annotation);
		}
	});
	if (!sourceRows.length)
		text(
			'No source inventory supplied. Verify the evidence before a funding decision.',
			MARGIN,
			109,
			contentWidth,
			7,
			2,
			false,
			muted
		);
	text(
		`${payload.evidence.length > 5 ? `+ ${payload.evidence.length - 5} sources. ` : ''}Full evidence and assumptions: attached policy-brief-evidence.json; also available from the app.`,
		MARGIN,
		44,
		contentWidth,
		6.8,
		1,
		false,
		muted
	);
	text(`Dataset ${payload.version}`, MARGIN, 29, contentWidth, 6.6, 1, false, muted);
	return doc.save();
}

export async function downloadPolicyBriefPdf(payload: PolicyBriefPdfPayload): Promise<void> {
	const bytes = await generatePolicyBriefPdf(payload);
	const filename = `mobility-policy-brief-${payload.date.replace(/[^0-9-]/g, '') || 'snapshot'}`;
	const download = (blob: Blob, name: string) => {
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = name;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 30_000);
	};
	download(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `${filename}.pdf`);
}
