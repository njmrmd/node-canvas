<script lang="ts">
	import { Background, BackgroundVariant, Controls, MiniMap, SvelteFlow, useSvelteFlow, type Edge, type Node } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { untrack } from 'svelte';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import { panToLowerThird } from '$lib/canvas/viewport';
	import EmptyState from './EmptyState.svelte';
	import NodeCard from './NodeCard.svelte';

	let { onpick }: { onpick?: (prompt: string) => void } = $props();
	const store = useCanvas();
	const flow = useSvelteFlow();
	const nodeTypes = { card: NodeCard };
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let container = $state<HTMLDivElement>();
	/** Nodes auto-follow has already framed once. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping read only in rAF, never rendered
	const framed = new Set<string>();

	store.measure = () =>
		new Map(
			store.graph.nodeIds.flatMap((id) => {
				const h = flow.getInternalNode(id)?.measured.height;
				return h ? [[id, h] as const] : [];
			})
		);
	store.visibleCenter = () => {
		const r = container!.getBoundingClientRect();
		return flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height * 0.4 });
	};

	// Graph → flow nodes, only when layout or structure changed. Tokens never pass through here.
	$effect(() => {
		void store.layoutVersion;
		untrack(() => {
			const graph = store.graph;
			const prev = new Map(nodes.map((n) => [n.id, n]));
			nodes = graph.nodeIds.map((id) => {
				const { position } = graph.nodesById[id];
				const p = prev.get(id);
				if (p && p.position.x === position.x && p.position.y === position.y) return p;
				return p ? { ...p, position } : { id, type: 'card', position, data: {} };
			});
			edges = graph.nodeIds
				.filter((id) => graph.nodesById[id].parentId)
				.map((id) => ({ id: `e-${id}`, source: graph.nodesById[id].parentId!, target: id }));
		});
	});

	// Frame a new node in the lower third once measured, then keep its growing bottom on screen.
	$effect(() => {
		const id = store.following;
		const node = id ? store.graph.nodesById[id] : null;
		if (!id || !node) return;
		void node.response;
		requestAnimationFrame(() => follow(id));
	});

	function follow(id: string) {
		const internal = flow.getInternalNode(id);
		const width = internal?.measured.width;
		const height = internal?.measured.height;
		if (!internal || !width || !height || !container || store.following !== id) return;
		const rect = { ...internal.internals.positionAbsolute, width, height };
		const size = { width: container.clientWidth, height: container.clientHeight };
		const vp = flow.getViewport();
		if (!framed.has(id)) {
			framed.add(id);
			void flow.setViewport(panToLowerThird(vp, rect, size), { duration: 250 });
			return;
		}
		const overflow = (rect.y + rect.height) * vp.zoom + vp.y - (size.height - 24);
		if (overflow > 0) void flow.setViewport({ ...vp, y: vp.y - overflow });
	}
</script>

<div class="flow" bind:this={container}>
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		initialViewport={store.viewport}
		nodesConnectable={false}
		elementsSelectable={false}
		deleteKey={null}
		zoomOnDoubleClick={false}
		minZoom={0.25}
		maxZoom={2}
		onlyRenderVisibleElements
		onmovestart={(event) => {
			if (event) store.following = null;
		}}
		onmoveend={(_event, viewport) => store.setViewport(viewport)}
		onnodedragstart={() => (store.following = null)}
		onnodedragstop={({ targetNode }) => {
			if (targetNode) store.moved(targetNode.id, targetNode.position);
		}}
	>
		<Background variant={BackgroundVariant.Lines} gap={24} patternColor="var(--cy-paper-edge)" bgColor="var(--cy-paper)" />
		<Controls showLock={false} />
		<MiniMap pannable zoomable bgColor="var(--cy-paper-deep)" />
	</SvelteFlow>
	{#if store.graph.nodeIds.length === 0}<EmptyState variant="empty" {onpick} />{/if}
</div>

<style>
	.flow {
		position: relative;
		flex: 1;
		min-height: 0;
	}
</style>
