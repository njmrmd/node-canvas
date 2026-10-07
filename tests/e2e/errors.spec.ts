import { expect, test } from './fixtures';
import { send } from './helpers';

test('a send after the session has ended says so, with a way back in', async ({ page, context, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'before the session ends');
	await context.clearCookies();
	const id = await send(page, 'after the session ends', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toHaveAttribute('data-status', 'error');
	await expect(card).toContainText("You've been signed out. Sign in again to keep going.");
	await expect(card.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in?next=%2Fcanvas');
});

test('a send with no key connected points to the key page', async ({ page, signIn }) => {
	await signIn();
	await page.route('**/api/chat', (route) =>
		route.fulfill({
			status: 400,
			contentType: 'application/json',
			body: JSON.stringify({ error: { code: 'no_key_configured', message: 'Connect a key first.' } })
		})
	);
	await page.goto('/canvas');
	const id = await send(page, 'no key behind this', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toContainText('No model key is connected. Connect one on the key page.');
	await expect(card.getByRole('link', { name: 'Open the key page' })).toHaveAttribute('href', '/keys');
});
