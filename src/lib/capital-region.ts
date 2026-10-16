/** Shared loading scope; never a combined population or proposal evaluation boundary. */
export const capitalIslandIds = ['island:1442', 'island:1443', 'island:1483'];

export function isCapitalIsland(id: string | null): boolean {
	return id !== null && capitalIslandIds.includes(id);
}
