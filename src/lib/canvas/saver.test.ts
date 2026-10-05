import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NodeWire, ViewWire } from './node-wire';
import { MAX_BATCH_BYTES, Saver, type SaveBody, type SaverDeps } from './saver';

function node(id: string, extra: Partial<NodeWire> = {}): NodeWire {
	return {
		id, parentId: null, prompt: 'p', response: 'r', thinking: '', status: 'complete', error: null, usage: null,
		model: null, x: 0, y: 0, positionMode: 'auto', width: null, height: null, collapsed: false,
		bodyCollapsed: false, createdAt: 1, updatedAt: 1, ...extra
	};
}

function harness(nodes: Record<string, NodeWire>, depth: Record<string, number> = {}) {
	const sent: { body: SaveBody; keepalive: boolean }[] = [];
	const errors: (string | null)[] = [];
	let failNext: unknown = null;
	let online = true;
	const view: ViewWire = { viewport: { x: 0, y: 0, zoom: 1 }, targetNodeId: null };
	const deps: SaverDeps = {
		getNode: (id) => nodes[id] ?? null,
		depthOf: (id) => depth[id] ?? 0,
		getView: () => view,
		put: async (body, keepalive) => {
			if (failNext) {
				const e = failNext;
				failNext = null;
				throw e;
			}
			sent.push({ body, keepalive });
			return { rejected: [] };
		},
		isOnline: () => online,
		onError: (m) => errors.push(m),
		priority: () => [],
		failureMessage: 'not saved'
	};
	const saver = new Saver(deps, { setInterval: (() => 0) as unknown as typeof setInterval, clearInterval: (() => {}) as unknown as typeof clearInterval });
	return { saver, sent, errors, fail: (e: unknown) => (failNext = e), setOnline: (v: boolean) => (online = v) };
}

describe('Saver', () => {
	it('sends dirty nodes parents first, with the view, in one request', async () => {
		const h = harness({ c: node('c'), p: node('p') }, { c: 2, p: 1 });
		h.saver.markNode('c');
		h.saver.markNode('p');
		h.saver.markView();
		await h.saver.flush();
		assert.equal(h.sent.length, 1);
		assert.deepEqual(h.sent[0].body.upserts.map((n) => n.id), ['p', 'c']);
		assert.ok(h.sent[0].body.view);
		assert.equal(h.saver.pending, 0);
		assert.deepEqual(h.errors, [null]);
	});

	it('splits more than 200 nodes into ordered batches', async () => {
		const nodes = Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`n${i}`, node(`n${i}`)]));
		const h = harness(nodes);
		Object.keys(nodes).forEach((id) => h.saver.markNode(id));
		await h.saver.flush();
		assert.deepEqual(h.sent.map((s) => s.body.upserts.length), [200, 200, 50]);
	});

	it('splits by bytes when nodes are large', () => {
		const big = 'x'.repeat(390_000);
		const nodes = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`b${i}`, node(`b${i}`, { response: big })]));
		const h = harness(nodes);
		Object.keys(nodes).forEach((id) => h.saver.markNode(id));
		const batches = h.saver.batches();
		assert.ok(batches.length >= 2);
		for (const b of batches) assert.ok(new TextEncoder().encode(JSON.stringify(b)).byteLength <= MAX_BATCH_BYTES);
		assert.equal(batches.flatMap((b) => b.upserts).length, 15);
	});

	it('drops nodes that no longer exist instead of retrying them forever', async () => {
		const h = harness({ kept: node('kept') });
		h.saver.markNode('kept');
		h.saver.markNode('deleted');
		await h.saver.flush();
		assert.deepEqual(h.sent[0].body.upserts.map((n) => n.id), ['kept']);
		assert.equal(h.saver.pending, 0);
	});

	it('keeps ids dirty and raises the banner on a server failure, then clears it', async () => {
		const h = harness({ a: node('a') });
		h.saver.markNode('a');
		h.fail({ code: 'internal_error' });
		await h.saver.flush();
		assert.deepEqual(h.errors, ['not saved']);
		assert.equal(h.saver.pending, 1);
		await h.saver.flush();
		assert.deepEqual(h.errors, ['not saved', null]);
		assert.equal(h.saver.pending, 0);
	});

	it('keeps ids dirty without a banner on a network failure', async () => {
		const h = harness({ a: node('a') });
		h.saver.markNode('a');
		h.fail({ code: 'network' });
		await h.saver.flush();
		assert.deepEqual(h.errors, []);
		assert.equal(h.saver.pending, 1);
	});

	it('waits while offline', async () => {
		const h = harness({ a: node('a') });
		h.saver.markNode('a');
		h.setOnline(false);
		await h.saver.flush();
		assert.equal(h.sent.length, 0);
	});

	it('keeps changes made during a request for the next flush', async () => {
		const nodes = { a: node('a') };
		const h = harness(nodes);
		h.saver.markNode('a');
		const first = h.saver.flush();
		h.saver.markNode('a');
		await first;
		assert.equal(h.saver.pending, 1);
	});

	it('sends a keepalive request under 60 KB, streaming nodes first, without clearing', async () => {
		const big = 'x'.repeat(40_000);
		const h = harness({ a: node('a', { response: big }), s: node('s', { response: big, status: 'streaming' }) });
		(h.saver as unknown as { deps: SaverDeps }).deps.priority = () => ['s'];
		h.saver.markNode('a');
		h.saver.markNode('s');
		await h.saver.flush({ keepalive: true });
		assert.equal(h.sent.length, 1);
		assert.equal(h.sent[0].keepalive, true);
		assert.deepEqual(h.sent[0].body.upserts.map((n) => n.id), ['s']);
		assert.equal(h.saver.pending, 2);
	});
});
