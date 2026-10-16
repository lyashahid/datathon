/** A single frontend origin for every browser harness; BASE_URL remains a legacy alias.
 * @param {Record<string, string | undefined>} [environment]
 */
export function browserBaseURL(environment = process.env) {
	return (environment.MOBILITY_QA_URL || environment.BASE_URL || 'http://127.0.0.1:5173').replace(
		/\/+$/,
		''
	);
}
