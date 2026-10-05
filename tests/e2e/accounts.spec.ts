import { expect, test, type Page } from '@playwright/test';
import { GOOD_KEY } from '../support/fake-anthropic';

// The real sign-up limit (5 per IP per hour) applies here too, and every test
// runs from 127.0.0.1 against one fresh database. Budget: this file makes at
// most 5 counted sign-up attempts. Reuse accounts rather than adding sign-ups.
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
	// The click returns before the server has hashed the password and created the
	// account. Navigating away now abandons the sign-up mid-flight; the redirect to
	// /keys is the signal that the account exists.
	await expect(page).toHaveURL(/\/keys$/);
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
	const scriptSrc = csp.split(';').find((directive) => directive.trim().startsWith('script-src')) ?? '';
	expect(scriptSrc).not.toContain('unsafe-inline');
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

test('a stale-session form action redirects to sign-in instead of erroring', async ({ page, context }) => {
	const address = email('stale-session');
	await signUp(page, address);
	await expect(page).toHaveURL(/\/keys$/);
	await context.clearCookies();

	const pageErrors: Error[] = [];
	page.on('pageerror', (error) => pageErrors.push(error));

	await page.getByLabel('Anthropic API key').fill(GOOD_KEY);
	await page.getByRole('button', { name: 'Verify and save key' }).click();

	// The action posts to /keys?/connect, so the preserved "next" carries that
	// suffix too; what matters is that it lands back on the keys screen and
	// never tries to deserialise the sign-in HTML as a form-action result.
	await expect(page).toHaveURL(/\/sign-in\?next=%2Fkeys/);
	expect(pageErrors).toEqual([]);
});

test('the whole account journey: key, sign out, sign in, delete', async ({ page }) => {
	const address = email('journey');
	await signUp(page, address);
	await expect(page).toHaveURL(/\/keys$/);
	await expect(page.getByText('No key connected yet.')).toBeVisible();
	await expect(page.getByText(address)).toBeVisible();

	// A key Anthropic rejects: explained on the screen where it was pasted.
	await page.getByLabel('Anthropic API key').fill('sk-ant-api03-wrong');
	await page.getByRole('button', { name: 'Verify and save key' }).click();
	await expect(page.getByText('Anthropic rejected that key')).toBeVisible();

	// A good key: stored, shown only as its last four characters.
	await page.getByLabel('Anthropic API key').fill(GOOD_KEY);
	await page.getByRole('button', { name: 'Verify and save key' }).click();
	await expect(page.getByText('Key verified and saved')).toBeVisible();
	await expect(page.getByText(`Connected — key ending ${GOOD_KEY.slice(-4)}`)).toBeVisible();
	await expect(page.locator('body')).not.toContainText(GOOD_KEY.slice(0, 20));

	await page.getByRole('button', { name: 'Remove key' }).click();
	await expect(page.getByText('No key connected yet.')).toBeVisible();

	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/$/);
	await page.goto('/keys');
	await expect(page).toHaveURL(/\/sign-in\?next=%2Fkeys$/);

	await signIn(page, address);
	await expect(page).toHaveURL(/\/keys$/);

	await page.getByRole('button', { name: 'Delete account' }).click();
	await expect(page.getByText('Tick the box to confirm.')).toBeVisible();
	await page.getByLabel('I understand this deletes everything').check();
	await page.getByRole('button', { name: 'Delete account' }).click();
	await expect(page).toHaveURL(/\/$/);

	await page.goto('/sign-in');
	await signIn(page, address);
	await expect(page.getByText('That email and password do not match.')).toBeVisible();
});
