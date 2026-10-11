import { asset } from '$app/paths';
import { getGeneratedTransportAsset } from './generatedAssets';

/**
 * Original atlas illustrations and generated architectural miniatures made for
 * this project. The SVGs remain self-contained fallbacks and optical alternatives
 * for categories without a generated asset.
 */
export type GraphicKind =
	| 'bus'
	| 'ferry'
	| 'vessel'
	| 'cargo-ship'
	| 'speedboat'
	| 'airplane'
	| 'airport'
	| 'hospital'
	| 'clinic'
	| 'school'
	| 'terminal'
	| 'shelter'
	| 'walk'
	| 'wait';

export type GraphicState = 'existing' | 'proposed' | 'draft' | 'moved' | 'paused';

export const GRAPHIC_STATE_LABELS: Record<GraphicState, string> = {
	existing: 'Existing',
	proposed: 'Proposed investment',
	draft: 'Placement preview',
	moved: 'Proposed relocation',
	paused: 'Paused in this scenario'
};

export const GRAPHIC_LABELS: Record<GraphicKind, string> = {
	bus: 'Public bus',
	ferry: 'Passenger ferry',
	vessel: 'Boat',
	'cargo-ship': 'Cargo ship',
	speedboat: 'Speedboat',
	airplane: 'Airplane',
	airport: 'Airport',
	hospital: 'Hospital',
	clinic: 'Clinic',
	school: 'School',
	terminal: 'Transport terminal',
	shelter: 'Bus stop with shelter and stop flag',
	walk: 'Walk',
	wait: 'Wait for service'
};

