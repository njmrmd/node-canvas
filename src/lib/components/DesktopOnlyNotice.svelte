<!--
	Spec §2: desktop only. Below 900 px the full notice replaces the page. On the landing page (Plan 4) a
	compact note sits above the page instead, because that is the one page a stranger opens from a shared
	link, often on a phone.
-->
<script lang="ts">
	import { copy } from '$lib/canvas/copy';

	let { compact = false }: { compact?: boolean } = $props();
</script>

{#if compact}
	<p class="desktop-note" role="note"><strong>{copy('desktop.title')}.</strong> {copy('desktop.body')}</p>
{:else}
	<main class="desktop-only" aria-labelledby="desktop-only-title">
		<h1 id="desktop-only-title">{copy('desktop.title')}</h1>
		<p>{copy('desktop.body')}</p>
	</main>
{/if}

<style>
	.desktop-only,
	.desktop-note {
		display: none;
	}
	/* Keep in step with +layout.svelte: the page hides under this same width. */
	@media (width < 900px) {
		.desktop-only {
			display: flex;
			flex-direction: column;
			justify-content: center;
			gap: var(--space-3);
			min-height: 100vh;
			padding: var(--space-6);
			font-family: var(--font-sans);
			background: var(--background);
			color: var(--foreground);
		}
		.desktop-note {
			display: block;
			margin: 0;
			padding: var(--space-3) var(--space-6);
			font-family: var(--font-sans);
			font-size: var(--text-sm);
			line-height: 1.5;
			background: var(--surface-subtle);
			color: var(--foreground);
			border-bottom: 1px solid var(--hairline);
		}
	}
	.desktop-only h1 {
		margin: 0;
		font-size: var(--text-2xl);
	}
	.desktop-only p {
		margin: 0;
		font-size: var(--text-base);
		color: var(--muted);
	}
</style>
