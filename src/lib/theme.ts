/**
 * Application colour theme. Edit this palette, then rebuild the app.
 * UI, charts, map paint and map symbols all use these same colours.
 * Existing tints, muted tones and transparency follow their palette role.
 */
export const themePalette = {
	brand: '#087f78',
	accent: '#8762d8',
	text: '#25272d',
	surface: '#ffffff',
	background: '#f4f3f8',
	success: '#16866e',
	warning: '#edbf50',
	danger: '#d65840',
	unknown: '#8f9baa',
	sea: '#087f8c',
	transfer: '#566cc3',
	health: '#9072dd',
	education: '#32ae89',
	airport: '#efa84b',
	mapWater: '#dceef0',
	mapLand: '#f5f2e7',
	mapBoundary: '#a0c1b9',
	mapBuilding: '#d9d2c1',
	mapRoad: '#fffefa',
	walking: '#22796d',
	bus: '#d18c34',
	ferry: '#2689b2',
	chartGreen: '#83a96c',
	chartLavender: '#a99acc',
	chartPaleLavender: '#d0c6e7',
	chartPaleGreen: '#d8e7ce',
	chartPeach: '#ecd6c5'
};

export type ThemePalette = typeof themePalette;
export type ThemeRole = keyof ThemePalette;

/**
 * The first tone in each group is its original palette reference. Remaining
 * tones preserve the current visual hierarchy while following palette edits.
 * Add a per-tone override in createTheme only when a colour needs an exception.
 */
