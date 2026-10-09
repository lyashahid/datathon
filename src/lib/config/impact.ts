/** Before-versus-after comparison settings. */
export const IMPACT_CONFIG = {
	/**
	 * Overall-score points (0–100 scale) a cell must gain or lose to count as improved or
	 * worsened. Smaller moves are treated as effectively unchanged, so rounding noise is never
	 * reported as benefit or harm.
	 */
	changeThresholdPoints: 2,
	/** Residents within this distance of a facility count towards its local impact. */
	localImpactRadiusM: 800
} as const;

/** Colours for the scenario-change overlay; the neutral band spans ± the threshold. */
export const IMPACT_COLORS = {
	strongLoss: '#d73027',
	loss: '#f46d43',
	neutral: '#6b7280',
	gain: '#66bd63',
	strongGain: '#1a9850'
} as const;
