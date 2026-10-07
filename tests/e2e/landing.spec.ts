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

test('at desktop width the landing page shows no phone note', async ({ page }) => {
	// 900 px is the narrowest width the app serves as desktop (the notices show under it).
	await page.setViewportSize({ width: 900, height: 800 });
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: 'A conversation is a graph, not a list.' })).toBeVisible();
	await expect(page.getByRole('note')).toBeHidden();
});

test('the tab icon is our own, and the page can load it', async ({ page, request }) => {
	await page.goto('/');
	// The server sends href="/favicon.svg"; once hydrated the attribute reads as an absolute URL, so compare the
	// resolved address (the `href` property), which is the same either way.
	await expect(page.locator('link[rel="icon"]')).toHaveJSProperty('href', new URL('/favicon.svg', page.url()).href);
	const response = await request.get('/favicon.svg');
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toMatch(/^image\/svg\+xml\b/);
	// Loaded by the page itself, under its Content-Security-Policy (img-src 'self'): a blocked file or an
	// SVG that is not well-formed XML fails to decode here, where a status check would pass it.
	const decoded = await page.evaluate(
		() =>
			new Promise<boolean>((resolve) => {
				const image = new Image();
				image.onload = () => resolve(true);
				image.onerror = () => resolve(false);
				image.src = '/favicon.svg';
			})
	);
	expect(decoded).toBe(true);
});

test('a shared link unfurls with a title, a description and a 1200 × 630 picture', async ({ page, request }) => {
	await page.goto('/');
	const property = (name: string) => page.locator(`meta[property="${name}"]`);
	await expect(property('og:site_name')).toHaveAttribute('content', 'node-canvas');
	await expect(property('og:title')).toHaveAttribute('content', 'A conversation is a graph, not a list');
	await expect(property('og:description')).toHaveAttribute('content', /^Branch any reply into a new direction/);
	await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Branch any reply into a new direction/);
	await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
	const image = await property('og:image').getAttribute('content');
	// Absolute, on this deployment's own origin: a crawler has no page to resolve a relative path against.
	expect(image).toBe(new URL('/og.png', page.url()).href);
	const response = await request.get(image!);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('image/png');
	const png = await response.body();
	// A PNG's IHDR chunk carries width and height as big-endian integers at bytes 16 and 20.
	expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
});