// Fixed SVG markup only: callers cannot insert HTML or source-supplied attributes.
const artwork: Record<GraphicKind, string> = {
	bus: `
 <ellipse cx="48" cy="80" rx="37" ry="8" fill="#d9e8e7"/>
 <path d="M15 30 57 17Q60 16 64 18L81 27Q85 29 85 34V65L43 80 15 65Z" fill="#138c87" stroke="#123e50" stroke-width="2.2" stroke-linejoin="round"/>
 <path d="M15 30 43 44 85 30 60 18Z" fill="#b6eae1" stroke="#123e50" stroke-width="2.2" stroke-linejoin="round"/>
 <path d="M15 31 43 44V80L15 65Z" fill="#20a59a"/>
 <path d="M43 44 85 30V65L43 80Z" fill="#0e777b"/>
 <path d="M20 37 37 46V61L20 52Z" fill="#173b54" stroke="#123e50" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M48 46 62 41V55L48 60ZM67 39 80 35V49L67 54Z" fill="#d5f1ef"/>
 <path d="M51 48 58 46M70 41 77 39" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
 <path d="M20 58 37 67M48 66 80 55" stroke="#f4d188" stroke-width="4"/>
 <path d="M71 51V69M81 48V65" stroke="#154c58" stroke-width="2"/>
 <path d="M21 62 24 64M33 68 36 70" stroke="#fff5d7" stroke-width="4" stroke-linecap="round"/>
 <path d="M24 73 32 77" stroke="#15394b" stroke-width="3" stroke-linecap="round"/>
 <ellipse cx="52" cy="76" rx="5" ry="7" fill="#173b54" transform="rotate(15 52 76)"/>
 <ellipse cx="52" cy="76" rx="2" ry="3" fill="#e8f6f3" transform="rotate(15 52 76)"/>
 <ellipse cx="77" cy="68" rx="5" ry="7" fill="#173b54" transform="rotate(15 77 68)"/>
 <ellipse cx="77" cy="68" rx="2" ry="3" fill="#e8f6f3" transform="rotate(15 77 68)"/>
 <path d="M15 39 10 36V46L15 49M85 37 89 35V44L85 46" fill="#123e50" stroke="#123e50" stroke-linejoin="round"/>
 <path d="M24 29 58 20" stroke="#f0fff9" stroke-width="2.5" stroke-linecap="round"/>
`,
	ferry: `
 <ellipse cx="48" cy="76" rx="38" ry="11" fill="#d6edf6"/>
 <path d="M14 58 56 44 84 55 42 72Z" fill="#f5fbfc" stroke="#256482" stroke-width="1.5" stroke-linejoin="round"/>
 <path d="M14 58 42 72 47 80 23 68Z" fill="#24678a"/>
 <path d="M42 72 84 55 75 72 47 80Z" fill="#378dae"/>
 <path d="M26 44 58 34 72 40 39 52Z" fill="#d1eef5" stroke="#256482" stroke-width="1.3" stroke-linejoin="round"/>
 <path d="M26 44 39 52 39 66 26 58Z" fill="#fff" stroke="#256482" stroke-width="1.3" stroke-linejoin="round"/>
 <path d="M39 52 72 40 72 53 39 66Z" fill="#e7f5f8" stroke="#256482" stroke-width="1.3" stroke-linejoin="round"/>
 <path d="M32 31 55 23 67 29 43 38Z" fill="#f8fcfc" stroke="#256482" stroke-width="1.3" stroke-linejoin="round"/>
 <path d="M32 31 43 38 43 49 32 42Z" fill="#226482"/>
 <path d="M43 38 67 29 67 39 43 49Z" fill="#71bfd2" stroke="#256482" stroke-width="1.3" stroke-linejoin="round"/>
 <path d="M43 55 48 53 48 58 43 60ZM51 52 56 50 56 55 51 57ZM60 49 65 47 65 52 60 54Z" fill="#205f7e"/>
 <path d="M46 39 63 33" stroke="#d9faff" stroke-width="2"/>
 <path d="M56 25V13M56 13 67 16 56 20" stroke="#296a86" stroke-width="1.4" fill="#e8b456" stroke-linejoin="round"/>
 <path d="M13 76Q21 80 29 76M63 83Q72 86 82 81M10 66 17 69" fill="none" stroke="#74bed1" stroke-width="2" stroke-linecap="round"/>
`,
	'cargo-ship': `
 <ellipse cx="49" cy="78" rx="39" ry="10" fill="#d6edf6"/>
 <path d="M7 60 61 43 90 55 66 77 31 85 16 74Z" fill="#173f58" stroke="#143449" stroke-width="2" stroke-linejoin="round"/>
 <path d="M7 60 36 73 90 55 61 43Z" fill="#eaf4f0" stroke="#143449" stroke-width="2" stroke-linejoin="round"/>
 <path d="M36 73 90 55 66 77 31 85Z" fill="#2d6a81"/>
 <path d="M15 68 30 76 74 62" fill="none" stroke="#e8bb68" stroke-width="3" stroke-linejoin="round"/>
 <path d="M25 44 41 39 54 45 38 51Z" fill="#f6d996" stroke="#a97836" stroke-width="1.6" stroke-linejoin="round"/>
 <path d="M25 44 38 51V65L25 59Z" fill="#d19a4b" stroke="#a97836" stroke-width="1.6" stroke-linejoin="round"/>
 <path d="M38 51 54 45V59L38 65Z" fill="#e8bc6b" stroke="#a97836" stroke-width="1.6" stroke-linejoin="round"/>
 <path d="M46 36 62 31 75 37 59 43Z" fill="#a7d8d7" stroke="#286b78" stroke-width="1.6" stroke-linejoin="round"/>
 <path d="M46 36 59 43V57L46 51Z" fill="#2b8f99" stroke="#286b78" stroke-width="1.6" stroke-linejoin="round"/>
 <path d="M59 43 75 37V51L59 57Z" fill="#63b6bb" stroke="#286b78" stroke-width="1.6" stroke-linejoin="round"/>
 <path d="M30 47V59M35 50V62M42 52V62M49 49V59M63 43V53M70 41V51" stroke="#935f2a" stroke-width="1.2"/>
 <path d="M13 28 29 23 41 29 25 35Z" fill="#f4fbfa" stroke="#2b6075" stroke-width="1.6" stroke-linejoin="round"/>
 <path d="M13 28 25 35V57L13 51Z" fill="#d9eef0" stroke="#2b6075" stroke-width="1.6" stroke-linejoin="round"/>
 <path d="M25 35 41 29V51L25 57Z" fill="#fffdf6" stroke="#2b6075" stroke-width="1.6" stroke-linejoin="round"/>
 <path d="M16 33 22 36V41L16 38ZM29 36 37 33V38L29 41Z" fill="#2b6075"/>
 <path d="M20 24V13L28 10V23Z" fill="#e8bb68" stroke="#2b6075" stroke-width="1.6" stroke-linejoin="round"/>
 <path d="M20 13 28 10 33 12 25 15Z" fill="#173f58"/>
 <path d="M34 26V15M34 15 43 18 34 21" fill="#67a6b8" stroke="#2b6075" stroke-width="1.6" stroke-linejoin="round"/>
 <path d="M9 82Q18 87 28 83M68 85Q79 87 90 80" fill="none" stroke="#70b8cb" stroke-width="2.2" stroke-linecap="round"/>
`,
	vessel: `
 <ellipse cx="49" cy="79" rx="39" ry="9" fill="#d6edf6"/>
 <path d="M10 59 52 45 80 46 91 39 88 58 75 75 43 84 24 77Z" fill="#244f68" stroke="#173f58" stroke-width="2" stroke-linejoin="round"/>
 <path d="M10 59 52 45 80 46 91 39 83 56 39 72Z" fill="#d4e8e4" stroke="#173f58" stroke-width="2" stroke-linejoin="round"/>
 <path d="M39 72 83 56 88 48 88 58 75 75 43 84Z" fill="#34788b"/>
 <path d="M15 62 39 76 79 62 87 48" fill="none" stroke="#e8bb68" stroke-width="3" stroke-linejoin="round"/>
 <path d="M50 53 68 48 80 51 64 59Z" fill="#8cbfbf"/>
 <path d="M62 50 66 56M70 49 74 53" stroke="#5d939b" stroke-width="1.4" stroke-linecap="round"/>
 <path d="M20 42 43 34 61 42 37 51Z" fill="#fffdf6" stroke="#285c72" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M20 42 37 51V68L20 59Z" fill="#b5d9d9" stroke="#285c72" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M37 51 61 42V59L37 68Z" fill="#dceee8" stroke="#285c72" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M24 48 33 52V58L24 54ZM41 52 48 49V55L41 58ZM51 48 57 46V52L51 54Z" fill="#285c72"/>
 <path d="M16 39 42 30 64 40 37 51V55L16 44Z" fill="#4d9b9e" stroke="#285c72" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M16 39 37 49 64 40" fill="none" stroke="#bce0d7" stroke-width="2" stroke-linejoin="round"/>
 <path d="M45 32V20M41 22H49" stroke="#285c72" stroke-width="2" stroke-linecap="round"/>
 <path d="M80 46 88 42" stroke="#fffdf6" stroke-width="2" stroke-linecap="round"/>
 <path d="M12 78Q19 81 26 80M64 85Q76 85 86 78" fill="none" stroke="#70b8cb" stroke-width="2" stroke-linecap="round"/>
`,
	speedboat: `
 <ellipse cx="50" cy="72" rx="38" ry="11" fill="#d6edf6"/>
 <path d="M8 58 59 44 90 51 65 70 26 82Z" fill="#f8fcf8" stroke="#245d7a" stroke-width="2" stroke-linejoin="round"/>
 <path d="M8 58 29 69 90 51 65 70 26 82Z" fill="#208e9a" stroke="#245d7a" stroke-width="2" stroke-linejoin="round"/>
 <path d="M29 69 90 51 65 70 26 82Z" fill="#266c86"/>
 <path d="M13 62 29 73 80 58" fill="none" stroke="#f2d293" stroke-width="3" stroke-linejoin="round"/>
 <path d="M26 48 48 33 66 38 77 51 39 64Z" fill="#f4fbfa" stroke="#245d7a" stroke-width="2" stroke-linejoin="round"/>
 <path d="M48 33 66 38 74 48 52 55Z" fill="#193e57" stroke="#245d7a" stroke-width="2" stroke-linejoin="round"/>
 <path d="M48 33 52 55 39 64 26 48Z" fill="#8acbd1" stroke="#245d7a" stroke-width="2" stroke-linejoin="round"/>
 <path d="M53 37 57 48 67 45" fill="none" stroke="#bbe6e4" stroke-width="2" stroke-linecap="round"/>
 <path d="M24 54 33 59M44 59 48 58" stroke="#245d7a" stroke-width="2.5" stroke-linecap="round"/>
 <path d="M13 75 25 80M5 68 15 72M39 85Q55 84 66 78" fill="none" stroke="#70b8cb" stroke-width="2.5" stroke-linecap="round"/>
`,
	airplane: `
 <ellipse cx="48" cy="79" rx="35" ry="8" fill="#dce8ef"/>
 <path d="M23 68 71 27Q77 22 80 26Q83 30 77 35L29 77Q23 79 21 76Q19 72 23 68Z" fill="#f8fcfd" stroke="#284a69" stroke-width="2" stroke-linejoin="round"/>
 <path d="M42 50 18 33 25 28 56 37Z" fill="#b5d8e2" stroke="#284a69" stroke-width="2" stroke-linejoin="round"/>
 <path d="M49 54 75 68 87 60 62 43Z" fill="#80b8d0" stroke="#284a69" stroke-width="2" stroke-linejoin="round"/>
 <path d="M28 66 13 59 17 54 39 56ZM32 72 40 85 51 78 42 63Z" fill="#2e7595" stroke="#284a69" stroke-width="2" stroke-linejoin="round"/>
 <path d="M72 29 76 28 78 31 74 34Z" fill="#284a69"/>
 <path d="M61 39 39 58" stroke="#3e91ab" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 5"/>
 <path d="M55 62 64 67M34 41 41 45" stroke="#284a69" stroke-width="5" stroke-linecap="round"/>
 <path d="M25 73 30 73 36 68" fill="none" stroke="#e7bd72" stroke-width="3" stroke-linecap="round"/>
 <path d="M61 77 73 81M13 81 24 85" stroke="#bdd2df" stroke-width="2.5" stroke-linecap="round"/>
`,
	airport: `
 <path d="M7 73 48 57 91 73 49 90Z" fill="#dce8e9"/>
 <path d="M8 69 56 52 80 62 31 80Z" fill="#315b6c" stroke="#284a69" stroke-width="1.5" stroke-linejoin="round"/>
 <path d="M20 69 64 54M25 74 71 58" stroke="#d6e7e7" stroke-width="1.4" stroke-linecap="round"/>
 <path d="M30 70 35 68M43 65 48 63M56 60 61 58" stroke="#fffdf6" stroke-width="2" stroke-linecap="round"/>
 <path d="M45 36 71 27 86 34 59 44Z" fill="#b4d8dc" stroke="#284a69" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M45 36 59 44V65L45 59Z" fill="#f4faf7" stroke="#284a69" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M59 44 86 34V55L59 65Z" fill="#70aeba" stroke="#284a69" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M63 46 69 44V58L63 60ZM73 43 80 40V54L73 57Z" fill="#244e68"/>
 <path d="M23 27 37 22 46 27 32 32V61L23 56Z" fill="#e4f1ee" stroke="#284a69" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M32 32 46 27V56L32 61Z" fill="#72aebc" stroke="#284a69" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M18 14 34 8 50 15 48 28 32 34 20 28Z" fill="#284a69" stroke="#284a69" stroke-width="1.8" stroke-linejoin="round"/>
 <path d="M22 17 32 22 32 30 22 25ZM35 22 46 18 45 25 35 29Z" fill="#a9dfe4"/>
 <path d="M34 8V3M29 4H39" stroke="#e7bd72" stroke-width="2.2" stroke-linecap="round"/>
 <path d="M42 75 47 68 44 62 47 61 52 66 62 64 65 66 55 71 58 77 55 79 51 74 44 78Z" fill="#fffdf7" stroke="#284a69" stroke-width="1.4" stroke-linejoin="round"/>
 <path d="M76 61 88 65M69 69 82 73" stroke="#9cbcc5" stroke-width="2" stroke-linecap="round"/>
`,
	hospital: `
 <path d="M7 75 47 60 89 75 49 91Z" fill="#dce9e6"/>
 <path d="M15 47 40 38 78 53 51 64Z" fill="#e0f2e9" stroke="#146c68" stroke-width="2" stroke-linejoin="round"/>
 <path d="M15 47 51 64V82L15 66Z" fill="#f5fcf7" stroke="#146c68" stroke-width="2" stroke-linejoin="round"/>
 <path d="M51 64 78 53V71L51 82Z" fill="#b5ded1" stroke="#146c68" stroke-width="2" stroke-linejoin="round"/>
 <path d="M29 21 55 12 74 20 48 30Z" fill="#b9e6d7" stroke="#146c68" stroke-width="2" stroke-linejoin="round"/>
 <path d="M29 21 48 30V67L29 59Z" fill="#fffdf6" stroke="#146c68" stroke-width="2" stroke-linejoin="round"/>
 <path d="M48 30 74 20V57L48 67Z" fill="#159283" stroke="#146c68" stroke-width="2" stroke-linejoin="round"/>
 <path d="M32 20 55 12 70 19 47 27Z" fill="#d9f5e8"/>
 <path d="M59 31 64 29V37L70 35V41L64 43V51L59 53V45L53 47V41L59 39Z" fill="#fffdf5"/>
 <path d="M34 31 41 34V41L34 38ZM34 45 41 48V55L34 52Z" fill="#80c8bc"/>
 <path d="M19 54 25 57V63L19 60ZM56 68 64 65V71L56 74ZM68 63 74 61V67L68 69Z" fill="#3c8c8c"/>
 <path d="M33 63 43 67V79L33 75Z" fill="#146c68"/>
 <path d="M30 77 43 83 43 87 30 81Z" fill="#c5dad3"/>
 <path d="M77 46 89 41V68L77 73Z" fill="#edf8f0" stroke="#146c68" stroke-width="2" stroke-linejoin="round"/>
 <path d="M83 46V60M79 55 87 52" stroke="#168f80" stroke-width="3"/>
`,
	clinic: `
 <path d="M9 76 48 61 88 77 49 91Z" fill="#dce9e6"/>
 <path d="M17 42 55 29 82 42 43 57Z" fill="#c4e8dc" stroke="#146c68" stroke-width="2" stroke-linejoin="round"/>
 <path d="M17 42 43 57V79L17 66Z" fill="#fffdf6" stroke="#146c68" stroke-width="2" stroke-linejoin="round"/>
 <path d="M43 57 82 42V65L43 79Z" fill="#9fd8c9" stroke="#146c68" stroke-width="2" stroke-linejoin="round"/>
 <path d="M12 41 55 26 87 42 43 59Z" fill="#168f80" stroke="#146c68" stroke-width="2" stroke-linejoin="round"/>
 <path d="M55 26 87 42 43 59V54L80 41Z" fill="#0d766f"/>
 <path d="M22 49 33 55V65L22 60ZM62 55 75 50V60L62 65Z" fill="#66b9ad" stroke="#146c68" stroke-width="1.5" stroke-linejoin="round"/>
 <path d="M48 63 57 59V74L48 78Z" fill="#146c68"/>
 <path d="M46 79 58 74 63 76 50 82Z" fill="#c6dad1"/>
 <path d="M37 13 58 8 65 11V37L44 43 37 39Z" fill="#0e786f" stroke="#146c68" stroke-width="2" stroke-linejoin="round"/>
 <path d="M44 16 65 11V37L44 43Z" fill="#168f80"/>
 <path d="M52 19 57 18V25L62 23V29L57 31V37L52 38V32L47 34V28L52 26Z" fill="#fffdf5"/>
 <path d="M17 70 29 76" stroke="#c6dad1" stroke-width="3" stroke-linecap="round"/>
`,
	school: `
 <path d="M6 76 46 62 91 78 49 92Z" fill="#e2e7e9"/>
 <path d="M14 45 51 32 82 45 44 61Z" fill="#f2e9ce" stroke="#183c59" stroke-width="2" stroke-linejoin="round"/>
 <path d="M14 45 44 61V83L14 68Z" fill="#fff9e7" stroke="#183c59" stroke-width="2" stroke-linejoin="round"/>
 <path d="M44 61 82 45V68L44 83Z" fill="#d1ddd9" stroke="#183c59" stroke-width="2" stroke-linejoin="round"/>
 <path d="M8 43 43 15 68 25 89 43 44 63Z" fill="#183c59" stroke="#183c59" stroke-width="2.2" stroke-linejoin="round"/>
 <path d="M43 15 68 25 44 63 44 53Z" fill="#315b76"/>
 <path d="M11 44 44 59 87 43" fill="none" stroke="#eacb82" stroke-width="3" stroke-linejoin="round"/>
 <path d="M24 33 34 37 34 49 24 44ZM34 37 42 33V44L34 49Z" fill="#fff9e7" stroke="#183c59" stroke-width="1.5" stroke-linejoin="round"/>
 <path d="M34 37V49" stroke="#eacb82" stroke-width="2"/>
 <path d="M19 54 25 57V64L19 61ZM32 61 38 64V71L32 68ZM60 59 68 56V64L60 67ZM73 54 78 52V60L73 62Z" fill="#557d8a"/>
 <path d="M47 68 56 64V78L47 82Z" fill="#183c59"/>
 <path d="M43 82 58 76 64 79 49 86Z" fill="#d1ddd9"/>
 <path d="M84 64V83M84 64V18M84 18 93 21 84 28" stroke="#183c59" stroke-width="2" fill="#eacb82" stroke-linejoin="round"/>
 <path d="M7 73V84" stroke="#598374" stroke-width="2"/>
 <path d="M3 71Q1 61 8 56Q16 60 14 70L8 76Z" fill="#78ad94"/>
`,
	terminal: `
 <path d="M9 73 49 60 88 75 48 90Z" fill="#dfeae8"/>
 <path d="M16 41 59 26 82 36 38 53Z" fill="#a3cfca" stroke="#326e69" stroke-width="1.4" stroke-linejoin="round"/>
 <path d="M16 41 38 53 38 76 16 64Z" fill="#f1f8f5" stroke="#326e69" stroke-width="1.4" stroke-linejoin="round"/>
 <path d="M38 53 82 36 82 61 38 76Z" fill="#b8d5ce" stroke="#326e69" stroke-width="1.4" stroke-linejoin="round"/>
 <path d="M43 54 54 50 54 66 43 70ZM59 48 70 44 70 60 59 64ZM74 42 78 40 78 57 74 59Z" fill="#5a9796"/>
 <path d="M21 48 33 54 33 64 21 58Z" fill="#8cb9b6"/>
 <path d="M12 41 58 24 85 36 38 54Z" fill="#deeee7" stroke="#326e69" stroke-width="1.4" stroke-linejoin="round"/>
 <path d="M30 28V16L44 10 56 15V29L44 34Z" fill="#0e8778" stroke="#326e69" stroke-width="1.3" stroke-linejoin="round"/>
 <path d="M44 10V34L56 29V15Z" fill="#1a9c89"/>
 <path d="M34 20 40 23 40 27 34 24M47 18 52 16 52 20 47 22" fill="#d4f4e9"/>
 <path d="M42 80 72 69M45 84 75 73" stroke="#7aab9e" stroke-width="2" stroke-linecap="round"/>
`,
	shelter: `
 <path d="M7 78 46 65 89 80 49 93Z" fill="#dee9ef"/>
 <path d="M18 40 45 31 69 42 41 54V81L18 70Z" fill="#d6eaf0" stroke="#245d88" stroke-width="2" stroke-linejoin="round"/>
 <path d="M41 54 69 42V69L41 81Z" fill="#eff8f7" stroke="#245d88" stroke-width="2" stroke-linejoin="round"/>
 <path d="M12 37 44 25 76 40 41 55 12 41Z" fill="#367fac" stroke="#245d88" stroke-width="2" stroke-linejoin="round"/>
 <path d="M12 37 41 51 76 36V40L41 55 12 41Z" fill="#245d88"/>
 <path d="M18 45V73M41 55V82M69 45V70" stroke="#245d88" stroke-width="3" stroke-linecap="round"/>
 <path d="M45 68 63 61 67 63 48 71Z" fill="#d6ad68" stroke="#245d88" stroke-width="1.5" stroke-linejoin="round"/>
 <path d="M49 72V78M63 66V72" stroke="#245d88" stroke-width="2.5"/>
 <path d="M22 47 34 53V65L22 59Z" fill="#fffdf6" stroke="#6c96af" stroke-width="1.5" stroke-linejoin="round"/>
 <path d="M25 52 31 55M25 56 31 59" stroke="#367fac" stroke-width="1.6" stroke-linecap="round"/>
 <path d="M80 35V81" stroke="#245d88" stroke-width="3.5" stroke-linecap="round"/>
 <path d="M71 16 86 11 92 14V35L77 41 71 38Z" fill="#245d88" stroke="#245d88" stroke-width="2" stroke-linejoin="round"/>
 <path d="M77 19 92 14V35L77 41Z" fill="#367fac"/>
 <path d="M80 23 88 20V31L80 34Z" fill="#fffdf6"/>
 <path d="M82 25 86 24V27L82 28Z" fill="#245d88"/>
 <path d="M81 35V37M87 33V35" stroke="#fffdf6" stroke-width="2"/>
 <path d="M75 83 86 79" stroke="#aec8d8" stroke-width="3" stroke-linecap="round"/>
`,
	walk: `
 <ellipse cx="49" cy="78" rx="28" ry="8" fill="#e0ece8"/>
 <path d="M16 70 71 50M25 79 80 59" stroke="#becdc7" stroke-width="2" stroke-linecap="round"/>
 <circle cx="53" cy="23" r="7" fill="#f0c99c"/>
 <path d="M45 35 56 32 62 49 51 54 42 44Z" fill="#248d79" stroke="#176a5d" stroke-width="1.3" stroke-linejoin="round"/>
 <path d="M47 49 40 63 29 71M55 52 64 64 62 78" fill="none" stroke="#285869" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
 <path d="M45 36 36 48 28 47M57 37 66 43 75 40" fill="none" stroke="#e6bb92" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
 <path d="M27 72 34 73M60 79 67 79" stroke="#193e49" stroke-width="4" stroke-linecap="round"/>
 <path d="M43 36 38 35 32 47 40 51Z" fill="#eab861"/>
`,
	wait: `
 <ellipse cx="48" cy="77" rx="32" ry="9" fill="#eee9da"/>
 <circle cx="48" cy="44" r="26" fill="#fcf6e6" stroke="#bfa16a" stroke-width="2"/>
 <circle cx="48" cy="44" r="21" fill="#fffdf7" stroke="#e0d1af" stroke-width="1"/>
 <path d="M48 28V44L61 50" fill="none" stroke="#6b805f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
 <circle cx="48" cy="44" r="3" fill="#d4a44e"/>
 <path d="M48 23V26M48 62V65M27 44H30M66 44H69" stroke="#bfa16a" stroke-width="2" stroke-linecap="round"/>
 <path d="M22 19 15 26M74 19 81 26" stroke="#d4a44e" stroke-width="4" stroke-linecap="round"/>
 <path d="M33 68 29 77M63 68 67 77" stroke="#6b805f" stroke-width="3" stroke-linecap="round"/>
`
};

