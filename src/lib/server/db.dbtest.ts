import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { freshDatabase } from '../../../tests/support/test-db';
import { query, queryOne, withTransaction } from './db';

let db: Awaited<ReturnType<typeof freshDatabase>> | undefined;
before(async () => {
	db = await freshDatabase();
});
after(() => db?.drop());

describe('withTransaction', () => {
	it("makes a committed transaction's writes visible after it returns", async () => {
		const email = 'committed@example.test';
		await withTransaction(async (run) => {
			await run('insert into users (email, password_hash) values ($1, $2)', [email, 'x']);
		});
		const row = await queryOne<{ email: string }>('select email from users where email = $1', [email]);
		assert.equal(row?.email, email);
	});

	it('rolls back writes and rethrows when the callback throws', async () => {
		const email = 'rolled-back@example.test';
		await assert.rejects(
			withTransaction(async (run) => {
				await run('insert into users (email, password_hash) values ($1, $2)', [email, 'x']);
				throw new Error('boom');
			}),
			/boom/
		);
		const row = await queryOne('select 1 from users where email = $1', [email]);
		assert.equal(row, null);
	});

	it('does not block concurrent query() calls while a transaction is open (no self-deadlock)', async () => {
		const started = Date.now();
		const transaction = withTransaction(async (run) => {
			await run('insert into users (email, password_hash) values ($1, $2)', ['holder@example.test', 'x']);
			await run('select pg_sleep(0.3)');
		});

		const concurrentResult = await Promise.all([
			query<{ n: number }>('select 1 as n'),
			query<{ n: number }>('select 2 as n')
		]);
		const concurrentElapsed = Date.now() - started;

		assert.deepEqual(
			concurrentResult.map((rows) => rows[0].n),
			[1, 2]
		);
		// Two plain queries alongside an open transaction must finish well
		// before the transaction's 300ms sleep does — proving they run on their
		// own pool connections instead of queueing behind the transaction's.
		assert.ok(concurrentElapsed < 250, `expected concurrent queries under 250ms, took ${concurrentElapsed}ms`);

		await transaction;
	});
});
