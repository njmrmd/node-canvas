<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { copy } from '$lib/canvas/copy';
	import { presentError } from '$lib/canvas/errors';
	import { canBranchFrom, canContinue, canRegenerate, canRetry, CONTINUE_PROMPT } from '$lib/canvas/graph';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import Markdown from './Markdown.svelte';

	let { id }: NodeProps = $props();
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
	// When each applies is graph.ts's call. Only a failed card pays for the child lookup Retry needs.
	const retryable = $derived(node?.status === 'error' && canRetry(store.graph, id));
	const continuable = $derived(!!node && canContinue(node));
	const regenerable = $derived(
		!!node && (node.status === 'interrupted' || (node.status === 'error' && !retryable)) && canRegenerate(store.graph, id)
	);
	const blocked = $derived(store.streamBlockedReason);

	// A streaming body follows its newest line unless the reader scrolled up.
	let body = $state<HTMLDivElement>();
	let stick = true;
	$effect(() => {
		void node?.response;
		if (body && stick && node?.status === 'streaming') body.scrollTop = body.scrollHeight;
	});
</script>

{#if node}
	<article
		class="card"
		class:target={isTarget}
		data-node-id={id}
		data-parent-id={node.parentId ?? ''}
		data-status={node.status}
		style:width="{store.width}px"
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
				aria-label={copy('node.action.delete')}
				title={copy('node.action.delete')}
				onclick={() => store.remove(id)}><span aria-hidden="true">✕</span></button
			>
		</header>
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
		{#if retryable || continuable || regenerable}
			<footer class="actions">
				{#if retryable}
					<button class="nodrag primary" type="button" disabled={!!blocked} title={blocked ?? undefined} onclick={() => store.retry(id)}
						>{copy('node.action.retry')}</button
					>
				{/if}
				{#if continuable}
					<button class="nodrag primary" type="button" disabled={!!blocked} title={blocked ?? undefined} onclick={() => store.continueReply(id)}
						>{copy('node.action.continue')}</button
					>
				{/if}
				{#if regenerable}
					<button class="nodrag" type="button" disabled={!!blocked} title={blocked ?? undefined} onclick={() => store.regenerate(id)}
						>{copy('node.action.regenerate')}</button
					>
				{/if}
			</footer>
		{/if}
		<Handle type="source" position={Position.Bottom} isConnectable={false} />
	</article>
{/if}

<style>
	.card {
		background: var(--cy-paper-lift);
		color: var(--cy-ink);
		border: 1px solid var(--cy-paper-edge);
		border-radius: var(--radius-md);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
		font: var(--text-sm);
	}
	.card.target {
		border-color: var(--cy-gold);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--cy-gold) 40%, transparent);
	}
	header {
		display: flex;
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
	.error {
		margin: var(--space-2) 0 0;
		color: var(--danger);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		padding: 0 var(--space-3) var(--space-3);
	}
</style>
