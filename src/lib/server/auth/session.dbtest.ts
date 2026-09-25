import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { freshDatabase } from '../../../../tests/support/test-db';
import { query, queryOne } from '../db';
import { createSession, deleteExpiredSessions, deleteSession, getUserBySessionToken } from './session';

let db: Awaited<ReturnType<typeof freshDatabase>> | undefined;
let userId: string;
before(async () => {
	db = await freshDatabase();
	userId = (await queryOne<{ id: string }>(
		"insert into users (email, password_hash) values ('s@example.test', 'x') returning id"
	))!.id;
});
after(() => db?.drop());

describe('sessions', () => {
	it('resolves a fresh token to its user', async () => {
		const { token, expiresAt } = await createSession(userId);
		assert.ok(expiresAt.getTime() > Date.now() + 29 * 86_400_000);
		assert.deepEqual(await getUserBySessionToken(token), { id: userId, email: 's@example.test' });
	});

	it('stores only the SHA-256 of the token', async () => {
		const { token } = await createSession(userId);
		const hash = createHash('sha256').update(token, 'utf8').digest();
		const rows = await query<{ token_hash: Buffer }>('select token_hash from sessions');
		assert.ok(rows.some((r) => r.token_hash.equals(hash)));
		assert.ok(rows.every((r) => !r.token_hash.toString('utf8').includes(token)));
	});

	it('does not resolve an unknown or deleted token', async () => {
		assert.equal(await getUserBySessionToken('nope'), null);
		const { token } = await createSession(userId);
		await deleteSession(token);
		assert.equal(await getUserBySessionToken(token), null);
	});

	it("does not resolve, and sweeps, an expired session", async () => {
		const { token } = await createSession(userId);
		const hash = createHash('sha256').update(token, 'utf8').digest();
		await query("update sessions set expires_at = now() - interval '1 second' where token_hash = $1", [hash]);
		assert.equal(await getUserBySessionToken(token), null);
		assert.ok((await deleteExpiredSessions()) >= 1);
		assert.equal((await query('select 1 from sessions where token_hash = $1', [hash])).length, 0);
	});
});
