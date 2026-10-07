<!-- Spec §4's transcript view (the old app's "Linear view"): the root → target path as plain text. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { copy } from '$lib/canvas/copy';
	import { pathToRoot } from '$lib/canvas/graph';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import { paragraphs, transcriptText } from '$lib/canvas/transcript';

	const store = useCanvas();
	const path = $derived(store.target && store.graph.nodesById[store.target] ? pathToRoot(store.graph, store.target) : []);
	let panel = $state<HTMLElement>();
	let copied = $state<'copied' | 'failed' | null>(null);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		// Opened from a key or a button: take focus, and give it back on close.
		const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		panel?.focus();
		return () => {
			clearTimeout(copiedTimer);
			returnTo?.focus({ preventScroll: true });
		};
	});

	async function copyAll() {
		try {
			await navigator.clipboard.writeText(transcriptText(path));
			copied = 'copied';
		} catch {
			// A refused or missing clipboard (a denied permission, an insecure origin): say so, and log nothing.
			copied = 'failed';
		}
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = null), 2000);
	}
</script>

<section class="linear" aria-labelledby="linear-title" tabindex="-1" bind:this={panel}>
	<header>
		<h2 id="linear-title">{copy('linearview.heading')}</h2>
		<button type="button" disabled={path.length === 0} onclick={copyAll}
			>{copied === 'copied' ? copy('linearview.copied') : copied === 'failed' ? copy('linearview.copyFailed') : copy('linearview.copyAll')}</button
		>
		<button type="button" class="close" aria-label={copy('linearview.close')} onclick={() => (store.transcriptOpen = false)}>×</button>
		<span class="sr-only" role="status">{copied === 'copied' ? copy('linearview.copied') : copied === 'failed' ? copy('linearview.copyFailed') : ''}</span>
	</header>
	{#if path.length === 0}
		<p class="empty">{copy('linearview.empty')}</p>
	{:else}
		<ol>
			{#each path as node (node.id)}
				<li>
					<p class="you">{node.prompt}</p>
					<!-- One text node per paragraph, so a streaming token rewrites the last, not the whole reply. -->
					<p class="reply">{#each paragraphs(node.response) as chunk, i (i)}<span>{chunk}</span>{:else}…{/each}</p>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.linear {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(480px, 100%);
		z-index: var(--z-popover);
		overflow: auto;
		background: var(--cy-paper-deep);
		color: var(--cy-ink);
		border-left: 1px solid var(--cy-paper-edge);
		font: var(--text-sm);
	}
	.linear:focus {
		outline: none;
	}
	header {
		position: sticky;
		top: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		background: var(--cy-paper-deep);
		border-bottom: 1px solid var(--cy-paper-edge);
	}
	h2 {
		flex: 1;
		margin: 0;
		font: var(--text-base);
		font-weight: 600;
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
	ol {
		list-style: none;
		margin: 0;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	p {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.you {
		font-weight: var(--weight-user-text);
		margin-bottom: var(--space-2);
	}
	.reply {
		color: var(--cy-ink-soft);
	}
	.empty {
		padding: var(--space-4);
		color: var(--cy-ink-soft);
	}
</style>
