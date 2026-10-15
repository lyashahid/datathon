/** Start a browser download and keep its object URL alive until the click is consumed. */
function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	try {
		document.body.append(anchor);
		anchor.click();
	} finally {
		anchor.remove();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}
}

export function downloadText(
	contents: string,
	filename: string,
	type = 'text/plain;charset=utf-8'
): void {
	downloadBlob(new Blob([contents], { type }), filename);
}

export function downloadJson(value: unknown, filename: string): void {
	downloadText(JSON.stringify(value, null, 2), filename, 'application/json');
}
