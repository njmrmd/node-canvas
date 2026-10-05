import type { ConversationGraph, ConversationNode, NodeError, NodeStatus } from './graph';

/** One node as it travels between the browser and `PUT /api/nodes` / the canvas load. */
export type NodeWire = {
	id: string;
	parentId: string | null;
	prompt: string;
	response: string;
	thinking: string;
	status: NodeStatus;
	error: NodeError | null;
	usage: { inputTokens: number; outputTokens: number } | null;
	model: string | null;
	x: number;
	y: number;
	positionMode: 'auto' | 'manual';
	width: number | null;
	height: number | null;
	collapsed: boolean;
	bodyCollapsed: boolean;
	/** Epoch milliseconds. */
	createdAt: number;
	updatedAt: number;
};

export type ViewWire = {
	viewport: { x: number; y: number; zoom: number };
	targetNodeId: string | null;
};

export function toWire(node: ConversationNode): NodeWire {
	return {
		id: node.id,
		parentId: node.parentId,
		prompt: node.prompt,
		response: node.response,
		thinking: node.thinking,
		status: node.status,
		error: node.error,
		usage: node.usage,
		model: node.model,
		x: node.position.x,
		y: node.position.y,
		positionMode: node.positionMode,
		width: node.size?.width ?? null,
		height: node.size?.height ?? null,
		collapsed: node.collapsed,
		bodyCollapsed: node.bodyCollapsed,
		createdAt: node.createdAt,
		updatedAt: node.updatedAt
	};
}

/** Rebuilds a graph, creation-ordered so every parent precedes its children. */
export function fromWire(wires: readonly NodeWire[]): ConversationGraph {
	const sorted = [...wires].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
	const nodesById: Record<string, ConversationNode> = {};
	for (const w of sorted) {
		nodesById[w.id] = {
			id: w.id,
			parentId: w.parentId,
			prompt: w.prompt,
			response: w.response,
			thinking: w.thinking,
			status: w.status,
			error: w.error,
			position: { x: w.x, y: w.y },
			positionMode: w.positionMode,
			size: w.width !== null && w.height !== null ? { width: w.width, height: w.height } : null,
			collapsed: w.collapsed,
			bodyCollapsed: w.bodyCollapsed,
			usage: w.usage,
			model: w.model,
			createdAt: w.createdAt,
			updatedAt: w.updatedAt
		};
	}
	return { nodesById, nodeIds: sorted.map((w) => w.id) };
}
