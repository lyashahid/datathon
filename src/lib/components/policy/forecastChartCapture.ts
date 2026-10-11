/** Date shown in a brief follows the Maldives local calendar, without a clock or ISO suffix. */
export function maldivesDateOnly(value: string): string {
	const parsed = new Date(value);
	if (!Number.isFinite(parsed.getTime()))
		throw new Error('The forecast generation date is invalid.');
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Indian/Maldives',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(parsed);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((item) => item.type === type)!.value;
	return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Render only the selected inline chart. All marks, colors, and text are embedded locally. */
export async function captureForecastSvg(svg: SVGSVGElement): Promise<string> {
	const clone = svg.cloneNode(true) as SVGSVGElement;
	if (clone.querySelector('image, script, foreignObject, use'))
		throw new Error('The chart contains unsupported external content.');
	const width = svg.viewBox.baseVal.width || 680;
	const height = svg.viewBox.baseVal.height || 250;
	clone.setAttribute('width', String(width));
	clone.setAttribute('height', String(height + 25));
	clone.setAttribute('viewBox', `0 0 ${width} ${height + 25}`);
	for (const node of clone.querySelectorAll('text')) {
		node.setAttribute('font-family', 'Arial, sans-serif');
		node.setAttribute('font-size', '11');
		node.setAttribute('fill', '#54736b');
	}
	const ns = 'http://www.w3.org/2000/svg';
	const legend = (x: number, label: string, color: string, dashed: boolean) => {
		const line = document.createElementNS(ns, 'line');
		for (const [key, value] of Object.entries({
			x1: x,
			y1: height + 8,
			x2: x + 24,
			y2: height + 8,
			stroke: color,
			'stroke-width': 3,
			...(dashed ? { 'stroke-dasharray': '5 4' } : {})
		}))
			line.setAttribute(key, String(value));
		const text = document.createElementNS(ns, 'text');
		for (const [key, value] of Object.entries({
			x: x + 31,
			y: height + 12,
			'font-family': 'Arial, sans-serif',
			'font-size': 11,
			fill: '#54736b'
		}))
			text.setAttribute(key, String(value));
		text.textContent = label;
		clone.append(line, text);
	};
	legend(58, 'Recorded totals', '#486d66', false);
	legend(238, 'Forecast', '#087b70', true);
	legend(378, 'Historical error range', '#a3cdbd', false);
	const url = URL.createObjectURL(
		new Blob([new XMLSerializer().serializeToString(clone)], {
			type: 'image/svg+xml;charset=utf-8'
		})
	);
	try {
		const image = new Image();
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('The forecast chart could not be rendered.'));
			image.src = url;
		});
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(width * 2);
		canvas.height = Math.round((height + 25) * 2);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Chart export is unavailable in this browser.');
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/png');
	} finally {
		URL.revokeObjectURL(url);
	}
}
