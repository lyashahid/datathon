/** North-facing miniature vehicles; only received GPS positions and headings move them. */
function vehicleSymbol(kind: 'bus' | 'vessel'): ImageData | null {
	const canvas = document.createElement('canvas');
	canvas.width = 96;
	canvas.height = 112;
	const context = canvas.getContext('2d');
	if (!context) return null;
	context.scale(2, 2);
	context.lineJoin = 'round';
	context.lineCap = 'round';
	context.shadowColor = '#193b4650';
	context.shadowBlur = 3;
	context.shadowOffsetY = 1.5;
	if (kind === 'bus') {
		// A long road vehicle with side windows, wheels and a front windshield.
		// The neutral livery is illustrative, not a claim about the operator's fleet.
		context.fillStyle = '#263b40';
		for (const x of [14, 31]) {
			for (const y of [15, 37]) {
				context.beginPath();
				context.roundRect(x, y, 3, 7, 1);
				context.fill();
			}
		}
		context.fillStyle = '#d79c46';
		context.strokeStyle = '#fffefa';
		context.lineWidth = 1.2;
		context.beginPath();
		context.roundRect(16, 6, 16, 44, [4, 4, 2, 2]);
		context.fill();
		context.stroke();
		context.shadowColor = 'transparent';
		context.fillStyle = '#28444f';
		context.beginPath();
		context.roundRect(18, 9, 12, 6, [2, 2, 1, 1]);
		context.fill();
		context.fillStyle = '#88b9c7';
		context.fillRect(19, 10, 10, 1);
		context.fillStyle = '#395b67';
		context.fillRect(16.5, 17, 2, 24);
		context.fillRect(29.5, 17, 2, 24);
		context.fillStyle = '#f6edd5';
		context.beginPath();
		context.roundRect(19, 17, 10, 25, 1.5);
		context.fill();
		context.strokeStyle = '#c2bda8';
		context.lineWidth = 0.5;
		for (const y of [23, 35]) {
			context.beginPath();
			context.roundRect(21, y, 6, 3, 0.7);
			context.stroke();
			context.beginPath();
			context.moveTo(22, y + 1.5);
			context.lineTo(26, y + 1.5);
			context.stroke();
		}
		context.strokeStyle = '#d79c46';
		context.lineWidth = 0.8;
		for (const y of [21, 26, 31, 36]) {
			context.beginPath();
			context.moveTo(16.5, y);
			context.lineTo(18.5, y);
			context.moveTo(29.5, y);
			context.lineTo(31.5, y);
			context.stroke();
		}
		context.fillStyle = '#28444f';
		context.fillRect(19, 44, 10, 2);
		context.fillStyle = '#fff9db';
		context.fillRect(18, 6.5, 2, 1.5);
		context.fillRect(28, 6.5, 2, 1.5);
		context.fillStyle = '#b9503a';
		context.fillRect(17, 47.5, 2, 1.5);
		context.fillRect(29, 47.5, 2, 1.5);
		context.strokeStyle = '#28444f';
		context.lineWidth = 1;
		context.beginPath();
		context.moveTo(16, 12);
		context.lineTo(13, 12);
		context.moveTo(32, 12);
		context.lineTo(35, 12);
		context.stroke();
	} else {
		const hull = new Path2D('M24 4C16 10 12 20 13 33L17 50H31L35 33C36 20 32 10 24 4Z');
		context.fillStyle = '#378aa6';
		context.strokeStyle = '#fffefa';
		context.lineWidth = 1.2;
		context.fill(hull);
		context.stroke(hull);
		context.shadowColor = 'transparent';
		context.fillStyle = '#f3efe0';
		context.fill(new Path2D('M24 11C19 17 16 24 17 33L20 45H28L31 33C32 24 29 17 24 11Z'));
		context.fillStyle = '#2d5364';
		context.beginPath();
		context.roundRect(19, 23, 10, 14, 2);
		context.fill();
		context.fillStyle = '#a9ccd2';
		context.fillRect(20, 24, 8, 3);
		context.fillStyle = '#fffefa';
		context.fillRect(21, 28, 6, 7);
		context.strokeStyle = '#bcbda9';
		context.lineWidth = 0.7;
		context.beginPath();
		context.moveTo(24, 14);
		context.lineTo(24, 20);
		context.moveTo(20, 41);
		context.lineTo(28, 41);
		context.stroke();
	}
	return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Locally drawn map symbols; the records and positions always come from the backend. */
export function atlasSymbols(): Record<string, ImageData> {
	const colors: Record<string, string> = {
		health: '#087f7c',
		school: '#ad7b3a',
		airport: '#507a9b',
		bus: '#557a91',
		'bus-stop': '#557a91',
		marine: '#3c8c9a',
		ferry: '#3c8c9a',
		port: '#3c8c9a',
		civic: '#87789c',
		transport: '#607d8a',
		aircraft: '#8772a4',
		vessel: '#378aa6',
		'live-bus': '#b98942',
		origin: '#337f7a',
		destination: '#d56954',
		removed: '#c1493f'
	};
	const paths: Record<string, string> = {
		// A hospital building reads as a place, rather than an unexplained plus action.
		health:
			'M4 21V7h4V3h8v4h4v14M2 21h20M9 7v6M15 7v6M9 10h6M10 21v-5h4v5M5 10h.1M5 14h.1M19 10h.1M19 14h.1',
		school: 'M2 8l10-5 10 5-10 5-10-5ZM6 10v7c4 3 8 3 12 0v-7M22 8v8',
		airport: 'M12 3v18M3 13l9-5 9 5M8 21l4-3 4 3',
		aircraft: 'M12 3v18M3 13l9-5 9 5M8 21l4-3 4 3',
		bus: 'M5 5h14v14H5V5ZM5 12h14M8 8h8M8 16h.1M16 16h.1M7 19v2M17 19v2',
		'bus-stop': 'M5 3h14v15H5V3ZM5 12h14M8 6h8M8 15h.1M16 15h.1M8 18v3M16 18v3',
		marine: 'M12 7v14M7 12H3c0 5 4 9 9 9s9-4 9-9h-4M8 11h8',
		ferry: 'M3 11h18l-3 7H6l-3-7ZM6 11V5h12v6M10 5v6M14 5v6M2 21c3-3 5 3 8 0s5 3 8 0 3 0 4 0',
		port: 'M12 7v14M7 12H3c0 5 4 9 9 9s9-4 9-9h-4M8 11h8',
		// Moving glyphs face north so provider bearings rotate them correctly.
		civic: 'M3 8l9-5 9 5H3ZM5 10v8M10 10v8M14 10v8M19 10v8M3 21h18',
		transport: 'M12 3c-4 0-7 3-7 7 0 5 7 11 7 11s7-6 7-11c0-4-3-7-7-7Z',
		origin: 'M5 20L12 4l7 16M8 14h8',
		destination: 'M6 4v16h7c7 0 7-8 0-8H6m7 0c7 0 7-8 0-8H6',
		removed: 'M5 5l14 14M19 5L5 19'
	};
	return Object.fromEntries(
		Object.entries(colors).flatMap(([name, color]) => {
			if (name === 'live-bus' || name === 'vessel') {
				const vehicle = vehicleSymbol(name === 'live-bus' ? 'bus' : 'vessel');
				return vehicle ? [[`atlas-${name}`, vehicle]] : [];
			}
			const canvas = document.createElement('canvas');
			canvas.width = 80;
			canvas.height = 80;
			const context = canvas.getContext('2d');
			if (!context) return [];
			context.scale(2, 2);
			context.shadowColor = '#173c4925';
			context.shadowBlur = 5;
			context.shadowOffsetY = 2;
			context.fillStyle = '#fffefa';
			const moving = name === 'aircraft';
			if (!moving) {
				context.beginPath();
				context.arc(20, 19, 16, 0, Math.PI * 2);
				context.fill();
			}
			context.shadowColor = 'transparent';
			context.strokeStyle = `${color}45`;
			context.lineWidth = 0.8;
			if (!moving) context.stroke();
			context.translate(8, 7);
			if (moving) {
				context.strokeStyle = '#fffefa';
				context.lineWidth = 4.5;
				context.lineJoin = 'round';
				context.lineCap = 'round';
				context.stroke(new Path2D(paths[name]));
			}
			context.strokeStyle = color;
			context.lineWidth = moving ? 2.3 : 1.7;
			context.lineJoin = 'round';
			context.lineCap = 'round';
			context.stroke(new Path2D(paths[name]));
			if (name === 'marine' || name === 'port' || name === 'transport') {
				context.beginPath();
				context.arc(12, name === 'marine' ? 4 : 10, 2, 0, Math.PI * 2);
				context.stroke();
			}
			return [[`atlas-${name}`, context.getImageData(0, 0, 80, 80)]];
		})
	);
}

/** Counts are infrastructure clusters, never vehicles or a population estimate. */
export function atlasClusterSymbol(count: number): ImageData | null {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 80;
	const context = canvas.getContext('2d');
	if (!context) return null;
	context.scale(2, 2);
	context.fillStyle = '#fffefa';
	context.strokeStyle = '#6b9894';
	context.lineWidth = 1.5;
	context.beginPath();
	context.arc(20, 20, 15.5, 0, Math.PI * 2);
	context.fill();
	context.stroke();
	context.fillStyle = '#366c68';
	context.font = '600 13px Inter, sans-serif';
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	context.fillText(count > 999 ? '999+' : String(count), 20, 20.5);
	return context.getImageData(0, 0, 80, 80);
}

/** A ship and count separate observed vessel groups from stationary place clusters. */
export function atlasVesselClusterSymbol(count: number): ImageData | null {
	const canvas = document.createElement('canvas');
	canvas.width = 128;
	canvas.height = 72;
	const context = canvas.getContext('2d');
	if (!context) return null;
	context.scale(2, 2);
	context.fillStyle = '#edf9fa';
	context.strokeStyle = '#378aa6';
	context.lineWidth = 1.2;
	context.beginPath();
	context.roundRect(2, 3, 60, 30, 12);
	context.fill();
	context.stroke();
	context.save();
	context.translate(7, 6);
	context.scale(0.9, 0.9);
	context.lineWidth = 1.7;
	context.lineJoin = 'round';
	context.lineCap = 'round';
	context.stroke(
		new Path2D('M3 11h18l-3 7H6l-3-7ZM6 11V5h12v6M10 5v6M14 5v6M2 21c3-3 5 3 8 0s5 3 8 0')
	);
	context.restore();
	context.fillStyle = '#28657c';
	context.font = '700 12px Inter, sans-serif';
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	context.fillText(count > 999 ? '999+' : String(count), 44, 18.5);
	return context.getImageData(0, 0, 128, 72);
}
