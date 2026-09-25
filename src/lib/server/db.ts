import pg, { type QueryResultRow } from 'pg';
import { ApiError } from './api-error';
import { tlsConnectionConfig } from './db-tls.mjs';

// One pool per server instance, kept on globalThis so dev hot reloads reuse
// it. max: 1 because a Vercel function instance serves one request at a time;
// point DATABASE_URL at a pooled endpoint.
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
			max: 1,
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 10_000,
			// A stalled query fails fast instead of eating the request (TES-62).
			statement_timeout: 10_000,
			query_timeout: 10_000
		});
		g.__nc_pool.on('error', (error) => {
			console.error('[db] idle client error:', error.message);
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
