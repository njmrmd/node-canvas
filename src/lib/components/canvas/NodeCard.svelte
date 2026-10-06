<script lang="ts">
	import { Handle, NodeResizeControl, Position, type NodeProps } from '@xyflow/svelte';
	import { copy } from '$lib/canvas/copy';
	import { presentError } from '$lib/canvas/errors';
	import { canBranchFrom, canContinue, canRegenerate, canRetry, CONTINUE_PROMPT, type ConversationNode } from '$lib/canvas/graph';
	import { NODE_HEIGHT_MAX, NODE_HEIGHT_MIN, NODE_WIDTH_MAX, NODE_WIDTH_MIN } from '$lib/canvas/layout';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import Markdown from './Markdown.svelte';

	let { id, width, height }: NodeProps = $props();
	const store = useCanvas();
	const node = $derived(store.graph.nodesById[id]);
	const isTarget = $derived(store.target === id);
	const queued = $derived(store.queuePosition(id));
	const failure = $derived(node?.status === 'error' && node.error ? presentError(node.error) : null);
	const status = $derived.by(() => {
		if (!node) return '';
		if (queued !== null) return copy('node.status.queued', { n: queued });
		if (node.status === 'streaming' && node.response === '') return copy('node.status.thinking');
		if (node.status === 'interrupted') return copy('node.status.stopped');
		if (failure) return failure.category;
		return '';
	});
	// graph.ts decides when Retry and Continue apply. The Regenerate button is offered only on a stopped card
	// (beside Continue when it has text) or a failed one that cannot be retried; R on the keyboard (Task 10) can
	// regenerate any finished card. Only a failed card pays for the child lookup Retry needs.
	const retryable = $derived(node?.status === 'error' && canRetry(store.graph, id));
	const continuable = $derived(!!node && canContinue(node));
	const regenerable = $derived(
		!!node && (node.status === 'interrupted' || (node.status === 'error' && !retryable)) && canRegenerate(store.graph, id)
	);
	const blocked = $derived(store.streamBlockedReason);
	/** A resized card has a fixed height — except while its body is collapsed, when it is one line. */
	const sized = $derived(height !== undefined && !node?.bodyCollapsed);
	const children = $derived(store.childCount(id));
	const hiddenCount = $derived(node?.collapsed ? store.hiddenBelow(id) : 0);
	const oneLine = $derived(node?.bodyCollapsed ? summaryLine(node) : '');
	/** Whether this resize changed the card's size: a click on the corner without a drag does not, and must not pin it. */
	let resizeChanged = false;

	/** The collapsed body's one line: the reply's first line, else the failure, else "Thinking", else the prompt. */
	function summaryLine(n: ConversationNode): string {
		const line = firstLine(n.response);
		if (line) return line;
		if (n.error) return presentError(n.error).message;
		if (n.status === 'streaming') return copy('node.status.thinking');
		return n.prompt;
	}

	/** Scans line by line, so a long reply is not split in full. */
	function firstLine(text: string): string {
		for (let start = 0; start < text.length; ) {
			const end = text.indexOf('\n', start);
			const line = text.slice(start, end === -1 ? text.length : end).trim();
			if (line) return line;
			if (end === -1) break;
			start = end + 1;
		}
		return '';
	}

	// A streaming body follows its newest line unless the reader scrolled up.
	let body = $state<HTMLDivElement>();
	let stick = true;
	$effect(() => {
		void node?.response;
		if (body && stick && node?.status === 'streaming') body.scrollTop = body.scrollHeight;
	});
</script>

