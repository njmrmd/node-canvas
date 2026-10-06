<!-- The undo toast: one level, for UNDO_MS; Cmd/Ctrl+Z does the same (Task 10). -->
<script lang="ts">
	import { copy } from '$lib/canvas/copy';
	import { useCanvas } from '$lib/canvas/store.svelte';

	const store = useCanvas();
	const message = $derived(
		store.undo
			? store.undo.removed.length === 1
				? copy('delete.undo')
				: copy('delete.undo.subtree', { n: store.undo.removed.length - 1 })
			: ''
	);
</script>

{#if store.undo}
	<div class="toast" role="status">
		<span>{message}</span>
		<button type="button" onclick={() => store.undoRemove()}>{copy('delete.undo.action')}</button>
	</div>
{/if}

<style>
	.toast {
		position: absolute;
		left: 50%;
		bottom: var(--space-4);
		transform: translateX(-50%);
		z-index: var(--z-toast);
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper-deep);
		color: var(--cy-ink);
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
		font: var(--text-sm);
	}
	button {
		font: inherit;
		color: var(--cy-gold);
		background: none;
		border: 0;
		text-decoration: underline;
		cursor: pointer;
	}
</style>
