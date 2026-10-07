import { expect, test } from './fixtures';
import { savedNodesText, send, settled } from './helpers';

test('a send after the session has ended says so, with a way back in', async ({ page, context, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'before the session ends');
	await context.clearCookies();
	const id = await send(page, 'after the session ends', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toHaveAttribute('data-status', 'error');
	await expect(card).toContainText(
		"You've been signed out. Sign in again in the new tab this opens, then come back here — this tab keeps your changes and saves them."
	);
	const link = card.getByRole('link', { name: 'Sign in (new tab)' });
	await expect(link).toHaveAttribute('href', '/sign-in?next=%2F');
	await expect(link).toHaveAttribute('target', '_blank');
	// Following it opens another tab and leaves this one on the canvas, so its unsaved changes are not torn down by a navigation.
	const [newTab] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }), link.click()]);
	await expect(newTab).toHaveURL(/\/sign-in\?next=%2F$/);
	expect(new URL(page.url()).pathname).toBe('/canvas');
	await expect(card).toBeVisible();
});

test('after signing in again elsewhere, the signed-out tab saves what it kept', async ({ page, context, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'before the session ends');
	const session = await context.cookies();
	await context.clearCookies();
	const prompt = 'made while signed out';
	const id = await send(page, prompt, { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toHaveAttribute('data-status', 'error');
	// A change made while signed out: drag the new card.
	await settled(page);
	const title = card.locator('.prompt');
	const box = (await title.boundingBox())!;
	await page.mouse.move(box.x + 20, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + 20 + 40, box.y + box.height / 2, { steps: 20 });
	await page.mouse.up();
	// Signing in again in another tab sets the cookie this context shares.
	await context.addCookies(session);
	// Both the card and the drag (a dragged card is saved as "manual") reach the server, from the tab that kept them.
	await expect.poll(() => savedNodesText(page), { timeout: 30_000 }).toContain(prompt);
	await expect.poll(() => savedNodesText(page), { timeout: 30_000 }).toContain('"manual"');
});

test('a send with no key connected points to the key page', async ({ page, signIn }) => {
	await signIn();
	await page.route('**/api/chat', (route) =>
		route.fulfill({
			status: 409,
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

test('after choosing another model, Retry uses it instead of the one that is gone', async ({ page, signIn }) => {
	await signIn();
	const models: string[] = [];
	await page.route('**/api/chat', async (route) => {
		const { model } = route.request().postDataJSON() as { model: string };
		models.push(model);
		if (model === 'claude-opus-5-5') {
			await route.fulfill({
				status: 400,
				contentType: 'application/json',
				body: JSON.stringify({ error: { code: 'unsupported_model', message: 'x' } })
			});
		} else {
			await route.continue();
		}
	});
	await page.goto('/canvas');
	const id = await send(page, 'ask the one that is gone', { wait: false });
	const card = page.locator(`article[data-node-id="${id}"]`);
	await expect(card).toContainText("This model isn't available any more. Choose another in the top bar, then press Retry.");
	await page.getByLabel('Model').selectOption({ label: 'Claude Haiku 4.5' });
	await card.getByRole('button', { name: 'Retry' }).click();
	await expect(card).toHaveAttribute('data-status', 'complete', { timeout: 30_000 });
	expect(models.at(-1)).toBe('claude-haiku-4-5');
});
