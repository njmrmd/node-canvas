<script lang="ts">
	import { resolve } from '$app/paths';
	import Shell from '$lib/components/Shell.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>node-canvas</title></svelte:head>
<Shell>
	<h1>A conversation is a graph, not a list.</h1>
	<p>Bring your own Anthropic key and branch any reply into a new direction.</p>
	{#if data.user}
		<!-- /keys does not exist until Task 9; resolve() cannot type-check an unknown route yet. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<p><a href={resolve('/canvas')}>Open the canvas</a> · <a href="/keys">Your key</a></p>
	{:else}
		<p><a href={resolve('/sign-up')}>Create an account</a> · <a href={resolve('/sign-in')}>Sign in</a></p>
	{/if}
</Shell>
