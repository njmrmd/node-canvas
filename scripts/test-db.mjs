#!/usr/bin/env node
// Runs src/**/*.dbtest.ts against a real Postgres: TEST_DATABASE_URL when set
// (CI's service container), otherwise an embedded Postgres started here.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

/**
 * embedded-postgres's stop() can hang forever instead of rejecting: if the
 * server process already exited on its own (e.g. it failed to bind its port
 * and shut down before we call stop()), stop() registers an 'exit' listener
 * *after* that event already fired, so its promise never settles. Nothing
 * about that dangling promise keeps the event loop alive, so the script
 * would exit on its own anyway - but ends up skipping whatever cleanup was
 * sequenced after the `await`, silently. Race a timeout so cleanup always
 * runs even when stop() can't tell us it's done.
 */
async function stopServer(instance) {
	await Promise.race([instance.stop().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5000))]);
}

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
	try {
		await server.initialise();
		await server.start();
	} catch (error) {
		// The server may or may not have come up far enough to need stopping;
		// either way, don't leave it running or the temp dir behind.
		await stopServer(server);
		await rm(dir, { recursive: true, force: true });
		console.error('[test-db] failed to start embedded Postgres:', error?.message ?? error);
		process.exit(1);
	}
	url = `postgres://postgres:postgres@localhost:${port}/postgres?sslmode=disable`;
}

const code = await new Promise((resolve) => {
	const child = spawn(
		process.execPath,
		['--import', 'tsx', '--test', '--test-concurrency=1', ...(targets.length ? targets : ['src/**/*.dbtest.ts'])],
		{ stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url } }
	);
	child.on('error', () => resolve(1));
	child.on('exit', (exitCode) => resolve(exitCode ?? 1));
});

if (server) {
	await stopServer(server);
	await rm(dir, { recursive: true, force: true });
}
process.exit(code);
