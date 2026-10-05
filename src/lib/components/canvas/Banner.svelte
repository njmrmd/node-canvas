<script lang="ts">
	import type { Snippet } from 'svelte';

	let { tone, children }: { tone: 'info' | 'warning' | 'danger'; children: Snippet } = $props();
</script>

<div class="banner {tone}" role="status">{@render children()}</div>

<style>
	.banner {
		padding: var(--space-2) var(--space-6);
		font: var(--text-xs);
		border-bottom: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper-deep);
		color: var(--cy-ink-soft);
	}
	.warning {
		color: var(--warning);
	}
	.danger {
		color: var(--danger);
	}
</style>
