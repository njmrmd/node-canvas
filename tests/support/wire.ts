import { randomUUID } from 'node:crypto';
import type { NodeWire } from '../../src/lib/canvas/node-wire';

export function wire(overrides: Partial<NodeWire> = {}): NodeWire {
	return {
		id: randomUUID(),
		parentId: null,
		prompt: 'hi',
		response: 'hello',
		thinking: '',
		status: 'complete',
		error: null,
		usage: { inputTokens: 1, outputTokens: 2 },
		model: 'claude-opus-5-5',
		x: 0,
		y: 0,
		positionMode: 'auto',
		width: null,
		height: null,
		collapsed: false,
		bodyCollapsed: false,
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		...overrides
	};
}
