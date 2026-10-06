import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addNode, appendText, completeNode, createGraph, newNodeId } from './graph';
import { fromWire, toWire } from './node-wire';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('node ids', () => {
	it('are always UUIDs (the nodes table keys on uuid)', () => {
		for (let i = 0; i < 20; i++) assert.match(newNodeId(), UUID);
	});
});

describe('node wire format', () => {
	it('round-trips a node, including its model', () => {
		const a = addNode(createGraph(), { prompt: 'hi', position: { x: 10, y: 20 }, model: 'claude-opus-5-5', now: 1000 });
		const done = completeNode(appendText(a.graph, a.node.id, 'hello'), a.node.id, { inputTokens: 1, outputTokens: 2 }, 2000);
		const wire = toWire(done.nodesById[a.node.id]);
		assert.equal(wire.model, 'claude-opus-5-5');
		assert.equal(wire.x, 10);
		assert.equal(wire.response, 'hello');
		const back = fromWire([wire]);
		assert.deepEqual(back.nodeIds, [a.node.id]);
		assert.deepEqual(back.nodesById[a.node.id], done.nodesById[a.node.id]);
	});

	it('orders nodes by creation time so parents precede children', () => {
		const root = addNode(createGraph(), { prompt: 'r', position: { x: 0, y: 0 }, now: 1 });
		const withChild = completeNode(appendText(root.graph, root.node.id, 'a'), root.node.id, null, 2);
		const child = addNode(withChild, { parentId: root.node.id, prompt: 'c', position: { x: 0, y: 0 }, now: 3 });
		const wires = child.graph.nodeIds.map((id) => toWire(child.graph.nodesById[id])).reverse();
		assert.deepEqual(fromWire(wires).nodeIds, [root.node.id, child.node.id]);
	});

	it('defaults a missing model to null for nodes created without one', () => {
		const a = addNode(createGraph(), { prompt: 'hi', position: { x: 0, y: 0 } });
		assert.equal(a.node.model, null);
	});
});
