import { themeColors } from '#lib/theme.js';
/** North-facing miniature vehicles; route illustrations use a separate neutral symbol. */
function vehicleSymbol(
	kind: 'bus' | 'vessel' | 'aircraft',
	illustrative = false
): ImageData | null {
	const canvas = document.createElement('canvas');
	canvas.width = 96;
	canvas.height = 112;
	const context = canvas.getContext('2d');
	if (!context) return null;
	context.scale(2, 2);
	context.lineJoin = 'round';
	context.lineCap = 'round';
	context.shadowColor = themeColors.color193b4650;
	context.shadowBlur = 3;
	context.shadowOffsetY = 1.5;
	if (kind === 'bus') {
		// A long road vehicle with side windows, wheels and a front windshield.
		// The neutral livery is illustrative, not a claim about the operator's fleet.
		context.fillStyle = themeColors.color263b40;
		for (const x of [14, 31]) {
			for (const y of [15, 37]) {
				context.beginPath();
				context.roundRect(x, y, 3, 7, 1);
				context.fill();
			}
		}
		context.fillStyle = themeColors.colord79c46;
		context.strokeStyle = themeColors.colorfffefa;
		context.lineWidth = 1.2;
		context.beginPath();
		context.roundRect(16, 6, 16, 44, [4, 4, 2, 2]);
		context.fill();
		context.stroke();
		context.shadowColor = 'transparent';
		context.fillStyle = themeColors.color28444f;
		context.beginPath();
		context.roundRect(18, 9, 12, 6, [2, 2, 1, 1]);
		context.fill();
		context.fillStyle = themeColors.color88b9c7;
		context.fillRect(19, 10, 10, 1);
		context.fillStyle = themeColors.color395b67;
		context.fillRect(16.5, 17, 2, 24);
		context.fillRect(29.5, 17, 2, 24);
		context.fillStyle = themeColors.colorf6edd5;
		context.beginPath();
		context.roundRect(19, 17, 10, 25, 1.5);
		context.fill();
		context.strokeStyle = themeColors.colorc2bda8;
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
		context.strokeStyle = themeColors.colord79c46;
		context.lineWidth = 0.8;
		for (const y of [21, 26, 31, 36]) {
			context.beginPath();
			context.moveTo(16.5, y);
			context.lineTo(18.5, y);
			context.moveTo(29.5, y);
			context.lineTo(31.5, y);
			context.stroke();
		}
		context.fillStyle = themeColors.color28444f;
		context.fillRect(19, 44, 10, 2);
		context.fillStyle = themeColors.colorfff9db;
		context.fillRect(18, 6.5, 2, 1.5);
		context.fillRect(28, 6.5, 2, 1.5);
		context.fillStyle = themeColors.colorb9503a;
		context.fillRect(17, 47.5, 2, 1.5);
		context.fillRect(29, 47.5, 2, 1.5);
		context.strokeStyle = themeColors.color28444f;
		context.lineWidth = 1;
		context.beginPath();
		context.moveTo(16, 12);
		context.lineTo(13, 12);
		context.moveTo(32, 12);
		context.lineTo(35, 12);
		context.stroke();
	} else if (kind === 'aircraft') {
		// A small regional aircraft, with the same painted miniature treatment as the boat.
		// Neutral details do not imply a particular airline or assigned aircraft model.
		const livery = illustrative ? themeColors.color607d8a : themeColors.color378aa6;
		const silhouette = new Path2D(
			'M24 4C21.5 5 21 8 21 13V20L4 28V32L21 28L21.5 41L14 46V49L23 46L24 51L25 46L34 49V46L26.5 41L27 28L44 32V28L27 20V13C27 8 26.5 5 24 4Z'
		);
		context.fillStyle = themeColors.colorf3efe0;
		context.strokeStyle = themeColors.colorfffefa;
		context.lineWidth = 1.4;
		context.fill(silhouette);
		context.stroke(silhouette);
		context.shadowColor = 'transparent';
		context.fillStyle = livery;
		context.fill(new Path2D('M4 29L21 23V26L4 32ZM27 23L44 29V32L27 26Z'));
		context.fill(new Path2D('M14 46L22 42V45L14 49ZM26 42L34 46V49L26 45Z'));
		// Engine nacelles and propellers remain legible at normal map zoom.
		for (const x of [12, 31]) {
			context.fillStyle = livery;
			context.beginPath();
			context.roundRect(x, 19, 5, 13, [2.5, 2.5, 1, 1]);
			context.fill();
			context.strokeStyle = themeColors.color28444f;
			context.lineWidth = 1.1;
			context.beginPath();
			context.moveTo(x - 1.5, 19);
			context.lineTo(x + 6.5, 19);
			context.stroke();
			context.fillStyle = themeColors.colora9ccd2;
			context.fillRect(x + 1, 23, 3, 5);
		}
		context.fillStyle = themeColors.colorfffefa;
		context.fill(new Path2D('M24 5C22 7 22 10 22 14L22.5 40L24 47L25.5 40L26 14C26 10 26 7 24 5Z'));
		context.fillStyle = themeColors.color28444f;
		context.fill(new Path2D('M22 11Q24 8.5 26 11L25.5 14H22.5Z'));
		context.fillStyle = themeColors.colora9ccd2;
		context.fillRect(23, 11, 2, 1);
		context.fillStyle = livery;
		for (const y of [18, 23, 28, 33]) {
			context.fillRect(21.7, y, 0.9, 1.8);
			context.fillRect(25.4, y, 0.9, 1.8);
		}
		context.fill(new Path2D('M24 37L25.5 43L24 50L22.5 43Z'));
	} else {
		const hull = new Path2D('M24 4C16 10 12 20 13 33L17 50H31L35 33C36 20 32 10 24 4Z');
		context.fillStyle = illustrative ? themeColors.color607d8a : themeColors.color378aa6;
		context.strokeStyle = themeColors.colorfffefa;
		context.lineWidth = 1.2;
		context.fill(hull);
		context.stroke(hull);
		context.shadowColor = 'transparent';
		context.fillStyle = themeColors.colorf3efe0;
		context.fill(new Path2D('M24 11C19 17 16 24 17 33L20 45H28L31 33C32 24 29 17 24 11Z'));
		context.fillStyle = illustrative ? themeColors.color36585f : themeColors.color2d5364;
		context.beginPath();
		context.roundRect(19, 23, 10, 14, 2);
		context.fill();
		context.fillStyle = themeColors.colora9ccd2;
		context.fillRect(20, 24, 8, 3);
		context.fillStyle = themeColors.colorfffefa;
		context.fillRect(21, 28, 6, 7);
		context.strokeStyle = themeColors.colorbcbda9;
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
		health: themeColors.color087f7c,
		school: themeColors.colorad7b3a,
		airport: themeColors.color507a9b,
		'air-terminal': themeColors.color507a9b,
		bus: themeColors.color557a91,
		'bus-stop': themeColors.color557a91,
		marine: themeColors.color3c8c9a,
		ferry: themeColors.color3c8c9a,
		port: themeColors.color3c8c9a,
		civic: themeColors.color87789c,
		transport: themeColors.color607d8a,
		aircraft: themeColors.color378aa6,
		'route-aircraft': themeColors.color607d8a,
		vessel: themeColors.color378aa6,
		'route-vessel': themeColors.color607d8a,
		'live-bus': themeColors.colorb98942,
		origin: themeColors.color337f7a,
		destination: themeColors.colord56954,
		removed: themeColors.colorc1493f
	};
	const paths: Record<string, string> = {
		// A hospital building reads as a place, rather than an unexplained plus action.
		health:
			'M4 21V7h4V3h8v4h4v14M2 21h20M9 7v6M15 7v6M9 10h6M10 21v-5h4v5M5 10h.1M5 14h.1M19 10h.1M19 14h.1',
		school: 'M2 8l10-5 10 5-10 5-10-5ZM6 10v7c4 3 8 3 12 0v-7M22 8v8',
		airport: 'M12 3v18M3 13l9-5 9 5M8 21l4-3 4 3',
		'air-terminal':
			'M3 21V9h18v12M1 21h22M2 9l2-5h16l2 5H2ZM7 9v8M12 9v8M17 9v8M3 14h18M9 21v-4h6v4',
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
			if (['live-bus', 'vessel', 'route-vessel', 'aircraft', 'route-aircraft'].includes(name)) {
				const vehicle = vehicleSymbol(
					name === 'live-bus' ? 'bus' : name.includes('aircraft') ? 'aircraft' : 'vessel',
					name.startsWith('route-')
				);
				return vehicle ? [[`atlas-${name}`, vehicle]] : [];
			}
			const canvas = document.createElement('canvas');
			canvas.width = 80;
			canvas.height = 80;
			const context = canvas.getContext('2d');
			if (!context) return [];
			context.scale(2, 2);
			context.shadowColor = themeColors.color173c4925;
			context.shadowBlur = 5;
			context.shadowOffsetY = 2;
			context.fillStyle = themeColors.colorfffefa;
			context.beginPath();
			context.arc(20, 19, 16, 0, Math.PI * 2);
			context.fill();
			context.shadowColor = 'transparent';
			context.strokeStyle = `${color}45`;
			context.lineWidth = 0.8;
			context.stroke();
			context.translate(8, 7);
			context.strokeStyle = color;
			context.lineWidth = 1.7;
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
	context.fillStyle = themeColors.colorfffefa;
	context.strokeStyle = themeColors.color6b9894;
	context.lineWidth = 1.5;
	context.beginPath();
	context.arc(20, 20, 15.5, 0, Math.PI * 2);
	context.fill();
	context.stroke();
	context.fillStyle = themeColors.color366c68;
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
	context.fillStyle = themeColors.coloredf9fa;
	context.strokeStyle = themeColors.color378aa6;
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
	context.fillStyle = themeColors.color28657c;
	context.font = '700 12px Inter, sans-serif';
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	context.fillText(count > 999 ? '999+' : String(count), 44, 18.5);
	return context.getImageData(0, 0, 128, 72);
}
