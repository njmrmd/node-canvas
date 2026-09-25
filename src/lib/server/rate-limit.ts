import { ApiError } from './api-error';
import { query, queryOne } from './db';

export type RateLimitPolicy = {
	/** Bucket name; part of the counter key. */
	bucket: string;
	/** Requests permitted per window. */
	limit: number;
	/** Window length in seconds. */
	windowSeconds: number;
};

/** Every limit in the product, in one place. */
export const POLICIES = {
	/** Per IP: stops scripted account farming from one host. */
	signUp: { bucket: 'signup', limit: 5, windowSeconds: 3600 },
	/** Per IP: the credential-stuffing control. */
	signIn: { bucket: 'signin', limit: 10, windowSeconds: 900 },
	/** Per user: saving a key calls Anthropic. */
	keyWrite: { bucket: 'key_write', limit: 20, windowSeconds: 3600 },
	/** Per user: the main product action. */
	chat: { bucket: 'chat', limit: 60, windowSeconds: 3600 },
	/** Per user: a backstop against a runaway save loop, not a real limit on saving. */
	nodeWrite: { bucket: 'node_write', limit: 120, windowSeconds: 60 }
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitResult = {
	/** Whether this request was permitted (distinct from remaining === 0). */
	allowed: boolean;
	limit: number;
	remaining: number;
	/** When the current window ends. */
	resetAt: Date;
};

/** IETF RateLimit draft headers, plus Retry-After on a refusal. */
export function rateLimitHeaders(
	result: RateLimitResult,
	options?: { retryAfter?: boolean }
): Record<string, string> {
	const resetSeconds = Math.max(0, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
	const headers: Record<string, string> = {
		'RateLimit-Limit': String(result.limit),
		'RateLimit-Remaining': String(result.remaining),
		'RateLimit-Reset': String(resetSeconds)
	};
	if (options?.retryAfter) headers['Retry-After'] = String(resetSeconds);
	return headers;
}

/**
 * One atomic insert-or-increment. At the ceiling the `where count < limit`
 * guard matches no row, so an empty result is exactly and only a refusal.
 */
export async function consume(policy: RateLimitPolicy, subject: string): Promise<RateLimitResult> {
	const windowMs = policy.windowSeconds * 1000;
	const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
	const resetAt = new Date(windowStart.getTime() + windowMs);

	const row = await queryOne<{ count: number }>(
		`insert into rate_limits (bucket, subject, window_start, count)
		      values ($1, $2, $3, 1)
		 on conflict (bucket, subject, window_start) do update
		        set count = rate_limits.count + 1
		      where rate_limits.count < $4
		  returning count`,
		[policy.bucket, subject, windowStart, policy.limit]
	);

	if (!row) return { allowed: false, limit: policy.limit, remaining: 0, resetAt };

	// First hit of a new window: every stale window in the bucket is dead
	// weight, not just this subject's — one subject's rollover is as good a
	// time as any to sweep the rest.
	if (row.count === 1) {
		await query('delete from rate_limits where bucket = $1 and window_start < $2', [policy.bucket, windowStart]);
	}

	return { allowed: true, limit: policy.limit, remaining: Math.max(0, policy.limit - row.count), resetAt };
}

/** Consumes, and throws a 429 carrying the same headers when refused. */
export async function enforce(policy: RateLimitPolicy, subject: string): Promise<RateLimitResult> {
	const result = await consume(policy, subject);
	if (result.allowed) return result;
	const minutes = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 60000));
	throw new ApiError(
		'rate_limited',
		`You have reached the limit of ${policy.limit} for this action. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
		{ headers: rateLimitHeaders(result, { retryAfter: true }) }
	);
}

/** Namespaced so an IP and a user id can never collide. */
export function userSubject(userId: string): string {
	return `user:${userId}`;
}

/** `address` comes from SvelteKit's `event.getClientAddress()` (the real peer on Vercel). */
export function ipSubject(address: string): string {
	return `ip:${address}`;
}
