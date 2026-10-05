import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { freshDatabase } from '../../../tests/support/test-db';
import { ApiError } from './api-error';
import { query, queryOne } from './db';
import { wire } from '../../../tests/support/wire';
import { deleteNode, loadCanvas, saveNodes } from './nodes';

let db: Awaited<ReturnType<typeof freshDatabase>> | undefined;
let a: string;
let b: string;
before(async () => {
	db = await freshDatabase();
	const make = async (email: string) =>
		(await queryOne<{ id: string }>("insert into users (email, password_hash) values ($1, 'x') returning id", [email]))!.id;
	a = await make('a@nodes.test');
	b = await make('b@nodes.test');
});
after(() => db?.drop());

const count = async (userId: string) =>
	Number((await queryOne<{ n: string }>('select count(*) as n from nodes where user_id = $1', [userId]))!.n);

describe('saveNodes / loadCanvas', () => {
	it('inserts, then updates, and loads back exactly', async () => {
		const n = wire({ createdAt: 1_700_000_000_123, updatedAt: 1_700_000_000_456 });
		await saveNodes(a, [n], { viewport: { x: 5, y: 6, zoom: 0.5 }, targetNodeId: n.id });
		await saveNodes(a, [{ ...n, response: 'edited', x: 40, updatedAt: 1_700_000_001_000 }], null);
		const loaded = await loadCanvas(a);
		assert.deepEqual(loaded.nodes, [{ ...n, response: 'edited', x: 40, updatedAt: 1_700_000_001_000 }]);
		assert.deepEqual(loaded.view, { viewport: { x: 5, y: 6, zoom: 0.5 }, targetNodeId: n.id });
	});

	it('saves a child before its parent in one batch (deferred FK)', async () => {
		const parent = wire();
		const child = wire({ parentId: parent.id });
		await saveNodes(a, [child, parent], null);
		const loaded = await loadCanvas(a);
		assert.ok(loaded.nodes.some((n) => n.id === child.id && n.parentId === parent.id));
	});

	it('rejects the whole batch when a parent does not exist, writing nothing', async () => {
		const before = await count(a);
		const fine = wire();
		const orphan = wire({ parentId: randomUUID() });
		await assert.rejects(saveNodes(a, [fine, orphan], null), (e: unknown) => e instanceof ApiError && e.code === 'invalid_request');
		assert.equal(await count(a), before);
	});

	it('never overwrites another user’s node, and reports it as rejected', async () => {
		const mine = wire({ prompt: 'b owns this' });
		await saveNodes(b, [mine], null);
		const { rejected } = await saveNodes(a, [{ ...mine, prompt: 'hijacked' }], null);
		assert.deepEqual(rejected, [mine.id]);
		const row = await queryOne<{ prompt: string; user_id: string }>('select prompt, user_id from nodes where id = $1', [mine.id]);
		assert.deepEqual(row, { prompt: 'b owns this', user_id: b });
	});

	it('ignores a view target that is not one of the user’s saved nodes', async () => {
		const foreign = (await loadCanvas(b)).nodes[0].id;
		await saveNodes(a, [], { viewport: { x: 0, y: 0, zoom: 1 }, targetNodeId: foreign });
		assert.equal((await loadCanvas(a)).view?.targetNodeId, null);
		await saveNodes(a, [], { viewport: { x: 0, y: 0, zoom: 1 }, targetNodeId: randomUUID() });
		assert.equal((await loadCanvas(a)).view?.targetNodeId, null);
	});

	it('saves a 390k-character response', async () => {
		const big = wire({ response: 'y'.repeat(390_000) });
		await saveNodes(a, [big], null);
		const loaded = await loadCanvas(a);
		assert.equal(loaded.nodes.find((n) => n.id === big.id)?.response.length, 390_000);
	});
});

describe('deleteNode', () => {
	it('deletes the subtree, only for its owner', async () => {
		const root = wire();
		const child = wire({ parentId: root.id });
		await saveNodes(a, [root, child], null);
		await deleteNode(b, root.id);
		assert.ok((await loadCanvas(a)).nodes.some((n) => n.id === root.id), 'another user cannot delete it');
		await deleteNode(a, root.id);
		const ids = (await loadCanvas(a)).nodes.map((n) => n.id);
		assert.ok(!ids.includes(root.id) && !ids.includes(child.id));
		await query('select 1'); // connection still healthy
	});
});
