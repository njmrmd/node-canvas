<!-- Fetches the canvas page by page, then hands the nodes to the app. §4.11: past 5 s, say so. -->
<script lang="ts">
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import { onMount } from 'svelte';
	import { apiFetch } from '$lib/canvas/api-client';
	import { copy } from '$lib/canvas/copy';
	import { loadAllNodes, type NodesPage } from '$lib/canvas/load';
	import type { NodeWire, ViewWire } from '$lib/canvas/node-wire';
	import type { ModelSpec } from '$lib/shared/models';
	import '$lib/styles/canvas-tokens.css';
	import CanvasApp from './CanvasApp.svelte';

	type Data = { view: ViewWire | null; email: string; models: readonly ModelSpec[]; defaultModelId: string };
	let { data }: { data: Data } = $props();

	const SLOW_MS = 5000;
	let nodes = $state.raw<NodeWire[] | null>(null);
	let failed = $state(false);
	let slow = $state(false);

	async function load() {
		failed = false;
		slow = false;
		const timer = setTimeout(() => (slow = true), SLOW_MS);
		try {
			nodes = await loadAllNodes((after) =>
				apiFetch<NodesPage>(after === null ? '/api/nodes' : `/api/nodes?after=${encodeURIComponent(after)}`)
			);
		} catch {
			failed = true;
		} finally {
			clearTimeout(timer);
		}
	}

	onMount(() => {
		void load();
	});
</script>

{#if nodes}
	<SvelteFlowProvider><CanvasApp {data} {nodes} /></SvelteFlowProvider>
{:else}
	<div class="loading canvas-surface" role="status">
		{#if failed || slow}<p>{copy('canvas.loadError')}</p>{/if}
		{#if failed}<button type="button" onclick={() => void load()}>{copy('canvas.loadRetry')}</button>{/if}
	</div>
{/if}

<style>
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		height: 100vh;
		background: var(--cy-paper);
		color: var(--cy-ink);
		font: var(--text-sm);
	}
	p {
		margin: 0;
	}
	button {
		font: inherit;
		color: var(--cy-ink);
		background: var(--cy-paper-lift);
		border: 1px solid var(--cy-paper-edge);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-3);
		cursor: pointer;
	}
</style>
