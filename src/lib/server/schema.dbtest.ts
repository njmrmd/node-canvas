import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { freshDatabase } from '../../../tests/support/test-db';
import { query, queryOne } from './db';

let db: Awaited<ReturnType<typeof freshDatabase>> | undefined;
before(async () => {
	db = await freshDatabase();
});
after(() => db?.drop());

async function user(email: string): Promise<string> {
	const row = await queryOne<{ id: string }>(
		"insert into users (email, password_hash) values ($1, 'x') returning id",
		[email]
	);
	return row!.id;
}

function node(id: string, userId: string, parentId: string | null) {
	return query(
		`insert into nodes (id, user_id, parent_id, prompt, status, x, y, position_mode, created_at, updated_at)
		 values ($1, $2, $3, 'p', 'complete', 0, 0, 'auto', now(), now())`,
		[id, userId, parentId]
	);
}

const count = async (table: string, userId: string) =>
	Number((await queryOne<{ n: string }>(`select count(*) as n from ${table} where user_id = $1`, [userId]))!.n);

describe('schema', () => {
	it('treats emails as case-insensitive and unique', async () => {
		await user('Case@Example.test');
		await assert.rejects(user('case@example.test'), /duplicate key/);
	});

	it('refuses a parent that belongs to another user', async () => {
		const a = await user('a@example.test');
		const b = await user('b@example.test');
		const parent = randomUUID();
		await node(parent, a, null);
		await assert.rejects(node(randomUUID(), b, parent), /foreign key/);
	});

	it('deleting a node deletes its whole subtree', async () => {
		const u = await user('tree@example.test');
		const [root, child, grandchild, other] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
		await node(root, u, null);
		await node(child, u, root);
		await node(grandchild, u, child);
		await node(other, u, null);
		await query('delete from nodes where id = $1 and user_id = $2', [root, u]);
		const left = await query<{ id: string }>('select id from nodes where user_id = $1', [u]);
		assert.deepEqual(left.map((r) => r.id), [other]);
	});

	it('clears the view target when that node is deleted', async () => {
		const u = await user('view@example.test');
		const n = randomUUID();
		await node(n, u, null);
		await query(`insert into canvas_view (user_id, viewport, target_node_id) values ($1, '{"x":0,"y":0,"zoom":1}', $2)`, [u, n]);
		await query('delete from nodes where id = $1', [n]);
		const view = await queryOne<{ target_node_id: string | null }>('select target_node_id from canvas_view where user_id = $1', [u]);
		assert.equal(view!.target_node_id, null);
	});

	it('deleting a user deletes everything they own', async () => {
		const u = await user('gone@example.test');
		await node(randomUUID(), u, null);
		await query("insert into sessions (token_hash, user_id, expires_at) values ('\\x00', $1, now() + interval '1 day')", [u]);
		await query("insert into provider_keys (user_id, ciphertext, iv, tag, last4) values ($1, '\\x00', '\\x00', '\\x00', 'abcd')", [u]);
		await query(`insert into canvas_view (user_id, viewport) values ($1, '{"x":0,"y":0,"zoom":1}')`, [u]);
		await query('delete from users where id = $1', [u]);
		for (const table of ['nodes', 'sessions', 'provider_keys', 'canvas_view']) {
			assert.equal(await count(table, u), 0, table);
		}
	});
});
