<script lang="ts">
	import { resolve } from '$app/paths';
	import { copy } from '$lib/canvas/copy';

	let { variant, onpick }: { variant: 'no-key' | 'empty'; onpick?: (prompt: string) => void } = $props();
	const starters = [copy('starter.1'), copy('starter.2'), copy('starter.3')];
</script>

<div class="empty" class:overlay={variant === 'empty'}>
	{#if variant === 'no-key'}
		<h1>{copy('provider.headline')}</h1>
		<p>{copy('provider.sub')}</p>
		<a class="cta" href={resolve('/keys')}>{copy('provider.cta')}</a>
	{:else}
		<h2>{copy('empty.headline')}</h2>
		<p>{copy('empty.sub')}</p>
		{#if onpick}
			<div class="starters">
				{#each starters as s (s)}<button type="button" onclick={() => onpick(s)}>{s}</button>{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.empty {
		max-width: 520px;
		margin: 15vh auto 0;
		padding: 0 var(--space-6);
		text-align: center;
		color: var(--cy-ink, var(--foreground));
	}
	.overlay {
		position: absolute;
		inset: 20% 0 auto;
		margin: 0 auto;
		pointer-events: none;
	}
	h1,
	h2 {
		margin: 0 0 var(--space-2);
	}
	p {
		margin: 0 0 var(--space-6);
		opacity: 0.8;
	}
	.starters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		justify-content: center;
		pointer-events: auto;
	}
	.starters button {
		font: var(--text-sm);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-full);
		border: 1px solid var(--cy-paper-edge);
		background: var(--cy-paper-lift);
		color: var(--cy-ink);
		cursor: pointer;
	}
	.cta {
		display: inline-block;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-sm);
		background: var(--foreground);
		color: var(--background);
		text-decoration: none;
	}
</style>
