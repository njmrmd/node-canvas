<!-- Renders parsed blocks with text interpolation only: no {@html}, ever. -->
<script lang="ts">
	import { parseMarkdown, type Inline } from '$lib/canvas/markdown';

	let { text, streaming = false }: { text: string; streaming?: boolean } = $props();
	const blocks = $derived(parseMarkdown(text));
	const caretInline = $derived(streaming && blocks.at(-1)?.kind === 'paragraph');
</script>

{#snippet inline(parts: Inline[])}{#each parts as part, i (i)}{#if part.kind === 'strong'}<strong>{part.text}</strong>{:else if part.kind === 'code'}<code>{part.text}</code>{:else}{part.text}{/if}{/each}{/snippet}

<div class="md">
	{#each blocks as block, b (b)}
		{#if block.kind === 'paragraph'}
			<p>{@render inline(block.inline)}{#if caretInline && b === blocks.length - 1}<span class="caret" aria-hidden="true"></span>{/if}</p>
		{:else if block.kind === 'list' && block.ordered}
			<ol>{#each block.items as item, i (i)}<li>{@render inline(item)}</li>{/each}</ol>
		{:else if block.kind === 'list'}
			<ul>{#each block.items as item, i (i)}<li>{@render inline(item)}</li>{/each}</ul>
		{:else}
			<pre><code>{block.text}</code></pre>
		{/if}
	{/each}
	{#if streaming && !caretInline}<span class="caret" aria-hidden="true"></span>{/if}
</div>

<style>
	.md {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	p,
	ol,
	ul,
	pre {
		margin: 0;
	}
	ol,
	ul {
		padding-left: 20px;
	}
	ol {
		list-style-type: decimal;
	}
	ul {
		list-style-type: disc;
	}
	code {
		font: var(--text-code);
		background: color-mix(in srgb, currentColor 10%, transparent);
		border-radius: var(--radius-sm);
		padding: 0 4px;
	}
	pre {
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, currentColor 8%, transparent);
		overflow-x: auto;
	}
	pre code {
		background: none;
		padding: 0;
	}
	.caret {
		display: inline-block;
		width: 0.5em;
		height: 1em;
		margin-left: 2px;
		vertical-align: text-bottom;
		background: currentColor;
		animation: blink 1s steps(2) infinite;
	}
	@keyframes blink {
		to {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.caret {
			animation: none;
		}
	}
</style>
