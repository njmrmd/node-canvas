<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { CanvasStore, provideCanvas } from '$lib/canvas/store.svelte';
	import type { NodeWire, ViewWire } from '$lib/canvas/node-wire';
	import { findModel, type ModelSpec } from '$lib/shared/models';
	import '$lib/styles/canvas-tokens.css';
	import Canvas from './Canvas.svelte';
	import Composer from './Composer.svelte';
	import TopBar from './TopBar.svelte';

	type Data = { nodes: NodeWire[]; view: ViewWire | null; email: string; models: readonly ModelSpec[]; defaultModelId: string };
	let { data }: { data: Data } = $props();

	function initialModel(): string {
		try {
			const saved = localStorage.getItem('nc:model');
			if (saved && findModel(saved)) return saved;
		} catch {
			// storage unavailable: use the default
		}
		return data.defaultModelId;
	}

	// Seeded once from the load; the store owns the canvas from then on.
	const store = untrack(() => new CanvasStore({ nodes: data.nodes, view: data.view, model: initialModel() }));
	provideCanvas(store);
	onMount(() => {
		store.start();
		return () => store.dispose();
	});
</script>

<div class="app canvas-surface">
	<TopBar models={data.models} email={data.email} />
	<Canvas />
	<Composer />
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: var(--cy-paper);
	}
</style>
