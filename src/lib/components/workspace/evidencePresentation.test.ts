import { describe, expect, it } from 'vitest';
import {
	collectEvidenceSources,
	evidenceDate,
	evidenceSourceMetadata,
	forecastEvidenceSources,
	sourceMatches
} from './evidencePresentation.ts';

describe('evidence presentation', () => {
	it('keeps different file vintages separate and combines repeated citations', () => {
		const source = {
			id: 'population',
			title: 'Population projection',
			url: 'https://example.test/population',
			sha256: 'first',
			referencePeriod: '2026'
		};
		const rows = collectEvidenceSources([
			{ name: 'Planning', sources: [source] },
			{
				name: 'Forecasts',
				sources: [
					{ ...source, publisher: 'Statistics bureau' },
					{ ...source, sha256: 'revised' }
				]
			}
		]);
		expect(rows).toHaveLength(2);
		expect(rows[0].groups).toEqual(['Planning', 'Forecasts']);
		expect(rows[0].referencePeriod).toBe('2026');
		expect(rows[0].publisher).toBe('Statistics bureau');
		expect(source).not.toHaveProperty('groups');
	});

	it('uses Maldives dates and never invents a missing date', () => {
		expect(evidenceDate(null)).toBe('Not supplied');
		expect(evidenceDate('2022')).toBe('2022');
		expect(evidenceDate('2026-06')).toBe('June 2026');
		expect(evidenceDate('2026-10-10')).toBe('10 Oct 2026');
		expect(evidenceDate('2026-10-10T22:00:00Z')).toBe('11 Oct 2026');
		expect(evidenceDate('Period not specified')).toBe('Period not specified');
	});

	it('searches actual source fields, requiring all query terms', () => {
		const [row] = collectEvidenceSources([
			{
				name: 'Planning',
				sources: [
					{ id: 'census', title: 'Official population', publisher: 'MBS', referencePeriod: '2022' }
				]
			}
		]);
		expect(sourceMatches(row, 'mbs 2022')).toBe(true);
		expect(sourceMatches(row, 'live traffic')).toBe(false);
		expect(sourceMatches(row, '')).toBe(true);
	});

	it('attributes recognized source hosts while keeping genuinely missing metadata explicit', () => {
		const source = {
			id: 'worldpop2026',
			url: 'https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2026/MDV/v1/100m/constrained/mdv_pop_2026.tif',
			referenceYear: 2026,
			sha256: 'original'
		};
		const presented = evidenceSourceMetadata(source);
		expect(presented.publisher).toBe('WorldPop');
		expect(presented.coverage).toContain('100 m constrained population raster');
		expect(presented.coverage).toContain('source file path');
		expect(presented.sha256).toBe('original');
		expect(presented).not.toHaveProperty('fetchedAt');
		expect(presented).not.toHaveProperty('license');
		expect(source).not.toHaveProperty('publisher');
		expect(
			evidenceSourceMetadata({
				id: 'unknown',
				url: 'https://example.test/MDV/100m/constrained/test.tif'
			})
		).not.toHaveProperty('publisher');
		expect(
			evidenceSourceMetadata({
				...source,
				publisher: 'Supplied publisher',
				coverage: 'Supplied scope'
			})
		).toMatchObject({ publisher: 'Supplied publisher', coverage: 'Supplied scope' });
	});

	it('separates workbook issue, anomalous worksheet, publication date and missing retrieval time', () => {
		const latestUrl =
			'https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2026/09/MIF_June-2026.xlsx';
		const rows = forecastEvidenceSources({
			monthly: [{ sourceUrl: latestUrl }],
			provenance: {
				modelVersion: 'model',
				transformVersion: 'transform',
				checkedAt: '2026-10-11T12:00:00Z',
				latestPublicationDate: '2026-09-07',
				revisionQualification: 'Revised history',
				sources: [
					{
						id: 'dec_2023_issue',
						url: 'https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2024/02/MIF-Dec-2023.xlsx',
						sha256: 'older-hash',
						publicationSheet: 'Nov 2022'
					},
					{
						id: 'latest_june_2026',
						url: latestUrl,
						sha256: 'latest-hash',
						publicationSheet: 'June 2026'
					}
				]
			}
		});
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			id: 'dec_2023_issue',
			title: 'Monthly statistics — December 2023 workbook',
			publisher: 'Maldives Bureau of Statistics',
			referencePeriod: 'December 2023 workbook issue',
			publicationSheet: 'Nov 2022',
			status: 'receipt-recorded',
			sha256: 'older-hash'
		});
		expect(rows[0]).not.toHaveProperty('publicationDate');
		expect(rows[0]).not.toHaveProperty('fetchedAt');
		expect(rows[1]).toMatchObject({
			publicationDate: '2026-09-07',
			lastValidatedAt: '2026-10-11T12:00:00Z',
			transformationVersion: 'transform'
		});
		expect(rows[1]).not.toHaveProperty('retrievedAt');
		expect(rows[1]).not.toHaveProperty('license');
		expect(forecastEvidenceSources(null)).toEqual([]);
	});
});