// Optical variants for 22–32px map marks: larger identifying features and a white
// contour keep them legible over streets. These contain no service-state styling;
// timed, untimed, proposed and disabled states remain controlled by the map layers.
const markerArtwork: Partial<Record<GraphicKind, string>> = {
	vessel: `
 <path d="M48 7Q69 28 72 48V75Q69 87 48 89Q27 87 24 75V48Q27 28 48 7Z" fill="#fffdf8" stroke="#fffdf8" stroke-width="9" stroke-linejoin="round"/>
 <path d="M48 10Q66 30 69 49V73Q66 84 48 86Q30 84 27 73V49Q30 30 48 10Z" fill="#34788b" stroke="#173f58" stroke-width="3" stroke-linejoin="round"/>
 <path d="M48 19Q61 35 62 46H34Q35 35 48 19Z" fill="#b5d9d9"/>
 <path d="M34 49H62V75Q48 79 34 75Z" fill="#fffdf6" stroke="#285c72" stroke-width="2.5" stroke-linejoin="round"/>
 <path d="M39 51H57V58H39Z" fill="#285c72"/>
 <path d="M35 62H61V73H35Z" fill="#4d9b9e"/>
 <path d="M48 29V40M43 34H53" stroke="#5d939b" stroke-width="2.5" stroke-linecap="round"/>
 <path d="M31 51V72M65 51V72" stroke="#e8bb68" stroke-width="3" stroke-linecap="round"/>
`,
	'cargo-ship': `
 <path d="M48 7Q69 19 72 35V74L63 87H33L24 74V35Q27 19 48 7Z" fill="#fffdf8" stroke="#fffdf8" stroke-width="9" stroke-linejoin="round"/>
 <path d="M48 9Q67 20 70 36V73L61 84H35L26 73V36Q29 20 48 9Z" fill="#244f68" stroke="#173f58" stroke-width="3" stroke-linejoin="round"/>
 <path d="M48 17 61 32H35Z" fill="#d3e8e9"/>
 <rect x="32" y="36" width="14" height="21" rx="1.5" fill="#e8bb68"/>
 <rect x="50" y="36" width="14" height="21" rx="1.5" fill="#63b6bb"/>
 <path d="M37 39V54M41 39V54M55 39V54M59 39V54" stroke="#173f58" stroke-width="2"/>
 <rect x="32" y="62" width="32" height="12" rx="2" fill="#fffdf6"/>
 <path d="M36 66H43M53 66H60" stroke="#244f68" stroke-width="3" stroke-linecap="round"/>
 <path d="M45 73H51V79H45Z" fill="#e8bb68"/>
`,
	speedboat: `
 <path d="M48 7Q65 18 71 40L70 76Q67 85 48 87Q29 85 26 76L25 40Q31 18 48 7Z" fill="#fffdf8" stroke="#fffdf8" stroke-width="9" stroke-linejoin="round"/>
 <path d="M48 10Q63 21 68 41L67 74Q63 82 48 84Q33 82 29 74L28 41Q33 21 48 10Z" fill="#fffdf6" stroke="#245d7a" stroke-width="3.5" stroke-linejoin="round"/>
 <path d="M48 17Q59 26 62 39H34Q37 26 48 17Z" fill="#8acbd1"/>
 <path d="M33 44Q48 37 63 44L60 58H36Z" fill="#193e57" stroke="#245d7a" stroke-width="2" stroke-linejoin="round"/>
 <path d="M48 41V55" stroke="#a9dfe4" stroke-width="2.5"/>
 <path d="M36 62H60V74Q48 78 36 74Z" fill="#208e9a"/>
 <path d="M33 71V75M63 71V75" stroke="#e8bb68" stroke-width="3" stroke-linecap="round"/>
`,
	airplane: `
 <path d="M48 7Q54 7 55 18L56 34 87 53V62L55 51 54 70 66 80V87L48 81 30 87V80L42 70 41 51 9 62V53L40 34 41 18Q42 7 48 7Z" fill="#fffdf8" stroke="#fffdf8" stroke-width="9" stroke-linejoin="round"/>
 <path d="M48 10Q52 10 52 19L54 36 84 54V58L53 48 51 71 63 81V83L48 78 33 83V81L45 71 43 48 12 58V54L42 36 44 19Q44 10 48 10Z" fill="#edf8fa" stroke="#284a69" stroke-width="3" stroke-linejoin="round"/>
 <path d="M44 24Q48 21 52 24V29H44Z" fill="#284a69"/>
 <path d="M19 53 40 43M56 43 77 53" stroke="#69aabc" stroke-width="4" stroke-linecap="round"/>
 <path d="M38 58V65M58 58V65" stroke="#284a69" stroke-width="5" stroke-linecap="round"/>
 <path d="M48 66V75" stroke="#e8bb68" stroke-width="3" stroke-linecap="round"/>
`,
	airport: `
 <path d="M11 11H43V84H11ZM57 32H83L88 48 80 55V83H60V55L52 48Z" fill="#fffdf8" stroke="#fffdf8" stroke-width="9" stroke-linejoin="round"/>
 <rect x="13" y="13" width="28" height="69" rx="3" fill="#284a69"/>
 <path d="M20 21H34M20 74H34" stroke="#d6e7e7" stroke-width="3"/>
 <path d="M27 28V35M27 44V51M27 60V67" stroke="#fffdf6" stroke-width="3" stroke-linecap="round"/>
 <path d="M63 49H77V81H63Z" fill="#c7e4e5" stroke="#284a69" stroke-width="3" stroke-linejoin="round"/>
 <path d="M56 34H84L81 49 70 55 59 49Z" fill="#69aabc" stroke="#284a69" stroke-width="3" stroke-linejoin="round"/>
 <path d="M63 38V47M77 38V47" stroke="#284a69" stroke-width="2.5"/>
 <path d="M70 32V22M63 23H77" stroke="#e8bb68" stroke-width="3.5" stroke-linecap="round"/>
 <path d="M58 84H83" stroke="#284a69" stroke-width="3" stroke-linecap="round"/>
`,
	bus: `
 <path d="M25 14H71Q82 14 82 26V73Q82 78 77 78V82H65V78H31V82H19V78Q14 78 14 73V26Q14 14 25 14Z" fill="#fffdf8" stroke="#fffdf8" stroke-width="9" stroke-linejoin="round"/>
 <rect x="16" y="16" width="64" height="62" rx="12" fill="#179b90" stroke="#123e50" stroke-width="3"/>
 <rect x="24" y="27" width="48" height="27" rx="5" fill="#173b54"/>
 <path d="M48 29V52M28 34 39 31" stroke="#8ed8d1" stroke-width="3" stroke-linecap="round"/>
 <path d="M24 60H72" stroke="#f4d188" stroke-width="4"/>
 <path d="M20 75V82H31V77M65 77V82H76V75" fill="#173b54" stroke="#173b54" stroke-width="3" stroke-linejoin="round"/>
 <path d="M26 67H32M64 67H70" stroke="#fffdf5" stroke-width="5" stroke-linecap="round"/>
 <path d="M37 20H59" stroke="#d5f1ef" stroke-width="3" stroke-linecap="round"/>
 `,
	hospital: `
 <path d="M12 43H29V17H67V43H84V82H12Z" fill="#fffdf8" stroke="#fffdf8" stroke-width="9" stroke-linejoin="round"/>
 <path d="M13 46H32V80H13ZM64 46H83V80H64Z" fill="#d8eee4" stroke="#146c68" stroke-width="3" stroke-linejoin="round"/>
 <path d="M29 18H67V80H29Z" fill="#168f80" stroke="#146c68" stroke-width="3" stroke-linejoin="round"/>
 <path d="M43 26H53V35H62V45H53V54H43V45H34V35H43Z" fill="#fffdf5"/>
 <path d="M41 64H55V81H41Z" fill="#0d5e5a"/>
 <path d="M19 54H25M19 66H25M71 54H77M71 66H77" stroke="#499d91" stroke-width="5"/>
 <path d="M27 83H69" stroke="#146c68" stroke-width="3" stroke-linecap="round"/>
 `,
	clinic: `
 <path d="M33 13H63V38L85 47V81H11V47L33 38Z" fill="#fffdf8" stroke="#fffdf8" stroke-width="9" stroke-linejoin="round"/>
 <path d="M15 47H81V80H15Z" fill="#d8eee4" stroke="#146c68" stroke-width="3" stroke-linejoin="round"/>
 <path d="M10 47 48 33 86 47V52H10Z" fill="#0d766f" stroke="#146c68" stroke-width="3" stroke-linejoin="round"/>
 <rect x="33" y="14" width="30" height="32" rx="5" fill="#168f80" stroke="#146c68" stroke-width="3"/>
 <path d="M44 20H52V26H58V34H52V40H44V34H38V26H44Z" fill="#fffdf5"/>
 <path d="M41 59H55V81H41Z" fill="#146c68"/>
 <path d="M24 61H32V71H24ZM64 61H72V71H64Z" fill="#66b9ad"/>
 <path d="M11 83H85" stroke="#146c68" stroke-width="3" stroke-linecap="round"/>
 `,
	school: `
 <path d="M10 42 48 13 86 42H80V82H16V42Z" fill="#fffdf8" stroke="#fffdf8" stroke-width="9" stroke-linejoin="round"/>
 <path d="M17 40H79V80H17Z" fill="#fff4d7" stroke="#183c59" stroke-width="3" stroke-linejoin="round"/>
 <path d="M9 43 48 13 87 43Z" fill="#183c59" stroke="#183c59" stroke-width="3" stroke-linejoin="round"/>
 <path d="M14 43H82" stroke="#eacb82" stroke-width="4" stroke-linecap="round"/>
 <path d="M35 28Q41 27 48 31Q55 27 61 28V39Q55 38 48 42Q41 38 35 39Z" fill="#fff9e7" stroke="#183c59" stroke-width="1.5" stroke-linejoin="round"/>
 <path d="M48 31V40" stroke="#eacb82" stroke-width="2.5"/>
 <path d="M24 53H33V65H24ZM63 53H72V65H63Z" fill="#557d8a"/>
 <path d="M41 57H55V81H41Z" fill="#183c59"/>
 <path d="M12 83H84" stroke="#183c59" stroke-width="3" stroke-linecap="round"/>
 `,
	shelter: `
 <path d="M8 31 59 25 70 33V39H63V82H16V39H8ZM76 14H90V40H84V82H77V40H72V14Z" fill="#fffdf8" stroke="#fffdf8" stroke-width="9" stroke-linejoin="round"/>
 <path d="M18 39H62V78H18Z" fill="#dceff3" stroke="#245d88" stroke-width="2.5"/>
 <path d="M10 30 59 25 69 32V39H10Z" fill="#367fac" stroke="#245d88" stroke-width="3" stroke-linejoin="round"/>
 <path d="M17 39V80M62 39V80" stroke="#245d88" stroke-width="5" stroke-linecap="round"/>
 <path d="M29 65H51M32 65V76M48 65V76" stroke="#245d88" stroke-width="4" stroke-linecap="round"/>
 <path d="M24 46H34V58H24Z" fill="#fffdf5"/>
 <path d="M80 39V81" stroke="#245d88" stroke-width="4" stroke-linecap="round"/>
 <rect x="72" y="14" width="18" height="27" rx="4" fill="#367fac" stroke="#245d88" stroke-width="3"/>
 <rect x="76" y="20" width="10" height="14" rx="2" fill="#fffdf5"/>
 <path d="M78 23H84V27H78Z" fill="#245d88"/>
 <path d="M78 34V36M84 34V36" stroke="#fffdf5" stroke-width="2"/>
 <path d="M12 83H85" stroke="#245d88" stroke-width="3" stroke-linecap="round"/>
 `
};

/** No fonts, gradients, filters or external resources; safe to rasterize into map symbols. */
export function getTransportSvg(kind: GraphicKind, size = 96): string {
	const dimension = Number.isFinite(size) ? Math.max(16, Math.min(1024, size)) : 96;
	const drawing = dimension <= 64 ? (markerArtwork[kind] ?? artwork[kind]) : artwork[kind];
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 96 96" fill="none" aria-hidden="true">${drawing}</svg>`;
}

export function getTransportDataUri(kind: GraphicKind, size = 96): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(getTransportSvg(kind, size))}`;
}

/**
 * Resolve generated files through SvelteKit so a configured base path or asset
 * host also works. Map consumers should rasterize at their intended symbol size;
 * the source PNG resolution is deliberately independent of marker dimensions.
 */
export function getTransportAssetUrl(
	kind: GraphicKind,
	size = 96,
	state: GraphicState = 'existing'
): string {
	const generated = getGeneratedTransportAsset(kind, state);
	return generated
		? asset(generated as Parameters<typeof asset>[0])
		: getTransportDataUri(kind, size);
}
