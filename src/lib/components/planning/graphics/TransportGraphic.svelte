<script lang="ts">
	import {
		getTransportAssetUrl,
		getTransportDataUri,
		GRAPHIC_LABELS,
		GRAPHIC_STATE_LABELS,
		type GraphicKind,
		type GraphicState
	} from './transportGraphics';

	let {
		kind,
		size = 96,
		label,
		compact = false,
		state: graphicState = 'existing'
	}: {
		kind: GraphicKind;
		size?: number | string;
		label?: string;
		compact?: boolean;
		state?: GraphicState;
	} = $props();
	const dimension = $derived(
		typeof size === 'number'
			? `${Number.isFinite(size) ? Math.max(16, Math.min(256, size)) : 96}px`
			: size
	);
	// Generated miniatures and vector fallbacks share a bounded display box.
	const artworkSize = $derived(typeof size === 'number' && size <= 48 ? 64 : 96);
	const artworkUrl = $derived(getTransportAssetUrl(kind, artworkSize, graphicState));
	let failedUrl = $state<string | null>(null);
	const imageUrl = $derived(
		failedUrl === artworkUrl ? getTransportDataUri(kind, artworkSize) : artworkUrl
	);
</script>

<span
	class="transport-graphic"
	class:compact
	class:paused={graphicState === 'paused'}
	data-state={graphicState}
	style:width={dimension}
	style:height={dimension}
	role="img"
	aria-label={label ??
		`${GRAPHIC_LABELS[kind]}${graphicState === 'existing' ? '' : `, ${GRAPHIC_STATE_LABELS[graphicState]}`}`}
>
	<img
		src={imageUrl}
		alt=""
		width="96"
		height="96"
		draggable="false"
		decoding="async"
		onerror={() => (failedUrl = artworkUrl)}
	/>
</span>

<style>
	.transport-graphic {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		line-height: 0;
		user-select: none;
	}
	.transport-graphic img {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
		object-fit: contain;
	}
	.compact img {
		transform: scale(1.08);
	}
	.paused img {
		filter: grayscale(1);
		opacity: 0.5;
	}
</style>
