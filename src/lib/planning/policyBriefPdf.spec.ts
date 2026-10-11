import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
	generatePolicyBriefPdf,
	serializePolicyBriefSnapshot,
	type PolicyBriefPdfPayload
} from './policyBriefPdf.ts';

const payload: PolicyBriefPdfPayload = {
	title: 'Connect residents to suitable healthcare',
	location: 'Greater Malé',
	summary: 'Conditional proposal with gains, losses and illustrative costs.',
	metrics: [
		{ label: 'Additional people benefiting', before: 0, after: 120 },
		{
			label: 'Annual net carbon change',
			before: null,
			after: null,
			unit: 't CO₂e/year',
			detail: 'Energy factor unavailable; do not treat as zero.'
		}
	],
	interventions: ['Add a connecting bus service.'],
	evidence: [
		{
			name: 'Official timetable',
			url: 'https://www.rtl.mv/',
			date: '2026-10-10',
			status: 'Partial snapshot'
		}
	],
	assumptions: ['30-minute access target', 'Costs are illustrative'],
	delivery: {
		agency: 'Operator and responsible ministry - confirm',
		phases: ['Validate service', 'Pilot', 'Evaluate'],
		verification: ['Timetable completeness', 'Local unit costs']
	},
	islandImpacts: [{ name: 'Malé', gained: 120, lost: 5, unknown: 45 }],
	version: 'dataset-test',
	date: '2026-10-11'
};

describe('offline policy brief PDF', () => {
	it('creates one A4 page with a clickable official source and complete evidence attachment', async () => {
		const bytes = await generatePolicyBriefPdf(payload);
		const doc = await PDFDocument.load(bytes);
		expect(doc.getPageCount()).toBe(1);
		expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 2);
		expect(doc.getPage(0).getHeight()).toBeCloseTo(841.89, 2);
		expect(doc.getTitle()).toBe(payload.title);
		const annotation = doc.getPage(0).node.Annots()?.lookup(0);
		expect(annotation?.toString()).toContain('/URI');
		expect(doc.catalog.get(PDFName.of('Names'))).toBeDefined();
	});
	it('retains full unavailable values and every source in the JSON snapshot despite page limits', () => {
		const sources = Array.from({ length: 20 }, (_, i) => ({
			name: `Source ${i}`,
			url: `https://example.org/${i}`,
			detail: 'Complete methodological qualification'
		}));
		const snapshot = JSON.parse(serializePolicyBriefSnapshot({ ...payload, evidence: sources }));
		expect(snapshot.evidence).toEqual(sources);
		expect(snapshot.metrics[1].after).toBeNull();
		expect(snapshot.delivery).toEqual(payload.delivery);
		const enriched = JSON.parse(
			serializePolicyBriefSnapshot({
				...payload,
				provenance: { modelVersion: 'service-aware-test' },
				carbonRange: { low: -10, high: 35, unit: 't CO2e/year' }
			})
		);
		expect(enriched.provenance.modelVersion).toBe('service-aware-test');
		expect(enriched.carbonRange).toMatchObject({ low: -10, high: 35 });
		expect(snapshot.schemaVersion).toBe(1);
	});
	it('keeps long text, unsupported glyphs and malformed map captures on a single reviewable page', async () => {
		const doc = await PDFDocument.load(
			await generatePolicyBriefPdf({
				...payload,
				title: 'Malé → Hulhumalé: CO₂ change ≥ 0',
				mapImage: 'data:image/png;base64,invalid',
				assumptions: Array(30).fill('Very long planning assumptions '.repeat(30)),
				evidence: Array(30).fill({ name: 'Official source '.repeat(30), date: '2026-10-10' })
			})
		);
		expect(doc.getPageCount()).toBe(1);
		expect(doc.getTitle()).toContain('CO2 change >= 0');
	});
	it('does not create active links for unsafe URL protocols', async () => {
		const doc = await PDFDocument.load(
			await generatePolicyBriefPdf({
				...payload,
				evidence: [{ name: 'Invalid link', url: 'javascript:alert(1)' }]
			})
		);
		expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
	});
});
