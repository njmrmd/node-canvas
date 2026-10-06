<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		ControlButton,
		Controls,
		MiniMap,
		SvelteFlow,
		useSvelteFlow,
		type Edge,
		type Node
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { untrack } from 'svelte';
	import { copy } from '$lib/canvas/copy';
	import { moveFocus } from '$lib/canvas/navigation';
	import { resolveShortcut, type Command } from '$lib/canvas/shortcuts';
	import { useCanvas } from '$lib/canvas/store.svelte';
	import { focusOn, panToLowerThird, rectInView, zoomAt, ZOOM_STEP_FACTOR, type Viewport } from '$lib/canvas/viewport';
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
	// Once its drawn cards are measured, the store lays it out once more: one pass per reopen, never per token. Svelte
	// Flow renders a card it has never measured once, wherever it sits, so this normally completes; the 30-frame cap
	// is only a safety net.
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

	// Keyboard focus: show the card (off screen it is not even rendered), then give it DOM focus.
	$effect(() => {
		void store.focusRequest;
		const id = untrack(() => store.focusedId);
		if (id) untrack(() => void reveal(id));
	});

	async function reveal(id: string) {
		const node = store.graph.nodesById[id];
		if (!node || !container) return;
		const internal = flow.getInternalNode(id);
		const rect = {
			x: node.position.x,
			y: node.position.y,
			width: internal?.measured.width ?? node.size?.width ?? store.width,
			height: internal?.measured.height ?? node.size?.height ?? 160
		};
		const vp = flow.getViewport();
		const size = { width: container.clientWidth, height: container.clientHeight };
		if (!rectInView(vp, rect, size)) await flow.setViewport(focusOn(rect, size, vp.zoom, 0.5));
		// A card scrolled into view mounts a frame or two later.
		for (let frame = 0; frame < 20; frame++) {
			const el = container.querySelector<HTMLElement>(`article[data-node-id="${id}"]`);
			if (el) {
				el.focus({ preventScroll: true });
				return;
			}
			await new Promise((resolve) => requestAnimationFrame(resolve));
		}
	}

	/** Zooms around the focused card's centre, else the canvas centre (the old app's anchor). */
	function zoomTo(zoom: number) {
		const vp = flow.getViewport();
		void flow.setViewport(zoomAt(vp, zoom, zoomAnchor(vp)), { duration: 150 });
	}

	function zoomAnchor(vp: Viewport) {
		const internal = store.focusedId ? flow.getInternalNode(store.focusedId) : undefined;
		if (internal?.measured.width && internal.measured.height) {
			const { x, y } = internal.internals.positionAbsolute;
			return { x: (x + internal.measured.width / 2) * vp.zoom + vp.x, y: (y + internal.measured.height / 2) * vp.zoom + vp.y };
		}
		return { x: container!.clientWidth / 2, y: container!.clientHeight / 2 };
	}

	/** The commands a held key may repeat. */
	const REPEATS: readonly Command['kind'][] = ['focus', 'nudge', 'resize', 'zoomIn', 'zoomOut'];

	/** Every canvas shortcut comes through here (spec §8: one window handler). */
	function onKey(event: KeyboardEvent) {
		if (event.defaultPrevented || store.shortcutsOpen) return; // the sheet is modal; its own Esc closes it
		const el = event.target instanceof HTMLElement ? event.target : null;
		const typing = !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
		if (store.transcriptOpen && event.key === 'Escape' && !typing) {
			event.preventDefault();
			store.transcriptOpen = false;
			return;
		}
		// Inside the linear view the keys scroll it and work its buttons; only Esc (above) belongs to the canvas there.
		if (el?.closest('.linear')) return;
		const cardId = el?.matches('article[data-node-id]') ? (el.dataset.nodeId ?? null) : null;
		const command = resolveShortcut(event, { typing, onCard: cardId !== null });
		if (!command) return;
		event.preventDefault();
		// A held key repeats. A held Delete would walk up the tree (focus moves to the parent after each delete),
		// so only moves, nudges, resizes and zoom steps act on a repeat.
		if (event.repeat && !REPEATS.includes(command.kind)) return;
		run(command, cardId);
	}

	function run(command: Command, cardId: string | null) {
		const id = cardId ?? '';
		switch (command.kind) {
			case 'focus': {
				const to = moveFocus(store.graph, cardId ?? store.focusedId ?? store.target, command.move);
				if (to) store.focusCard(to);
				return;
			}
			case 'bind':
				return store.bindComposer(id);
			case 'branch':
				return store.branchFromCard(id);
			case 'regenerate':
				return store.regenerate(id);
			case 'toggleCollapsed':
				return store.toggleCollapsed(id);
			case 'toggleBody':
				return store.toggleBodyCollapsed(id);
			case 'resize':
				return store.resizeBy(id, command.dw, command.dh);
			case 'nudge':
				return store.nudge(id, command.dx, command.dy);
			case 'delete':
				return store.remove(id);
			case 'stop':
				return store.stop(id);
			case 'undo':
				return store.undoRemove();
			case 'zoomIn':
				return zoomTo(flow.getViewport().zoom * ZOOM_STEP_FACTOR);
			case 'zoomOut':
				return zoomTo(flow.getViewport().zoom / ZOOM_STEP_FACTOR);
			case 'zoom100':
				return zoomTo(1);
			case 'fit':
				void flow.fitView({ duration: 250 });
				return;
			case 'tidy':
				return store.tidy();
			case 'focusPath':
				return store.toggleFocusPath();
			case 'transcript':
				store.transcriptOpen = !store.transcriptOpen;
				return;
			case 'shortcuts':
				store.shortcutsOpen = true;
				return;
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="flow" bind:this={container}>
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		initialViewport={store.viewport}
		nodesConnectable={false}
		elementsSelectable={false}
		nodesFocusable={false}
		edgesFocusable={false}
		disableKeyboardA11y
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
		<Controls showLock={false}>
			<ControlButton onclick={() => zoomTo(1)} title={copy('zoom.reset')} aria-label={copy('zoom.reset')}>1:1</ControlButton>
		</Controls>
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
	.flow :global(.svelte-flow__edge) {
		transition: opacity var(--dur-base) var(--ease-out);
	}
	.flow :global(.svelte-flow__edge.off-path) {
		opacity: 0.35;
	}
	.flow :global(.svelte-flow__edge.on-path .svelte-flow__edge-path) {
		stroke: var(--cy-gold);
		stroke-width: 2;
	}
</style>
