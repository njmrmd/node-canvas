#!/usr/bin/env node
// Applies every db/migrations/*.sql exactly once, in filename order, each in
// a transaction, recording what it applied in schema_migrations.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { tlsConnectionConfig } from '../src/lib/server/db-tls.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

/**
 * @param {string} connectionString
 * @param {{ log?: (line: string) => void }} [options]
 * @returns {Promise<number>} how many migrations were applied
 */
export async function migrate(connectionString, { log = console.log } = {}) {
	const client = new pg.Client(tlsConnectionConfig(connectionString));
	await client.connect();
	try {
		await client.query(
			'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())'
		);
		const applied = new Set(
			(await client.query('select name from schema_migrations')).rows.map((row) => row.name)
		);
		const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
		let ran = 0;
		for (const name of files) {
			if (applied.has(name)) continue;
			const sql = await readFile(path.join(dir, name), 'utf8');
			await client.query('begin');
			try {
				await client.query(sql);
				await client.query('insert into schema_migrations (name) values ($1)', [name]);
				await client.query('commit');
			} catch (error) {
				await client.query('rollback');
				throw error;
			}
			log(`applied ${name}`);
			ran += 1;
		}
		return ran;
	} finally {
		await client.end();
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
	if (!url) {
		console.error('DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set. See .env.example.');
		process.exit(1);
	}
	const ran = await migrate(url);
	console.log(ran === 0 ? 'Already up to date.' : `Applied ${ran} migration(s).`);
}
