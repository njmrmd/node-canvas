<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="shell">
	<a class="wordmark" href={resolve('/')}>node-canvas</a>
	<main>{@render children()}</main>
</div>

<style>
	.shell {
		min-height: 100vh;
		display: grid;
		grid-template-rows: auto 1fr;
		padding: var(--space-6) var(--space-8);
	}
	.wordmark {
		font-weight: 600;
		text-decoration: none;
	}
	main {
		width: 100%;
		max-width: 440px;
		margin: var(--space-8) auto;
	}
</style>