{#if node}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (the cards are a roving-tabindex composite: keyboard focus moves between them, spec §4) -->
	<article
		class="card"
		class:target={isTarget}
		class:sized
		class:dim={store.dimmed(id)}
		data-node-id={id}
		data-parent-id={node.parentId ?? ''}
		data-status={node.status}
		tabindex={store.rovingId === id ? 0 : -1}
		aria-current={isTarget ? 'true' : undefined}
		onfocusin={() => store.noteFocus(id)}
		style:width="{width ?? store.width}px"
		style:height={sized ? `${height}px` : undefined}
	>
		<Handle type="target" position={Position.Top} isConnectable={false} />
		<header>
			{#if node.prompt === CONTINUE_PROMPT}
				<h3 class="prompt continued">{copy('node.continuedFrom')}</h3>
			{:else}
				<h3 class="prompt" title={node.prompt}>{node.prompt}</h3>
			{/if}
			{#if status}<span class="status">{status}</span>{/if}
			{#if node.status === 'streaming'}
				<button class="nodrag" type="button" onclick={() => store.stop(id)}>Stop</button>
			{/if}
			<button
				class="nodrag"
				type="button"
				aria-label="Branch"
				title={canBranchFrom(node)
					? undefined
					: copy(node.status === 'error' || node.status === 'interrupted' ? 'branch.failed' : 'branch.disabled')}
				disabled={!canBranchFrom(node)}
				onclick={() => store.branch(id)}>{copy('node.action.branch')}</button
			>
			<button
				class="nodrag icon"
				type="button"
				aria-label={copy(node.bodyCollapsed ? 'node.action.expandBody' : 'node.action.collapseBody')}
				title={copy(node.bodyCollapsed ? 'node.action.expandBody' : 'node.action.collapseBody')}
				onclick={() => store.toggleBodyCollapsed(id)}><span aria-hidden="true">{node.bodyCollapsed ? '▤' : '—'}</span></button
			>
			{#if children > 0}
				<button
					class="nodrag icon"
					type="button"
					aria-expanded={!node.collapsed}
					aria-label={node.collapsed ? copy('node.action.expand', { n: hiddenCount }) : copy('node.action.collapse')}
					title={node.collapsed ? copy('node.action.expand', { n: hiddenCount }) : copy('node.action.collapse')}
					onclick={() => store.toggleCollapsed(id)}><span aria-hidden="true">{node.collapsed ? '▸' : '▾'}</span></button
				>
			{/if}
			<button
				class="nodrag icon"
				type="button"
				aria-label={copy('node.action.delete')}
				title={copy('node.action.delete')}
				onclick={() => store.remove(id)}><span aria-hidden="true">✕</span></button
			>
		</header>
		{#if node.bodyCollapsed}
			<p class="oneline" data-testid="card-oneline" title={oneLine}>{oneLine}</p>
		{:else}
			{#if node.thinking}
				<details class="thinking nodrag nowheel">
					<summary>{copy('node.thinking')}</summary>
					<p>{node.thinking}</p>
				</details>
			{/if}
			<div
				class="body nowheel"
				data-testid="card-body"
				bind:this={body}
				onscroll={() => {
					if (body) stick = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
				}}
			>
				{#if node.response}
					<Markdown text={node.response} streaming={node.status === 'streaming'} />
				{:else if node.status === 'streaming'}
					<span class="pending">…</span>
				{/if}
				{#if failure}<p class="error" role="status">{failure.message}</p>{/if}
			</div>
		{/if}
		{#if retryable || continuable || regenerable}
			<footer class="actions">
				{#if retryable}
					<button class="nodrag primary" type="button" disabled={!!blocked} title={blocked ?? undefined} onclick={() => store.retry(id)}
						>{copy('node.action.retry')}</button
					>
				{/if}
				{#if continuable}
					<button
						class="nodrag primary"
						type="button"
						disabled={!!blocked}
						title={blocked ?? undefined}
						onclick={(e) => {
							// A double click is one request: its second click would make a second card and spend a second message.
							if (e.detail <= 1) store.continueReply(id);
						}}>{copy('node.action.continue')}</button
					>
				{/if}
				{#if regenerable}
					<button
						class="nodrag"
						type="button"
						disabled={!!blocked}
						title={blocked ?? undefined}
						onclick={(e) => {
							// A double click is one request: its second click would make a second card and spend a second message.
							if (e.detail <= 1) store.regenerate(id);
						}}>{copy('node.action.regenerate')}</button
					>
				{/if}
			</footer>
		{/if}
		{#if node.collapsed && hiddenCount > 0}
			<button class="nodrag chip" type="button" onclick={() => store.toggleCollapsed(id)}>{copy('node.hiddenCount', { n: hiddenCount })}</button>
		{/if}
		{#if !node.bodyCollapsed}
			<NodeResizeControl
				minWidth={NODE_WIDTH_MIN}
				maxWidth={NODE_WIDTH_MAX}
				minHeight={NODE_HEIGHT_MIN}
				maxHeight={NODE_HEIGHT_MAX}
				class="resize"
				aria-label={copy('node.action.resize')}
				title={copy('node.action.resize')}
				onResizeStart={() => (resizeChanged = false)}
				onResize={() => (resizeChanged = true)}
				onResizeEnd={(_event, params) => {
					// Svelte Flow calls onResize only when the size changes; a click on the corner ends without one.
					if (!resizeChanged) return;
					store.resized(id, { width: params.width, height: params.height });
				}}
			/>
		{/if}
		<Handle type="source" position={Position.Bottom} isConnectable={false} />
	</article>
{/if}

<style>
	.card {
		display: flex;
		flex-direction: column;
		background: var(--cy-paper-lift);
		color: var(--cy-ink);
		border: 1px solid var(--cy-paper-edge);
		border-radius: var(--radius-md);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
		font: var(--text-sm);
		transition: opacity var(--dur-base) var(--ease-out);
	}
	.card.dim:not(:hover):not(:focus-within) {
		opacity: 0.45;
	}
	.card.sized {
		overflow: hidden;
	}
	.card.target {
		border-color: var(--cy-gold);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--cy-gold) 40%, transparent);
	}
	.card:focus-visible {
		outline: var(--focus-ring-width) solid var(--cy-gold);
		outline-offset: var(--focus-ring-offset);
	}
	header {
		display: flex;
		flex-wrap: wrap; /* a narrow card wraps its buttons rather than pushing Delete out of it */
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--cy-paper-edge);
	}
	.prompt {
		flex: 1;
		margin: 0;
		font: inherit;
		font-weight: var(--weight-user-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.continued {
		font-style: italic;
		color: var(--cy-ink-soft);
	}
	.status {
		font: var(--text-xs);
		color: var(--cy-ink-soft);
	}
	button {
		font: var(--text-xs);
		min-height: 28px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper);
		color: var(--cy-ink);
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.icon {
		padding: 0 var(--space-2);
	}
	.primary {
		background: var(--cy-gold);
		color: var(--cy-paper-deep);
		border-color: transparent;
	}
	.thinking {
		padding: var(--space-2) var(--space-3) 0;
		color: var(--cy-ink-soft);
		font: var(--text-xs);
	}
	.thinking p {
		white-space: pre-wrap;
		max-height: 160px;
		overflow: auto;
	}
	.body {
		padding: var(--space-3);
		max-height: 360px;
		overflow: auto;
		user-select: text;
	}
	.card.sized .body {
		flex: 1;
		min-height: 0;
		max-height: none;
	}
	.oneline {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--cy-ink-soft);
	}
	.error {
		margin: var(--space-2) 0 0;
		color: var(--danger);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		padding: 0 var(--space-3) var(--space-3);
	}
	.chip {
		align-self: flex-start;
		margin: 0 var(--space-3) var(--space-3);
		border-radius: var(--radius-full);
	}
	.card :global(.svelte-flow__resize-control.resize) {
		width: 14px;
		height: 14px;
		border: 0;
		border-radius: 3px;
		background: var(--cy-gold);
		opacity: 0;
		transition: opacity var(--dur-fast) var(--ease-out);
	}
	.card:hover :global(.svelte-flow__resize-control.resize),
	.card:focus-within :global(.svelte-flow__resize-control.resize) {
		opacity: 1;
	}
</style>
