import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { savedNodesText, send, sleep, viewport } from './helpers';

test('below 900 pixels wide the app says it is built for desktop', async ({ page }) => {
	await page.setViewportSize({ width: 800, height: 900 });
	await page.goto('/sign-in');
	const notice = page.getByRole('heading', { name: 'node-canvas is built for desktop' });
	await expect(notice).toBeVisible();
	await expect(page.getByLabel('Email')).toBeHidden();
	await page.setViewportSize({ width: 1200, height: 900 });
	await expect(notice).toBeHidden();
	await expect(page.getByLabel('Email')).toBeVisible();
});

test('the notice takes over at 899 pixels and the page at 900, and the notice is the main region', async ({ page }) => {
	const notice = page.getByRole('main', { name: 'node-canvas is built for desktop' });
	await page.setViewportSize({ width: 900, height: 900 });
	await page.goto('/sign-in');
	await expect(page.getByLabel('Email')).toBeVisible();
	await expect(notice).toBeHidden();
	await page.setViewportSize({ width: 899, height: 900 });
	await expect(notice).toBeVisible();
	await expect(page.getByLabel('Email')).toBeHidden();
	await page.setViewportSize({ width: 900, height: 900 });
	await expect(notice).toBeHidden();
	await expect(page.getByLabel('Email')).toBeVisible();
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('the notice is plain CSS: it shows at 800 pixels and gives way at 1200', async ({ page }) => {
		const notice = page.getByRole('heading', { name: 'node-canvas is built for desktop' });
		await page.setViewportSize({ width: 800, height: 900 });
		await page.goto('/sign-in');
		await expect(notice).toBeVisible();
		await expect(page.getByLabel('Email')).toBeHidden();
		await page.setViewportSize({ width: 1200, height: 900 });
		await expect(notice).toBeHidden();
		await expect(page.getByLabel('Email')).toBeVisible();
	});
});

/** The flow's own transform. It stays readable behind the notice, where computed style reads `none`. */
const flowTransform = (page: Page) => page.locator('.svelte-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);

test('narrowing the window mid-reply neither pans the view nor lets the keys act on it', async ({ page, signIn }) => {
	await signIn();
	await page.goto('/canvas');
	await send(page, '[slow][long] stream while the window narrows', { wait: false });
	await sleep(1000); // the framing pan is done, and the card has not yet outgrown the view
	const before = await viewport(page);
	const drawn = await flowTransform(page);

	await page.setViewportSize({ width: 800, height: 900 });
	await sleep(1200); // a score of words stream in behind the notice
	const behindNotice = await flowTransform(page);
	expect.soft(behindNotice, 'the view stays put while the reply streams behind the notice').toBe(drawn);

	await page.keyboard.press('0'); // zoom to 100%
	await page.keyboard.press('l'); // tidy
	await sleep(400);
	expect.soft(await flowTransform(page), 'the shortcuts do nothing behind the notice').toBe(behindNotice);

	await page.setViewportSize({ width: 1440, height: 900 });
	await sleep(300);
	expect(await viewport(page)).toEqual(before);

	// Stop the reply and let the save land, so the test does not close the page mid-stream and mid-save.
	await page.getByRole('button', { name: 'Stop' }).click();
	await expect.poll(() => savedNodesText(page), { timeout: 15_000 }).toContain('"interrupted"');
});
