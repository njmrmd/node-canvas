import { expect, test, type Page } from '@playwright/test';

// The real sign-up limit (5 per IP per hour) applies here too, and every test
// runs from 127.0.0.1 against one fresh database. Budget: this file makes at
// most 4 counted sign-up attempts. Reuse accounts rather than adding sign-ups.
const email = (tag: string) => `e2e-${tag}-${Date.now()}@example.test`;
const PASSWORD = 'correct horse battery staple';

async function signUp(page: Page, address: string, password = PASSWORD) {
	await page.goto('/sign-up');
	await page.getByLabel('Email').fill(address);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Create account' }).click();
}

async function signIn(page: Page, address: string, password = PASSWORD) {
	await page.getByLabel('Email').fill(address);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
}

test('sign-up validates before it counts against the limit', async ({ page }) => {
	await signUp(page, 'not-an-email', 'short');
	await expect(page.getByText('That does not look like an email address')).toBeVisible();
	await expect(page.getByText('Use at least 10 characters')).toBeVisible();
	await expect(page).toHaveURL(/\/sign-up$/);
});

test('a taken email is refused without revealing anything else', async ({ page, context }) => {
	const address = email('taken');
	await signUp(page, address);
	await expect(page).toHaveURL(/\/keys$/);
	await context.clearCookies();
	await signUp(page, address);
	await expect(page.getByText('An account already exists for that email')).toBeVisible();
});

test('a protected page sends you to sign in, then back', async ({ page, context }) => {
	const address = email('next');
	await signUp(page, address);
	await context.clearCookies();
	await page.goto('/canvas');
	await expect(page).toHaveURL(/\/sign-in\?next=%2Fcanvas$/);
	await signIn(page, address);
	await expect(page).toHaveURL(/\/canvas$/);
});

test('wrong password is a generic refusal', async ({ page }) => {
	await page.goto('/sign-in');
	await signIn(page, email('nobody'), 'definitely-not-it');
	await expect(page.getByText('That email and password do not match.')).toBeVisible();
});

test('responses carry the security headers and a CSP', async ({ request }) => {
	const res = await request.get('/sign-in');
	const csp = res.headers()['content-security-policy'] ?? '';
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).toMatch(/script-src 'self' ('nonce-|'sha256-)/);
	expect(res.headers()['x-content-type-options']).toBe('nosniff');
	expect(res.headers()['x-frame-options']).toBe('DENY');
});

test('a cross-site form post is rejected', async ({ request }) => {
	const res = await request.post('/sign-in', {
		form: { email: 'x@example.test', password: 'whatever-long' },
		headers: { origin: 'https://evil.example' }
	});
	expect(res.status()).toBe(403);
});
