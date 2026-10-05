<script lang="ts">
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import CanvasApp from '$lib/components/canvas/CanvasApp.svelte';
	import EmptyState from '$lib/components/canvas/EmptyState.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Canvas · node-canvas</title></svelte:head>

{#if data.hasKey}
	<SvelteFlowProvider><CanvasApp {data} /></SvelteFlowProvider>
{:else}
	<EmptyState variant="no-key" />
{/if}
