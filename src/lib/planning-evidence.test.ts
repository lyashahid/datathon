import { describe, expect, it } from 'vitest';
import { planningEvidence } from './planning-evidence.js';

describe('planning evidence capabilities', () => {
	it('separates national walking support from unavailable timetables', () => {
		const evidence = planningEvidence(
			{
				spatial_method: 'assumed_uniform_land',
				spatial_quality: 'coarse_assumption',
				population_source: 'Official island projections',
				population_year: 2026
			},
			{
				resident_origins: 120,
				walking_edges: 80,
				scheduled_patterns: 0,
				timetable_status: 'unavailable'
			}
		);
		expect(evidence.approximate).toBe(true);
		expect(evidence.population).toContain('Official island projections (2026)');
		expect(evidence.distribution).toContain('potentially uninhabited land');
		expect(evidence.timetable).toContain('does not establish whether transport services operate');
	});

	it('keeps screened raster weights modeled and accepts legacy/camel case metadata', () => {
		const evidence = planningEvidence({
			spatialMethod: 'worldpop_calibrated',
			spatialQuality: 'modeled',
			populationSource: 'Island projections',
			populationYear: 2030
		});
		expect(evidence.approximate).toBe(false);
		expect(evidence.distribution).toContain('not observed neighbourhood counts');
		expect(evidence.population).toContain('2030');
		expect(planningEvidence('Source-backed allocation').qualification).toBe(
			'Source-backed allocation'
		);
	});

	it('uses explicit timetable status, never the existence of stops or route patterns', () => {
		expect(
			planningEvidence(null, { transport_stops: 70, scheduled_patterns: 3 }).timetable
		).toContain('require dated service evidence');
		expect(
			planningEvidence(null, { scheduled_patterns: 3, timetable_status: 'unavailable' }).timetable
		).toContain('No dated timetable');
		expect(planningEvidence(null, { timetable_status: 'available' }).timetable).toContain(
			'valid for the selected date'
		);
	});

	it('preserves qualification and deduplicates population and coverage warnings', () => {
		const evidence = planningEvidence(
			{
				qualification: 'Do not interpret as settlement counts.',
				warnings: ['Partial roads', 'Do not interpret as settlement counts.']
			},
			{ spatial_quality: 'coarse_assumption', warnings: ['Partial roads', 'Unverified entrances'] }
		);
		expect(evidence.approximate).toBe(true);
		expect(evidence.qualification).toBe('Do not interpret as settlement counts.');
		expect(evidence.warnings).toEqual(['Partial roads', 'Unverified entrances']);
	});

	it('uses the selected tile allocation when a map combines islands with different evidence', () => {
		const evidence = planningEvidence(
			{ spatial_method: 'worldpop_calibrated', spatial_quality: 'modeled' },
			null,
			{ spatial_method: 'mixed', spatial_quality: 'coarse_assumption' }
		);
		expect(evidence.approximate).toBe(true);
		expect(evidence.distribution).toContain('Approximate modeled resident distribution');
	});

	it('discloses coarse assumptions for an unscoped national evaluation', () => {
		const evidence = planningEvidence({
			spatial_method: 'mixed_island_allocations',
			spatial_quality: 'mixed_including_coarse_assumption'
		});
		expect(evidence.approximate).toBe(true);
		expect(evidence.distribution).toContain('some islands use approximate spatial assumptions');
	});
});
