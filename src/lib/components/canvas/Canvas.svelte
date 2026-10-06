<script lang="ts">
	import { Background, BackgroundVariant, Controls, MiniMap, SvelteFlow, useSvelteFlow, type Edge, type Node } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { untrack } from 'svelte';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import { panToLowerThird } from '$lib/canvas/viewport';
	import EmptyState from './EmptyState.svelte';
	import NodeCard from './NodeCard.svelte';
	import UndoToast from './UndoToast.svelte';

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

	// The flow measures only the cards it draws. Keep each card's last height while it is hidden or deleted, so a
	// subtree reopened by the chip, a send or Undo is laid out with real sizes rather than the 160 px default.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache read by layout calls only, never rendered
	const lastHeights = new Map<string, number>();
	/** Copies the current height of each of these cards the flow has measured into the cache. */
	function remember(ids: Iterable<string>) {
		for (const id of ids) {
			const h = flow.getInternalNode(id)?.measured.height;
			if (h) lastHeights.set(id, h);
		}
	}
	// The whole cache, not only the graph's ids: Undo lays a restored branch out before the branch is back in the graph.
	store.measure = () => {
		remember(store.graph.nodeIds);
		return new Map(lastHeights);
	};
	store.visibleCenter = () => {
		const r = container!.getBoundingClientRect();
		return flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height * 0.4 });
	};

	// Graph → flow nodes, only when layout or structure changed. Tokens never pass through here.
	$effect(() => {
		void store.layoutVersion;
		untrack(() => {
			const graph = store.graph;
			const { hidden } = store.structure;
			remember(nodes.map((n) => n.id)); // the last moment a card about to be hidden or deleted is still drawn
			const prev = new Map(nodes.map((n) => [n.id, n]));
			nodes = graph.nodeIds
				.filter((id) => !hidden.has(id))
				.map((id) => {
					const node = graph.nodesById[id];
					const width = node.size?.width;
					const height = node.size && !node.bodyCollapsed ? node.size.height : undefined;
					const p = prev.get(id);
					if (p && p.position.x === node.position.x && p.position.y === node.position.y && p.width === width && p.height === height) return p;
					return { ...(p ?? { id, type: 'card', data: {} }), position: node.position, width, height };
				});
		});
	});

	// Edges: on structure changes, and when the target or the focus path changes — still never per token.
	$effect(() => {
		void store.layoutVersion;
		const path = store.pathIds;
		const dim = store.focusPath && path !== null;
		untrack(() => {
			const graph = store.graph;
			const { hidden } = store.structure;
			edges = graph.nodeIds
				.filter((id) => !hidden.has(id) && graph.nodesById[id].parentId)
				.map((id) => {
					const source = graph.nodesById[id].parentId!;
					const onPath = dim && path!.has(id) && path!.has(source);
					return { id: `e-${id}`, source, target: id, class: !dim ? undefined : onPath ? 'on-path' : 'off-path' };
				});
		});
	});

	// A reopened subtree is laid out with the heights the cache has, and a card never drawn in this session has none.
	// Once its drawn cards are measured, the store lays it out once more: one pass per reopen, never per token. Cards
	// off screen are not drawn under onlyRenderVisibleElements, so the wait gives up after 30 frames.
	$effect(() => {
		const id = store.relayoutPending;
		if (!id) return;
		let frames = 0;
		let frame = requestAnimationFrame(function check() {
			if (measuredBelow(id) || ++frames >= 30) store.relayoutReopened();
			else frame = requestAnimationFrame(check);
		});
		return () => cancelAnimationFrame(frame);
	});

	/** Whether every drawn card below `id` has been measured. A card a nested collapse still hides is not drawn. */
	function measuredBelow(id: string): boolean {
		const { children, hidden } = store.structure;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a lookup local to this call, never rendered
		const seen = new Set<string>();
		const queue = [...(children.get(id) ?? [])];
		while (queue.length > 0) {
			const next = queue.pop()!;
			if (hidden.has(next) || seen.has(next)) continue; // seen again only in a corrupted, cyclic graph
			seen.add(next);
			if (!flow.getInternalNode(next)?.measured.height) return false;
			queue.push(...(children.get(next) ?? []));
		}
		return true;
	}

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
	<UndoToast />
</div>

<style>
	.flow {
		position: relative;
		flex: 1;
		min-height: 0;
	}
	.flow :global(.svelte-flow__edge.off-path) {
		opacity: 0.35;
		transition: opacity var(--dur-base) var(--ease-out);
	}
	.flow :global(.svelte-flow__edge.on-path .svelte-flow__edge-path) {
		stroke: var(--cy-gold);
		stroke-width: 2;
	}
</style>
