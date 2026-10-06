import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	addNode,
	adoptPositions,
	appendText,
	canContinue,
	canRegenerate,
	canRetry,
	completeNode,
	createGraph,
	expandPath,
	extractBranch,
	failNode,
	graphStructure,
	interruptNode,
	placeNode,
	restoreBranch,
	setCollapsed,
	startStreaming,
	visibleGraph,
	type ConversationGraph
} from './graph';

let clock = 1;
/** A node with an answer, so it can be branched from. Creation times increase in call order. */
function answered(graph: ConversationGraph, id: string, parentId: string | null = null): ConversationGraph {
	const now = clock++;
	const added = addNode(graph, { id, prompt: `${id}?`, parentId, position: { x: 0, y: 0 }, now });
	return completeNode(appendText(startStreaming(added.graph, id, now), id, `${id}!`, now), id, null, now);
}

/** r → a → b, r → c, and a second root s. */
function tree(): ConversationGraph {
	let g = answered(createGraph(), 'r');
	g = answered(g, 'a', 'r');
	g = answered(g, 'b', 'a');
	g = answered(g, 'c', 'r');
	return answered(g, 's');
}

describe('graph structure', () => {
	it('lists children in creation order, roots under null', () => {
		const { children } = graphStructure(tree());
		assert.deepEqual(children.get(null), ['r', 's']);
		assert.deepEqual(children.get('r'), ['a', 'c']);
		assert.deepEqual(children.get('a'), ['b']);
	});

	it('hides everything under a collapsed node, but not the node itself', () => {
		const g = setCollapsed(tree(), 'r', true);
		assert.deepEqual([...graphStructure(g).hidden].sort(), ['a', 'b', 'c']);
		assert.deepEqual(visibleGraph(g).nodeIds, ['r', 's']);
	});

	it('hides a nested collapsed subtree once, under the outer collapse', () => {
		const g = setCollapsed(setCollapsed(tree(), 'a', true), 'r', true);
		assert.deepEqual([...graphStructure(g).hidden].sort(), ['a', 'b', 'c']);
	});

	it('copies laid-out positions back into the full graph', () => {
		const g = setCollapsed(tree(), 'a', true);
		const laidOut = placeNode(visibleGraph(g), 'c', { x: 500, y: 40 });
		const merged = adoptPositions(g, laidOut);
		assert.deepEqual(merged.nodesById.c.position, { x: 500, y: 40 });
		assert.equal(merged.nodesById.b, g.nodesById.b, 'a hidden node is left alone');
	});

	it('expands every collapsed node on the way to a node', () => {
		const g = expandPath(setCollapsed(setCollapsed(tree(), 'r', true), 'a', true), 'b');
		assert.equal(g.nodesById.r.collapsed, false);
		assert.equal(g.nodesById.a.collapsed, false);
	});
});

describe('extract and restore a branch', () => {
	it('takes a node and its subtree out, parents first, and puts them back exactly', () => {
		const g = tree();
		const { graph, removed } = extractBranch(g, 'a');
		assert.deepEqual(removed.map((n) => n.id), ['a', 'b']);
		assert.deepEqual(graph.nodeIds, ['r', 'c', 's']);
		const back = restoreBranch(graph, removed);
		assert.deepEqual(back.nodeIds, g.nodeIds);
		assert.equal(back.nodesById.b, g.nodesById.b);
	});

	it('refuses to restore under a parent that is gone, or over a node already there', () => {
		const { graph, removed } = extractBranch(tree(), 'a');
		assert.throws(() => restoreBranch(extractBranch(graph, 'r').graph, removed), /gone/);
		assert.throws(() => restoreBranch(tree(), removed), /already/);
	});
});

describe('retry, continue and regenerate', () => {
	it('retries only a failed card with no replies', () => {
		let g = answered(createGraph(), 'r');
		g = failNode(startStreaming(addNode(g, { id: 'x', prompt: 'x', parentId: 'r', position: { x: 0, y: 0 } }).graph, 'x'), 'x', {
			code: 'provider_unavailable',
			message: 'no'
		});
		assert.equal(canRetry(g, 'x'), true);
		assert.equal(canRetry(g, 'r'), false, 'a complete card is not retried');
		g = appendText(g, 'x', 'partial');
		g = addNode(g, { id: 'y', prompt: 'y', parentId: 'x', position: { x: 0, y: 0 } }).graph;
		assert.equal(canRetry(g, 'x'), false, 'its replies answered the text it has');
	});

	it('continues only a stopped card that has text', () => {
		const g = answered(createGraph(), 'r');
		const stopped = interruptNode(g, 'r');
		assert.equal(canContinue(stopped.nodesById.r), true);
		assert.equal(canContinue(g.nodesById.r), false);
		assert.equal(canContinue(interruptNode(startStreaming(g, 'r'), 'r').nodesById.r), false, 'no text, nothing to continue');
	});

	it('regenerates any card that is not still streaming', () => {
		const g = tree();
		assert.equal(canRegenerate(g, 'b'), true);
		assert.equal(canRegenerate(startStreaming(g, 'b'), 'b'), false);
		assert.equal(canRegenerate(g, 'missing'), false);
	});
});