const tonesByRole: Record<ThemeRole, string[]> = {
	text: `
		25272d 000000 00000000 576761 5f7065 5f7066 5f7067 607068 607069 607166 616f69 617061 617064 617065
		617066 617067 617267 62636a 626f69 627065 627066 627067 627068 636f64 636f68 636f6d 637063 637065
		64606e 64606f 64616e 647169 656575 656e6c 65746c 66616f 666f60 66756c 676778 67776f 686577 687870
		68796c 687a70 687b73 697a6f 6a6e6b 6a776e 6a786f 6a796f 6b6b79 6b756f 6b7973 6b7a71 6b7b70 6c6676
		6c6775 6c6a7b 6c6d7a 6c766f 6c7871 6c796f 6d786d 6d7971 6e697b 6f8177 706879 706979 708371 716879
		716c7a 716f7d 71847b 72857c 738071 738177 73877d 747080 747183 747483 756d80 75857b 758880 767387
		767582 777181 777482 77827a 78847a 78877e 798371 7a8d8b 7b7287 7b7486 7b8276 7b8375 7b8578 7b857a
		7c7587 7c837e 7c857c 7c8674 7c8874 7d857c 7d8a7c 80768b 80918e 81778c 817c8b 81928c 827a8b 829087
		82918a 849087 878294 898494 8a8194 8f8a9c 90988c 97a196 98a098 a09aa9 e2e6e3
	`
		.trim()
		.split(/\s+/),
	brand: `
		087f78 00695c 087e77 087f7c 087f7c10 0a8176 0d817b 12352f40 123d3429 14282012 14282029 14776b 163a3b26
		163a3b33 164c47 165d52 16735a 1737350a 17373512 17392b22 173e3915 176c61 183b3208 183b3212 183d3312
		183d3320 185943 1a433f12 1c3e3722 1d645e 203f3824 213e3729 216f5c 224d4510 22634f 23433d 234f43 236e62
		243a36 243c3710 24664f 24787b 247b75 253534 253d36 25423622 257469 26866c 269d7c 26a984 273732 274b4410
		27877b 278a78 286d63 286d630b 286d6320 286d6324 286d632b 286d638c 287254 29483e 294b4c 294c4908
		294c490a 294c4912 294c4918 294c4920 294c4930 294c4935 294c4945 29a783 2a6c53 2b51452b 2ba78212 2c786c
		2d6b57 2e886b 2f8363 304e44 30969a 30a982 315d61 315f51 31866b55 32857a 337f7a 344644 345953 355e5a
		356659 3651490d 365b54 365d53 366c68 369f7b 38514d 38584c 397065 39756d 39836c 3b6657 3c6c5b 3f5c53
		40868b 417c6650 41988b 428d78 44876c 48665d 48716e 496f6d 4b7a6f 4e6d61 507b79 517b73 567268 567772
		58756d 5a7169 618176 62786f 627a70 65847c 67817d 6b9894 6ba99c 6d9384 6e8680 6f9a8b 6fa7a1 739088
		739389 759388 78938e 7b908b 7baf9c 81958d 9cb9af a7cccf b8d9cc c8d9d3 cbdcd6 d2e8df d2e8e8 d5e6e5
		d7e2df d8e7e5 d8e7e8 d9e3df dce8e9 dde8e9 dfebeb e0e9e9 e4ecec e4f2ef e5eded e5f7f0 e9f3ef e9f5f3
		eaf8f5 edf7f6 edf9fa eef4f4 eef6f4 eff7f5 f0f6f5 f5f9f9 faffff
	`
		.trim()
		.split(/\s+/),
	sea: `
		087f8c 045761 0d2e3826 116976 133b4233 133b4259 142d3438 147b86 153c42 167c87 173a4a0a 173a4a20
		173c4020 173c403d 173c4055 173c4925 173d4214 173d4229 173d4233 173d4240 173d4255 19394614 193b4650
		1d414b 1d414d09 1d414d12 1d414d22 1d414d26 213c4e 23454d 234e5a 253d49 25454d 263b40 28444f 28657c
		294c53 2d5364 2d626a 2f4e5a 326c75 34585d 35565b 35566e 355679 355e67 36585f 376c79 378aa6 395b67
		397eb0 3c8c9a 3e7782 3f626e 3f6a78 426b78 42737e 437c8b 456167 466d79 49616a 4c6873 4c8e99 4d6872
		4d7078 4f8d99 507a9b 557a91 56737a 56747c 58737e 5a6e72 5a747c 5b7781 5c747d 5c7a84 5e7b82 607d8a
		637e89 647b83 648598 667d85 667f87 66818a 66858a 688187 6a858a 6c8b96 6d868d 728891 728b90 73888e
		7a8f96 7a9097 7c929a 7d9299 7d9ea3 7e9ea8 81969d 8798a0 88b9c7 899ba2 8a9ba2 8ba0a6 8d9da1 90a5ac
		a9ccd2 bdd5da c7dfe3 cfdee1 d8e4e6 dde5ec dde8eb dfeaec e1ebec e2eef7 eaf1f2 edf1f5 edf4fa f4f8fa
	`
		.trim()
		.split(/\s+/),
	transfer: `
		566cc3 153f6f 23233403 23252b 252b3533 252b3555 2563eb 282b35 292535 292735 302b40 376eb1 392b5903
		392b5905 3c315803 3c315804 3c31581c 3f3b4c 403265 433667 536aa6 555069 5874a4 625c73 637abd 655799
		65579930 66579988 68578d 6d50b2 716693 745fa7 756b8c 7651c2 7765b2 7960bc 81749c 9691a3 9793a6 a090c555
		a8b5cd ac93df aea0ce c2b7dc d4c9ed dad7e3 dcd7e7 dde5f2 dedde5 e1ddea e6e4ee e7e3f0 e7e6ed e7e6ee
		e9e6ef e9edf9 e9f0ff eae8f0 ebe7f6 eceaf1 edf2fa eeecf3 efedf4 efedf5 efedf6 f0edf6 f2eff8 f2f1f6
		f3f1f7 f3f2f6 f7f6fb faf8fe faf9fc fafafd fbfafd fcfcfd
	`
		.trim()
		.split(/\s+/),
	success: `
		16866e 17251f66 174c3320 22824e 234c3a14 24403122 24403433 245b40 253c3025 26392f 263d3310 263d3330
		276046 294e3e 2c402014 304c39 32614c35 326c53 34473f12 34473f16 365344 365c48 374b3e 376551 3d6633
		3f5935 415b45 425e50 437936 446538 456655 476b35 476c55 486353 4b6758 4c6040 4c6557 4d6a3e 4d7655
		4f6940 4f7641 50635b 526347 52684f 52685b 52695b 526c60 526e62 52713d 52715c 52743f 52765d 527b62
		52834d 53635c 53695c 557447 557549 566b45 566f40 56744d 57695e 57735c 57744b 586e61 586f5f 587367
		58744b 5a7267 5a7348 5b7055 5c7350 5e715d 5e7166 5e7253 5e7b69 5f715e 5f715f 5f7161 60715a 60776d
		60786c 617155 617158 61715b 617465 617565 617567 617568 62705d 627157 62766a 62766c 62776b 628147
		63766b 647358 647769 65705e 65786d 657b5b 667b6b 667d50 66894e 66a88b 677e72 68765f 687d60 69bba5
		6a8073 6b795f 6b8157 6c8e7c 6d8278 709267 77836a 7b846a 7b8570 7b866f 7b8b6a 7ca680 80966f 80a28c
		82916c 83988f 849075 88ccae 89ad71 8a937d 8a947c 8a977a 8b957e 8bab88 8fa976 91a69b 91a881 9ba995
		a4bc94 acc799 b4c9a4 b6daca b8c6b0 b8cba8 bad2b4 bcd4b5 bfd2c5 c5d4cb c6dfbc c8dcca cad8cf cdddb8
		cedbc5 d0dfc1 d0dfd0 d1d8d0 d1dfd9 d3ded5 d4ded7 d4dfca d4dfd0 d4e3db d4e5d8 d5ded7 d5dfd5 d5e1da
		d5e6de d6deda d6e1da d6e1db d6e4de d7e1dc d7e2d6 d7e2dc d7e3dd d7e5dd d7e7e0 d7e9df d8e2dc d8e4de
		d8e5de d9e2db d9e2dd d9e4d9 d9e9df dae3dc dbe3dc dbe4d3 dbe5d4 dce4d7 dce4d8 dce4dd dce5da dce5dd
		dce5df dce5e1 dce6d4 dce6de dce7d0 dce7d2 dce7df dce7e0 dce7e1 dce8d5 dce8e2 dde5d6 dfe6e1 dfe8e3
		dff0e8 e0e7dc e0e7dd e0e7e3 e0e8e2 e0e9e5 e1e7e0 e1e8e0 e1e9df e1f1e326 e2ede7 e3e8df e3e9dc e3e9e4
		e3e9e5 e3ebe6 e3eedb e4e8df e4ece6 e4eedb e4eee3 e5eadd e5ece7 e5ede6 e6efe7 e7ece1 e7ece5 e7ece7
		e7eeea e7efdf e7f0df e7f0e3 e7f6ef e8ede5 e8eee6 e8efdf e8efeb e8f0dc e8f2df e8f6e96b e9eee7 eaf0e5
		eaf1e4 eaf2e8 eaf5ef edf0e9 edf0ed edf1e6 edf2e8 edf3e6 edf3ef edf4e4 edf4e6 edf4e8 edf4eb edf5ee
		edf5ef edf5f0 edf5f1 edf6f2 edf7f1 eef3e9 eef5ee eef7f2 eef8ef25 eff1ea eff2eb eff4ed eff6ea eff6f2
		eff7f3 f0f2ef f0f3ea f0f5e8 f1f4ed f1f5ec f1f6ec f2f5f2 f2f8ef f3f7f2 f3f8f5 f4f6f2 f4f8f4 f5f6f1
		f5f8f1 f5f8f3 f5f8f5 f5faf7 f5fbf8 f6faf8 f7f8f3 f7faf5 f7faf7 f9fbf5 f9fcfa fafbf7 fafcf9 fbfcf8
		fbfcf9 fbfdfc fcfdfb
	`
		.trim()
		.split(/\s+/),
	walking: `
		22796d
	`
		.trim()
		.split(/\s+/),
	ferry: `
		2689b2
	`
		.trim()
		.split(/\s+/),
	accent: `
		8762d8 31234803 32283f 36214d09 36303d 3c3150 3f255b03 44354f 4c326b0a 4f425f 514563 554a62 56456e
		5b427a12 5c4b72 5c4c6f 5d427f 5e4e6e 605477 62596e 645080 655875 655c73 655c76 68527f 685978 695674
		6c537d 6c617c 6c6478 6d617d 6e528f 6e587e 6e617e 6e637b 6f667c 7053a51c 70569c 706178 715687 716780
		71687e 71697d 7250b6 72677e 726781 7352a8 736088 73687f 746780 74697f 75628e 756381 756683 75677e
		756a81 756b80 756b83 765a9e 766083 776582 776682 776783 776784 776b82 776b84 776c82 776d84 78648e
		786982 786c84 786e83 7953b7 7953c4 7956bd 7956bf 796199 796a89 796b87 796c84 7a6985 7a6a89 7a7086
		7b5caf 7b658e 7c5ab1 7c668f 7d5ab6 7d6797 7d6c92 7d6d93 7d718b 80718e 80748e 81689a 81718d 81738d
		81778d 81798e 827299 82748e 83718d 83738c 83798f 84748e 84778f 84798f 8567b1 857b91 867791 8761a7
		8761a777 8761b8 8762d80d 8762d81a 8762d844 8772a4 87789c 88709d 8870a9 8974b1 897b97 897c97 8a65a7
		8a65be 8a6eab 8a7b96 8a7e96 8a7e99 8a7f97 8a8195 8b74aa 8b76ac 8b76ad 8b7b9a 8b8296 8c66d0 8c7b9d
		8c7b9f 8d79b0 8d7aa3 8d829b 8e78ab 8e7cab 9170c6 91849d 92819c 928ba0 9373c6 9471cf 9484a6 94889f
		9571cf 95849e 9674d9 998ba3 9d96a8 a08cb4 a09aaa a09aab a18ac7 a19aaa a294ad a298ae a39cac a49aac
		a98bd4 aa98c8 ac91d6 ada3bc b1a0c4 b1a4bd b2a3c4 b6a6d1 b79bcf b7a3cf b7afc7 b897f1 b8a2cd bbb3c6
		bc9ada bca4e8 bca9d4 c5b4e3 c5b4e6 c9c2d4 cbbfda ddd6e9 ded4ea e1dce9 e2dbe9 e3dced e4dfed e4e0e8
		e5def0 e5def2 e5dfed e5e0ed e5e1eb e6deec e6e1ee e7dcf8 e7def1 e7e0ee e7e2ec e8e0f0 e8e1f0 e8e1f3
		e8e3ef e8e4ee e9e1f2 e9e4f0 e9e5ee eae3f3 eae5f1 eae6f0 ebe6f1 ebe6f4 ebe7f0 ece3f8 ece6f3 ece6f4
		ece6f5 ece7f2 ece7f5 ece8f0 ece8f1 ece9f0 ede8f4 edeaf1 edeaf2 eee7f7 eee7fa eee8f5 eee8fa eee9f3
		eee9f4 eee9f7 eeeaf2 eeebf2 eeebf3 efeaf7 efebf4 efebf5 efecf2 efecf3 efedf3 f0e7fa f0eaf8 f0eafb
		f0ebf5 f0ebf6 f0ecf5 f0edf4 f0edf5 f1ebfb f1edf7 f1edf8 f1eef5 f2edf7 f2edf8 f2edf9 f2eef6 f2eef8
		f3edfc f3eefb f3eff9 f4effc f4f0f9 f4f0fc f4f1f8 f5f1fb f5f2f9 f5f2fa f5f2fb f6f3f9 f7f3fd f7f4fc
		f7f5fa f8f5fb f8f5fc f8f6fb f9f7fc faf8fc faf8fd fbf9fd fcfbfd fdfcfe
	`
		.trim()
		.split(/\s+/),
	education: `
		32ae89
	`
		.trim()
		.split(/\s+/),
	warning: `
		edbf50 503c3020 74603c 77551d 795b2d 7b6340 7c694c 805d39 8b5424 8b5636 8b683b 8c733f 8c7851 8e7447
		8f6c37 906428 91651d 926c54 946045 946630 946837 956831 956918 956b42 995e29 997349 99845b a48858
		a87556 ad7b3a ad8246 b5b8a6 b76c43 b77b3c b98942 bb7f48 bcbda9 be9344 c29149 c2bda8 c59a53 c59b83
		c6b56f cb8b4e cda64e d08a28 d59a3e d79c46 d9ad54 d9c5a4 dfb997 e4c6ac e6a24a e7ddc4 e9e3d4 ecd8b4
		eddfd4 eee0c8 f0d9c6 f0ddc7 f1ebdf f3efe0 f5f6f0 f6edd5 f7e7d9 f9eade faf2e7 faf6ed faf7ef faf8f1
		fbf2e4 fcf8ed ffead6 fff0cd fff0d6 fff0e7 fff0e8 fff1e5 fff1e8 fff2d9 fff2e8 fff3e9 fff4e9 fff5da
		fff6ef fff7ec fff8e8ed fff8eb fff8ef fff9db fff9e8 fff9ed fff9ed60 fff9eda0 fffaee fffdf8 fffdf8f5
		fffef4 fffef6eb fffef7e8 fffef7ed fffef9 fffef9ed
	`
		.trim()
		.split(/\s+/),
	chartGreen: `
		83a96c
	`
		.trim()
		.split(/\s+/),
	unknown: `
		8f9baa 87939b 889ea1 a4b2b5 a6a5b5 b7c3c4
	`
		.trim()
		.split(/\s+/),
	danger: `
		d65840 8a2b35 8e573c 914e60 924d40 95473d 984137 994731 9c3328 9c5c44 a14431 a25642 a45a46 a5552f
		a55547 a94a46 ad4b3d ad593f ad593f20 b84643 b9503a bb634c0b bb634caa bb7352 c1493f c44e55 d46d58 d4735b
		d56954 d7a0b5 db6956 dd806b df735b df9272 e2745d e6bec5 ebc8d1 edd6cc ef7159 ef715920 f9ebe9 fbe9e8
		fbebea fbeeed fcf0ee fff1ed fff1ee fff2f0 fff2f4 fff5f7
	`
		.trim()
		.split(/\s+/),
	health: `
		9072dd af98e7 cfc0ee
	`
		.trim()
		.split(/\s+/),
	mapBoundary: `
		a0c1b9 9fc9c5 a5c2b6 aac8bd
	`
		.trim()
		.split(/\s+/),
	chartLavender: `
		a99acc
	`
		.trim()
		.split(/\s+/),
	mapRoad: `
		fffefa c2c7bc c6c8bb c8c7b8 f8f9ef fff4cf fffdf5 fffdf5ee fffdf7 fffefade fffefaed fffefaf7
	`
		.trim()
		.split(/\s+/),
	mapBuilding: `
		d9d2c1 c7beac c9cec7 d0d4cd
	`
		.trim()
		.split(/\s+/),
	mapWater: `
		dceef0 cce5e6 cce6e6 e4eef0
	`
		.trim()
		.split(/\s+/),
	chartPaleLavender: `
		d0c6e7
	`
		.trim()
		.split(/\s+/),
	bus: `
		d18c34
	`
		.trim()
		.split(/\s+/),
	chartPaleGreen: `
		d8e7ce
	`
		.trim()
		.split(/\s+/),
	surface: `
		ffffff e6e6e9 ffffff0d ffffff80 ffffff88 ffffffb3 ffffffe0 ffffffe6 ffffffed fffffff5 fffffff7 fffffff9
	`
		.trim()
		.split(/\s+/),
	chartPeach: `
		ecd6c5
	`
		.trim()
		.split(/\s+/),
	airport: `
		efa84b
	`
		.trim()
		.split(/\s+/),
	mapLand: `
		f5f2e7 f4f1e8 f5f2e8
	`
		.trim()
		.split(/\s+/),
	background: `
		f4f3f8
	`
		.trim()
		.split(/\s+/)
};

