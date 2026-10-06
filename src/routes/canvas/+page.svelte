<script lang="ts">
	import CanvasLoader from '$lib/components/canvas/CanvasLoader.svelte';
	import EmptyState from '$lib/components/canvas/EmptyState.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Canvas · node-canvas</title></svelte:head>

{#if data.hasKey}
	<CanvasLoader {data} />
{:else}
	<EmptyState variant="no-key" />
{/if}
