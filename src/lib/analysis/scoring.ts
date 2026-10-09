import { SCORE_CATEGORIES, SCORE_WEIGHTS } from '#lib/config/analysis.ts';
import type {
	ScoreBreakdown,
	ScoreCategory,
	ScoreComponent,
	ScoreComponentId,
	ScoreInput,
	ScorePenalty
} from '#lib/types/analysis.ts';

export interface ComponentInput {
	id: ScoreComponentId;
	label: string;
	score: number;
	explanation: string;
	inputs: readonly ScoreInput[];
}

export function clampScore(value: number): number {
	return Math.min(100, Math.max(0, value));
}

export function scoreCategory(score: number): ScoreCategory {
	const match = SCORE_CATEGORIES.find((c) => score >= c.min);
	return (match ?? SCORE_CATEGORIES[SCORE_CATEGORIES.length - 1]).category;
}

/**
 * The single place a total score is formed: weighted component sum plus penalties,
 * clamped to 0–100 and rounded. Real and demo analyses both go through here, so the
 * displayed breakdown always reproduces the displayed total.
 */
export function composeScore(
	components: readonly ComponentInput[],
	penalties: readonly ScorePenalty[]
): ScoreBreakdown {
	const weighted: ScoreComponent[] = components.map((c) => {
		const score = clampScore(c.score);
		const weight = SCORE_WEIGHTS[c.id];
		return { ...c, score, weight, contribution: score * weight };
	});
	const rawTotal =
		weighted.reduce((sum, c) => sum + c.contribution, 0) +
		penalties.reduce((sum, p) => sum + p.points, 0);
	const score = Math.round(clampScore(rawTotal));
	return { score, category: scoreCategory(score), components: weighted, penalties, rawTotal };
}
