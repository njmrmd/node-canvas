<script lang="ts">
	import { resolve } from '$app/paths';
	import { copy } from '$lib/canvas/copy';

	let { variant }: { variant: 'no-key' | 'empty' } = $props();
</script>

<div class="empty" class:overlay={variant === 'empty'}>
	{#if variant === 'no-key'}
		<h1>{copy('provider.headline')}</h1>
		<p>{copy('provider.sub')}</p>
		<a class="cta" href={resolve('/keys')}>{copy('provider.cta')}</a>
	{:else}
		<h2>{copy('empty.headline')}</h2>
		<p>{copy('empty.sub')}</p>
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
	.cta {
		display: inline-block;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-sm);
		background: var(--foreground);
		color: var(--background);
		text-decoration: none;
	}
</style>
