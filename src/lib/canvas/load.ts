import type { NodeWire } from './node-wire';

/** One page of `GET /api/nodes`. */
export type NodesPage = { nodes: NodeWire[]; next: string | null };

/** No real canvas needs this many 3 MiB pages; a server that never says "done" must not hang the tab. */
export const MAX_PAGES = 1000;

/** The whole canvas, page by page, in creation order (parents before children). */
export async function loadAllNodes(fetchPage: (after: string | null) => Promise<NodesPage>): Promise<NodeWire[]> {
	const nodes: NodeWire[] = [];
	let after: string | null = null;
	for (let i = 0; i < MAX_PAGES; i++) {
		const page = await fetchPage(after);
		nodes.push(...page.nodes);
		if (page.next === null) return nodes;
		after = page.next;
	}
	throw new Error('The canvas has more pages than the loader allows.');
}
