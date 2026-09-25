import pg, { type QueryResultRow } from 'pg';
import { ApiError } from './api-error';
import { tlsConnectionConfig } from './db-tls.mjs';

// One pool per server instance, kept on globalThis so dev hot reloads reuse
// it. max: 5 because Vercel Fluid compute can run several concurrent
// requests on one instance, not just one; point DATABASE_URL at a pooled
// endpoint so this stays small relative to Postgres's own connection limit.
const g = globalThis as typeof globalThis & { __nc_pool?: pg.Pool };

function pool(): pg.Pool {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new ApiError('not_configured', 'The database is not configured for this deployment yet.');
	}
	if (!g.__nc_pool) {
		g.__nc_pool = new pg.Pool({
			// Verified TLS whatever sslmode the URL carries (see db-tls.mjs).
			...tlsConnectionConfig(connectionString),
			max: 5,
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 10_000,
			// A stalled query fails fast instead of eating the request (TES-62).
			statement_timeout: 10_000,
			query_timeout: 10_000
		});
		g.__nc_pool.on('error', (error) => {
			const code = typeof (error as NodeJS.ErrnoException).code === 'string' ? (error as NodeJS.ErrnoException).code : undefined;
			console.error(`[db] idle client error: ${error.name}${code ? ` code=${code}` : ''}`);
		});
	}
	return g.__nc_pool;
}

/** Parameterised query. Values always go through `params`, never into `text`. */
export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
	return (await pool().query<T>(text, params)).rows;
}

export async function queryOne<T extends QueryResultRow>(
	text: string,
	params: unknown[] = []
): Promise<T | null> {
	return (await query<T>(text, params))[0] ?? null;
}

/** Tests only: end the pool so the next query builds one from DATABASE_URL again. */
export async function closePool(): Promise<void> {
	const current = g.__nc_pool;
	g.__nc_pool = undefined;
	await current?.end();
}

/**
 * Runs `fn` inside a single transaction on one checked-out client: `fn`
 * receives a `query`-shaped function bound to that client, so every call it
 * makes shares the transaction. Commits on a normal return, rolls back (and
 * rethrows) on a throw, and always releases the client back to the pool.
 */
export async function withTransaction<T>(fn: (run: typeof query) => Promise<T>): Promise<T> {
	const client = await pool().connect();
	const run = (async <U extends QueryResultRow>(text: string, params: unknown[] = []): Promise<U[]> => {
		return (await client.query<U>(text, params)).rows;
	}) as typeof query;

	try {
		await client.query('begin');
		const result = await fn(run);
		await client.query('commit');
		return result;
	} catch (error) {
		try {
			await client.query('rollback');
		} catch {
			// The connection may already be unusable (e.g. it died mid-transaction);
			// the original error is what matters, so swallow the rollback failure.
		}
		throw error;
	} finally {
		client.release();
	}
}