type Hsl = [number, number, number];

function rgbToHsl(hex: string): Hsl {
	const [r, g, b] = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
	const high = Math.max(r, g, b),
		low = Math.min(r, g, b),
		delta = high - low;
	const lightness = (high + low) / 2;
	if (!delta) return [0, 0, lightness];
	const saturation = delta / (1 - Math.abs(2 * lightness - 1));
	const sector =
		high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
	return [(sector * 60 + 360) % 360, saturation, lightness];
}

function hslToHex([hue, saturation, lightness]: Hsl): string {
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
	const m = lightness - chroma / 2;
	const channels =
		hue < 60
			? [chroma, x, 0]
			: hue < 120
				? [x, chroma, 0]
				: hue < 180
					? [0, chroma, x]
					: hue < 240
						? [0, x, chroma]
						: hue < 300
							? [x, 0, chroma]
							: [chroma, 0, x];
	return channels
		.map((channel) =>
			Math.round((channel + m) * 255)
				.toString(16)
				.padStart(2, '0')
		)
		.join('');
}

function normalizedHex(value: string): string {
	const hex = value.replace(/^#/, '').toLowerCase();
	if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(hex)) {
		throw new Error(`Theme palette colours must be opaque hex values: ${value}`);
	}
	return hex.length === 3 ? [...hex].map((channel) => channel + channel).join('') : hex;
}

