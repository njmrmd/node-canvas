<!-- The product, drawn: one card, one fork, two cards. Decorative — the headline and lede say it in words. -->
<script lang="ts">
	import { CARDS, cardShapes, EDGES, HANDLE, VIEWBOX, type Card } from '$lib/landing/drawing';

	const [parent, ...children] = CARDS;
</script>

{#snippet card(c: Card)}
	{@const s = cardShapes(c)}
	<rect {...s.frame} class="frame" />
	<rect {...s.prompt} class="prompt" />
	{#each s.replies as r, i (i)}<rect {...r} class="reply" />{/each}
{/snippet}

<svg viewBox="0 0 {VIEWBOX.width} {VIEWBOX.height}" aria-hidden="true" focusable="false">
	{#each EDGES as d (d)}<path {d} class="edge" />{/each}
	{@render card(parent)}
	<circle cx={HANDLE.cx} cy={HANDLE.cy} r={HANDLE.r} class="handle" />
	<path d={HANDLE.plus} class="plus" />
	{#each children as c (c.x)}{@render card(c)}{/each}
</svg>

<style>
	svg {
		display: block;
		width: 100%;
		height: auto;
	}
	/* The edges are what make three cards read as one graph, so they are drawn in --muted, never faint. */
	.edge,
	.plus {
		fill: none;
		stroke-width: 1.5;
		stroke-linecap: round;
	}
	.edge {
		stroke: var(--muted);
	}
	.plus {
		stroke: var(--foreground);
	}
	.frame {
		fill: var(--background);
		stroke: var(--hairline);
		stroke-width: 1;
	}
	.prompt {
		fill: var(--foreground);
		fill-opacity: 0.8;
	}
	.reply {
		fill: var(--muted);
		fill-opacity: 0.45;
	}
	.handle {
		fill: var(--background);
		stroke: var(--foreground);
		stroke-width: 1.5;
	}
</style>
