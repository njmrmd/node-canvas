import { expect, test } from './fixtures';

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
