<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { CanvasStore, provideCanvas } from '$lib/canvas/store.svelte';
	import type { NodeWire, ViewWire } from '$lib/canvas/node-wire';
	import { findModel, type ModelSpec } from '$lib/shared/models';
	import { copy } from '$lib/canvas/copy';
	import { formatDuration } from '$lib/canvas/format';
	import '$lib/styles/canvas-tokens.css';
	import Banner from './Banner.svelte';
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
	let composer = $state<ReturnType<typeof Composer>>();
	onMount(() => {
		store.start();
		return () => store.dispose();
	});
</script>

<div class="app canvas-surface">
	<TopBar models={data.models} email={data.email} />
	{#if !store.online}<Banner tone="info">{copy('offline.banner')}</Banner>{/if}
	{#if store.limitReached && store.rateLimit}
		<Banner tone="warning">{copy('limit.banner', { total: store.rateLimit.limit, time: formatDuration(store.rateLimit.resetSeconds) })}</Banner>
	{/if}
	{#if store.saveError}<Banner tone="danger">{store.saveError}</Banner>{/if}
	<Canvas onpick={(prompt) => composer?.draft(prompt)} />
	<Composer bind:this={composer} />
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: var(--cy-paper);
	}
</style>
