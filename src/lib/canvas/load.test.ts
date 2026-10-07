import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadAllNodes, MAX_PAGES, type NodesPage } from './load';
import type { NodeWire } from './node-wire';

const fake = (id: string) => ({ id }) as unknown as NodeWire;

describe('loadAllNodes', () => {
	it('follows the cursors and returns every page in order', async () => {
		const pages: Record<string, NodesPage> = {
			start: { nodes: [fake('a'), fake('b')], next: 'c1' },
			c1: { nodes: [fake('c')], next: 'c2' },
			c2: { nodes: [fake('d')], next: null }
		};
		const asked: (string | null)[] = [];
		const nodes = await loadAllNodes(async (after) => {
			asked.push(after);
			return pages[after ?? 'start'];
		});
		assert.deepEqual(nodes.map((n) => n.id), ['a', 'b', 'c', 'd']);
		assert.deepEqual(asked, [null, 'c1', 'c2']);
	});

	it('gives up rather than loop forever on a server that never ends', async () => {
		let calls = 0;
		await assert.rejects(
			loadAllNodes(async () => {
				calls += 1;
				return { nodes: [], next: 'again' };
			}),
			/more pages/
		);
		assert.equal(calls, MAX_PAGES);
	});
});
