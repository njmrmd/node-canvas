import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { freshDatabase } from '../../../tests/support/test-db';
import { ApiError } from './api-error';
import { query, queryOne } from './db';
import { deleteKey, getDecryptedKey, getKeySummary, saveKey } from './keys';

const KEY = 'sk-ant-api03-EXAMPLE-NOT-A-REAL-KEY-0000000000-abcd';
let db: Awaited<ReturnType<typeof freshDatabase>> | undefined;
let a: string;
let b: string;

before(async () => {
	process.env.KEY_VAULT_ENCRYPTION_KEY = randomBytes(32).toString('base64');
	db = await freshDatabase();
	const insert = (email: string) =>
		queryOne<{ id: string }>("insert into users (email, password_hash) values ($1, 'x') returning id", [email]);
	a = (await insert('a@example.test'))!.id;
	b = (await insert('b@example.test'))!.id;
});
after(() => db?.drop());

describe('key store', () => {
	it('round-trips a key and shows only the last four', async () => {
		assert.equal(await getKeySummary(a), null);
		const summary = await saveKey(a, KEY);
		assert.equal(summary.last4, 'abcd');
		assert.equal(await getDecryptedKey(a), KEY);
		const row = await queryOne<{ ciphertext: Buffer }>('select ciphertext from provider_keys where user_id = $1', [a]);
		assert.ok(!row!.ciphertext.toString('utf8').includes('EXAMPLE'), 'ciphertext is not plaintext');
	});

	it('replacing a key overwrites the one row', async () => {
		await saveKey(a, `${KEY}-wxyz`);
		assert.equal((await getKeySummary(a))!.last4, 'wxyz');
		assert.equal((await query('select 1 from provider_keys where user_id = $1', [a])).length, 1);
	});

	it('a row copied onto another account does not decrypt', async () => {
		await query(
			`insert into provider_keys (user_id, ciphertext, iv, tag, last4)
			 select $2, ciphertext, iv, tag, last4 from provider_keys where user_id = $1`,
			[a, b]
		);
		await assert.rejects(getDecryptedKey(b), (e: unknown) => e instanceof ApiError && e.code === 'no_key_configured');
		await deleteKey(b);
	});

	it('deleting removes it; a missing key is no_key_configured', async () => {
		assert.equal(await deleteKey(a), true);
		assert.equal(await deleteKey(a), false);
		await assert.rejects(getDecryptedKey(a), (e: unknown) => e instanceof ApiError && e.code === 'no_key_configured');
	});
});
