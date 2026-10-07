<!-- Every canvas shortcut, from the same table the key handler reads. Esc or Close shuts it. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { copy } from '$lib/canvas/copy';
	import { SHORTCUT_ROWS } from '$lib/canvas/shortcuts';
	import { useCanvas } from '$lib/canvas/store.svelte';

	const store = useCanvas();
	let dialog = $state<HTMLDialogElement>();
	onMount(() => dialog?.showModal());
</script>

<dialog bind:this={dialog} aria-labelledby="shortcuts-title" onclose={() => (store.shortcutsOpen = false)}>
	<h2 id="shortcuts-title">{copy('shortcuts.title')}</h2>
	<dl>
		{#each SHORTCUT_ROWS as row (row.keys)}
			<div class="row">
				<dt><kbd>{row.keys}</kbd></dt>
				<dd>{row.does}</dd>
			</div>
		{/each}
	</dl>
	<button type="button" onclick={() => dialog?.close()}>{copy('shortcuts.close')}</button>
</dialog>

<style>
	dialog {
		width: min(520px, calc(100vw - 2 * var(--space-6)));
		padding: var(--space-6);
		border: 1px solid var(--cy-paper-edge);
		border-radius: var(--radius-lg);
		background: var(--cy-paper-deep);
		color: var(--cy-ink);
		font: var(--text-sm);
	}
	dialog::backdrop {
		background: var(--scrim);
	}
	h2 {
		margin: 0 0 var(--space-4);
		font: var(--text-lg);
	}
	dl {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3) var(--space-4);
		margin: 0 0 var(--space-4);
	}
	dt,
	dd {
		margin: 0;
	}
	kbd {
		font: var(--text-code);
		color: var(--cy-gold);
	}
	dd {
		color: var(--cy-ink-soft);
	}
	button {
		font: var(--text-xs);
		min-height: var(--control-height-sm);
		padding: 0 var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper);
		color: var(--cy-ink);
		cursor: pointer;
	}
</style>
