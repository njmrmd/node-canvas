import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { freshDatabase } from '../../../tests/support/test-db';
import { ApiError } from './api-error';
import { query } from './db';
import { consume, enforce, ipSubject, userSubject } from './rate-limit';

let db: Awaited<ReturnType<typeof freshDatabase>> | undefined;
before(async () => {
	db = await freshDatabase();
});
after(() => db?.drop());

const policy = { bucket: 'test', limit: 3, windowSeconds: 3600 };

describe('rate limits', () => {
	it('allows up to the limit, then refuses with headers', async () => {
		const subject = userSubject('u1');
		for (let i = 0; i < 3; i++) assert.equal((await consume(policy, subject)).allowed, true);
		await assert.rejects(enforce(policy, subject), (error: unknown) => {
			assert.ok(error instanceof ApiError);
			assert.equal(error.code, 'rate_limited');
			assert.equal(error.headers?.['RateLimit-Remaining'], '0');
			assert.ok(Number(error.headers?.['Retry-After']) > 0);
			return true;
		});
	});

	it('counts subjects independently, and namespaces them', async () => {
		assert.equal((await consume(policy, ipSubject('10.0.0.1'))).remaining, 2);
		assert.equal((await consume(policy, ipSubject('10.0.0.2'))).remaining, 2);
		assert.notEqual(ipSubject('x'), userSubject('x'));
	});

	it("deletes the subject's stale windows when a new window starts", async () => {
		const subject = userSubject('u-stale');
		await query(
			"insert into rate_limits (bucket, subject, window_start, count) values ($1, $2, now() - interval '3 hours', 9)",
			[policy.bucket, subject]
		);
		await consume(policy, subject);
		const rows = await query<{ count: number }>(
			'select count from rate_limits where bucket = $1 and subject = $2',
			[policy.bucket, subject]
		);
		assert.deepEqual(rows.map((r) => r.count), [1]);
	});
});
