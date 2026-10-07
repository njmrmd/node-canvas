import { graphStructure, type ConversationGraph } from './graph';

/** The keyboard's moves between cards (the old app's tree moves, not spatial ones). */
export type FocusMove = 'parent' | 'child' | 'prev' | 'next' | 'first' | 'last';

/**
 * Where a focus move lands, over the cards that are drawn. Arrows walk the tree: up to the parent,
 * down to the first child, left and right between siblings (roots are siblings); none of them wrap.
 * Home is the first root, End the newest leaf. From nothing, or from a card that is gone or hidden,
 * any move starts at the first root (End still finds the newest leaf). Null when there is nowhere to go.
 */
export function moveFocus(graph: ConversationGraph, from: string | null, move: FocusMove): string | null {
	const { children, hidden } = graphStructure(graph);
	const roots = children.get(null) ?? [];
	if (move === 'last') return newestLeaf(graph, children, hidden);
	if (move === 'first') return roots[0] ?? null;
	const node = from ? graph.nodesById[from] : undefined;
	if (!node || hidden.has(node.id)) return roots[0] ?? null;
	if (move === 'parent') return node.parentId;
	if (move === 'child') return node.collapsed ? null : (children.get(node.id)?.[0] ?? null);
	const siblings = children.get(node.parentId) ?? [];
	const next = siblings.indexOf(node.id) + (move === 'next' ? 1 : -1);
	return next >= 0 && next < siblings.length ? siblings[next] : null;
}

/** The drawn card with no drawn children that was created last. A collapsed card counts as a leaf. */
function newestLeaf(
	graph: ConversationGraph,
	children: ReadonlyMap<string | null, readonly string[]>,
	hidden: ReadonlySet<string>
): string | null {
	let best: string | null = null;
	for (const id of graph.nodeIds) {
		if (hidden.has(id)) continue;
		const node = graph.nodesById[id];
		const isLeaf = node.collapsed || (children.get(id)?.length ?? 0) === 0;
		if (isLeaf && (best === null || node.createdAt >= graph.nodesById[best].createdAt)) best = id;
	}
	return best;
}