function retone(tone: string, reference: string, replacement: string): string {
	if (reference === replacement) return `#${tone}`;
	const [h, s, l] = rgbToHsl(tone.slice(0, 6));
	const [oldH, oldS, oldL] = rgbToHsl(reference);
	const [newH, newS, newL] = rgbToHsl(replacement);
	const clamp = (value: number) => Math.max(0, Math.min(1, value));
	const hue = (((s < 0.015 ? newH : h + newH - oldH) % 360) + 360) % 360;
	return `#${hslToHex([hue, clamp(s + newS - oldS), clamp(l + newL - oldL)])}${tone.slice(6)}`;
}

const cssAliases = {
	background: 'f4f3f8',
	foreground: '25272d',
	card: 'ffffff',
	'card-foreground': '25272d',
	popover: 'ffffff',
	'popover-foreground': '25272d',
	primary: '273732',
	'primary-foreground': 'ffffff',
	secondary: 'efedf5',
	'secondary-foreground': '555069',
	muted: 'f3f2f6',
	'muted-foreground': '6c6d7a',
	accent: 'ebe7f6',
	'accent-foreground': '605477',
	destructive: 'b84643',
	border: 'e7e6ed',
	input: 'dedde5',
	ring: '8e7cab',
	'chart-1': '83a96c',
	'chart-2': 'a99acc',
	'chart-3': 'd0c6e7',
	'chart-4': 'd8e7ce',
	'chart-5': 'ecd6c5'
};

/** Build literal hex colours for canvas/MapLibre and matching SSR-safe CSS variables. */
export function createTheme(palette: ThemePalette = themePalette) {
	const tones: Record<`color${string}`, string> = {};
	for (const role of Object.keys(tonesByRole) as ThemeRole[]) {
		const replacement = normalizedHex(palette[role]);
		const group = tonesByRole[role];
		for (const tone of group) tones[`color${tone}`] = retone(tone, group[0], replacement);
	}
	const colors: ThemePalette & Record<`color${string}`, string> = { ...tones, ...palette };
	const variables = [
		...Object.entries(tones).map(([key, value]) => `--theme-color-${key.slice(5)}:${value}`),
		...Object.entries(palette).map(
			([key, value]) =>
				`--theme-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${value}`
		),
		...Object.entries(cssAliases).map(([key, tone]) => `--${key}:var(--theme-color-${tone})`)
	];
	return { colors, css: `:root{${variables.join(';')}}` };
}

const theme = createTheme();
export const themeColors = theme.colors;
export const themeCss = theme.css;
