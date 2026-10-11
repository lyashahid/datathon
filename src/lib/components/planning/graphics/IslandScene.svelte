<script lang="ts">
	import { getTransportDataUri } from './transportGraphics';
	let { label = 'An island connected by buses, ferries and walkable routes' }: { label?: string } =
		$props();
</script>

<svg
	class="island-scene"
	viewBox="0 0 340 160"
	role="img"
	aria-label={label}
	xmlns="http://www.w3.org/2000/svg"
>
	<path d="M0 123Q53 112 101 122T203 121T340 116V160H0Z" fill="#e4f2ef" />
	<path d="M21 101 187 43 310 101 148 151Z" fill="#d6e5ce" />
	<path d="M21 101V106L148 157V151ZM148 151V157L310 107V101Z" fill="#bfd3b7" />
	<path d="M41 102 181 55 282 101 147 138Z" fill="#edf2df" />
	<path
		d="M62 109 179 69 262 106M123 134 196 108 115 68"
		fill="none"
		stroke="#c0d1b7"
		stroke-width="9"
		stroke-linejoin="round"
	/>
	<path
		d="M63 108 179 68 261 105M123 134 195 108 115 68"
		fill="none"
		stroke="#fbfcf0"
		stroke-width="6"
		stroke-linejoin="round"
	/>
	<path
		d="M65 108 178 70 255 104"
		fill="none"
		stroke="#43a78b"
		stroke-width="2"
		stroke-dasharray="4 4"
	/>
	<path
		d="M183 143Q228 148 290 128"
		fill="none"
		stroke="#6bafc0"
		stroke-width="2"
		stroke-dasharray="4 4"
	/>
	<path d="M189 126 197 132 232 121 224 115Z" fill="#b9cab0" />
	<path d="M193 130V138L231 126V120Z" fill="#90b49a" />
	<image href={getTransportDataUri('hospital')} x="48" y="30" width="68" height="68" />
	<image href={getTransportDataUri('school')} x="159" y="4" width="76" height="76" />
	<image href={getTransportDataUri('terminal')} x="205" y="54" width="67" height="67" />
	<image href={getTransportDataUri('bus')} x="107" y="73" width="58" height="58" />
	<image href={getTransportDataUri('ferry')} x="224" y="100" width="65" height="65" />
	<g fill="#8db586"
		><ellipse cx="47" cy="81" rx="7" ry="4" /><ellipse cx="147" cy="39" rx="6" ry="4" /><ellipse
			cx="275"
			cy="86"
			rx="6"
			ry="4"
		/><ellipse cx="73" cy="128" rx="5" ry="3" /></g
	>
	<g fill="#eef6e7" stroke="#6ba185" stroke-width="1.4"
		><circle cx="74" cy="106" r="4" /><circle cx="175" cy="71" r="4" /><circle
			cx="249"
			cy="102"
			r="4"
		/></g
	>
</svg>

<style>
	.island-scene {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
	}
</style>
