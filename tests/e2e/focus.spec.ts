import { expect, test } from './fixtures';
import { fit, send } from './helpers';

test('cards off the path to the composer target are dimmed, and the toggle turns it off', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	const a = await send(page, 'first root');
	const b = await send(page, 'its reply');
	await expect(page.locator('.svelte-flow__edge.on-path')).toHaveCount(1);
	await expect(page.locator('.svelte-flow__edge.on-path .svelte-flow__edge-path')).toHaveCSS('stroke-width', '2px');
	await expect(page.locator('.svelte-flow__edge.on-path')).toHaveCSS('transition-property', 'opacity');
	await page.getByRole('button', { name: 'New conversation' }).click();
	const c = await send(page, 'second root');
	const card = (id: string) => page.locator(`article[data-node-id="${id}"]`);
	await fit(page);
	await expect(card(a)).toHaveClass(/\bdim\b/);
	await expect(card(b)).toHaveClass(/\bdim\b/);
	await expect(card(c)).not.toHaveClass(/\bdim\b/);
	await card(a).getByRole('button', { name: 'Branch' }).click();
	await expect(card(a)).not.toHaveClass(/\bdim\b/);
	await expect(card(b)).toHaveClass(/\bdim\b/); // below the target is off the root → target path
	await expect(card(c)).toHaveClass(/\bdim\b/);
	await page.getByRole('button', { name: 'Focus path' }).click();
	await expect(page.locator('article.dim')).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Focus path' })).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('article.dim')).toHaveCount(0);
});

test('the linear view shows the path to the target and copies it', async ({ page, context, signIn }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await signIn();
	await page.goto('/canvas');
	await send(page, 'question one');
	await send(page, 'question two');
	await page.getByRole('button', { name: 'Linear view' }).click();
	const panel = page.getByRole('region', { name: 'Linear view' });
	await expect(panel.locator('.you')).toHaveText(['question one', 'question two']);
	await page.getByRole('button', { name: 'Focus path' }).click();
	await expect(page.getByRole('button', { name: 'Focus path' })).toHaveAttribute('aria-pressed', 'false');
	await page.getByRole('button', { name: 'Focus path' }).click();
	await expect(panel.locator('.reply').first()).toContainText('Echo: question one.');
	await panel.getByRole('button', { name: 'Copy all' }).click();
	await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible();
	const text = await page.evaluate(() => navigator.clipboard.readText());
	expect(text).toMatch(/^You: question one\n\nAssistant: Echo: question one\.[\s\S]*\n\n---\n\nYou: question two\n\nAssistant: Echo: question two\./);
	await panel.getByRole('button', { name: 'Close linear view' }).click();
	await expect(panel).toHaveCount(0);
});

test('Copy all says so when the clipboard refuses', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, 'copy refused');
	await page.evaluate(() => {
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
			configurable: true
		});
	});
	await page.getByRole('button', { name: 'Linear view' }).click();
	const panel = page.getByRole('region', { name: 'Linear view' });
	await panel.getByRole('button', { name: 'Copy all' }).click();
	await expect(panel.getByRole('button', { name: "Couldn't copy" })).toBeVisible();
});

test('the shortcuts sheet lists all 21 shortcuts', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
	const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
	await expect(sheet.locator('kbd')).toHaveCount(21);
	await expect(sheet).toContainText('Move focus to parent / first child / sibling');
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(sheet).toHaveCount(0);
});
