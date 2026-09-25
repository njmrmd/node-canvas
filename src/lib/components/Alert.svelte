<script lang="ts">
	import type { Snippet } from 'svelte';

	let { tone, title, children }: { tone: 'danger' | 'ok' | 'warning'; title?: string; children?: Snippet } =
		$props();
</script>

<div class="alert {tone}" role={tone === 'danger' ? 'alert' : 'status'}>
	{#if title}<p class="title">{title}</p>{/if}
	{#if children}{@render children()}{/if}
</div>

<style>
	.alert {
		padding: var(--space-3) var(--space-4);
		border-left: 3px solid;
		border-radius: var(--radius-sm);
		margin-bottom: var(--space-4);
		font-size: var(--text-sm);
	}
	.title {
		margin: 0 0 var(--space-1);
		font-weight: 600;
	}
	.danger {
		background: var(--danger-surface);
		border-color: var(--danger-border);
		color: var(--danger);
	}
	.warning {
		background: var(--warning-surface);
		border-color: var(--warning-border);
		color: var(--warning);
	}
	.ok {
		background: var(--success-surface);
		border-color: var(--success-border);
		color: var(--success);
	}
</style>
