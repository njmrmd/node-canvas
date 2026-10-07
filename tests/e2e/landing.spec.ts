import { expect, test } from './fixtures';

test('a stranger sees what this is, and the way in', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'A conversation is a graph, not a list.' })).toBeVisible();
	await expect(page.locator('.drawing svg[aria-hidden="true"]')).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: 'How it works' })).toBeVisible();
	await expect(page.locator('ol.steps > li')).toHaveCount(3);
	await expect(page.getByRole('link', { name: 'Anthropic API key' })).toHaveAttribute('href', 'https://console.anthropic.com/settings/keys');
	await page.getByRole('link', { name: 'Create an account' }).click();
	await expect(page).toHaveURL(/\/sign-up$/);
	await page.goto('/');
	await page.getByRole('link', { name: 'Sign in', exact: true }).click();
	await expect(page).toHaveURL(/\/sign-in$/);
});

test('someone signed in is welcomed back, not pitched to', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'Welcome back.' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Manage your key' })).toHaveAttribute('href', '/keys');
	await page.getByRole('link', { name: 'Open the canvas' }).click();
	await expect(page).toHaveURL(/\/canvas$/);
});

test('on a phone-width window the landing page stays readable, with the desktop note above it', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'A conversation is a graph, not a list.' })).toBeVisible();
	await expect(page.getByRole('note')).toContainText('node-canvas is built for desktop');
	await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
	// Every other page is the app, and the full notice replaces it.
	await page.goto('/sign-in');
	await expect(page.getByRole('heading', { name: 'node-canvas is built for desktop' })).toBeVisible();
	await expect(page.getByLabel('Email')).toBeHidden();
});
