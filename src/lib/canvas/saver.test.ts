import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NodeWire, ViewWire } from './node-wire';
import { MAX_BATCH_BYTES, MAX_BATCH_NODES, MAX_SINGLES_PER_FLUSH, Saver, type SaveBody, type SaverDeps } from './saver';

function node(id: string, extra: Partial<NodeWire> = {}): NodeWire {
	return {
		id, parentId: null, prompt: 'p', response: 'r', thinking: '', status: 'complete', error: null, usage: null,
		model: null, x: 0, y: 0, positionMode: 'auto', width: null, height: null, collapsed: false,
		bodyCollapsed: false, createdAt: 1, updatedAt: 1, ...extra
	};
}

function harness(nodes: Record<string, NodeWire>, depth: Record<string, number> = {}) {
	const sent: { body: SaveBody; keepalive: boolean }[] = [];
	const attempts: SaveBody[] = [];
	const errors: (string | null)[] = [];
	const refused = new Set<string>();
	let failNext: unknown = null;
	let failTimes = 0;
	let online = true;
	let view: ViewWire = { viewport: { x: 0, y: 0, zoom: 1 }, targetNodeId: null };
	const removals: { id: string; keepalive: boolean }[] = [];
	let removeFails: unknown = null;
	const events: string[] = [];
	const deps: SaverDeps = {
		getNode: (id) => nodes[id] ?? null,
		depthOf: (id) => depth[id] ?? 0,
		getView: () => view,
		put: async (body, keepalive) => {
			attempts.push(body);
			if (failTimes > 0) {
				failTimes -= 1;
				throw failNext;
			}
			if (body.upserts.some((n) => refused.has(n.id))) throw { code: 'invalid_request' };
			sent.push({ body, keepalive });
			events.push(...body.upserts.map((n) => `put:${n.id}`));
			return { rejected: [] };
		},
		remove: async (id, keepalive) => {
			if (removeFails) {
				const e = removeFails;
				removeFails = null;
				throw e;
			}
			removals.push({ id, keepalive });
			events.push(`del:${id}`);
		},
		isOnline: () => online,
		onError: (m) => errors.push(m),
		priority: () => [],
		failureMessage: 'not saved'
	};
	const saver = new Saver(deps, { setInterval: (() => 0) as unknown as typeof setInterval, clearInterval: (() => {}) as unknown as typeof clearInterval });
	return {
		saver,
		sent,
		attempts,
		errors,
		/** The next `times` requests fail with `e`. */
		fail: (e: unknown, times = 1) => {
			failNext = e;
			failTimes = times;
		},
		/** The server refuses every request that carries this node, until `allow`. */
		refuse: (id: string) => refused.add(id),
		allow: (id: string) => refused.delete(id),
		setOnline: (v: boolean) => (online = v),
		removals,
		events,
		failRemove: (e: unknown) => (removeFails = e),
		setTarget: (id: string | null) => (view = { ...view, targetNodeId: id })
	};
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

	it('a refused node does not block the others', async () => {
		const h = harness({ p: node('p'), bad: node('bad', { parentId: 'p' }), c: node('c', { parentId: 'p' }), q: node('q') }, { p: 1, bad: 2, c: 2, q: 1 });
		h.refuse('bad');
		['c', 'bad', 'q', 'p'].forEach((id) => h.saver.markNode(id));
		h.saver.markView();
		await h.saver.flush();
		const saved = h.sent.flatMap((s) => s.body.upserts.map((n) => n.id));
		assert.deepEqual(saved.sort(), ['c', 'p', 'q']);
		assert.ok(h.sent.some((s) => s.body.view), 'the view saved too');
		// Retried one node per request, parents before children.
		const singles = h.attempts.slice(1).flatMap((b) => b.upserts.map((n) => n.id));
		assert.ok(singles.indexOf('p') < singles.indexOf('c') && singles.indexOf('p') < singles.indexOf('bad'));
		assert.ok(h.attempts.slice(1).every((b) => b.upserts.length <= 1));
		assert.equal(h.saver.pending, 1);
		assert.equal(h.errors.at(-1), 'not saved');

		// Next flush: the healthy change goes in a batch of its own; the refused node is retried alone.
		h.attempts.length = 0;
		h.saver.markNode('q');
		await h.saver.flush();
		assert.equal(h.attempts.length, 2);
		assert.deepEqual(h.attempts.map((b) => b.upserts.map((n) => n.id)), [['q'], ['bad']]);
		assert.equal(h.saver.pending, 1);
		assert.equal(h.errors.at(-1), 'not saved');

		// Once the server takes it, nothing is left and the banner clears.
		h.allow('bad');
		await h.saver.flush();
		assert.equal(h.saver.pending, 0);
		assert.equal(h.errors.at(-1), null);
	});

	for (const code of ['unauthenticated', 'internal_error']) {
		it(`a whole-batch refusal sends at most one request per flush (${code})`, async () => {
			const nodes = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`n${i}`, node(`n${i}`)]));
			const h = harness(nodes);
			Object.keys(nodes).forEach((id) => h.saver.markNode(id));
			h.fail({ code }, Number.POSITIVE_INFINITY);
			for (let i = 0; i < 3; i++) await h.saver.flush();
			assert.equal(h.attempts.length, 3);
			assert.equal(h.saver.pending, 50);
			assert.equal(h.errors.at(-1), 'not saved');
		});
	}

	it('a thrown non-API error stops the flush too', async () => {
		const nodes = { a: node('a'), b: node('b') };
		const h = harness(nodes);
		h.saver.markNode('a');
		h.saver.markNode('b');
		h.fail(new TypeError('boom'), Number.POSITIVE_INFINITY);
		await h.saver.flush();
		assert.equal(h.attempts.length, 1);
		assert.equal(h.saver.pending, 2);
		assert.deepEqual(h.errors, ['not saved']);
	});

	it('sends at most 10 single-node retries in one flush; the rest wait for the next', async () => {
		const nodes = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`n${i}`, node(`n${i}`)]));
		const h = harness(nodes);
		Object.keys(nodes).forEach((id) => {
			h.refuse(id);
			h.saver.markNode(id);
		});
		await h.saver.flush();
		assert.equal(h.attempts.length, 1 + MAX_SINGLES_PER_FLUSH);
		assert.equal(h.saver.pending, 30);
		assert.equal(h.errors.at(-1), 'not saved');
		h.attempts.length = 0;
		await h.saver.flush();
		assert.ok(h.attempts.length <= 1 + MAX_SINGLES_PER_FLUSH, `sent ${h.attempts.length}`);
	});

	it('stops retrying singly when the network drops, keeping the rest dirty', async () => {
		const h = harness({ a: node('a'), bad: node('bad'), b: node('b') });
		h.refuse('bad');
		['a', 'bad', 'b'].forEach((id) => h.saver.markNode(id));
		h.saver.markView();
		(h.saver as unknown as { deps: SaverDeps }).deps.put = async (body) => {
			h.attempts.push(body);
			if (h.attempts.length === 1) throw { code: 'invalid_request' };
			throw { code: 'network' };
		};
		await h.saver.flush();
		assert.equal(h.attempts.length, 2);
		assert.equal(h.saver.pending, 4);
		assert.deepEqual(h.errors, []);
	});

	it('stops retrying singly when rate limited, with the banner up', async () => {
		const h = harness({ a: node('a'), b: node('b'), c: node('c') });
		['a', 'b', 'c'].forEach((id) => h.saver.markNode(id));
		h.fail({ code: 'rate_limited' }, 10);
		await h.saver.flush();
		assert.equal(h.attempts.length, 1);
		assert.equal(h.saver.pending, 3);
		assert.deepEqual(h.errors, ['not saved']);
	});

	it('leaves a refused node out of the keepalive so the rest still saves', async () => {
		const h = harness({ a: node('a'), bad: node('bad') });
		h.refuse('bad');
		h.saver.markNode('a');
		h.saver.markNode('bad');
		await h.saver.flush();
		h.saver.markNode('a');
		await h.saver.flush({ keepalive: true });
		const last = h.sent.at(-1)!;
		assert.equal(last.keepalive, true);
		assert.deepEqual(last.body.upserts.map((n) => n.id), ['a']);
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

	it('works with default clock (no `this` binding required)', async () => {
		const deps: SaverDeps = {
			getNode: () => null,
			depthOf: () => 0,
			getView: () => ({ viewport: { x: 0, y: 0, zoom: 1 }, targetNodeId: null }),
			put: async () => ({ rejected: [] }),
			remove: async () => {},
			isOnline: () => true,
			onError: () => {},
			priority: () => [],
			failureMessage: 'fail'
		};
		const saver = new Saver(deps);
		saver.start();
		saver.stop();
		// If we get here, the clock functions work without `this`
		assert.ok(true);
	});

	it('default clock functions do not reference `this`', () => {
		const deps: SaverDeps = {
			getNode: () => null,
			depthOf: () => 0,
			getView: () => ({ viewport: { x: 0, y: 0, zoom: 1 }, targetNodeId: null }),
			put: async () => ({ rejected: [] }),
			remove: async () => {},
			isOnline: () => true,
			onError: () => {},
			priority: () => [],
			failureMessage: 'fail'
		};
		const saver = new Saver(deps);
		const clock = (saver as unknown as { clock: { setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (id: unknown) => void } }).clock;

		// Test setInterval doesn't need `this`
		const intervalId = Reflect.apply(clock.setInterval, {}, [() => {}, 1]);
		Reflect.apply(clock.clearInterval, {}, [intervalId]);
		assert.ok(true);
	});

	it('includes in-flight nodes in keepalive and counts them in pending', async () => {
		const h = harness({ a: node('a') });
		let normalPutResolve: (value: { rejected: string[] }) => void = () => {};
		let keepaliveBody: SaveBody = { upserts: [] };
		(h.saver as unknown as { deps: SaverDeps }).deps.put = async (body, keepalive) => {
			if (!keepalive) {
				// Normal flush: hold this open
				return new Promise((resolve) => (normalPutResolve = resolve));
			} else {
				// Keepalive: record what was sent
				keepaliveBody = body;
				return { rejected: [] };
			}
		};
		h.saver.markNode('a');
		const flushPromise = h.saver.flush();
		// Start keepalive while normal flush is still in-flight (put not resolved yet)
		const keepalivePromise = h.saver.flush({ keepalive: true });
		// Let keepalive run
		await new Promise((r) => setImmediate(r));
		// Assert keepalive included the in-flight node
		assert.deepEqual(keepaliveBody.upserts.map((n) => n.id), ['a']);
		assert.equal(h.saver.pending, 1); // Still in-flight from normal flush
		// Complete the normal flush
		normalPutResolve({ rejected: [] });
		await flushPromise;
		await keepalivePromise;
		assert.equal(h.saver.pending, 0);
	});

	it('keepalive does not send child when oversized parent is visited and skipped first', async () => {
		const big = 'x'.repeat(65_000);
		const small = 'x'.repeat(5_000);
		const h = harness({
			p: node('p', { response: big }),
			c: node('c', { response: small, parentId: 'p' })
		}, { p: 1, c: 2 });
		// Empty priority; mark p first so it's visited first in Set iteration order
		(h.saver as unknown as { deps: SaverDeps }).deps.priority = () => [];
		h.saver.markNode('p');
		h.saver.markNode('c');
		await h.saver.flush({ keepalive: true });
		// p is ~65 KB, skipped immediately (> 60 KB)
		// c walks back, finds skipped p ancestor, walk returns [], skips c
		// Result: no nodes sent (empty body not sent)
		assert.equal(h.sent.length, 0);
		assert.equal(h.saver.pending, 2);
	});

	it('keepalive skips child whose parent is too large to fit together', async () => {
		const big = 'x'.repeat(35_000);
		const h = harness({
			p: node('p', { response: big }),
			c: node('c', { response: big, parentId: 'p' })
		}, { p: 1, c: 2 });
		(h.saver as unknown as { deps: SaverDeps }).deps.priority = () => ['c'];
		h.saver.markNode('p');
		h.saver.markNode('c');
		await h.saver.flush({ keepalive: true });
		// Chain [p, c] is 70 KB > 60 KB, so neither is sent; no request
		assert.equal(h.sent.length, 0);
		assert.equal(h.saver.pending, 2);
	});

	it('keepalive sends parent and child if both fit', async () => {
		const big = 'x'.repeat(20_000);
		const h = harness({
			p: node('p', { response: big }),
			c: node('c', { response: big, parentId: 'p' })
		}, { p: 1, c: 2 });
		(h.saver as unknown as { deps: SaverDeps }).deps.priority = () => ['c'];
		h.saver.markNode('p');
		h.saver.markNode('c');
		await h.saver.flush({ keepalive: true });
		assert.equal(h.sent.length, 1);
		assert.deepEqual(h.sent[0].body.upserts.map((n) => n.id), ['p', 'c']);
		assert.equal(h.saver.pending, 2);
	});

	it('pending counts union of dirty and in-flight, not sum', async () => {
		const h = harness({ a: node('a') });
		let normalPutResolve: (value: { rejected: string[] }) => void = () => {};
		(h.saver as unknown as { deps: SaverDeps }).deps.put = async (_body, keepalive) => {
			if (!keepalive) {
				return new Promise((resolve) => (normalPutResolve = resolve));
			}
			return { rejected: [] };
		};
		h.saver.markNode('a');
		const flushPromise = h.saver.flush();
		// Let run() start and move 'a' to inFlightIds
		await new Promise((r) => setImmediate(r));
		// Now mark 'a' again while in-flight
		h.saver.markNode('a');
		// pending should be 1 (union), not 2 (sum)
		assert.equal(h.saver.pending, 1);
		normalPutResolve({ rejected: [] });
		await flushPromise;
	});

	it('handles getView throwing and recovers', async () => {
		let throwOnce = true;
		const h = harness({ a: node('a') });
		(h.saver as unknown as { deps: SaverDeps }).deps.getView = () => {
			if (throwOnce) {
				throwOnce = false;
				throw new Error('view error');
			}
			return { viewport: { x: 0, y: 0, zoom: 1 }, targetNodeId: null };
		};
		h.saver.markNode('a');
		h.saver.markView();
		await h.saver.flush();
		assert.deepEqual(h.errors, ['not saved']);
		assert.equal(h.saver.pending, 2);
		await h.saver.flush();
		assert.deepEqual(h.errors, ['not saved', null]);
		assert.equal(h.saver.pending, 0);
	});

	it('sends a pending delete after the flush saves, and never saves a node deleted before its first save', async () => {
		const nodes: Record<string, NodeWire> = { keep: node('keep'), gone: node('gone') };
		const h = harness(nodes);
		h.saver.markNode('keep');
		h.saver.markNode('gone');
		delete nodes.gone;
		h.saver.markDeleted('gone');
		await h.saver.flush();
		assert.deepEqual(h.sent.map((s) => s.body.upserts.map((n) => n.id)), [['keep']]);
		assert.deepEqual(h.removals, [{ id: 'gone', keepalive: false }]);
		assert.deepEqual(h.events, ['put:keep', 'del:gone'], 'the delete goes after the saves');
		assert.equal(h.saver.pending, 0);
	});

	it('Undo before the flush means the server never hears of the delete', async () => {
		const h = harness({ a: node('a') });
		h.saver.markDeleted('a');
		h.saver.cancelDeletion('a');
		h.saver.markNode('a');
		await h.saver.flush();
		assert.deepEqual(h.removals, []);
		assert.deepEqual(h.sent.map((s) => s.body.upserts.map((n) => n.id)), [['a']]);
	});

	it('keeps a delete pending through a network failure, and sends it on the next flush', async () => {
		const h = harness({});
		h.saver.markDeleted('x');
		h.failRemove({ code: 'network' });
		await h.saver.flush();
		assert.deepEqual(h.removals, []);
		assert.deepEqual(h.errors, [null], 'a network failure raises no banner');
		assert.equal(h.saver.pending, 1);
		await h.saver.flush();
		assert.deepEqual(h.removals, [{ id: 'x', keepalive: false }]);
		assert.equal(h.saver.pending, 0);
	});

	it('raises the banner when the server refuses a delete, and keeps it pending', async () => {
		const h = harness({});
		h.saver.markDeleted('x');
		h.failRemove({ code: 'internal_error' });
		await h.saver.flush();
		assert.deepEqual(h.errors, ['not saved']);
		assert.equal(h.saver.pending, 1);
	});

	it('the unload save also sends pending deletes, with keepalive, and keeps them pending', async () => {
		const h = harness({ a: node('a') });
		h.saver.markNode('a');
		h.saver.markDeleted('gone');
		await h.saver.flush({ keepalive: true });
		assert.deepEqual(h.removals, [{ id: 'gone', keepalive: true }]);
		assert.ok(h.sent.some((s) => s.keepalive && s.body.upserts.some((n) => n.id === 'a')));
		assert.equal(h.saver.pending, 2, 'the regular flush still owns them');
	});

	it('a second unload save while one is in flight sends nothing more', async () => {
		const puts: boolean[] = [];
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		const saver = new Saver({
			getNode: (id) => (id === 'a' ? node('a') : null),
			depthOf: () => 0,
			getView: () => ({ viewport: { x: 0, y: 0, zoom: 1 }, targetNodeId: null }),
			put: async (_body, keepalive) => {
				puts.push(keepalive);
				await held;
				return { rejected: [] };
			},
			remove: async () => {},
			isOnline: () => true,
			onError: () => {},
			priority: () => [],
			failureMessage: 'not saved'
		});
		saver.markNode('a');
		const first = saver.flush({ keepalive: true });
		const second = saver.flush({ keepalive: true });
		release();
		await Promise.all([first, second]);
		assert.deepEqual(puts, [true]);
	});

	it('nodes sent alone take turns under the cap, so a node the server now accepts is not starved', async () => {
		const nodes: Record<string, NodeWire> = {};
		for (let i = 1; i <= 10; i++) nodes[`bad${i}`] = node(`bad${i}`, { createdAt: i });
		nodes.late = node('late', { createdAt: 11 });
		const h = harness(nodes);
		for (const id of Object.keys(nodes)) {
			h.refuse(id);
			h.saver.markNode(id);
		}
		await h.saver.flush(); // the batch is refused; bad1–bad10 go alone and are refused; late waits (cap)
		await h.saver.flush(); // late is refused on its own; bad1–bad10 are refused again
		h.allow('late');
		await h.saver.flush(); // late was tried least recently, so it goes first
		assert.ok(h.sent.some((s) => s.body.upserts.length === 1 && s.body.upserts[0].id === 'late'), 'late was saved');
	});

	it('holds the view back while its target node is not saved, then sends it', async () => {
		const h = harness({ t: node('t') });
		h.refuse('t');
		h.saver.markNode('t');
		h.setTarget('t');
		h.saver.markView();
		await h.saver.flush();
		await h.saver.flush();
		assert.equal(h.sent.some((s) => s.body.view), false, 'a view naming an unsaved node would store no target');
		h.allow('t');
		await h.saver.flush();
		assert.ok(h.sent.some((s) => s.body.view?.targetNodeId === 't'));
	});

	it('holds the view back while its target is unsaved, even when the view rides with a batch', async () => {
		const nodes: Record<string, NodeWire> = {};
		for (let i = 0; i <= MAX_BATCH_NODES; i++) nodes[`n${i}`] = node(`n${i}`, { createdAt: i });
		const h = harness(nodes);
		h.refuse('n0');
		for (const id of Object.keys(nodes)) h.saver.markNode(id);
		h.setTarget('n0');
		h.saver.markView();
		await h.saver.flush();
		assert.equal(h.sent.some((s) => s.body.view), false, 'a view naming an unsaved node would store no target');
		h.allow('n0');
		await h.saver.flush();
		await h.saver.flush();
		assert.ok(h.sent.some((s) => s.body.view?.targetNodeId === 'n0'), 'the view arrives once its target is saved');
	});

	it('the unload save leaves the view out while its target is not in it', async () => {
		const h = harness({ t: node('t') });
		h.refuse('t');
		h.saver.markNode('t');
		h.setTarget('t');
		h.saver.markView();
		await h.saver.flush(); // t is refused and becomes a suspect; the view is held
		await h.saver.flush({ keepalive: true });
		assert.equal(h.sent.some((s) => s.keepalive && s.body.view), false);
	});

	it('a flush the server halts sends no delete, and keeps it pending', async () => {
		const h = harness({ a: node('a') });
		h.saver.markNode('a');
		h.saver.markDeleted('gone');
		h.fail({ code: 'internal_error' });
		await h.saver.flush();
		assert.deepEqual(h.removals, []);
		assert.equal(h.saver.pending, 2);
	});

	it('a later unload save sends again once the first has finished', async () => {
		const h = harness({ a: node('a') });
		h.saver.markNode('a');
		await h.saver.flush({ keepalive: true });
		await h.saver.flush({ keepalive: true });
		assert.equal(h.sent.filter((s) => s.keepalive).length, 2);
	});
});
