<!--
	Community feedback on one facility, shown beside (never merged into) its technical score.
-->
<script lang="ts">
	import { MessageSquare, ThumbsDown, ThumbsUp } from '@lucide/svelte';
	import { FEEDBACK_DISCLAIMER, FEEDBACK_LABELS, FEEDBACK_RULES } from '#lib/config/feedback.ts';
	import { getFeedbackState } from '#lib/stores/feedback.svelte.ts';
	import type { FeedbackKind } from '#lib/types/feedback.ts';
	import type { IconComponent } from '#lib/types/ui.ts';

	let { featureId, technicalScore }: { featureId: string; technicalScore: number | null } =
		$props();

	const feedback = getFeedbackState();
	const summary = $derived(feedback.summaryFor(featureId));
	const comments = $derived(
		feedback
			.feedbackFor(featureId)
			.filter((f) => f.text)
			.toReversed()
			.slice(0, 3)
	);
	const ICONS: Record<FeedbackKind, IconComponent> = {
		support: ThumbsUp,
		concern: ThumbsDown,
		comment: MessageSquare
	};

	let text = $state('');
	let error = $state<string | null>(null);

	async function submit(kind: FeedbackKind) {
		error = null;
		const result = await feedback.addFeedback({ featureId, kind, text });
		if (!result.ok) error = result.reason;
		else text = '';
	}
</script>

<section class="flex flex-col gap-2">
	<h3 class="hud-label">Community feedback</h3>
	<div class="grid grid-cols-2 gap-2">
		<div class="rounded border border-hud-line p-2">
			<p class="text-[10px] text-hud-muted">Technical analysis (facility score)</p>
			<p class="font-mono text-base font-semibold tabular-nums">
				{technicalScore ?? '--'}<span class="text-[10px] text-hud-faint">/100</span>
			</p>
		</div>
		<div class="rounded border border-hud-line p-2">
			<p class="text-[10px] text-hud-muted">Feedback</p>
			<p class="font-mono text-base font-semibold tabular-nums">
				{#if summary.supportShare === null}
					<span class="text-hud-faint">--</span>
				{:else}
					{Math.round(summary.supportShare * 100)}%<span class="text-[10px] text-hud-faint">
						support</span
					>
				{/if}
			</p>
			<p class="text-[10px] text-hud-faint tabular-nums">
				{summary.support} support · {summary.concern} concern · {summary.comment} comment
			</p>
		</div>
	</div>

	<textarea
		bind:value={text}
		rows="2"
		maxlength={FEEDBACK_RULES.descriptionMaxLength}
		placeholder="Optional note (required for a comment)"
		aria-label="Feedback note"
		class="resize-none rounded border border-hud-line bg-hud-raised px-2 py-1.5 text-xs text-hud-text select-text placeholder:text-hud-faint focus:border-hud-accent/60 focus:outline-none"
	></textarea>
	<div class="grid grid-cols-3 gap-1">
		{#each ['support', 'concern', 'comment'] as const as kind (kind)}
			{@const Icon = ICONS[kind]}
			<button
				type="button"
				class="flex items-center justify-center gap-1 rounded border border-hud-line py-1 text-[11px] hover:bg-hud-hover"
				onclick={() => submit(kind)}
			>
				<Icon class="size-3.5" />
				{FEEDBACK_LABELS[kind]}
			</button>
		{/each}
	</div>
	{#if error}<p class="text-[11px] text-hud-warn" role="alert">{error}</p>{/if}
	{#if comments.length}
		<ul class="flex flex-col gap-1">
			{#each comments as c (c.id)}
				<li class="rounded bg-hud-raised px-2 py-1 text-[11px] select-text">
					<span class="text-[10px] font-medium text-hud-muted">{FEEDBACK_LABELS[c.kind]}:</span>
					{c.text}
				</li>
			{/each}
		</ul>
	{/if}
	<p class="text-[10px] leading-relaxed text-hud-faint">{FEEDBACK_DISCLAIMER}</p>
</section>
