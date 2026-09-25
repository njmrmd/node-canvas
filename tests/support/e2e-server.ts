// Everything Playwright's webServer needs: a fresh migrated database, the
// fake Anthropic API, and `vite preview` (a production build, so SvelteKit's
// cross-site form check is active) wired to both.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { migrate } from '../../scripts/migrate.mjs';
import { startFakeAnthropic } from './fake-anthropic';

const APP_PORT = 4173;
const FAKE_ANTHROPIC_PORT = 4011;
const PG_PORT = 55433;

let admin = process.env.TEST_DATABASE_URL;
let server: EmbeddedPostgres | undefined;
let dataDir: string | undefined;

if (!admin) {
	dataDir = await mkdtemp(path.join(tmpdir(), 'node-canvas-e2e-pg-'));
	server = new EmbeddedPostgres({
		databaseDir: dataDir,
		port: PG_PORT,
		user: 'postgres',
		password: 'postgres',
		persistent: false,
		onLog: () => {}
	});
	await server.initialise();
	await server.start();
	admin = `postgres://postgres:postgres@localhost:${PG_PORT}/postgres?sslmode=disable`;
}

const name = `e2e_${randomBytes(4).toString('hex')}`;
const adminClient = new pg.Client({ connectionString: admin });
await adminClient.connect();
await adminClient.query(`create database ${name}`);
await adminClient.end();
const url = new URL(admin);
url.pathname = `/${name}`;
await migrate(url.toString(), { log: () => {} });

const fake = await startFakeAnthropic(FAKE_ANTHROPIC_PORT);

const preview = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(APP_PORT), '--strictPort'], {
	stdio: 'inherit',
	env: {
		...process.env,
		DATABASE_URL: url.toString(),
		KEY_VAULT_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
		ANTHROPIC_BASE_URL: fake.url
	}
});

async function shutdown(code = 0) {
	preview.kill('SIGTERM');
	await fake.close();
	if (server) {
		await server.stop();
		await rm(dataDir!, { recursive: true, force: true });
	}
	process.exit(code);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
preview.on('exit', (code) => {
	if (code) void shutdown(code);
});
