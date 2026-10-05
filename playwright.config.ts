import { defineConfig, devices } from '@playwright/test';

// Desktop only. `pnpm test:e2e` builds first; the server script boots a fresh
// Postgres database, a fake Anthropic API and `vite preview`.
export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 60_000,
	retries: 0,
	workers: 1,
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
	webServer: {
		command: 'node --import tsx tests/support/e2e-server.ts',
		url: 'http://localhost:4173/api/health',
		reuseExistingServer: false,
		timeout: 180_000,
		gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 }
	},
	projects: [
		{ name: 'desktop', testIgnore: /perf\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
		// Machine-dependent, so not part of CI: run with `pnpm test:perf`.
		...(process.env.PERF
			? [{ name: 'perf', testMatch: /perf\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }]
			: [])
	]
});
