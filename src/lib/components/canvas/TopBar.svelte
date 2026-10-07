<script lang="ts">
	import { resolve } from '$app/paths';
	import { useSvelteFlow } from '@xyflow/svelte';
	import { copy } from '$lib/canvas/copy';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import type { ModelSpec } from '$lib/shared/models';

	let { models, email }: { models: readonly ModelSpec[]; email: string } = $props();
	const store = useCanvas();
	const flow = useSvelteFlow();
</script>

<header class="topbar">
	<a class="wordmark" href={resolve('/')}>node-canvas</a>
	<label class="model">
		Model
		<select value={store.model} onchange={(e) => store.setModel(e.currentTarget.value)}>
			{#each models as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
		</select>
	</label>
	{#if store.rateLimit}
		<span class="chip">{copy('limit.chip', { used: store.rateLimit.limit - store.rateLimit.remaining, total: store.rateLimit.limit })}</span>
	{/if}
	<div class="spacer"></div>
	<button type="button" onclick={() => store.tidy()}>Tidy</button>
	<button type="button" onclick={() => flow.fitView({ duration: 250 })}>Fit</button>
	<button type="button" aria-pressed={store.focusPath} onclick={() => store.toggleFocusPath()}>{copy('focuspath.toggle')}</button>
	<button type="button" aria-pressed={store.transcriptOpen} onclick={() => (store.transcriptOpen = !store.transcriptOpen)}
		>{copy('linearview.heading')}</button
	>
	<button type="button" aria-label={copy('shortcuts.title')} title={copy('shortcuts.title')} onclick={() => (store.shortcutsOpen = true)}>?</button>
	<a class="account" href={resolve('/keys')} title={email}>Account</a>
</header>

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-6);
		border-bottom: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper-deep);
		color: var(--cy-ink);
		font: var(--text-sm);
	}
	.wordmark {
		font-weight: var(--weight-strong);
		color: inherit;
		text-decoration: none;
	}
	.model {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		color: var(--cy-ink-soft);
	}
	select,
	button {
		font: inherit;
		color: var(--cy-ink);
		background: var(--cy-paper);
		border: 1px solid var(--cy-paper-edge);
		border-radius: var(--radius-sm);
		padding: 4px var(--space-3);
	}
	button {
		cursor: pointer;
	}
	button[aria-pressed='true'] {
		border-color: var(--cy-gold);
		color: var(--cy-gold);
	}
	.chip {
		font: var(--text-xs);
		color: var(--cy-ink-soft);
	}
	.spacer {
		flex: 1;
	}
	.account {
		color: inherit;
	}
</style>
