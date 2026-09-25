import { createHash, randomBytes } from 'node:crypto';
import { query, queryOne } from '../db';

export const SESSION_TTL_DAYS = 30;
const TOKEN_BYTES = 32;

export type SessionUser = { id: string; email: string };

/** Only this hash is stored, so database read access does not yield a usable cookie. */
function hashToken(token: string): Buffer {
	return createHash('sha256').update(token, 'utf8').digest();
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
	const token = randomBytes(TOKEN_BYTES).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
	await query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [
		hashToken(token),
		userId,
		expiresAt
	]);
	return { token, expiresAt };
}

/** Expiry is enforced in SQL, so an expired row can never pass for a live one. */
export async function getUserBySessionToken(token: string): Promise<SessionUser | null> {
	return queryOne<SessionUser>(
		`select u.id, u.email::text as email
		   from sessions s join users u on u.id = s.user_id
		  where s.token_hash = $1 and s.expires_at > now()`,
		[hashToken(token)]
	);
}

export async function deleteSession(token: string): Promise<void> {
	await query('delete from sessions where token_hash = $1', [hashToken(token)]);
}

/** Housekeeping, run on sign-in. Returns how many rows went. */
export async function deleteExpiredSessions(): Promise<number> {
	return (await query('delete from sessions where expires_at <= now() returning 1')).length;
}
