import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addNode, appendText, completeNode, createGraph, setCollapsed, startStreaming, type ConversationGraph } from './graph';
import { moveFocus } from './navigation';

let clock = 1;
function answered(graph: ConversationGraph, id: string, parentId: string | null = null): ConversationGraph {
	const now = clock++;
	const added = addNode(graph, { id, prompt: id, parentId, position: { x: 0, y: 0 }, now });
	return completeNode(appendText(startStreaming(added.graph, id, now), id, id, now), id, null, now);
}

/** r → a → b, r → c (created after b), and a second root s (created last). */
function tree(): ConversationGraph {
	let g = answered(createGraph(), 'r');
	g = answered(g, 'a', 'r');
	g = answered(g, 'b', 'a');
	g = answered(g, 'c', 'r');
	return answered(g, 's');
}

describe('moveFocus', () => {
	it('moves to the parent, the first child, and the siblings either side', () => {
		const g = tree();
		assert.equal(moveFocus(g, 'b', 'parent'), 'a');
		assert.equal(moveFocus(g, 'r', 'child'), 'a');
		assert.equal(moveFocus(g, 'a', 'next'), 'c');
		assert.equal(moveFocus(g, 'c', 'prev'), 'a');
		assert.equal(moveFocus(g, 'r', 'next'), 's', 'roots are siblings');
	});

	it('stays put at the ends instead of wrapping', () => {
		const g = tree();
		assert.equal(moveFocus(g, 'r', 'parent'), null);
		assert.equal(moveFocus(g, 'b', 'child'), null);
		assert.equal(moveFocus(g, 'a', 'prev'), null);
		assert.equal(moveFocus(g, 's', 'next'), null);
	});

	it('goes to the first root on Home and to the newest leaf on End', () => {
		const g = tree();
		assert.equal(moveFocus(g, 'b', 'first'), 'r');
		assert.equal(moveFocus(g, 'r', 'last'), 's');
		assert.equal(moveFocus(answered(g, 'd', 'b'), 'r', 'last'), 'd');
	});

	it('never lands on a hidden card', () => {
		const g = setCollapsed(tree(), 'a', true);
		assert.equal(moveFocus(g, 'a', 'child'), null, 'a collapsed card has no child to go to');
		assert.equal(moveFocus(setCollapsed(tree(), 'r', true), 's', 'last'), 's');
		assert.equal(moveFocus(g, 'b', 'parent'), 'r', 'from a hidden card, start again at the first root');
	});

	it('starts at the first root when nothing is focused', () => {
		assert.equal(moveFocus(tree(), null, 'child'), 'r');
		assert.equal(moveFocus(createGraph(), null, 'first'), null);
	});

	it('End skips hidden cards, and a collapsed card counts as a leaf', () => {
		// t is the newest card of all but sits under the collapsed s, so the newest drawn leaf is s itself.
		const g = setCollapsed(answered(tree(), 't', 's'), 's', true);
		assert.equal(moveFocus(g, 'r', 'last'), 's');
	});
});
