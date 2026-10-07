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

<div role="status">
	{#if store.undo}
		<div class="toast">
			<span>{message}</span>
			<button type="button" onclick={() => store.undoRemove()}>{copy('delete.undo.action')}</button>
		</div>
	{/if}
</div>

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
		box-shadow: var(--shadow-2);
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
