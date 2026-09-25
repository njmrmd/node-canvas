#!/usr/bin/env node
// Runs src/**/*.dbtest.ts against a real Postgres: TEST_DATABASE_URL when set
// (CI's service container), otherwise an embedded Postgres started here.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const targets = process.argv.slice(2);
let url = process.env.TEST_DATABASE_URL;
let server;
let dir;

if (!url) {
	dir = await mkdtemp(path.join(tmpdir(), 'node-canvas-pg-'));
	const port = 55432;
	server = new EmbeddedPostgres({
		databaseDir: dir,
		port,
		user: 'postgres',
		password: 'postgres',
		persistent: false,
		onLog: () => {}
	});
	await server.initialise();
	await server.start();
	url = `postgres://postgres:postgres@localhost:${port}/postgres?sslmode=disable`;
}

const code = await new Promise((resolve) => {
	const child = spawn(
		process.execPath,
		['--import', 'tsx', '--test', '--test-concurrency=1', ...(targets.length ? targets : ['src/**/*.dbtest.ts'])],
		{ stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url } }
	);
	child.on('exit', (exitCode) => resolve(exitCode ?? 1));
});

if (server) {
	await server.stop();
	await rm(dir, { recursive: true, force: true });
}
process.exit(code);
