<script lang="ts">
	import { copy } from '$lib/canvas/copy';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import { MAX_MESSAGE_CHARS } from '$lib/shared/chat-limits';

	const store = useCanvas();
	let text = $state('');
	let field = $state<HTMLTextAreaElement>();
	const blocked = $derived(store.sendBlockedReason);
	const tooLong = $derived(text.trim().length > MAX_MESSAGE_CHARS);
	const placeholder = $derived(blocked ?? (store.target ? copy('composer.placeholder.reply') : copy('composer.placeholder')));

	function submit() {
		if (store.send(text)) text = '';
	}

	/** Used by the empty state's starter prompts (Task 10). */
	export function draft(value: string) {
		text = value;
		field?.focus();
	}

	// Enter or B on a card hands the cursor to the composer.
	$effect(() => {
		if (store.composerRequest > 0) field?.focus();
	});
</script>

<form
	class="composer"
	onsubmit={(e) => {
		e.preventDefault();
		submit();
	}}
>
	<div class="target" data-testid="composer-target" data-target-id={store.target ?? ''}>
		{copy('composer.target', { label: store.label(store.target) })}
		{#if store.target}
			<button type="button" class="link" onclick={() => store.newConversation()}>{copy('composer.newConversation')}</button>
		{/if}
	</div>
	<div class="row">
		<label class="sr-only" for="composer-input">{copy('composer.label')}</label>
		<textarea
			id="composer-input"
			bind:this={field}
			bind:value={text}
			rows="2"
			{placeholder}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
					e.preventDefault();
					submit();
				} else if (e.key === 'Escape') {
					// Back to the card the composer replies to, so the keyboard carries on from there.
					e.preventDefault();
					field?.blur();
					if (store.target) store.focusCard(store.target);
				}
			}}
		></textarea>
		<button type="submit" disabled={!text.trim() || !!blocked || tooLong}>Send</button>
	</div>
	{#if tooLong}<p class="note" role="status">{copy('composer.tooLong')}</p>{/if}
</form>

<style>
	.composer {
		padding: var(--space-3) var(--space-6) var(--space-4);
		border-top: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper-deep);
		color: var(--cy-ink);
	}
	.target {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		font: var(--text-xs);
		color: var(--cy-ink-soft);
		margin-bottom: var(--space-2);
	}
	.row {
		display: flex;
		gap: var(--space-2);
		max-width: 860px;
	}
	textarea {
		flex: 1;
		font: var(--text-sm);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper);
		color: var(--cy-ink);
		resize: none;
	}
	button[type='submit'] {
		min-width: 88px;
		border-radius: var(--radius-md);
		border: 0;
		background: var(--cy-gold);
		color: var(--cy-paper-deep);
		font-weight: 600;
		cursor: pointer;
	}
	button[type='submit']:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.note {
		margin: var(--space-2) 0 0;
		font: var(--text-xs);
		color: var(--cy-ink-soft);
	}
	.link {
		border: 0;
		background: none;
		color: inherit;
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}
</style>
