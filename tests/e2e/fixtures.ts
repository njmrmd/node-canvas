import { test as base, expect } from '@playwright/test';
import type { RecordedRequest } from '../support/fake-anthropic';
import type { SeedRequest, SeedResponse } from '../support/seed-server';

export const FAKE_ANTHROPIC = 'http://127.0.0.1:4011';
const SEED = 'http://127.0.0.1:4012';

/** `signIn()` seeds a fresh user (with a key by default) and sets their session cookie. */
export const test = base.extend<{ signIn: (options?: SeedRequest) => Promise<{ email: string; userId: string }> }>({
	signIn: async ({ context }, use) => {
		await use(async (options = {}) => {
			const res = await fetch(`${SEED}/seed`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(options)
			});
			if (!res.ok) throw new Error(`seed failed: ${res.status}`);
			const seeded = (await res.json()) as SeedResponse;
			await context.addCookies([
				{ name: 'nc_session', value: seeded.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }
			]);
			return { email: seeded.email, userId: seeded.userId };
		});
	}
});

export { expect };

export async function anthropicRequests(): Promise<RecordedRequest[]> {
	return (await fetch(`${FAKE_ANTHROPIC}/__requests`)).json();
}

export async function resetAnthropic(): Promise<void> {
	await fetch(`${FAKE_ANTHROPIC}/__reset`, { method: 'POST' });
}
