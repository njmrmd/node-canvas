// TEST-ONLY. Lets browser tests start signed in without spending the real
// sign-up / sign-in rate limits. Runs inside tests/support/e2e-server.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createSession } from '../../src/lib/server/auth/session';
import { hashPassword } from '../../src/lib/server/crypto/password';
import { query, queryOne } from '../../src/lib/server/db';
import { saveKey } from '../../src/lib/server/keys';
import { POLICIES } from '../../src/lib/server/rate-limit';
import { GOOD_KEY } from './fake-anthropic';

export type SeedRequest = { key?: boolean; nodes?: number; chatUsed?: number; thinkingChars?: number };
export type SeedResponse = { email: string; token: string; userId: string };

export async function seedUser({ key = true, nodes = 0, chatUsed = 0, thinkingChars = 0 }: SeedRequest): Promise<SeedResponse> {
	const email = `seed-${randomBytes(6).toString('hex')}@e2e.test`;
	const user = await queryOne<{ id: string }>('insert into users (email, password_hash) values ($1, $2) returning id', [
		email,
		await hashPassword('seeded-password-not-used')
	]);
	const userId = user!.id;
	if (key) await saveKey(userId, GOOD_KEY);
	const ids: string[] = [];
	for (let i = 0; i < nodes; i++) {
		const id = randomUUID();
		const parentId = i === 0 ? null : ids[Math.floor((i - 1) / 2)];
		await query(
			`insert into nodes (id, user_id, parent_id, prompt, response, thinking, status, x, y, position_mode, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, 'complete', $7, $8, 'auto', now() + ($9 || ' milliseconds')::interval, now())`,
			[
				id,
				userId,
				parentId,
				`Seeded question ${i + 1}`,
				'Seeded answer. '.repeat(20 + (i % 5) * 12),
				thinkingChars > 0 ? 'Seeded reasoning. '.repeat(Math.ceil(thinkingChars / 18)).slice(0, thinkingChars) : '',
				(i % 10) * 520,
				Math.floor(i / 10) * 420,
				String(i)
			]
		);
		ids.push(id);
	}
	if (chatUsed > 0) {
		const windowMs = POLICIES.chat.windowSeconds * 1000;
		await query('insert into rate_limits (bucket, subject, window_start, count) values ($1, $2, $3, $4)', [
			POLICIES.chat.bucket,
			`user:${userId}`,
			new Date(Math.floor(Date.now() / windowMs) * windowMs),
			chatUsed
		]);
	}
	const { token } = await createSession(userId);
	return { email, token, userId };
}

export function startSeedServer(port: number): Promise<{ close: () => Promise<void> }> {
	const server = createServer((req, res) => {
		if (req.method !== 'POST' || req.url !== '/seed') {
			res.writeHead(404).end();
			return;
		}
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', async () => {
			try {
				const seeded = await seedUser(raw ? JSON.parse(raw) : {});
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(seeded));
			} catch (error) {
				res.writeHead(500).end(error instanceof Error ? error.name : 'error');
			}
		});
	});
	return new Promise((resolve) =>
		server.listen(port, '127.0.0.1', () => resolve({ close: () => new Promise((done) => server.close(() => done())) }))
	);
}
