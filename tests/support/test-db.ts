import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../scripts/migrate.mjs';
import { closePool } from '../../src/lib/server/db';

/**
 * A brand-new, migrated database for one test file. Points the app's pool
 * (process.env.DATABASE_URL) at it; `drop()` closes the pool and removes it.
 */
export async function freshDatabase(): Promise<{ drop: () => Promise<void> }> {
	const admin = process.env.TEST_DATABASE_URL;
	if (!admin) throw new Error('TEST_DATABASE_URL is not set. Run database tests with `pnpm test:db`.');

	const name = `t_${randomBytes(6).toString('hex')}`;
	await adminQuery(admin, `create database ${name}`);
	const url = new URL(admin);
	url.pathname = `/${name}`;
	try {
		await migrate(url.toString(), { log: () => {} });
	} catch (error) {
		await adminQuery(admin, `drop database ${name} with (force)`);
		throw error;
	}
	process.env.DATABASE_URL = url.toString();

	return {
		drop: async () => {
			await closePool();
			await adminQuery(admin, `drop database ${name} with (force)`);
		}
	};
}

async function adminQuery(connectionString: string, sql: string): Promise<void> {
	const client = new pg.Client({ connectionString });
	await client.connect();
	try {
		await client.query(sql);
	} finally {
		await client.end();
	}
}
